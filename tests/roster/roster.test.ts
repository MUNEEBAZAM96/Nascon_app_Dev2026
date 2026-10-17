import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

const WINDOW = { open: '2026-09-01', close: '2026-09-30' };
const SPORT = {
  sport_id: 'roster_event',
  name: 'Roster Event',
  scoring_model: 'event',
  draw_allowed: true,
  periods: { count: 1 },
  scoring_events: { mark: { points: 1 } },
  overtime: { policy: 'none' },
  tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
  roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} },
};

describe('roster', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const { reset } = await import('../../backend/src/db/seed');
    const { createSport } = await import('../../backend/src/domain/sports');
    const { getPool } = await import('../../backend/src/db/pool');
    const { buildApp } = await import('../../backend/src/app');
    query = (sql, params) => getPool().query(sql, params);
    await reset();
    await createSport(SPORT);
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  function post(url: string, payload: unknown) {
    return app.inject({ method: 'POST', url, payload });
  }

  async function auditCount(leagueId: string): Promise<number> {
    const result = await query('SELECT COUNT(*)::int AS n FROM roster_audit WHERE roster_league_id = $1', [leagueId]);
    return Number(result.rows[0]?.n ?? 0);
  }

  async function setup(body: Record<string, unknown>, status = 201) {
    const res = await post('/audit/v1/roster/setup', body);
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    return res.json();
  }

  async function transfer(body: Record<string, unknown>) {
    return post('/audit/v1/roster/transfer', body);
  }

  function scene(leagueId: string, options: {
    squads: Array<Record<string, unknown>>;
    players: Array<Record<string, unknown>>;
    max?: number;
    required?: Record<string, number>;
    matches?: Array<Record<string, unknown>>;
    window?: { open: string; close: string };
  }) {
    const league: Record<string, unknown> = {
      league_id: leagueId,
      tenant_id: 'tenant-alpha',
      sport_id: 'roster_event',
      window: options.window ?? WINDOW,
    };
    if (options.max !== undefined) league.max_squad_size = options.max;
    if (options.required !== undefined) league.required_positions = options.required;
    return {
      league,
      squads: options.squads,
      players: options.players,
      matches_in_progress: options.matches ?? [],
    };
  }

  function move(over: Record<string, unknown>) {
    return {
      type: 'transfer',
      effective_date: '2026-09-15',
      requested_by: 'user-77',
      reason: 'Tactical move',
      ...over,
    };
  }

  test('setup counts a loaned player for the borrower and replaces the same league', async () => {
    const first = await setup(scene('lg-r1', {
      squads: [
        { squad_id: 'sq-a', tenant_id: 'tenant-alpha', name: 'Alpha' },
        { squad_id: 'sq-b', tenant_id: 'tenant-alpha', name: 'Beta' },
      ],
      players: [
        { player_id: 'p1', name: 'P One', position: 'mf', squad_id: 'sq-a', role: 'starter' },
        { player_id: 'p2', name: 'P Two', position: 'mf', squad_id: 'sq-a', role: 'captain' },
        {
          player_id: 'p3',
          name: 'P Three',
          position: 'df',
          squad_id: 'sq-b',
          role: 'substitute',
          parent_squad_id: 'sq-a',
          loan_end_date: '2026-09-30',
        },
      ],
    }));
    assert.equal(first.status, 'configured');
    assert.deepEqual(first.squad_counts, { 'sq-a': 2, 'sq-b': 1 });

    const second = await setup(scene('lg-r1', {
      squads: [{ squad_id: 'sq-n', tenant_id: 'tenant-alpha', name: 'New' }],
      players: [
        { player_id: 'p9', name: 'P Nine', position: 'mf', squad_id: 'sq-n', role: 'starter' },
        { player_id: 'p8', name: 'P Eight', position: 'mf', squad_id: 'sq-n', role: 'starter' },
        { player_id: 'p7', name: 'P Seven', position: 'mf', squad_id: 'sq-n', role: 'starter' },
        { player_id: 'p6', name: 'P Six', position: 'mf', squad_id: 'sq-n', role: 'starter' },
      ],
    }));
    assert.equal(second.status, 'configured');
    assert.deepEqual(second.squad_counts, { 'sq-n': 4 });
    const gone = await query('SELECT id FROM squads WHERE id = ANY($1::text[])', [['sq-a', 'sq-b']]);
    assert.equal(gone.rows.length, 0);
    const kept = await query('SELECT id FROM players WHERE id = $1', ['p1']);
    assert.equal(kept.rows.length, 1);
  });

  test('a transfer replays the same audit entry and rejects a changed body', async () => {
    await setup(scene('lg-tr', {
      squads: [
        { squad_id: 'tr-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'tr-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'tr-p1', name: 'One', position: 'mf', squad_id: 'tr-a', role: 'captain' },
        { player_id: 'tr-p2', name: 'Two', position: 'mf', squad_id: 'tr-a', role: 'starter' },
        { player_id: 'tr-p3', name: 'Three', position: 'df', squad_id: 'tr-b', role: 'starter' },
      ],
    }));
    const body = move({
      request_id: 'tr-001',
      league_id: 'lg-tr',
      player_id: 'tr-p2',
      from_squad_id: 'tr-a',
      to_squad_id: 'tr-b',
    });
    const created = await transfer(body);
    assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
    const accepted = created.json();
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.state, 'active');
    assert.equal(accepted.blocking_match_id, null);
    assert.equal(accepted.registration.role, 'substitute');
    assert.equal(accepted.registration.squad_id, 'tr-b');
    assert.equal(accepted.registration.registration_type, 'transfer');
    assert.equal(accepted.registration.parent_squad_id, null);

    const history = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/tr-p2?as_of=2026-09-15' });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().history.length, 1);

    const replay = await transfer(body);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().audit_entry.audit_id, accepted.audit_entry.audit_id);
    assert.equal(replay.json().audit_entry.when, accepted.audit_entry.when);
    const still = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/tr-p2?as_of=2026-09-15' });
    assert.equal(still.json().history.length, 1);

    const changed = await transfer({ ...body, reason: 'Different reason' });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, 'VALIDATION_ERROR');
    assert.deepEqual(changed.json().error.details.fields, ['request_id']);
    assert.equal(await auditCount('lg-tr'), 1);
  });

  test('schema failure wins over a missing league, and a missing player wins over a full squad', async () => {
    const badDate = await transfer(move({
      request_id: 'bad-date',
      league_id: 'lg-missing',
      player_id: 'nobody',
      from_squad_id: 'sq-a',
      to_squad_id: 'sq-b',
      effective_date: '09-30-2026',
    }));
    assert.equal(badDate.statusCode, 400);
    assert.equal(badDate.json().error.code, 'VALIDATION_ERROR');

    await setup(scene('lg-full', {
      max: 1,
      squads: [
        { squad_id: 'full-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'full-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'full-home', name: 'Home', position: 'mf', squad_id: 'full-a', role: 'starter' },
        { player_id: 'full-away', name: 'Away', position: 'mf', squad_id: 'full-b', role: 'starter' },
      ],
    }));
    const missingPlayer = await transfer(move({
      request_id: 'missing-player',
      league_id: 'lg-full',
      player_id: 'not-a-player',
      from_squad_id: 'full-a',
      to_squad_id: 'full-b',
    }));
    assert.equal(missingPlayer.statusCode, 404);
    assert.equal(missingPlayer.json().error.code, 'PLAYER_NOT_FOUND');
    assert.equal(await auditCount('lg-full'), 0);
  });

  test('each roster conflict leaves the audit log unchanged', async () => {
    await setup(scene('lg-cross', {
      squads: [
        { squad_id: 'cross-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'cross-b', tenant_id: 'tenant-beta', name: 'B' },
      ],
      players: [
        { player_id: 'cross-p', name: 'Cross', position: 'mf', squad_id: 'cross-a', role: 'starter' },
        { player_id: 'cross-q', name: 'Other', position: 'mf', squad_id: 'cross-a', role: 'starter' },
        { player_id: 'cross-r', name: 'Beta', position: 'mf', squad_id: 'cross-b', role: 'starter' },
      ],
    }));
    const cross = await transfer(move({
      request_id: 'req-cross',
      league_id: 'lg-cross',
      player_id: 'cross-p',
      from_squad_id: 'cross-a',
      to_squad_id: 'cross-b',
    }));
    assert.equal(cross.statusCode, 409);
    assert.equal(cross.json().error.code, 'CROSS_TENANT_TRANSFER');
    assert.equal(await auditCount('lg-cross'), 0);

    await setup(scene('lg-squad', {
      squads: [
        { squad_id: 'ns-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'ns-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'ns-p', name: 'Here', position: 'mf', squad_id: 'ns-a', role: 'starter' },
        { player_id: 'ns-q', name: 'There', position: 'mf', squad_id: 'ns-b', role: 'starter' },
      ],
    }));
    const notIn = await transfer(move({
      request_id: 'req-notin',
      league_id: 'lg-squad',
      player_id: 'ns-p',
      from_squad_id: 'ns-b',
      to_squad_id: 'ns-a',
    }));
    assert.equal(notIn.statusCode, 409);
    assert.equal(notIn.json().error.code, 'NOT_IN_SQUAD');
    assert.equal(await auditCount('lg-squad'), 0);

    await setup(scene('lg-window', {
      squads: [
        { squad_id: 'win-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'win-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'win-p', name: 'Late', position: 'mf', squad_id: 'win-a', role: 'starter' },
        { player_id: 'win-q', name: 'Room', position: 'mf', squad_id: 'win-b', role: 'starter' },
      ],
    }));
    const closed = await transfer(move({
      request_id: 'req-window',
      league_id: 'lg-window',
      player_id: 'win-p',
      from_squad_id: 'win-a',
      to_squad_id: 'win-b',
      effective_date: '2026-10-01',
    }));
    assert.equal(closed.statusCode, 409);
    assert.equal(closed.json().error.code, 'TRANSFER_WINDOW_CLOSED');
    assert.equal(await auditCount('lg-window'), 0);

    await setup(scene('lg-loaned', {
      squads: [
        { squad_id: 'loan-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'loan-b', tenant_id: 'tenant-alpha', name: 'B' },
        { squad_id: 'loan-c', tenant_id: 'tenant-alpha', name: 'C' },
      ],
      players: [
        { player_id: 'loan-keep', name: 'Keep', position: 'mf', squad_id: 'loan-a', role: 'starter' },
        {
          player_id: 'loan-p',
          name: 'Loaned',
          position: 'mf',
          squad_id: 'loan-b',
          role: 'substitute',
          parent_squad_id: 'loan-a',
          loan_end_date: '2026-09-30',
        },
        { player_id: 'loan-c-p', name: 'C', position: 'mf', squad_id: 'loan-c', role: 'starter' },
      ],
    }));
    const onLoan = await transfer(move({
      request_id: 'req-onloan',
      league_id: 'lg-loaned',
      player_id: 'loan-p',
      from_squad_id: 'loan-b',
      to_squad_id: 'loan-c',
      effective_date: '2026-09-15',
    }));
    assert.equal(onLoan.statusCode, 409);
    assert.equal(onLoan.json().error.code, 'PLAYER_ON_LOAN');
    assert.equal(await auditCount('lg-loaned'), 0);

    await setup(scene('lg-cap', {
      max: 1,
      squads: [
        { squad_id: 'cap-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'cap-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'cap-p', name: 'Mover', position: 'mf', squad_id: 'cap-a', role: 'starter' },
        { player_id: 'cap-extra', name: 'Extra', position: 'mf', squad_id: 'cap-a', role: 'starter' },
        { player_id: 'cap-q', name: 'Full', position: 'df', squad_id: 'cap-b', role: 'starter' },
      ],
    }));
    const full = await transfer(move({
      request_id: 'req-full',
      league_id: 'lg-cap',
      player_id: 'cap-p',
      from_squad_id: 'cap-a',
      to_squad_id: 'cap-b',
    }));
    assert.equal(full.statusCode, 409);
    assert.equal(full.json().error.code, 'SQUAD_FULL');
    assert.equal(await auditCount('lg-cap'), 0);

    await setup(scene('lg-min', {
      required: { mf: 1 },
      squads: [
        { squad_id: 'min-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'min-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'min-p', name: 'Only', position: 'mf', squad_id: 'min-a', role: 'starter' },
        { player_id: 'min-q', name: 'Room', position: 'df', squad_id: 'min-b', role: 'starter' },
      ],
    }));
    const minimum = await transfer(move({
      request_id: 'req-min',
      league_id: 'lg-min',
      player_id: 'min-p',
      from_squad_id: 'min-a',
      to_squad_id: 'min-b',
    }));
    assert.equal(minimum.statusCode, 409);
    assert.equal(minimum.json().error.code, 'MIN_POSITION_VIOLATION');
    assert.equal(await auditCount('lg-min'), 0);

    await setup(scene('lg-rel', {
      squads: [
        { squad_id: 'rel-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'rel-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'rel-p', name: 'Free', position: 'mf', squad_id: 'rel-a', role: 'starter' },
        { player_id: 'rel-q', name: 'Stay', position: 'mf', squad_id: 'rel-a', role: 'starter' },
      ],
    }));
    const released = await transfer({
      request_id: 'req-rel',
      league_id: 'lg-rel',
      player_id: 'rel-p',
      type: 'release',
      from_squad_id: 'rel-a',
      effective_date: '2026-10-05',
      requested_by: 'user-77',
      reason: 'Left the league',
    });
    assert.equal(released.statusCode, 201, JSON.stringify(released.json()));
    assert.equal(released.json().registration, null);
    const afterRelease = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/rel-p?as_of=2026-10-05' });
    assert.equal(afterRelease.json().current_squad_id, null);
  });

  test('a move during a live match stays on the old squad until the match ends', async () => {
    await setup(scene('lg-def', {
      required: { gk: 1 },
      window: { open: '2026-09-01', close: '2026-09-30' },
      matches: [{ match_id: 'm-live', home_squad_id: 'def-a', away_squad_id: 'def-b' }],
      squads: [
        { squad_id: 'def-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'def-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'def-out', name: 'Out', position: 'mf', squad_id: 'def-a', role: 'starter' },
        { player_id: 'def-gk', name: 'Keeper', position: 'gk', squad_id: 'def-a', role: 'starter' },
        { player_id: 'def-b1', name: 'Other', position: 'mf', squad_id: 'def-b', role: 'starter' },
      ],
    }));
    const deferred = await transfer(move({
      request_id: 'req-def',
      league_id: 'lg-def',
      player_id: 'def-out',
      from_squad_id: 'def-a',
      to_squad_id: 'def-b',
      effective_date: '2026-09-30',
    }));
    assert.equal(deferred.statusCode, 201, JSON.stringify(deferred.json()));
    const body = deferred.json();
    assert.equal(body.state, 'deferred_until_match_end');
    assert.equal(body.blocking_match_id, 'm-live');
    assert.equal(body.registration.squad_id, 'def-a');
    assert.equal(body.registration.role, 'starter');

    const history = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/def-out?as_of=2026-09-30' });
    assert.equal(history.json().current_squad_id, 'def-a');
    const still = await query(
      'SELECT squad_id FROM registrations WHERE roster_league_id = $1 AND player_id = $2',
      ['lg-def', 'def-out'],
    );
    assert.equal(still.rows[0]?.squad_id, 'def-a');
  });

  test('a loan returns the player the day after it ends, once', async () => {
    await setup(scene('lg-ret', {
      squads: [
        { squad_id: 'ret-a', tenant_id: 'tenant-alpha', name: 'A' },
        { squad_id: 'ret-b', tenant_id: 'tenant-alpha', name: 'B' },
      ],
      players: [
        { player_id: 'ret-p', name: 'Loan', position: 'mf', squad_id: 'ret-a', role: 'starter' },
        { player_id: 'ret-q', name: 'Host', position: 'df', squad_id: 'ret-b', role: 'starter' },
      ],
    }));
    const loaned = await transfer({
      request_id: 'req-loan',
      league_id: 'lg-ret',
      player_id: 'ret-p',
      type: 'loan',
      from_squad_id: 'ret-a',
      to_squad_id: 'ret-b',
      effective_date: '2026-09-15',
      loan_end_date: '2026-09-30',
      requested_by: 'user-77',
      reason: 'Short loan',
    });
    assert.equal(loaned.statusCode, 201, JSON.stringify(loaned.json()));
    assert.equal(loaned.json().registration.registration_type, 'loan');
    assert.equal(loaned.json().registration.parent_squad_id, 'ret-a');
    assert.equal(loaned.json().registration.role, 'substitute');

    const during = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/ret-p?as_of=2026-09-30' });
    assert.equal(during.statusCode, 200, JSON.stringify(during.json()));
    const duringBody = during.json();
    assert.equal(duringBody.current_squad_id, 'ret-b');
    assert.equal(duringBody.parent_squad_id, 'ret-a');
    assert.equal(duringBody.history.filter((entry: { action: string }) => entry.action === 'loan_return').length, 0);

    const after = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/ret-p?as_of=2026-10-01' });
    const afterBody = after.json();
    assert.equal(afterBody.current_squad_id, 'ret-a');
    assert.equal(afterBody.parent_squad_id, null);
    assert.equal(afterBody.role, 'substitute');
    assert.equal(afterBody.history.filter((entry: { action: string }) => entry.action === 'loan_return').length, 1);
    const returned = afterBody.history.find((entry: { action: string }) => entry.action === 'loan_return');
    assert.equal(returned.who, 'system');
    assert.equal(returned.why, 'Loan ended');
    assert.equal(returned.from_squad_id, 'ret-b');
    assert.equal(returned.to_squad_id, 'ret-a');
    assert.equal(returned.effective_date, '2026-10-01');

    const again = await app.inject({ method: 'GET', url: '/audit/v1/roster/history/ret-p?as_of=2026-10-01' });
    assert.equal(again.json().history.filter((entry: { action: string }) => entry.action === 'loan_return').length, 1);
    assert.equal(duringBody.history.length, 1);
    assert.equal(afterBody.history.length, 2);
  });
});
