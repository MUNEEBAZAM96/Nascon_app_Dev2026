import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';

const ROLES = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'] as const;
type RoleName = (typeof ROLES)[number];

const CONTEXT = {
  tenant_id: 'tenant-alpha',
  foreign_tenant_id: 'tenant-beta',
  own_league_id: 'league-alpha-1',
  other_league_id: 'league-alpha-2',
  foreign_league_id: 'league-beta-1',
  own_club_id: 'club-alpha-1',
  other_club_id: 'club-alpha-2',
  foreign_club_id: 'club-beta-1',
  own_player_id: 'player-alpha-1',
  other_player_id: 'player-alpha-2',
  foreign_player_id: 'player-beta-1',
};

describe('rbac probes', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let tokens: Record<RoleName, string>;
  let secret: string;

  before(async () => {
    const { reset } = await import('../../backend/src/db/seed');
    const { loadConfig } = await import('../../backend/src/config');
    const { buildApp } = await import('../../backend/src/app');
    secret = loadConfig().jwtSecret;
    await reset();
    app = buildApp();
    await app.ready();
    const matrix = await app.inject({ method: 'POST', url: '/audit/v1/rbac-matrix' });
    assert.equal(matrix.statusCode, 200, JSON.stringify(matrix.json()));
    tokens = matrix.json().tokens;
  });

  after(async () => {
    await app.close();
    const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
    for (const handle of handles) handle.unref?.();
  });

  function call(method: 'GET' | 'POST' | 'PATCH', url: string, token?: string) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: method === 'GET' ? undefined : {},
    });
  }

  async function expectMatrix(method: 'GET' | 'POST' | 'PATCH', url: string, allowed: RoleName[]) {
    for (const role of ROLES) {
      const res = await call(method, url, tokens[role]);
      if (allowed.includes(role)) {
        assert.equal(res.statusCode, 200, `${role} ${method} ${url} ${JSON.stringify(res.json())}`);
        assert.deepEqual(res.json(), { authorized: true });
      } else {
        assert.equal(res.statusCode, 403, `${role} ${method} ${url} ${JSON.stringify(res.json())}`);
        assert.equal(res.json().error.code, 'FORBIDDEN');
      }
    }
  }

  test('the matrix returns five tokens and the seeded context', async () => {
    const res = await app.inject({ method: 'POST', url: '/audit/v1/rbac-matrix', payload: {} });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.context, CONTEXT);
    for (const role of ROLES) assert.equal(typeof body.tokens[role], 'string');
    assert.ok(body.tokens.super_admin.length > 0);
  });

  test('each probe allows and denies the seeded targets', async () => {
    await expectMatrix('POST', '/audit/v1/rbac/tenants', ['super_admin']);
    await expectMatrix('POST', '/audit/v1/rbac/leagues/league-alpha-1/fixtures', ['super_admin', 'league_organizer']);
    await expectMatrix('POST', '/audit/v1/rbac/leagues/league-alpha-2/fixtures', ['super_admin']);
    await expectMatrix('POST', '/audit/v1/rbac/leagues/league-beta-1/fixtures', ['super_admin']);
    for (const action of ['roster', 'products'] as const) {
      await expectMatrix('POST', `/audit/v1/rbac/clubs/club-alpha-1/${action}`, ['super_admin', 'club_manager']);
      await expectMatrix('POST', `/audit/v1/rbac/clubs/club-alpha-2/${action}`, ['super_admin']);
      await expectMatrix('POST', `/audit/v1/rbac/clubs/club-beta-1/${action}`, ['super_admin']);
    }
    await expectMatrix('PATCH', '/audit/v1/rbac/players/player-alpha-1', ['super_admin', 'club_manager', 'player']);
    await expectMatrix('PATCH', '/audit/v1/rbac/players/player-alpha-2', ['super_admin']);
    await expectMatrix('PATCH', '/audit/v1/rbac/players/player-beta-1', ['super_admin']);
    await expectMatrix('GET', '/audit/v1/rbac/clubs/club-alpha-1', [...ROLES]);
    await expectMatrix('GET', '/audit/v1/rbac/clubs/club-alpha-2', [...ROLES]);
    await expectMatrix('GET', '/audit/v1/rbac/clubs/club-beta-1', ['super_admin']);
    await expectMatrix('GET', '/audit/v1/rbac/platform/config', ['super_admin']);
  });

  test('missing, tampered, alg none, and expired tokens are 401', async () => {
    const missing = await call('GET', '/audit/v1/rbac/platform/config');
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error.code, 'UNAUTHENTICATED');

    const valid = tokens.super_admin;
    const flipped = `${valid.slice(0, -1)}${valid.endsWith('a') ? 'b' : 'a'}`;
    const tampered = await call('GET', '/audit/v1/rbac/platform/config', flipped);
    assert.equal(tampered.statusCode, 401);
    assert.equal(tampered.json().error.code, 'UNAUTHENTICATED');

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-admin', role: 'super_admin' })).toString('base64url');
    const none = await call('GET', '/audit/v1/rbac/platform/config', `${header}.${payload}.`);
    assert.equal(none.statusCode, 401);
    assert.equal(none.json().error.code, 'UNAUTHENTICATED');

    const expired = expiredToken(secret);
    const stale = await call('GET', '/audit/v1/rbac/platform/config', expired);
    assert.equal(stale.statusCode, 401);
    assert.equal(stale.json().error.code, 'UNAUTHENTICATED');
  });

  test('a missing league or player is 404, not 403', async () => {
    const league = await call('POST', '/audit/v1/rbac/leagues/league-missing/fixtures', tokens.super_admin);
    assert.equal(league.statusCode, 404);
    assert.equal(league.json().error.code, 'LEAGUE_NOT_FOUND');
    const player = await call('PATCH', '/audit/v1/rbac/players/player-missing', tokens.super_admin);
    assert.equal(player.statusCode, 404);
    assert.equal(player.json().error.code, 'PLAYER_NOT_FOUND');
  });

  test('a sport id that looks like SQL is 400 and the server stays up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/sports',
      payload: {
        sport_id: "x'; DROP TABLE sports;--",
        name: 'Injected',
        scoring_model: 'event',
        periods: { count: 1 },
        scoring_events: { mark: { points: 1 } },
        draw_allowed: true,
        overtime: { policy: 'none' },
        tie_break_order: ['h2h_points'],
        roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} },
      },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok' });
  });

  test('ping rate limit returns 429 and then allows another request', async () => {
    const { getRedis } = await import('../../backend/src/queue/redis');
    const redis = getRedis();
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        redis.once('ready', () => resolve());
        redis.once('error', reject);
      });
    }
    await redis.ping();
    const first = await app.inject({ method: 'GET', url: '/api/v1/ping' });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { pong: true });
    const rest = [];
    for (let i = 0; i < 149; i += 1) rest.push(await app.inject({ method: 'GET', url: '/api/v1/ping' }));
    const limited = [first, ...rest].filter((res) => res.statusCode === 429);
    assert.ok(limited.length >= 40, `expected at least 40 rate limits, got ${limited.length}`);
    for (const res of limited) {
      assert.equal(res.json().error.code, 'RATE_LIMITED');
      assert.ok(res.headers['retry-after']);
    }
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    const again = await app.inject({ method: 'GET', url: '/api/v1/ping' });
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), { pong: true });
  });

  test('a body over 1 MB is 413 and health still answers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/sports',
      payload: { sport_id: 'x', blob: 'a'.repeat(1024 * 1024 + 64) },
    });
    assert.equal(res.statusCode, 413);
    assert.equal(res.json().error.code, 'PAYLOAD_TOO_LARGE');
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
  });
});

function expiredToken(secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-admin',
    email: 'admin@nascon.test',
    role: 'super_admin',
    tenant_id: null,
    league_id: null,
    club_id: null,
    player_id: null,
    exp: Math.floor(Date.now() / 1000) - 10,
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
