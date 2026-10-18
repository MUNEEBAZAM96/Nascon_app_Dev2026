process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

describe('costream session', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let signDay2: (entityId: string, sigPayload: unknown) => string;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const crypto = await import('../../backend/src/crypto/sign');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    signDay2 = crypto.signDay2;
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

  function post(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/costream/session', payload });
  }

  const fourPersonBody = {
    session_id: 'cs-session-101',
    host: 'player-alpha-1',
    participants: ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'],
    simulate_host_drop: true,
    layout: 'grid_4',
  };

  function expectedSignature(sessionId: string, body: Record<string, unknown>) {
    return signDay2(sessionId, {
      active_host: body.active_host,
      handoff_occurred: body.handoff_occurred,
      layout: body.layout,
      participant_count: body.participant_count,
      session_id: body.session_id,
      status: body.status,
    });
  }

  test('invalid body returns 400 VALIDATION_ERROR', async () => {
    const res = await post({});
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('four-person drop scenario matches the contract', async () => {
    await reset();
    const res = await post(fourPersonBody);
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.session_id, 'cs-session-101');
    assert.equal(body.active_host, 'player-alpha-2');
    assert.equal(body.participant_count, 3);
    assert.deepEqual(body.participants, ['player-alpha-2', 'player-beta-1', 'player-beta-2']);
    assert.equal(body.handoff_occurred, true);
    assert.equal(body.layout, 'grid_4');
    assert.equal(body.status, 'active');
    assert.equal(body.composite_playback_url, 'http://localhost:8888/costream/cs-session-101/index.m3u8');
    assert.equal(body.chat_room_id, 'chat-cs-session-101');
    assert.equal(body.signature, expectedSignature('cs-session-101', body));
  });

  test('identical body replays as 200 with one session row', async () => {
    await reset();
    const first = await post(fourPersonBody);
    assert.equal(first.statusCode, 201);
    const second = await post(fourPersonBody);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), first.json());
    const rows = await query('SELECT COUNT(*)::int AS n FROM costream_sessions WHERE session_id = $1', ['cs-session-101']);
    assert.equal(Number(rows.rows[0]?.n), 1);
  });

  test('five participants returns 409 COSTREAM_SESSION_FULL', async () => {
    await reset();
    await query(
      `INSERT INTO players (id, name, position, club_id) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      ['player-extra-5', 'Extra', 'mf', 'club-alpha-1'],
    );
    const res = await post({
      session_id: 'cs-session-full',
      host: 'player-alpha-1',
      participants: [
        'player-alpha-1',
        'player-alpha-2',
        'player-beta-1',
        'player-beta-2',
        'player-extra-5',
      ],
      simulate_host_drop: false,
      layout: 'grid_4',
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'COSTREAM_SESSION_FULL');
  });

  test('host not in participants returns 400 VALIDATION_ERROR', async () => {
    await reset();
    const res = await post({
      session_id: 'cs-session-host',
      host: 'player-alpha-1',
      participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2'],
      simulate_host_drop: false,
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('one person with host drop is terminated', async () => {
    await reset();
    const res = await post({
      session_id: 'cs-session-solo-drop',
      host: 'player-alpha-1',
      participants: ['player-alpha-1'],
      simulate_host_drop: true,
      layout: 'solo',
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.status, 'terminated');
    assert.equal(body.active_host, null);
    assert.equal(body.participant_count, 0);
    assert.deepEqual(body.participants, []);
    assert.equal(body.handoff_occurred, false);
    assert.equal(body.signature, expectedSignature('cs-session-solo-drop', body));
  });

  test('unknown player returns 404 PLAYER_NOT_FOUND', async () => {
    await reset();
    const res = await post({
      session_id: 'cs-session-missing',
      host: 'player-alpha-1',
      participants: ['player-alpha-1', 'player-missing-xyz'],
      simulate_host_drop: false,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'PLAYER_NOT_FOUND');
  });

  test('solo layout with two remaining after drop returns 400 UNSUPPORTED_LAYOUT', async () => {
    await reset();
    const res = await post({
      session_id: 'cs-session-solo-bad',
      host: 'player-alpha-1',
      participants: ['player-alpha-1', 'player-alpha-2', 'player-beta-1'],
      simulate_host_drop: true,
      layout: 'solo',
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'UNSUPPORTED_LAYOUT');
  });
});
