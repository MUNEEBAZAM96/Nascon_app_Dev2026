import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

const TIE_BREAK = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const SHARED = {
  overtime: { policy: 'none' },
  tie_break_order: TIE_BREAK,
  roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} },
};

const EVENT_SPORT = {
  ...SHARED,
  sport_id: 'sample_event',
  name: 'Sample Event',
  scoring_model: 'event',
  draw_allowed: true,
  periods: { count: 1 },
  scoring_events: { mark: { points: 1 } },
};

const INNINGS_SPORT = {
  ...SHARED,
  sport_id: 'sample_innings',
  name: 'Sample Innings',
  scoring_model: 'innings',
  draw_allowed: true,
  periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
  scoring_events: {
    run: { runs: 1, legal_ball: true, wicket: false },
    out: { runs: 0, legal_ball: true, wicket: true },
  },
};

interface Row {
  rank: number;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
  fair_play: number;
  status: string;
  resolved_by: string | null;
}

interface Table {
  league_id: string;
  sport_id: string;
  qualification_spots: number;
  table: Row[];
  h2h: Record<string, Record<string, { played: number; points: number; scored: number; conceded: number }>>;
}

describe('leagues and standings', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const { reset } = await import('../../backend/src/db/seed');
    const { createSport } = await import('../../backend/src/domain/sports');
    const { getPool } = await import('../../backend/src/db/pool');
    const { buildApp } = await import('../../backend/src/app');
    query = (sql, params) => getPool().query(sql, params);
    await reset();
    await createSport(EVENT_SPORT);
    await createSport(INNINGS_SPORT);
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  function post(url: string, payload: unknown) {
    return app.inject({ method: 'POST', url, payload });
  }

  async function register(body: Record<string, unknown>) {
    const res = await post('/audit/v1/leagues', body);
    assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
    return res.json() as { league_id: string; status: string; team_count: number; fixture_count: number };
  }

  async function standings(leagueId: string) {
    const res = await app.inject({ method: 'GET', url: `/audit/v1/standings/${leagueId}` });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    return res.json() as Table;
  }

  async function event(body: Record<string, unknown>, status = 201) {
    const res = await post('/audit/v1/events', body);
    assert.equal(res.statusCode, status, JSON.stringify(res.json()));
    return res.json();
  }

  async function playMarks(matchId: string, marks: Array<[string, number]>, eventType = 'mark') {
    await event({ event_id: `${matchId}-start`, match_id: matchId, type: 'match_start', payload: {} });
    let n = 0;
    for (const [teamId, count] of marks) {
      for (let i = 0; i < count; i += 1) {
        n += 1;
        await event({
          event_id: `${matchId}-p${n}`,
          match_id: matchId,
          type: 'score',
          payload: { team_id: teamId, event_type: eventType },
        });
      }
    }
    await event({ event_id: `${matchId}-end`, match_id: matchId, type: 'match_end', payload: {} });
  }

  test('an unplayed table is ordered by drawing of lots', async () => {
    const { lotsKey } = await import('../../backend/src/crypto/sign');
    const created = await register({
      league_id: 'lg-1',
      sport_id: 'sample_event',
      teams: ['t1', 't2', 't3'],
      fixtures: [
        { match_id: 'lg1-m12', home_team_id: 't1', away_team_id: 't2' },
        { match_id: 'lg1-m23', home_team_id: 't2', away_team_id: 't3' },
        { match_id: 'lg1-m31', home_team_id: 't3', away_team_id: 't1' },
      ],
      qualification: { spots: 2 },
      lots_seed: 42,
      tie_break_order: TIE_BREAK,
    });
    assert.deepEqual(created, { league_id: 'lg-1', status: 'created', team_count: 3, fixture_count: 3 });

    const view = await standings('lg-1');
    const order = ['t1', 't3', 't2'];
    assert.deepEqual(order.map((teamId) => lotsKey(42, 'lg-1', teamId)), [
      '0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293',
      'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028',
      'e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9',
    ]);
    assert.deepEqual(view.table.map((row) => row.team_id), order);
    assert.deepEqual(view.table.map((row) => row.resolved_by), ['draw_lots', 'draw_lots', null]);
    for (const row of view.table) {
      assert.equal(row.played, 0);
      assert.equal(row.won, 0);
      assert.equal(row.drawn, 0);
      assert.equal(row.lost, 0);
      assert.equal(row.scored, 0);
      assert.equal(row.conceded, 0);
      assert.equal(row.diff, 0);
      assert.equal(row.points, 0);
      assert.equal(row.fair_play, 0);
      assert.equal(row.status, 'still_possible');
    }
    for (const left of order) {
      for (const right of order) {
        if (left === right) continue;
        assert.deepEqual(view.h2h[left][right], { played: 0, points: 0, scored: 0, conceded: 0 });
      }
    }
  });

  test('three teams on three points split by the head-to-head mini-league', async () => {
    await register({
      league_id: 'lg-mini',
      sport_id: 'sample_event',
      teams: ['A', 'B', 'C'],
      points: { win: 3, draw: 1, loss: 0 },
      fixtures: [
        { match_id: 'mini-ab', home_team_id: 'A', away_team_id: 'B' },
        { match_id: 'mini-ca', home_team_id: 'C', away_team_id: 'A' },
        { match_id: 'mini-bc', home_team_id: 'B', away_team_id: 'C' },
      ],
      qualification: { spots: 1 },
      tie_break_order: TIE_BREAK,
    });
    await playMarks('mini-ab', [['A', 2]]);
    await playMarks('mini-ca', [['C', 1]]);
    await playMarks('mini-bc', [['B', 3]]);

    const view = await standings('lg-mini');
    assert.deepEqual(view.table.map((row) => row.team_id), ['A', 'B', 'C']);
    assert.deepEqual(view.table.map((row) => row.points), [3, 3, 3]);
    assert.deepEqual(view.table.map((row) => row.resolved_by), ['h2h_points', 'h2h_diff', null]);
    assert.deepEqual(view.h2h.A.B, { played: 1, points: 3, scored: 2, conceded: 0 });
    assert.deepEqual(view.h2h.B.A, { played: 1, points: 0, scored: 0, conceded: 2 });
  });

  test('innings net run rate rounds to 3 decimals and counts a completed innings as its full overs', async () => {
    await register({
      league_id: 'lg-nrr',
      sport_id: 'sample_innings',
      teams: ['bat', 'bowl'],
      points: { win: 3, draw: 1, loss: 0 },
      fixtures: [{ match_id: 'nrr-1', home_team_id: 'bat', away_team_id: 'bowl' }],
      qualification: { spots: 1 },
    });
    await event({ event_id: 'nrr-start', match_id: 'nrr-1', type: 'match_start', payload: {} });
    for (let i = 1; i <= 5; i += 1) {
      await event({ event_id: `nrr-run-${i}`, match_id: 'nrr-1', type: 'score', payload: { team_id: 'bat', event_type: 'run' } });
    }
    for (let i = 1; i <= 10; i += 1) {
      await event({ event_id: `nrr-out-${i}`, match_id: 'nrr-1', type: 'score', payload: { team_id: 'bat', event_type: 'out' } });
    }
    for (let i = 1; i <= 12; i += 1) {
      await event({ event_id: `nrr-bowl-${i}`, match_id: 'nrr-1', type: 'score', payload: { team_id: 'bowl', event_type: 'run' } });
    }
    await event({ event_id: 'nrr-end', match_id: 'nrr-1', type: 'match_end', payload: {} });

    const batFaced = 20;
    const bowlFaced = 12 / 6;
    const batNrr = Math.round((5 / batFaced - 12 / bowlFaced) * 1000) / 1000;
    const bowlNrr = Math.round((12 / bowlFaced - 5 / batFaced) * 1000) / 1000;
    const view = await standings('lg-nrr');
    const bat = view.table.find((row) => row.team_id === 'bat');
    const bowl = view.table.find((row) => row.team_id === 'bowl');
    assert.equal(bat?.diff, batNrr);
    assert.equal(bowl?.diff, bowlNrr);
    assert.equal(batNrr, -5.75);
    assert.equal(bowlNrr, 5.75);
  });

  test('clinched and eliminated follow points and remaining fixtures only', async () => {
    const fixtures = [
      { match_id: 'q-c-e', home_team_id: 'c1', away_team_id: 'e1' },
      { match_id: 'q-c-o', home_team_id: 'c1', away_team_id: 'o1' },
      { match_id: 'q-s-e', home_team_id: 's1', away_team_id: 'e1' },
      { match_id: 'q-s-o', home_team_id: 's1', away_team_id: 'o1' },
    ];
    await register({
      league_id: 'lg-qual',
      sport_id: 'sample_event',
      teams: ['c1', 'e1', 's1', 'o1'],
      points: { win: 3, draw: 1, loss: 0 },
      fixtures,
      qualification: { spots: 2 },
      tie_break_order: TIE_BREAK,
    });
    await playMarks('q-c-e', [['c1', 1]]);
    await playMarks('q-c-o', [['c1', 1]]);
    await playMarks('q-s-e', [['s1', 1]]);

    const view = await standings('lg-qual');
    const byId = Object.fromEntries(view.table.map((row) => [row.team_id, row]));
    assert.equal(byId.c1.points, 6);
    assert.equal(byId.c1.status, 'clinched');
    assert.equal(byId.e1.points, 0);
    assert.equal(byId.e1.status, 'eliminated');
    assert.equal(byId.s1.points, 3);
    assert.equal(byId.s1.status, 'still_possible');
    assert.equal(byId.o1.points, 0);
    assert.equal(byId.o1.status, 'still_possible');

    await register({
      league_id: 'lg-qual-2',
      sport_id: 'sample_event',
      teams: ['c1', 'e1', 's1', 'o1'],
      points: { win: 3, draw: 1, loss: 0 },
      fixtures: fixtures.map((fixture) => ({ ...fixture, match_id: `${fixture.match_id}-b` })),
      qualification: { spots: 2 },
      tie_break_order: ['fair_play', 'scored', 'overall_diff', 'h2h_points', 'h2h_diff', 'draw_lots'],
    });
    await playMarks('q-c-e-b', [['c1', 1]]);
    await playMarks('q-c-o-b', [['c1', 1]]);
    await playMarks('q-s-e-b', [['s1', 1]]);
    const again = await standings('lg-qual-2');
    const againById = Object.fromEntries(again.table.map((row) => [row.team_id, row.status]));
    assert.deepEqual(againById, { c1: 'clinched', e1: 'eliminated', s1: 'still_possible', o1: 'still_possible' });
  });

  test('a compensation changes the next standings read and leaves the old row', async () => {
    await register({
      league_id: 'lg-comp',
      sport_id: 'sample_event',
      teams: ['p1', 'p2'],
      points: { win: 3, draw: 1, loss: 0 },
      fixtures: [{ match_id: 'comp-1', home_team_id: 'p1', away_team_id: 'p2' }],
      qualification: { spots: 1 },
    });
    await event({ event_id: 'comp-start', match_id: 'comp-1', type: 'match_start', payload: {} });
    await event({ event_id: 'comp-mark', match_id: 'comp-1', type: 'score', payload: { team_id: 'p1', event_type: 'mark' } });
    await event({ event_id: 'comp-end', match_id: 'comp-1', type: 'match_end', payload: {} });

    const beforeTable = await standings('lg-comp');
    assert.equal(beforeTable.table[0].team_id, 'p1');
    assert.equal(beforeTable.table[0].points, 3);
    assert.equal(beforeTable.table[0].scored, 1);
    assert.deepEqual(beforeTable.h2h.p1.p2, { played: 1, points: 3, scored: 1, conceded: 0 });

    const storedBefore = await query('SELECT payload, sequence FROM match_events WHERE id = $1', ['comp-mark']);
    await event({ event_id: 'comp-fix', match_id: 'comp-1', type: 'compensation', payload: { compensates: 'comp-mark' } });
    const storedAfter = await query('SELECT payload, sequence FROM match_events WHERE id = $1', ['comp-mark']);
    assert.deepEqual(storedAfter.rows[0], storedBefore.rows[0]);

    const afterTable = await standings('lg-comp');
    const p1 = afterTable.table.find((row) => row.team_id === 'p1');
    const p2 = afterTable.table.find((row) => row.team_id === 'p2');
    assert.equal(p1?.points, 1);
    assert.equal(p2?.points, 1);
    assert.equal(p1?.scored, 0);
    assert.equal(p1?.conceded, 0);
    assert.equal(p1?.diff, 0);
    assert.deepEqual(afterTable.h2h.p1.p2, { played: 1, points: 1, scored: 0, conceded: 0 });
    assert.notEqual(beforeTable.table[0].points, afterTable.table.find((row) => row.rank === 1)?.points);
  });

  test('league fixtures start without match_init, and the error catalogue is exact', async () => {
    await register({
      league_id: 'lg-stream',
      sport_id: 'sample_event',
      teams: ['h', 'a'],
      fixtures: [{ match_id: 'stream-1', home_team_id: 'h', away_team_id: 'a' }],
      qualification: { spots: 1 },
    });
    const preview = await app.inject({ method: 'GET', url: '/audit/v1/score/stream-1' });
    assert.equal(preview.statusCode, 200);
    const previewBody = preview.json();
    assert.equal(previewBody.status, 'upcoming');
    assert.equal(previewBody.outcome, 'pending');
    assert.deepEqual(previewBody.events, []);
    assert.equal(previewBody.home.team_id, 'h');
    assert.equal(previewBody.home.score, 0);

    const started = await event({ event_id: 'stream-start', match_id: 'stream-1', type: 'match_start', payload: {} });
    assert.equal(started.sequence, 1);
    const init = await post('/audit/v1/events', {
      event_id: 'stream-init',
      match_id: 'stream-1',
      type: 'match_init',
      payload: { sport_id: 'sample_event', home_team_id: 'h', away_team_id: 'a' },
    });
    assert.equal(init.statusCode, 409);
    assert.equal(init.json().error.code, 'MATCH_EXISTS');

    const missingSport = await post('/audit/v1/leagues', {
      league_id: 'lg-missing',
      sport_id: 'missing_sport',
      teams: ['t1', 't2'],
      fixtures: [{ match_id: 'missing-m', home_team_id: 't1', away_team_id: 't2' }],
      qualification: { spots: 1 },
    });
    assert.equal(missingSport.statusCode, 404);
    assert.equal(missingSport.json().error.code, 'SPORT_NOT_FOUND');

    const again = await post('/audit/v1/leagues', {
      league_id: 'lg-1',
      sport_id: 'sample_event',
      teams: ['t1', 't2'],
      fixtures: [{ match_id: 'fresh-m', home_team_id: 't1', away_team_id: 't2' }],
      qualification: { spots: 1 },
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, 'LEAGUE_EXISTS');

    const reused = await post('/audit/v1/leagues', {
      league_id: 'lg-reuse',
      sport_id: 'sample_event',
      teams: ['t1', 't2'],
      fixtures: [{ match_id: 'lg1-m12', home_team_id: 't1', away_team_id: 't2' }],
      qualification: { spots: 1 },
    });
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().error.code, 'MATCH_EXISTS');

    const unknown = await app.inject({ method: 'GET', url: '/audit/v1/standings/lg-nope' });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error.code, 'LEAGUE_NOT_FOUND');

    const seeded = await post('/audit/v1/leagues', {
      league_id: 'league-alpha-1',
      sport_id: 'sample_event',
      teams: ['t1', 't2'],
      fixtures: [{ match_id: 'alpha-new', home_team_id: 't1', away_team_id: 't2' }],
      qualification: { spots: 1 },
    });
    assert.equal(seeded.statusCode, 409);
    assert.equal(seeded.json().error.code, 'LEAGUE_EXISTS');
  });
});
