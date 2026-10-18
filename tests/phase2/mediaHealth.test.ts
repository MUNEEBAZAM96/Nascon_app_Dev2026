process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

describe('media health gate', { concurrency: 1 }, () => {
  describe('without MEDIA_HEALTH_URL', () => {
    let app: FastifyInstance;
    let reset: () => Promise<unknown>;

    before(async () => {
      delete process.env.MEDIA_HEALTH_URL;
      const { resetConfigCache } = await import('../../backend/src/config');
      resetConfigCache();
      const pool = await import('../../backend/src/db/pool');
      const seed = await import('../../backend/src/db/seed');
      const { buildApp } = await import('../../backend/src/app');
      await pool.migrate();
      reset = seed.reset;
      await reset();
      app = buildApp();
      await app.ready();
    });

    after(async () => {
      await app.close();
      const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
      for (const handle of handles) handle.unref?.();
    });

    test('GET /health returns ok when media probe is disabled', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { status: 'ok' });
    });
  });

  describe('with MEDIA_HEALTH_URL pointing at a closed port', () => {
    let app: FastifyInstance;
    let priorMediaUrl: string | undefined;

    before(async () => {
      priorMediaUrl = process.env.MEDIA_HEALTH_URL;
      process.env.MEDIA_HEALTH_URL = 'http://127.0.0.1:1/';
      const { resetConfigCache } = await import('../../backend/src/config');
      resetConfigCache();
      const pool = await import('../../backend/src/db/pool');
      const seed = await import('../../backend/src/db/seed');
      const { buildApp } = await import('../../backend/src/app');
      await pool.migrate();
      await seed.reset();
      app = buildApp();
      await app.ready();
    });

    after(async () => {
      await app.close();
      if (priorMediaUrl === undefined) delete process.env.MEDIA_HEALTH_URL;
      else process.env.MEDIA_HEALTH_URL = priorMediaUrl;
      const { resetConfigCache } = await import('../../backend/src/config');
      resetConfigCache();
      const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
      for (const handle of handles) handle.unref?.();
    });

    test('GET /health returns 503 NOT_READY when media does not answer', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error.code, 'NOT_READY');
    });
  });
});
