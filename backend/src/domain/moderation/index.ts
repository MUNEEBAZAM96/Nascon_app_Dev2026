import type { PoolClient } from 'pg';
import { z } from 'zod';

import { signDay2 } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);

const Message = z.object({
  message_id: Id,
  sender_id: Id,
  text: z.string(),
});

const ModerationBody = z.object({
  chat_room_id: Id,
  messages: z.array(Message).max(100),
  simulate_failed_notifications: z.number().int().min(0).default(0),
});

type IncomingMessage = z.infer<typeof Message>;

const DICTIONARY = new Set([
  'badword',
  'porn',
  'scam',
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'idiotspam',
]);

const CHAR_MAP: Record<string, string> = {
  '@': 'a',
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '3': 'e',
  $: 's',
};

function mapChar(ch: string): string {
  const lower = ch.toLowerCase();
  return CHAR_MAP[lower] ?? lower;
}

/** Normalizes a substring for dictionary token matching. */
export function normalizeToken(text: string): string {
  const mapped = [...text].map(mapChar);
  let out = '';
  for (let i = 0; i < mapped.length; i += 1) {
    const ch = mapped[i];
    if (ch === '_' || ch === '.' || ch === '-' || ch === '*') {
      const prev = out.at(-1);
      const next = mapped[i + 1];
      if (prev && /[a-z0-9]/.test(prev) && next && /[a-z0-9]/.test(next)) continue;
    }
    out += ch;
  }
  return out;
}

export function isFlood(text: string): boolean {
  if (/(.)\1{3,}/i.test(text)) return true;
  if (/!{3,}/.test(text)) return true;
  if (/\?{3,}/.test(text)) return true;
  return false;
}

function findProfanitySpans(original: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < original.length; start += 1) {
    for (let end = start + 1; end <= original.length; end += 1) {
      const norm = normalizeToken(original.slice(start, end));
      if (DICTIONARY.has(norm)) spans.push({ start, end });
    }
  }
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const chosen: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    if (chosen.some((s) => span.start < s.end && span.end > s.start)) continue;
    chosen.push(span);
  }
  chosen.sort((a, b) => a.start - b.start);
  return chosen;
}

export function maskProfanity(original: string): { text: string; flagged: boolean } {
  const spans = findProfanitySpans(original);
  if (spans.length === 0) return { text: original, flagged: false };
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += original.slice(cursor, span.start);
    out += '***';
    cursor = span.end;
  }
  out += original.slice(cursor);
  return { text: out, flagged: true };
}

interface FilteredMessage {
  message_id: string;
  sender_id: string;
  text: string;
  flagged: boolean;
  reason: string | null;
}

function processMessages(messages: IncomingMessage[]): {
  filtered: FilteredMessage[];
  kicked_users: string[];
  muted_users: string[];
  flagged_count: number;
} {
  const filtered: FilteredMessage[] = [];
  const kicked: string[] = [];
  const muted: string[] = [];
  const kickedSet = new Set<string>();
  const mutedSet = new Set<string>();

  for (const msg of messages) {
    if (isFlood(msg.text)) {
      if (!mutedSet.has(msg.sender_id)) {
        mutedSet.add(msg.sender_id);
        muted.push(msg.sender_id);
      }
      continue;
    }
    const masked = maskProfanity(msg.text);
    if (masked.flagged) {
      if (!kickedSet.has(msg.sender_id)) {
        kickedSet.add(msg.sender_id);
        kicked.push(msg.sender_id);
      }
      filtered.push({
        message_id: msg.message_id,
        sender_id: msg.sender_id,
        text: masked.text,
        flagged: true,
        reason: 'profanity_leetspeak',
      });
      continue;
    }
    filtered.push({
      message_id: msg.message_id,
      sender_id: msg.sender_id,
      text: msg.text,
      flagged: false,
      reason: null,
    });
  }

  const flagged_count = filtered.filter((m) => m.flagged).length;
  return { filtered, kicked_users: kicked, muted_users: muted, flagged_count };
}

async function loadDlq(client: PoolClient, chatRoomId: string): Promise<Array<Record<string, unknown>>> {
  const result = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM moderation_dlq WHERE chat_room_id = $1 ORDER BY created_at ASC, id ASC`,
    [chatRoomId],
  );
  return result.rows.map((row) => row.payload);
}

async function pushDlq(
  client: PoolClient,
  chatRoomId: string,
  count: number,
  startIndex: number,
): Promise<Array<Record<string, unknown>>> {
  for (let i = 0; i < count; i += 1) {
    const idx = startIndex + i;
    const id = `${chatRoomId}:${idx}`;
    const payload = {
      notification_id: id,
      chat_room_id: chatRoomId,
      failed_at_index: idx,
    };
    await client.query(
      `INSERT INTO moderation_dlq (id, chat_room_id, payload) VALUES ($1, $2, $3::jsonb)`,
      [id, chatRoomId, JSON.stringify(payload)],
    );
  }
  return loadDlq(client, chatRoomId);
}

export async function moderateChat(input: unknown): Promise<Record<string, unknown>> {
  const body = parseBody(ModerationBody, input ?? {});
  const { filtered, kicked_users, muted_users, flagged_count } = processMessages(body.messages);

  const client = await getPool().connect();
  let undelivered: Array<Record<string, unknown>>;
  try {
    await client.query('BEGIN');
    const prior = await loadDlq(client, body.chat_room_id);
    if (body.simulate_failed_notifications > 0) {
      undelivered = await pushDlq(client, body.chat_room_id, body.simulate_failed_notifications, prior.length);
    } else {
      undelivered = prior;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const queue_depth = undelivered.length;
  const signature = signDay2(body.chat_room_id, {
    chat_room_id: body.chat_room_id,
    flagged_count,
    kicked_users,
    queue_depth,
  });

  return {
    chat_room_id: body.chat_room_id,
    filtered_messages: filtered,
    kicked_users,
    muted_users,
    flagged_count,
    dlq_status: {
      queue_depth,
      undelivered_events: undelivered,
    },
    signature,
  };
}
