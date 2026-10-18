process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

describe('stream key', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let signDay2: (entityId: string, sigPayload: unknown) => string;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const crypto = await import('../../backend/src/crypto/sign');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    signDay2 = crypto.signDay2;
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  function post(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/stream/key', payload });
  }

  test('bad action returns 400 VALIDATION_ERROR', async () => {
    const res = await post({ action: 'destroy', player_id: 'player-alpha-1' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('unknown player returns 404 PLAYER_NOT_FOUND', async () => {
    const res = await post({ action: 'generate', player_id: 'player-missing' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'PLAYER_NOT_FOUND');
  });

  test('generate returns 201 with sk_live key and active URLs', async () => {
    const res = await post({ action: 'generate', player_id: 'player-alpha-1' });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.match(body.stream_key, /^sk_live_[a-f0-9]{16}$/);
    assert.equal(body.status, 'active');
    assert.equal(body.ingest_endpoints.rtmp, `rtmp://localhost:1935/live/${body.stream_key}`);
    assert.equal(body.ingest_endpoints.whip, `http://localhost:8889/live/${body.stream_key}/whip`);
    assert.equal(body.playback_url, `http://localhost:8888/live/${body.stream_key}/index.m3u8`);
  });

  test('rotate with override returns 200, URLs, and matching signature', async () => {
    const override = 'sk_live_9f83a1b2c3d4e5f6';
    const res = await post({
      action: 'rotate',
      player_id: 'player-alpha-1',
      stream_key_override: override,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.stream_key, override);
    assert.equal(body.status, 'active');
    assert.equal(body.ingest_endpoints.rtmp, `rtmp://localhost:1935/live/${override}`);
    assert.equal(body.ingest_endpoints.whip, `http://localhost:8889/live/${override}/whip`);
    assert.equal(body.playback_url, `http://localhost:8888/live/${override}/index.m3u8`);
    assert.equal(
      body.signature,
      signDay2(override, {
        action: 'rotate',
        player_id: 'player-alpha-1',
        status: 'active',
        stream_key: override,
      }),
    );
  });

  test('revoke returns 200 with null ingest and playback', async () => {
    const res = await post({ action: 'revoke', player_id: 'player-alpha-1' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, 'revoked');
    assert.equal(body.ingest_endpoints, null);
    assert.equal(body.playback_url, null);
  });

  test('second revoke returns 404 STREAM_NOT_FOUND', async () => {
    const res = await post({ action: 'revoke', player_id: 'player-alpha-1' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'STREAM_NOT_FOUND');
  });

  test('rotate with a revoked override returns 409 KEY_REVOKED', async () => {
    await reset();
    const gen = await post({ action: 'generate', player_id: 'player-alpha-1' });
    const oldKey = gen.json().stream_key;
    const override = 'sk_live_9f83a1b2c3d4e5f6';
    await post({ action: 'rotate', player_id: 'player-alpha-1', stream_key_override: override });
    const res = await post({
      action: 'rotate',
      player_id: 'player-alpha-1',
      stream_key_override: oldKey,
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'KEY_REVOKED');
  });
});
