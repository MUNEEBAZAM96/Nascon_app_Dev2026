import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

const SPORT = {
  sport_id: 'sync_event',
  name: 'Sync Event',
  scoring_model: 'event',
  draw_allowed: true,
  periods: { count: 1 },
  scoring_events: { mark: { points: 1 } },
  overtime: { policy: 'none' },
  tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
  roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} },
};

describe('offline sync', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let sign: (salt: string, id: string, payload: unknown) => string;
  let salt: string;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const { reset } = await import('../../backend/src/db/seed');
    const { createSport } = await import('../../backend/src/domain/sports');
    const { loadConfig } = await import('../../backend/src/config');
    const crypto = await import('../../backend/src/crypto/sign');
    const { getPool } = await import('../../backend/src/db/pool');
    const { buildApp } = await import('../../backend/src/app');
    sign = crypto.sign;
    salt = loadConfig().day1Salt;
    query = (sql, params) => getPool().query(sql, params);
    await reset();
    await createSport(SPORT);
    app = buildApp();
    await app.ready();
    await event({ event_id: 'sync-init', match_id: 'm-sync', type: 'match_init', payload: { sport_id: 'sync_event', home_team_id: 'home', away_team_id: 'away' } });
    await event({ event_id: 'sync-start', match_id: 'm-sync', type: 'match_start', payload: {} });
  });

  after(async () => {
    await app.close();
  });

  function event(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/events', payload });
  }

  function sync(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/offline-sync', payload });
  }

  function scoreAction(actionId: string, eventId: string, base: number, queuedAt = '2026-10-17T11:00:00Z') {
    return {
      action_id: actionId,
      type: 'score_event',
      queued_at: queuedAt,
      base_version: base,
      payload: {
        event_id: eventId,
        match_id: 'm-sync',
        type: 'score',
        payload: { team_id: 'home', event_type: 'mark' },
      },
    };
  }

  test('a fresh score on the current version is appended', async () => {
    const res = await sync({ device_id: 'dev-1', actions: [scoreAction('a1', 'sync-mark-1', 2)] });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    const row = res.json().results[0];
    assert.equal(row.status, 'applied');
    assert.equal(row.resolution, 'appended');
    assert.equal(row.error_code, null);
    assert.equal(row.server_version, 3);
    assert.equal(row.signature, sign(salt, 'sync-mark-1', { team_id: 'home', event_type: 'mark' }));
    assert.deepEqual(res.json().summary, { applied: 1, rejected: 0, duplicate: 0 });
  });

  test('a stale score is still applied as a rebase', async () => {
    const res = await sync({ device_id: 'dev-1', actions: [scoreAction('a2', 'sync-mark-2', 2, '2026-10-17T11:05:00Z')] });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    const row = res.json().results[0];
    assert.equal(row.status, 'applied');
    assert.equal(row.resolution, 'rebased_append');
    assert.equal(row.error_code, null);
    assert.equal(row.server_version, 4);
  });

  test('the same action again changes nothing', async () => {
    const before = await query('SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1', ['m-sync']);
    const res = await sync({ device_id: 'dev-1', actions: [scoreAction('a1', 'sync-mark-1', 2)] });
    assert.equal(res.statusCode, 200);
    const row = res.json().results[0];
    assert.equal(row.status, 'duplicate');
    assert.equal(row.resolution, 'skipped_duplicate');
    assert.equal(row.error_code, null);
    assert.equal(row.signature, null);
    const after = await query('SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1', ['m-sync']);
    assert.equal(after.rows[0].n, before.rows[0].n);
  });

  test('an unknown match is a per-action rejection', async () => {
    const res = await sync({
      device_id: 'dev-1',
      actions: [{
        action_id: 'missing-match',
        type: 'score_event',
        queued_at: '2026-10-17T12:00:00Z',
        base_version: 5,
        payload: { event_id: 'nope', match_id: 'missing-match-id', type: 'score', payload: { team_id: 'home', event_type: 'mark' } },
      }],
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].status, 'rejected');
    assert.equal(res.json().results[0].resolution, 'server_wins');
    assert.equal(res.json().results[0].error_code, 'MATCH_NOT_FOUND');
  });

  test('a score before the match has started keeps the rule code', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/audit/v1/leagues',
      payload: {
        league_id: 'lg-sync',
        sport_id: 'sync_event',
        teams: ['s1', 's2'],
        fixtures: [{ match_id: 'sync-fix-1', home_team_id: 's1', away_team_id: 's2' }],
        qualification: { spots: 1 },
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    const res = await sync({
      device_id: 'dev-1',
      actions: [{
        action_id: 'too-early',
        type: 'score_event',
        queued_at: '2026-10-17T12:30:00Z',
        base_version: 0,
        payload: { event_id: 'early-score', match_id: 'sync-fix-1', type: 'score', payload: { team_id: 's1', event_type: 'mark' } },
      }],
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    assert.equal(res.json().results[0].status, 'rejected');
    assert.equal(res.json().results[0].resolution, 'server_wins');
    assert.equal(res.json().results[0].error_code, 'MATCH_NOT_IN_PROGRESS');
    const count = await query('SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1', ['sync-fix-1']);
    assert.equal(count.rows[0].n, 0);
  });

  test('a future base version is rejected and writes no event', async () => {
    const before = await query('SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1', ['m-sync']);
    const res = await sync({ device_id: 'dev-1', actions: [scoreAction('future', 'sync-future', 99)] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].error_code, 'INVALID_BASE_VERSION');
    assert.equal(res.json().results[0].resolution, 'server_wins');
    const after = await query('SELECT COUNT(*)::int AS n FROM match_events WHERE match_id = $1', ['m-sync']);
    assert.equal(after.rows[0].n, before.rows[0].n);
  });

  test('an empty action list is a validation error', async () => {
    const res = await sync({ device_id: 'dev-1', actions: [] });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    assert.ok(res.json().error.details.fields.includes('actions'));
  });
});
