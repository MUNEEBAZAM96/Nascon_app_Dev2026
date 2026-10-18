import { createHash, createHmac } from 'node:crypto';

import { loadConfig } from '../config';

// Matches Python json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot encode NaN or Infinity.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((key) => obj[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
}

export function sign(salt: string, id: string, payload: unknown): string {
  const message = `${id}|${canonical(payload)}`;
  return createHmac('sha256', Buffer.from(salt, 'utf8')).update(Buffer.from(message, 'utf8')).digest('hex');
}

/**
 * Day 2 HMAC via DAY2_SALT and the same canonical() as sign().
 * Section 5.3 sig_payload key sets (entity id in parentheses):
 * - Stream key (stream_key): action, player_id, status, stream_key
 * - Co-stream (session_id): active_host, handoff_occurred, layout, participant_count, session_id, status
 * - QR (entity_id): entity_id, short_url, target_route
 * - Cart merge (guest_token): cart_merged, guest_token, registered_user_id, total_items, write_rejection_code
 * - Moderation (chat_room_id): chat_room_id, flagged_count, kicked_users, queue_depth
 * Match events and checkout receipts use sign() with DAY1_SALT only.
 */
export function signDay2(entityId: string, sigPayload: unknown): string {
  const salt = loadConfig().day2Salt;
  if (salt === undefined || salt === '') {
    throw new Error('DAY2_SALT is missing or empty');
  }
  return sign(salt, entityId, sigPayload);
}

export function lotsKey(seed: number, leagueId: string, teamId: string): string {
  return createHash('sha256').update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}
