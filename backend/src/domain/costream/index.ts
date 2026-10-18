import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonical, signDay2 } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);
const Layout = z.enum(['solo', 'grid_2', 'grid_4', 'spotlight']);

const SessionBody = z.object({
  session_id: Id,
  host: Id,
  participants: z
    .array(Id)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'participants must be unique' }),
  simulate_host_drop: z.boolean().default(false),
  layout: Layout.default('grid_4'),
});

type SessionInput = z.infer<typeof SessionBody>;

export interface CostreamResponse {
  session_id: string;
  active_host: string | null;
  handoff_occurred: boolean;
  layout: SessionInput['layout'];
  participant_count: number;
  participants: string[];
  status: 'active' | 'terminated';
  composite_playback_url: string;
  chat_room_id: string;
  signature: string;
}

function requestHash(body: SessionInput): string {
  return createHash('sha256')
    .update(
      canonical({
        session_id: body.session_id,
        host: body.host,
        participants: body.participants,
        simulate_host_drop: body.simulate_host_drop,
        layout: body.layout,
      }),
      'utf8',
    )
    .digest('hex');
}

function remainingAfterDrop(body: SessionInput): string[] {
  if (!body.simulate_host_drop) return [...body.participants];
  if (body.participants.length === 1) return [];
  return body.participants.filter((id) => id !== body.host);
}

function assertLayout(body: SessionInput, remaining: string[]): void {
  if (body.layout === 'solo' && remaining.length > 1) {
    throw new AppError(400, 'UNSUPPORTED_LAYOUT', 'Layout does not support this participant count.', {
      layout: body.layout,
      participant_count: remaining.length,
    });
  }
  if (body.layout === 'grid_2' && remaining.length > 2) {
    throw new AppError(400, 'UNSUPPORTED_LAYOUT', 'Layout does not support this participant count.', {
      layout: body.layout,
      participant_count: remaining.length,
    });
  }
}

function buildSessionState(body: SessionInput): Omit<CostreamResponse, 'composite_playback_url' | 'chat_room_id' | 'signature'> {
  const { session_id, host, layout, simulate_host_drop, participants: requestParticipants } = body;

  if (!simulate_host_drop) {
    return {
      session_id,
      active_host: host,
      handoff_occurred: false,
      layout,
      participant_count: requestParticipants.length,
      participants: [...requestParticipants],
      status: 'active',
    };
  }

  if (requestParticipants.length === 1) {
    return {
      session_id,
      active_host: null,
      handoff_occurred: false,
      layout,
      participant_count: 0,
      participants: [],
      status: 'terminated',
    };
  }

  const remaining = requestParticipants.filter((id) => id !== host);
  return {
    session_id,
    active_host: remaining[0] ?? null,
    handoff_occurred: true,
    layout,
    participant_count: requestParticipants.length - 1,
    participants: remaining,
    status: 'active',
  };
}

function signSession(state: Omit<CostreamResponse, 'composite_playback_url' | 'chat_room_id' | 'signature'>): string {
  return signDay2(state.session_id, {
    active_host: state.active_host,
    handoff_occurred: state.handoff_occurred,
    layout: state.layout,
    participant_count: state.participant_count,
    session_id: state.session_id,
    status: state.status,
  });
}

function fullResponse(state: Omit<CostreamResponse, 'composite_playback_url' | 'chat_room_id' | 'signature'>): CostreamResponse {
  return {
    ...state,
    composite_playback_url: `http://localhost:8888/costream/${state.session_id}/index.m3u8`,
    chat_room_id: `chat-${state.session_id}`,
    signature: signSession(state),
  };
}

async function assertPlayersExist(participantIds: string[], hostId: string): Promise<void> {
  const unique = [...new Set([...participantIds, hostId])];
  const pool = getPool();
  for (const playerId of unique) {
    const row = await pool.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
    if (!row.rows[0]) {
      throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });
    }
  }
}

export async function createCostreamSession(input: unknown): Promise<{ http_status: 200 | 201 } & CostreamResponse> {
  const body = parseBody(SessionBody, input ?? {});

  await assertPlayersExist(body.participants, body.host);

  if (!body.participants.includes(body.host)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['host'] });
  }

  if (body.participants.length > 4) {
    throw new AppError(409, 'COSTREAM_SESSION_FULL', 'Co-stream session is full.', {
      max_participants: 4,
    });
  }

  const remaining = remainingAfterDrop(body);
  assertLayout(body, remaining);

  const hash = requestHash(body);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`costream:${body.session_id}`]);

    const prior = await client.query<{ request_hash: string; response: CostreamResponse }>(
      'SELECT request_hash, response FROM costream_sessions WHERE session_id = $1',
      [body.session_id],
    );
    const stored = prior.rows[0];
    if (stored) {
      if (stored.request_hash !== hash) {
        throw new AppError(409, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['session_id'] });
      }
      await client.query('COMMIT');
      return { http_status: 200, ...stored.response };
    }

    const response = fullResponse(buildSessionState(body));
    await client.query('INSERT INTO costream_sessions (session_id, request_hash, response) VALUES ($1, $2, $3::jsonb)', [
      body.session_id,
      hash,
      JSON.stringify(response),
    ]);
    await client.query('COMMIT');
    return { http_status: 201, ...response };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
