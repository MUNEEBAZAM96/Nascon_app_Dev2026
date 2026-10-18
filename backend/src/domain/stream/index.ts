import { randomBytes } from 'node:crypto';

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { signDay2 } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);
const STREAM_KEY_PATTERN = /^sk_live_[a-f0-9]{16}$/;

const StreamKeyBody = z.object({
  action: z.enum(['generate', 'rotate', 'revoke']),
  player_id: Id,
  label: z.string().min(1).max(64).default('default'),
  stream_key_override: z.string().regex(STREAM_KEY_PATTERN).optional(),
});

type StreamAction = z.infer<typeof StreamKeyBody>['action'];

function buildUrls(streamKey: string): {
  ingest_endpoints: { rtmp: string; whip: string };
  playback_url: string;
} {
  return {
    ingest_endpoints: {
      rtmp: `rtmp://localhost:1935/live/${streamKey}`,
      whip: `http://localhost:8889/live/${streamKey}/whip`,
    },
    playback_url: `http://localhost:8888/live/${streamKey}/index.m3u8`,
  };
}

function signStream(
  action: StreamAction,
  playerId: string,
  status: 'active' | 'revoked',
  streamKey: string,
): string {
  return signDay2(streamKey, { action, player_id: playerId, status, stream_key: streamKey });
}

function newStreamKey(): string {
  return `sk_live_${randomBytes(8).toString('hex')}`;
}

async function assertPlayerExists(playerId: string): Promise<void> {
  const pool = getPool();
  const player = await pool.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
  if (!player.rows[0]) {
    throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });
  }
}

async function findActiveKey(playerId: string, label: string): Promise<string | null> {
  const pool = getPool();
  const row = await pool.query<{ stream_key: string }>(
    `SELECT stream_key FROM stream_keys WHERE player_id = $1 AND label = $2 AND status = 'active' LIMIT 1`,
    [playerId, label],
  );
  return row.rows[0]?.stream_key ?? null;
}

async function assertKeyNotRevoked(streamKey: string): Promise<void> {
  const pool = getPool();
  const row = await pool.query<{ status: string }>(
    `SELECT status FROM stream_keys WHERE stream_key = $1 LIMIT 1`,
    [streamKey],
  );
  if (row.rows[0]?.status === 'revoked') {
    throw new AppError(409, 'KEY_REVOKED', 'Stream key has been revoked.', { stream_key: streamKey });
  }
}

async function revokeActiveSlot(client: PoolClient, playerId: string, label: string): Promise<void> {
  await client.query(
    `UPDATE stream_keys SET status = 'revoked' WHERE player_id = $1 AND label = $2 AND status = 'active'`,
    [playerId, label],
  );
}

async function insertActiveKey(client: PoolClient, streamKey: string, playerId: string, label: string): Promise<void> {
  await client.query(
    `INSERT INTO stream_keys (stream_key, player_id, label, status) VALUES ($1, $2, $3, 'active')`,
    [streamKey, playerId, label],
  );
}

function activeResponse(
  httpStatus: 200 | 201,
  action: StreamAction,
  playerId: string,
  label: string,
  streamKey: string,
): { http_status: 200 | 201 } & Record<string, unknown> {
  const status = 'active' as const;
  const { ingest_endpoints, playback_url } = buildUrls(streamKey);
  return {
    http_status: httpStatus,
    action,
    player_id: playerId,
    label,
    stream_key: streamKey,
    status,
    ingest_endpoints,
    playback_url,
    signature: signStream(action, playerId, status, streamKey),
  };
}

function revokedResponse(
  action: StreamAction,
  playerId: string,
  label: string,
  streamKey: string,
): { http_status: 200 } & Record<string, unknown> {
  const status = 'revoked' as const;
  return {
    http_status: 200,
    action,
    player_id: playerId,
    label,
    stream_key: streamKey,
    status,
    ingest_endpoints: null,
    playback_url: null,
    signature: signStream(action, playerId, status, streamKey),
  };
}

export async function manageStreamKey(input: unknown): Promise<{ http_status: number } & Record<string, unknown>> {
  const body = parseBody(StreamKeyBody, input);
  await assertPlayerExists(body.player_id);

  const pool = getPool();

  if (body.action === 'revoke') {
    const activeKey = await findActiveKey(body.player_id, body.label);
    if (!activeKey) {
      throw new AppError(404, 'STREAM_NOT_FOUND', 'No active stream key for this player.', {
        player_id: body.player_id,
        label: body.label,
      });
    }
    await pool.query(
      `UPDATE stream_keys SET status = 'revoked' WHERE stream_key = $1`,
      [activeKey],
    );
    return revokedResponse('revoke', body.player_id, body.label, activeKey);
  }

  if (body.stream_key_override !== undefined && body.action !== 'rotate') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['stream_key_override'] });
  }

  if (body.action === 'rotate' && body.stream_key_override !== undefined) {
    await assertKeyNotRevoked(body.stream_key_override);
    const taken = await pool.query<{ status: string; player_id: string; label: string }>(
      `SELECT status, player_id, label FROM stream_keys WHERE stream_key = $1`,
      [body.stream_key_override],
    );
    const row = taken.rows[0];
    if (row?.status === 'active' && (row.player_id !== body.player_id || row.label !== body.label)) {
      throw new AppError(409, 'KEY_REVOKED', 'Stream key has been revoked.', { stream_key: body.stream_key_override });
    }
  }

  let streamKey: string;
  if (body.action === 'rotate' && body.stream_key_override !== undefined) {
    streamKey = body.stream_key_override;
  } else {
    streamKey = newStreamKey();
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await revokeActiveSlot(client, body.player_id, body.label);
    await insertActiveKey(client, streamKey, body.player_id, body.label);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const httpStatus = body.action === 'generate' ? 201 : 200;
  return activeResponse(httpStatus, body.action, body.player_id, body.label, streamKey);
}
