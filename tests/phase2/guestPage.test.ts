process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

const GUEST_IDS = [
  'guest-video-player',
  'live-score-banner',
  'pinned-merch-card',
  'add-to-guest-cart-btn',
  'guest-cart-count',
  'chat-message-list',
  'chat-input-field',
  'chat-send-btn',
  'progressive-auth-modal',
] as const;

describe('guest live web page', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;

  before(async () => {
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

  function assertHtml(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type'] ?? ''), /text\/html/);
  }

  test('live page has contract markup and score polling script', async () => {
    const res = await app.inject({ method: 'GET', url: '/web/matches/match-m1/live' });
    assertHtml(res);
    const body = res.body;
    for (const id of GUEST_IDS) {
      assert.match(body, new RegExp(`id="${id}"`));
    }
    assert.match(body, /id="live-score-banner"[^>]*>1 - 0</);
    assert.match(body, /id="guest-cart-count"[^>]*>0</);
    assert.match(body, /progressive-auth-modal" hidden/);
    assert.match(body, /display:none/);
    assert.match(body, /\/audit\/v1\/score\/'/);
    assert.match(body, /\+ matchId/);
    assert.doesNotMatch(body, /\/api\/v1\/chat/);
    assert.doesNotMatch(body, /\/audit\/v1\/checkout/);
    assert.match(body, /data-variant-id="var-jersey-001-L"/);
  });

  test('banner reflects a second accepted goal event', async () => {
    await reset();
    const goal = {
      event_id: 'match-m1-goal-2',
      match_id: 'match-m1',
      type: 'score',
      payload: { team_id: 'club-alpha-1', event_type: 'goal' },
    };
    const eventRes = await app.inject({ method: 'POST', url: '/audit/v1/events', payload: goal });
    assert.equal(eventRes.statusCode, 201, JSON.stringify(eventRes.json()));

    const live = await app.inject({ method: 'GET', url: '/web/matches/match-m1/live' });
    assertHtml(live);
    assert.match(live.body, /id="live-score-banner"[^>]*>2 - 0</);
  });

  test('QR short link redirects to live HTML', async () => {
    await reset();
    const redirect = await app.inject({ method: 'GET', url: '/q/m1-live' });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.headers.location, '/web/matches/match-m1/live');
    const live = await app.inject({ method: 'GET', url: '/web/matches/match-m1/live' });
    assertHtml(live);
  });

  test('companion web routes return HTML 200', async () => {
    await reset();
    const paths = [
      '/web/matches/match-m1/preview',
      '/web/matches/match-m1/vod',
      '/web/matches/match-m1/notice',
      '/preview',
      '/vod',
      '/notice',
      '/web/players/player-alpha-1',
      '/web/clubs/club-alpha-1',
      '/web/costream/cs-session-101',
    ];
    for (const url of paths) {
      const res = await app.inject({ method: 'GET', url });
      assertHtml(res);
    }
  });

  test('live page burst is not rate limited', async () => {
    await reset();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.inject({ method: 'GET', url: '/web/matches/match-m1/live' })),
    );
    assert.ok(results.every((res) => res.statusCode !== 429));
  });

  test('health unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });
});
