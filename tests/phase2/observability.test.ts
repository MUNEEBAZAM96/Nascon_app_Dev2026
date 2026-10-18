process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

const METRIC_NAMES = [
  'nascon_active_ws_connections',
  'nascon_active_streams_total',
  'nascon_stream_bitrate_kbps',
  'nascon_dlq_depth',
  'nascon_qr_scans_total',
] as const;

function parseMetric(body: string, name: string): number {
  const line = body.split('\n').find((row) => row.startsWith(`${name} `));
  assert.ok(line, `missing metric line for ${name}`);
  return Number(line.split(/\s+/)[1]);
}

describe('observability and privacy', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    query = (sql, params) => pool.getPool().query(sql, params);
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
    for (const handle of handles) handle.unref?.();
  });

  async function metricsBody(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/plain/);
    assert.match(res.headers['content-type'] ?? '', /version=0\.0\.4/);
    const body = res.body;
    for (const name of METRIC_NAMES) assert.match(body, new RegExp(name));
    return body;
  }

  test('GET /health returns only status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });

  test('GET /metrics exposes baseline counters after reset', async () => {
    await reset();
    const body = await metricsBody();
    assert.equal(parseMetric(body, 'nascon_dlq_depth'), 0);
    assert.equal(parseMetric(body, 'nascon_active_streams_total'), 0);
    assert.equal(parseMetric(body, 'nascon_qr_scans_total'), 0);
  });

  test('non-inspect QR scan increases nascon_qr_scans_total', async () => {
    await reset();
    const before = parseMetric(await metricsBody(), 'nascon_qr_scans_total');
    const scan = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1' });
    assert.equal(scan.statusCode, 200);
    const afterScan = parseMetric(await metricsBody(), 'nascon_qr_scans_total');
    assert.equal(afterScan, before + 1);
    const inspect = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' });
    assert.equal(inspect.statusCode, 200);
    const afterInspect = parseMetric(await metricsBody(), 'nascon_qr_scans_total');
    assert.equal(afterInspect, afterScan);
  });

  test('nascon_dlq_depth tracks moderation DLQ and reset clears it', async () => {
    await reset();
    const mod = await app.inject({
      method: 'POST',
      url: '/audit/v1/moderation/test',
      payload: { chat_room_id: 'chat-dlq-metrics', messages: [], simulate_failed_notifications: 2 },
    });
    assert.equal(mod.statusCode, 200);
    assert.equal(parseMetric(await metricsBody(), 'nascon_dlq_depth'), 2);
    await reset();
    assert.equal(parseMetric(await metricsBody(), 'nascon_dlq_depth'), 0);
  });

  test('privacy erasure anonymizes user-player and wipes guest tokens', async () => {
    await reset();
    const first = await app.inject({ method: 'DELETE', url: '/audit/v1/privacy/user/user-player' });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { status: 'anonymized', pii_retained: false, tokens_wiped: true });

    const second = await app.inject({ method: 'DELETE', url: '/audit/v1/privacy/user/user-player' });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), { status: 'anonymized', pii_retained: false, tokens_wiped: true });

    const user = await query('SELECT id, email, password, role, player_id FROM users WHERE id = $1', ['user-player']);
    assert.equal(user.rows[0]?.id, 'user-player');
    assert.equal(user.rows[0]?.role, 'player');
    assert.equal(user.rows[0]?.player_id, 'player-alpha-1');
    assert.notEqual(user.rows[0]?.email, 'player@nascon.test');
    assert.notEqual(user.rows[0]?.password, 'Nascon@26');

    const player = await query('SELECT id FROM players WHERE id = $1', ['player-alpha-1']);
    assert.equal(player.rows[0]?.id, 'player-alpha-1');

    const guests = await query('SELECT token FROM guest_tokens');
    assert.equal(guests.rows.length, 0);

    const ids = await query('SELECT id FROM users ORDER BY id');
    assert.deepEqual(
      ids.rows.map((row) => row.id),
      ['user-admin', 'user-manager', 'user-organizer', 'user-player', 'user-viewer'],
    );

    const matrix = await app.inject({ method: 'POST', url: '/audit/v1/rbac-matrix', payload: {} });
    assert.equal(matrix.statusCode, 200);
    assert.equal(Object.keys(matrix.json().tokens).length, 5);
  });

  test('unknown user privacy delete returns 404 USER_NOT_FOUND', async () => {
    await reset();
    const res = await app.inject({ method: 'DELETE', url: '/audit/v1/privacy/user/user-does-not-exist' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'USER_NOT_FOUND');
  });

  test('burst of QR inspect reads is not rate limited', async () => {
    await reset();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' })),
    );
    assert.ok(results.every((res) => res.statusCode !== 429));
  });

  test('active stream key increases nascon_active_streams_total', async () => {
    await reset();
    const gen = await app.inject({
      method: 'POST',
      url: '/audit/v1/stream/key',
      payload: { action: 'generate', player_id: 'player-alpha-1' },
    });
    assert.equal(gen.statusCode, 201);
    assert.equal(parseMetric(await metricsBody(), 'nascon_active_streams_total'), 1);
  });
});
