import { createHash, createHmac } from 'node:crypto';

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

/** Day 2 HMAC. The caller supplies DAY2_SALT. entityId is the signed id from Section 5.3. */
export function signDay2(salt: string, entityId: string, sigPayload: unknown): string {
  return sign(salt, entityId, sigPayload);
}

export function lotsKey(seed: number, leagueId: string, teamId: string): string {
  return createHash('sha256').update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}
