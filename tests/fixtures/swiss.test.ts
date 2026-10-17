import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { generateSwiss } from '../../backend/src/domain/fixtures/swiss';
import { AppError } from '../../backend/src/http/errors';

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

function expectAppError(fn: () => unknown, status: number, code: string) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    assert.equal(err.statusCode, status);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail('expected an error');
}

describe('swiss round 1 (exact)', () => {
  test('odd field: last seed byes, seed i meets seed i+m, lower seed is home', () => {
    const result = generateSwiss(teams(5), { total_rounds: 3, round: 1 });
    assert.equal(result.format, 'swiss');
    assert.equal(result.round, 1);
    assert.equal(result.total_rounds, 3);
    assert.equal(result.bye, 't5');
    assert.deepEqual(result.pairings, [
      { match_id: 'SW-R1-M1', home: 't1', away: 't3' },
      { match_id: 'SW-R1-M2', home: 't2', away: 't4' },
    ]);
    assert.deepEqual(
      result.standings.map((s) => [s.rank, s.team_id, s.score, s.buchholz]),
      [
        [1, 't1', 0, 0],
        [2, 't2', 0, 0],
        [3, 't3', 0, 0],
        [4, 't4', 0, 0],
        [5, 't5', 0, 0],
      ],
    );
  });

  test('even field: no bye; defaults total_rounds = ceil(log2 n) and round 1', () => {
    const result = generateSwiss(teams(8), {});
    assert.equal(result.bye, null);
    assert.equal(result.total_rounds, 3);
    assert.equal(result.round, 1);
    assert.deepEqual(
      result.pairings.map((p) => [p.home, p.away]),
      [
        ['t1', 't5'],
        ['t2', 't6'],
        ['t3', 't7'],
        ['t4', 't8'],
      ],
    );
  });
});

describe('swiss later rounds', () => {
  const round1 = { round: 1, bye: 't5', matches: [
    { home: 't1', away: 't3', result: 'home' },
    { home: 't2', away: 't4', result: 'draw' },
  ] };

  test('standings reflect history: score, buchholz, seed order; bye counts as a win', () => {
    const result = generateSwiss(teams(5), { total_rounds: 3, round: 2, history: [round1] });
    const rows = result.standings.map((s) => [s.rank, s.team_id, s.score, s.buchholz]);
    assert.deepEqual(rows, [
      [1, 't1', 1, 0],
      [2, 't5', 1, 0],
      [3, 't2', 0.5, 0.5],
      [4, 't4', 0.5, 0.5],
      [5, 't3', 0, 1],
    ]);
  });

  test('round 2: no rematches, each team once, bye to lowest score without a prior bye', () => {
    const result = generateSwiss(teams(5), { total_rounds: 3, round: 2, history: [round1] });
    assert.equal(result.round, 2);
    assert.equal(result.bye, 't3', 'lowest score without a bye');
    const seen = new Set<string>();
    for (const p of result.pairings) {
      assert.ok(!seen.has(p.home) && !seen.has(p.away));
      seen.add(p.home);
      seen.add(p.away);
      const key = [p.home, p.away].sort().join();
      assert.ok(key !== 't1,t3' && key !== 't2,t4', `rematch ${key}`);
    }
    assert.equal(result.pairings.length, 2);
    assert.ok(result.pairings.every((p, i) => p.match_id === `SW-R2-M${i + 1}`));
    // Minimum achievable gap: t1(1) v t5(1) and t2(0.5) v t4(0.5) rematch is banned, so t2/t4 split.
    const gap = result.pairings.reduce((sum, p) => sum + Math.abs(score(result, p.home) - score(result, p.away)), 0);
    assert.equal(gap, 1);
  });

  test('bye tie goes to the worst seed (largest index) among equal lowest scores', () => {
    const history = [
      { round: 1, bye: null, matches: [
        { home: 't1', away: 't4', result: 'home' },
        { home: 't2', away: 't5', result: 'home' },
        { home: 't3', away: 't6', result: 'home' },
      ] },
    ];
    const result = generateSwiss(teams(7), { total_rounds: 3, round: 2, history: [{ ...history[0], bye: 't7' }] });
    // t4, t5, t6 all have 0 and no bye; t7 already had one. Worst seed is t6.
    assert.equal(result.bye, 't6');
  });

  test('search finds a pairing where greedy would fail', () => {
    // 4 teams, two rounds played: remaining legal pairs force a specific perfect matching.
    const history = [
      { round: 1, bye: null, matches: [
        { home: 't1', away: 't2', result: 'home' },
        { home: 't3', away: 't4', result: 'home' },
      ] },
      { round: 2, bye: null, matches: [
        { home: 't1', away: 't3', result: 'home' },
        { home: 't2', away: 't4', result: 'home' },
      ] },
    ];
    const result = generateSwiss(teams(4), { total_rounds: 3, round: 3, history });
    const keys = result.pairings.map((p) => [p.home, p.away].sort().join()).sort();
    assert.deepEqual(keys, ['t1,t4', 't2,t3']);
  });

  test('no rematch-free pairing → 409 NO_VALID_PAIRING with details.round', () => {
    // 4 teams have played all three rounds of a complete round robin; round 4 is impossible.
    const history = [
      { round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
      { round: 2, bye: null, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
      { round: 3, bye: null, matches: [{ home: 't1', away: 't4', result: 'home' }, { home: 't2', away: 't3', result: 'home' }] },
    ];
    // total_rounds max is n-1 = 3 for 4 teams, so use 5 teams with t5 always the bye.
    const five = history.map((h) => ({ ...h, bye: 't5' }));
    const err = expectAppError(
      () => generateSwiss(teams(5), { total_rounds: 4, round: 4, history: five }),
      409,
      'NO_VALID_PAIRING',
    );
    assert.deepEqual(err.details, { round: 4 });
  });

  test('buchholz sums opponents’ current scores and ignores byes', () => {
    const history = [
      { round: 1, bye: 't5', matches: [
        { home: 't1', away: 't3', result: 'home' },
        { home: 't2', away: 't4', result: 'away' },
      ] },
      { round: 2, bye: 't3', matches: [
        { home: 't1', away: 't4', result: 'home' },
        { home: 't5', away: 't2', result: 'draw' },
      ] },
    ];
    const result = generateSwiss(teams(5), { total_rounds: 4, round: 3, history });
    const byTeam = Object.fromEntries(result.standings.map((s) => [s.team_id, s]));
    // Scores: t1=2, t4=1, t5=1.5, t2=0.5, t3=1 (bye)
    assert.equal(byTeam.t1.score, 2);
    assert.equal(byTeam.t1.buchholz, byTeam.t3.score + byTeam.t4.score);
    assert.equal(byTeam.t5.buchholz, byTeam.t2.score, 'bye adds nothing');
    assert.equal(byTeam.t3.buchholz, byTeam.t1.score);
  });
});

describe('swiss validation', () => {
  test('history must cover exactly rounds 1..round-1', () => {
    expectAppError(() => generateSwiss(teams(4), { total_rounds: 3, round: 2 }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { total_rounds: 3, round: 3, history: [{ round: 1, bye: null, matches: [] }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { round: 1, history: [{ round: 1, bye: null, matches: [] }] }), 400, 'VALIDATION_ERROR');
  });

  test('bad result, unknown team, or self-pair in history → 400', () => {
    const base = { total_rounds: 3, round: 2 };
    expectAppError(() => generateSwiss(teams(4), { ...base, history: [{ round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'win' }] }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { ...base, history: [{ round: 1, bye: null, matches: [{ home: 't1', away: 'zz', result: 'home' }] }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { ...base, history: [{ round: 1, bye: 'zz', matches: [] }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { ...base, history: [{ round: 1, bye: null, matches: [{ home: 't1', away: 't1', result: 'home' }] }] }), 400, 'VALIDATION_ERROR');
  });

  test('total_rounds 1..n-1, round 1..total_rounds, teams 2..64', () => {
    expectAppError(() => generateSwiss(teams(4), { total_rounds: 4 }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(4), { total_rounds: 2, round: 3 }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(teams(65), {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSwiss(['solo'], {}), 400, 'VALIDATION_ERROR');
    assert.equal(generateSwiss(teams(2), {}).total_rounds, 1);
  });
});

function score(result: ReturnType<typeof generateSwiss>, team: string): number {
  return result.standings.find((s) => s.team_id === team)!.score;
}
