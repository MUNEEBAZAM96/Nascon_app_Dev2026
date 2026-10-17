import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

const SHARED = {
  overtime: { policy: 'none' },
  tie_break_order: ['scored'],
  roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} },
};

const SAMPLE_EVENT = {
  ...SHARED,
  sport_id: 'sample_event',
  name: 'Sample Event',
  scoring_model: 'event',
  draw_allowed: true,
  periods: { count: 1 },
  scoring_events: { point: { points: 1 }, treble: { points: 3 } },
};

const SAMPLE_INNINGS = {
  ...SHARED,
  sport_id: 'sample_innings',
  name: 'Sample Innings',
  scoring_model: 'innings',
  draw_allowed: true,
  periods: { innings_per_team: 1, overs_per_innings: 1, balls_per_over: 2, wickets_per_innings: 10 },
  scoring_events: {
    run: { runs: 1, legal_ball: true, wicket: false },
    extra: { runs: 1, legal_ball: false, wicket: false },
  },
};

const SAMPLE_ROUND = {
  ...SHARED,
  sport_id: 'sample_round',
  name: 'Sample Round',
  scoring_model: 'round',
  draw_allowed: false,
  periods: { best_of: 3 },
  scoring_events: { map_win: { rounds: 1 } },
};

const SUCCESS_KEYS = ['event_id', 'match_id', 'match_version', 'sequence', 'signature', 'type'];

describe('event-sourced scoring', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let createSport: (input: unknown) => Promise<unknown>;
  let sign: (salt: string, id: string, payload: unknown) => string;
  let day1Salt: string;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;

  before(async () => {
    ({ reset } = await import('../../backend/src/db/seed'));
    ({ createSport } = await import('../../backend/src/domain/sports'));
    ({ sign } = await import('../../backend/src/crypto/sign'));
    const config = await import('../../backend/src/config');
    const { getPool } = await import('../../backend/src/db/pool');
    const { buildApp } = await import('../../backend/src/app');
    day1Salt = config.loadConfig().day1Salt;
    query = (sql, params) => getPool().query(sql, params);
    await reset();
    await createSport(SAMPLE_EVENT);
    await createSport(SAMPLE_INNINGS);
    await createSport(SAMPLE_ROUND);
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  function post(payload: unknown) {
    return app.inject({ method: 'POST', url: '/audit/v1/events', payload });
  }

  async function accept(payload: Record<string, unknown>, sequence: number) {
    const res = await post(payload);
    assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), SUCCESS_KEYS);
    assert.equal(body.event_id, payload.event_id);
    assert.equal(body.match_id, payload.match_id);
    assert.equal(body.type, payload.type);
    assert.equal(body.sequence, sequence);
    assert.equal(body.match_version, sequence);
    return body as { signature: string; sequence: number; match_version: number };
  }

  async function scoreOf(matchId: string) {
    const res = await app.inject({ method: 'GET', url: `/audit/v1/score/${matchId}` });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    return res.json();
  }

  test('init, start, score, compensation, and match_end replay the corrected score', async () => {
    const matchId = 'm-event';
    const init = { event_id: 'e-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } };
    const start = { event_id: 'e-start', match_id: matchId, type: 'match_start', payload: {} };
    const point = { event_id: 'e-point', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'point' } };
    const treble = { event_id: 'e-treble', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'treble' } };
    const comp = { event_id: 'e-comp', match_id: matchId, type: 'compensation', payload: { compensates: 'e-treble' } };
    const end = { event_id: 'e-end', match_id: matchId, type: 'match_end', payload: {} };
    await accept(init, 1);
    await accept(start, 2);
    const pointBody = await accept(point, 3);
    await accept(treble, 4);
    await accept(comp, 5);
    await accept(end, 6);

    assert.equal(pointBody.signature, sign(day1Salt, 'e-point', point.payload));

    const view = await scoreOf(matchId);
    assert.equal(view.status, 'completed');
    assert.equal(view.outcome, 'home_win');
    assert.equal(view.winner_team_id, 'h1');
    assert.equal(view.tiebreak_winner_team_id, null);
    assert.equal(view.league_id, null);
    assert.equal(view.version, 6);
    assert.equal(view.home.score, 1);
    assert.equal(view.away.score, 0);
    assert.equal(view.home.fair_play, 0);
    assert.equal(view.away.fair_play, 0);
    assert.equal(view.home.wickets, null);
    assert.equal(view.home.balls, null);
    assert.equal(view.home.overs, null);

    const trebleRow = view.events.find((event: { event_id: string }) => event.event_id === 'e-treble');
    const compRow = view.events.find((event: { event_id: string }) => event.event_id === 'e-comp');
    assert.equal(trebleRow.payload.event_type, 'treble');
    assert.equal(trebleRow.compensated, true);
    assert.equal(trebleRow.compensated_by, 'e-comp');
    assert.equal(compRow.compensated, false);
    assert.equal(compRow.compensated_by, null);

    const stored = await query('SELECT payload, sequence FROM match_events WHERE id = $1', ['e-treble']);
    assert.equal(stored.rows[0].sequence, 4);
    assert.deepEqual(stored.rows[0].payload, { team_id: 'h1', event_type: 'treble' });
  });

  test('the same body replays as 200 and a changed body is 409', async () => {
    const init = { event_id: 'e-init-2', match_id: 'm-idem', type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } };
    const first = await accept(init, 1);
    const again = await post(init);
    assert.equal(again.statusCode, 200);
    const body = again.json();
    assert.deepEqual(Object.keys(body).sort(), SUCCESS_KEYS);
    assert.equal(body.signature, first.signature);
    assert.equal(body.sequence, 1);
    assert.equal(body.match_version, 1);
    const count = await query('SELECT count(*)::int AS n FROM match_events WHERE id = $1', ['e-init-2']);
    assert.equal(count.rows[0].n, 1);

    const changed = await post({ ...init, payload: { ...init.payload, home_team_id: 'h2' } });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, 'DUPLICATE_EVENT_ID');
  });

  test('a non-legal delivery does not spend a ball, and the next delivery is 409', async () => {
    const matchId = 'm-innings';
    await accept({ event_id: 'inn-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_innings', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'inn-start', match_id: matchId, type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'inn-extra', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'extra' } }, 3);
    await accept({ event_id: 'inn-run-1', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'run' } }, 4);
    await accept({ event_id: 'inn-run-2', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'run' } }, 5);
    const blocked = await post({ event_id: 'inn-run-3', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'run' } });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, 'INNINGS_COMPLETE');
    const view = await scoreOf(matchId);
    assert.equal(view.home.score, 3);
    assert.equal(view.home.balls, 2);
    assert.equal(view.home.overs, '1.0');
    assert.equal(view.home.wickets, 0);
    assert.equal(view.away.balls, 0);
    assert.equal(view.away.overs, '0.0');
  });

  test('innings caps multiply by innings_per_team for balls and wickets', async () => {
    await createSport({
      ...SHARED,
      sport_id: 'sample_long',
      name: 'Sample Long',
      scoring_model: 'innings',
      draw_allowed: true,
      periods: { innings_per_team: 2, overs_per_innings: 1, balls_per_over: 2, wickets_per_innings: 10 },
      scoring_events: { run: { runs: 1, legal_ball: true, wicket: false } },
    });
    await createSport({
      ...SHARED,
      sport_id: 'sample_wicket',
      name: 'Sample Wicket',
      scoring_model: 'innings',
      draw_allowed: true,
      periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 1 },
      scoring_events: { out: { runs: 0, legal_ball: true, wicket: true } },
    });

    const balls = 'm-long';
    await accept({ event_id: 'long-init', match_id: balls, type: 'match_init', payload: { sport_id: 'sample_long', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'long-start', match_id: balls, type: 'match_start', payload: {} }, 2);
    for (let i = 1; i <= 4; i += 1) {
      await accept({ event_id: `long-run-${i}`, match_id: balls, type: 'score', payload: { team_id: 'h1', event_type: 'run' } }, i + 2);
    }
    const fifth = await post({ event_id: 'long-run-5', match_id: balls, type: 'score', payload: { team_id: 'h1', event_type: 'run' } });
    assert.equal(fifth.statusCode, 409);
    assert.equal(fifth.json().error.code, 'INNINGS_COMPLETE');

    const wickets = 'm-wicket';
    await accept({ event_id: 'wkt-init', match_id: wickets, type: 'match_init', payload: { sport_id: 'sample_wicket', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'wkt-start', match_id: wickets, type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'wkt-out', match_id: wickets, type: 'score', payload: { team_id: 'h1', event_type: 'out' } }, 3);
    const next = await post({ event_id: 'wkt-next', match_id: wickets, type: 'score', payload: { team_id: 'h1', event_type: 'out' } });
    assert.equal(next.statusCode, 409);
    assert.equal(next.json().error.code, 'INNINGS_COMPLETE');
  });

  test('a decided series rejects the next map and stays in progress', async () => {
    const matchId = 'm-round';
    await accept({ event_id: 'rnd-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_round', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'rnd-start', match_id: matchId, type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'rnd-1', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'map_win' } }, 3);
    await accept({ event_id: 'rnd-2', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'map_win' } }, 4);
    const third = await post({ event_id: 'rnd-3', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'map_win' } });
    assert.equal(third.statusCode, 409);
    assert.equal(third.json().error.code, 'SERIES_ALREADY_DECIDED');
    const view = await scoreOf(matchId);
    assert.equal(view.status, 'in_progress');
    assert.equal(view.outcome, 'pending');
    assert.equal(view.winner_team_id, null);
    assert.equal(view.home.score, 2);
    assert.equal(view.away.score, 0);
    assert.equal(view.home.wickets, null);
  });

  test('a level round match needs a tie-break, and compensating it after the end is undecided', async () => {
    const matchId = 'm-tie';
    await accept({ event_id: 'tie-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_round', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'tie-start', match_id: matchId, type: 'match_start', payload: {} }, 2);
    const blocked = await post({ event_id: 'tie-end-early', match_id: matchId, type: 'match_end', payload: {} });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error.code, 'TIE_NOT_ALLOWED');
    const stored = await query('SELECT count(*)::int AS n FROM match_events WHERE id = $1', ['tie-end-early']);
    assert.equal(stored.rows[0].n, 0);

    await accept({ event_id: 'tie-winner', match_id: matchId, type: 'tiebreak_winner', payload: { team_id: 'h1' } }, 3);
    await accept({ event_id: 'tie-end', match_id: matchId, type: 'match_end', payload: {} }, 4);
    const won = await scoreOf(matchId);
    assert.equal(won.outcome, 'home_win');
    assert.equal(won.winner_team_id, 'h1');
    assert.equal(won.tiebreak_winner_team_id, 'h1');
    assert.equal(won.home.score, 0);
    assert.equal(won.away.score, 0);

    const comp = await post({ event_id: 'tie-comp', match_id: matchId, type: 'compensation', payload: { compensates: 'tie-winner' } });
    assert.equal(comp.statusCode, 201);
    const undone = await scoreOf(matchId);
    assert.equal(undone.outcome, 'undecided');
    assert.equal(undone.winner_team_id, null);
    assert.equal(undone.tiebreak_winner_team_id, null);
    const tieRow = undone.events.find((event: { event_id: string }) => event.event_id === 'tie-winner');
    assert.equal(tieRow.compensated, true);
  });

  test('illegal order, a second init, and unknown records use the catalogue codes', async () => {
    const early = await post({ event_id: 'ord-score', match_id: 'm-order', type: 'score', payload: { team_id: 'h1', event_type: 'point' } });
    assert.equal(early.statusCode, 409);
    assert.equal(early.json().error.code, 'MATCH_NOT_IN_PROGRESS');

    await accept({ event_id: 'ord-init', match_id: 'm-order', type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    const earlyComp = await post({ event_id: 'ord-comp', match_id: 'm-order', type: 'compensation', payload: { compensates: 'missing' } });
    assert.equal(earlyComp.statusCode, 409);
    assert.equal(earlyComp.json().error.code, 'MATCH_NOT_IN_PROGRESS');

    await accept({ event_id: 'ord-start', match_id: 'm-order', type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'ord-point', match_id: 'm-order', type: 'score', payload: { team_id: 'a1', event_type: 'point' } }, 3);
    await accept({ event_id: 'ord-end', match_id: 'm-order', type: 'match_end', payload: {} }, 4);
    const after = await post({ event_id: 'ord-late', match_id: 'm-order', type: 'score', payload: { team_id: 'h1', event_type: 'point' } });
    assert.equal(after.statusCode, 409);
    assert.equal(after.json().error.code, 'MATCH_NOT_IN_PROGRESS');
    const ended = await scoreOf('m-order');
    assert.equal(ended.outcome, 'away_win');
    assert.equal(ended.winner_team_id, 'a1');

    const secondEnd = await post({ event_id: 'ord-end-2', match_id: 'm-order', type: 'match_end', payload: {} });
    assert.equal(secondEnd.statusCode, 409);
    assert.equal(secondEnd.json().error.code, 'ILLEGAL_TRANSITION');

    const noInit = await post({ event_id: 'ord-start-bare', match_id: 'm-bare', type: 'match_start', payload: {} });
    assert.equal(noInit.statusCode, 409);
    assert.equal(noInit.json().error.code, 'ILLEGAL_TRANSITION');

    const secondInit = await post({ event_id: 'ord-init-2', match_id: 'm-order', type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } });
    assert.equal(secondInit.statusCode, 409);
    assert.equal(secondInit.json().error.code, 'MATCH_EXISTS');

    const missing = await app.inject({ method: 'GET', url: '/audit/v1/score/m-missing' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'MATCH_NOT_FOUND');

    const unknownSport = await post({ event_id: 'ord-unknown-sport', match_id: 'm-unknown-sport', type: 'match_init', payload: { sport_id: 'no_such_sport', home_team_id: 'h1', away_team_id: 'a1' } });
    assert.equal(unknownSport.statusCode, 404);
    assert.equal(unknownSport.json().error.code, 'SPORT_NOT_FOUND');

    const level = await post({ event_id: 'draw-init', match_id: 'm-draw', type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } });
    assert.equal(level.statusCode, 201);
    await accept({ event_id: 'draw-start', match_id: 'm-draw', type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'draw-end', match_id: 'm-draw', type: 'match_end', payload: {} }, 3);
    const drawn = await scoreOf('m-draw');
    assert.equal(drawn.outcome, 'draw');
    assert.equal(drawn.winner_team_id, null);
  });

  test('an event type absent from the sport JSON is 400 UNKNOWN_EVENT_TYPE', async () => {
    const matchId = 'm-unknown-type';
    await accept({ event_id: 'unk-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'unk-start', match_id: matchId, type: 'match_start', payload: {} }, 2);
    const res = await post({ event_id: 'unk-score', match_id: matchId, type: 'score', payload: { team_id: 'h1', event_type: 'not_in_the_json' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'UNKNOWN_EVENT_TYPE');
  });

  test('discipline changes fair play only, and bad compensations use the catalogue', async () => {
    const matchId = 'm-fair';
    await accept({ event_id: 'fair-init', match_id: matchId, type: 'match_init', payload: { sport_id: 'sample_event', home_team_id: 'h1', away_team_id: 'a1' } }, 1);
    await accept({ event_id: 'fair-start', match_id: matchId, type: 'match_start', payload: {} }, 2);
    await accept({ event_id: 'fair-card', match_id: matchId, type: 'discipline', payload: { team_id: 'h1', points: 2 } }, 3);
    const added = await scoreOf(matchId);
    assert.equal(added.home.fair_play, 2);
    assert.equal(added.home.score, 0);

    await accept({ event_id: 'fair-comp', match_id: matchId, type: 'compensation', payload: { compensates: 'fair-card' } }, 4);
    const removed = await scoreOf(matchId);
    assert.equal(removed.home.fair_play, 0);

    const unknown = await post({ event_id: 'fair-missing', match_id: matchId, type: 'compensation', payload: { compensates: 'does-not-exist' } });
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error.code, 'EVENT_NOT_FOUND');

    const initTarget = await post({ event_id: 'fair-init-comp', match_id: matchId, type: 'compensation', payload: { compensates: 'fair-init' } });
    assert.equal(initTarget.statusCode, 409);
    assert.equal(initTarget.json().error.code, 'INVALID_COMPENSATION');

    const twice = await post({ event_id: 'fair-comp-2', match_id: matchId, type: 'compensation', payload: { compensates: 'fair-card' } });
    assert.equal(twice.statusCode, 409);
    assert.equal(twice.json().error.code, 'INVALID_COMPENSATION');
  });
});
