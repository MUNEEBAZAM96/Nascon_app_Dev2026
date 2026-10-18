import { z } from 'zod';

import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';
import { transferPlayer } from '../roster';
import { appendEvent } from '../scoring';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const Id = z.string().regex(ID_PATTERN);

const SyncBody = z.object({
  device_id: Id,
  actions: z.array(z.object({
    action_id: Id,
    type: z.enum(['score_event', 'roster_transfer']),
    queued_at: z.string().regex(STAMP),
    base_version: z.number().int().min(0),
    payload: z.record(z.string(), z.unknown()),
  })).min(1).max(100),
});

type Action = z.infer<typeof SyncBody>['actions'][number];
type Status = 'applied' | 'rejected' | 'duplicate';
type Resolution = 'appended' | 'rebased_append' | 'skipped_duplicate' | 'server_wins';

interface ActionResult {
  action_id: string;
  status: Status;
  resolution: Resolution;
  error_code: string | null;
  processed_order: number;
  server_version: number;
  signature: string | null;
}

/** Replays queued device actions in queued_at order and reports per-action conflict resolution (Section 5.14). */
export async function replayOffline(input: unknown): Promise<{
  device_id: string;
  results: ActionResult[];
  summary: { applied: number; rejected: number; duplicate: number };
}> {
  const body = parseBody(SyncBody, input ?? {});
  const ordered = body.actions.map((action, index) => ({ action, index }));
  ordered.sort((left, right) => {
    if (left.action.queued_at < right.action.queued_at) return -1;
    if (left.action.queued_at > right.action.queued_at) return 1;
    return left.index - right.index;
  });

  const results = new Array<ActionResult>(body.actions.length);
  let processed = 0;
  for (const item of ordered) {
    processed += 1;
    results[item.index] = await settle(body.device_id, item.action, processed);
  }
  return {
    device_id: body.device_id,
    results,
    summary: {
      applied: results.filter((row) => row.status === 'applied').length,
      rejected: results.filter((row) => row.status === 'rejected').length,
      duplicate: results.filter((row) => row.status === 'duplicate').length,
    },
  };
}

async function settle(deviceId: string, action: Action, processedOrder: number): Promise<ActionResult> {
  const seen = await getPool().query(
    'SELECT 1 FROM offline_actions WHERE device_id = $1 AND action_id = $2',
    [deviceId, action.action_id],
  );
  if ((seen.rowCount ?? 0) > 0) {
    const version = await currentVersion(action);
    return done(action.action_id, 'duplicate', 'skipped_duplicate', null, processedOrder, version, null);
  }

  if (action.type === 'score_event') {
    const matchId = stringField(action.payload, 'match_id');
    if (!matchId || !(await rowExists('matches', matchId))) {
      return remember(deviceId, action, rejected(action.action_id, 'MATCH_NOT_FOUND', processedOrder, 0));
    }
    const version = await countRows('match_events', 'match_id', matchId);
    if (action.base_version > version) {
      return remember(deviceId, action, rejected(action.action_id, 'INVALID_BASE_VERSION', processedOrder, version));
    }
    try {
      const appended = await appendEvent(action.payload);
      if (appended.http_status === 200) {
        return remember(deviceId, action, done(action.action_id, 'duplicate', 'skipped_duplicate', null, processedOrder, version, null));
      }
      const after = await countRows('match_events', 'match_id', matchId);
      const resolution = action.base_version === version ? 'appended' : 'rebased_append';
      return remember(deviceId, action, done(action.action_id, 'applied', resolution, null, processedOrder, after, appended.signature));
    } catch (err) {
      return remember(deviceId, action, fromError(action.action_id, err, processedOrder, version));
    }
  }

  const playerId = stringField(action.payload, 'player_id');
  if (!playerId || !(await rowExists('players', playerId))) {
    return remember(deviceId, action, rejected(action.action_id, 'PLAYER_NOT_FOUND', processedOrder, 0));
  }
  const version = await countRows('roster_audit', 'player_id', playerId);
  if (action.base_version > version) {
    return remember(deviceId, action, rejected(action.action_id, 'INVALID_BASE_VERSION', processedOrder, version));
  }
  try {
    const moved = await transferPlayer(action.payload);
    if (moved.http_status === 200) {
      return remember(deviceId, action, done(action.action_id, 'duplicate', 'skipped_duplicate', null, processedOrder, version, null));
    }
    const after = await countRows('roster_audit', 'player_id', playerId);
    const resolution = action.base_version === version ? 'appended' : 'rebased_append';
    return remember(deviceId, action, done(action.action_id, 'applied', resolution, null, processedOrder, after, null));
  } catch (err) {
    return remember(deviceId, action, fromError(action.action_id, err, processedOrder, version));
  }
}

async function remember(deviceId: string, action: Action, result: ActionResult): Promise<ActionResult> {
  await getPool().query(
    'INSERT INTO offline_actions (device_id, action_id, result) VALUES ($1, $2, $3::jsonb)',
    [deviceId, action.action_id, JSON.stringify(result)],
  );
  return result;
}

async function currentVersion(action: Action): Promise<number> {
  if (action.type === 'score_event') {
    const matchId = stringField(action.payload, 'match_id');
    return matchId ? countRows('match_events', 'match_id', matchId) : 0;
  }
  const playerId = stringField(action.payload, 'player_id');
  return playerId ? countRows('roster_audit', 'player_id', playerId) : 0;
}

async function rowExists(table: 'matches' | 'players', id: string): Promise<boolean> {
  const result = await getPool().query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

async function countRows(table: 'match_events' | 'roster_audit', column: 'match_id' | 'player_id', id: string): Promise<number> {
  const result = await getPool().query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE ${column} = $1`,
    [id],
  );
  return Number(result.rows[0]?.n ?? 0);
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rejected(actionId: string, code: string, processedOrder: number, version: number): ActionResult {
  return done(actionId, 'rejected', 'server_wins', code, processedOrder, version, null);
}

function fromError(actionId: string, err: unknown, processedOrder: number, version: number): ActionResult {
  if (err instanceof AppError) return rejected(actionId, err.code, processedOrder, version);
  throw err;
}

function done(
  actionId: string,
  status: Status,
  resolution: Resolution,
  errorCode: string | null,
  processedOrder: number,
  serverVersion: number,
  signature: string | null,
): ActionResult {
  return {
    action_id: actionId,
    status,
    resolution,
    error_code: errorCode,
    processed_order: processedOrder,
    server_version: serverVersion,
    signature,
  };
}
