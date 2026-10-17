import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { generateRoundRobin } from '../../backend/src/domain/fixtures/roundRobin';
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

function checkInvariants(n: number, legs: 1 | 2) {
  const result = generateRoundRobin(teams(n), { legs });
  const perLeg = n % 2 === 0 ? n - 1 : n;
  assert.equal(result.format, 'round_robin');
  assert.equal(result.team_count, n);
  assert.equal(result.round_count, perLeg * legs);
  assert.equal(result.rounds.length, perLeg * legs);

  const pairCount = new Map<string, number>();
  const orderedCount = new Map<string, number>();
  const byesPerLeg = new Map<string, number[]>(teams(n).map((t) => [t, [0, 0]]));
  const homeByLeg = [new Map<string, number>(), new Map<string, number>()];
  const awayByLeg = [new Map<string, number>(), new Map<string, number>()];

  for (const round of result.rounds) {
    const seen = new Set<string>();
    assert.equal(round.matches.length, Math.floor(n / 2));
    assert.equal(round.byes.length, n % 2 === 0 ? 0 : 1);
    const legIndex = round.round <= perLeg ? 0 : 1;
    for (const bye of round.byes) byesPerLeg.get(bye)![legIndex]++;

    round.matches.forEach((match, i) => {
      assert.equal(match.match_id, `RR-L${legIndex + 1}-R${round.round}-M${i + 1}`);
      assert.equal(match.leg, legIndex + 1);
      assert.equal(match.status, 'scheduled');
      assert.equal(match.awarded_to, null);
      for (const team of [match.home, match.away]) {
        assert.ok(!seen.has(team), `${team} plays twice in round ${round.round}`);
        seen.add(team);
      }
      const key = [match.home, match.away].sort().join('|');
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      const ordered = `${match.home}>${match.away}`;
      orderedCount.set(ordered, (orderedCount.get(ordered) ?? 0) + 1);
      homeByLeg[legIndex].set(match.home, (homeByLeg[legIndex].get(match.home) ?? 0) + 1);
      awayByLeg[legIndex].set(match.away, (awayByLeg[legIndex].get(match.away) ?? 0) + 1);
    });
  }

  assert.equal(pairCount.size, (n * (n - 1)) / 2, 'every pair must meet');
  for (const count of pairCount.values()) assert.equal(count, legs);
  if (legs === 2) for (const count of orderedCount.values()) assert.equal(count, 1);

  for (const team of teams(n)) {
    for (let leg = 0; leg < legs; leg++) {
      const home = homeByLeg[leg].get(team) ?? 0;
      const away = awayByLeg[leg].get(team) ?? 0;
      assert.ok(Math.abs(home - away) <= 1, `${team} leg ${leg + 1}: home ${home} away ${away}`);
      if (n % 2 === 1) assert.equal(byesPerLeg.get(team)![leg], 1, `${team} byes once in leg ${leg + 1}`);
    }
  }
  assert.deepEqual(result.summary, { total: result.rounds.length * Math.floor(n / 2), scheduled: result.rounds.length * Math.floor(n / 2), forfeit: 0, voided: 0 });
}

describe('round robin schedule', () => {
  test('odd field: one bye per round, every team byes once per leg', () => checkInvariants(5, 1));
  test('even field: no byes, n-1 rounds', () => checkInvariants(6, 1));
  test('double leg: each ordered pair once, rounds continue globally', () => checkInvariants(5, 2));
  test('large even field keeps home/away balance', () => checkInvariants(12, 2));
  test('smallest field of 2', () => checkInvariants(2, 1));
  test('odd field of 3 and 7', () => {
    checkInvariants(3, 1);
    checkInvariants(7, 2);
  });
});

describe('round robin withdrawals', () => {
  test('forfeit_remaining forfeits rounds after after_round and awards the opponent', () => {
    const result = generateRoundRobin(teams(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
    for (const round of result.rounds) {
      for (const match of round.matches) {
        const involved = match.home === 't3' || match.away === 't3';
        if (involved && round.round > 2) {
          assert.equal(match.status, 'forfeit');
          assert.equal(match.awarded_to, match.home === 't3' ? match.away : match.home);
        } else {
          assert.equal(match.status, 'scheduled');
          assert.equal(match.awarded_to, null);
        }
      }
    }
    assert.equal(result.summary.forfeit, 2);
    assert.equal(result.summary.scheduled, 8);
    assert.equal(result.summary.total, 10);
  });

  test('after_round 0 means the team never plays', () => {
    const result = generateRoundRobin(teams(4), { withdrawals: [{ team_id: 't1', after_round: 0 }] });
    const involved = result.rounds.flatMap((r) => r.matches).filter((m) => m.home === 't1' || m.away === 't1');
    assert.equal(involved.length, 3);
    for (const match of involved) assert.equal(match.status, 'forfeit');
  });

  test('void_all voids every fixture of the team, any round', () => {
    const result = generateRoundRobin(teams(5), {
      withdrawals: [{ team_id: 't3', after_round: 2 }],
      withdrawal_policy: 'void_all',
    });
    const involved = result.rounds.flatMap((r) => r.matches).filter((m) => m.home === 't3' || m.away === 't3');
    assert.equal(involved.length, 4);
    for (const match of involved) {
      assert.equal(match.status, 'voided');
      assert.equal(match.awarded_to, null);
    }
    assert.equal(result.summary.voided, 4);
    assert.equal(result.rounds.flatMap((r) => r.byes).filter((b) => b === 't3').length, 1, 'byes unaffected');
  });

  test('a fixture between two withdrawn teams is voided under forfeit_remaining', () => {
    const result = generateRoundRobin(teams(4), {
      withdrawals: [
        { team_id: 't1', after_round: 0 },
        { team_id: 't2', after_round: 0 },
      ],
    });
    const all = result.rounds.flatMap((r) => r.matches);
    const both = all.find((m) => [m.home, m.away].sort().join() === 't1,t2')!;
    assert.equal(both.status, 'voided');
    assert.equal(both.awarded_to, null);
    assert.equal(result.summary.voided, 1);
    assert.equal(result.summary.forfeit, 4);
    assert.equal(result.summary.scheduled, 1);
  });

  test('unknown team or out-of-range after_round → 400 VALIDATION_ERROR', () => {
    expectAppError(() => generateRoundRobin(teams(4), { withdrawals: [{ team_id: 'zz', after_round: 1 }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(teams(4), { withdrawals: [{ team_id: 't1', after_round: 4 }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(teams(4), { withdrawals: [{ team_id: 't1', after_round: -1 }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(teams(4), { withdrawal_policy: 'nope' }), 400, 'VALIDATION_ERROR');
  });
});

describe('round robin validation', () => {
  test('team limits 2..40 and uniqueness', () => {
    expectAppError(() => generateRoundRobin(['a'], {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(teams(41), {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(['a', 'a'], {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(['a', 'b|c'], {}), 400, 'VALIDATION_ERROR');
    assert.equal(generateRoundRobin(teams(40), {}).round_count, 39);
  });

  test('legs must be 1 or 2; params must be an object', () => {
    expectAppError(() => generateRoundRobin(teams(4), { legs: 3 }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateRoundRobin(teams(4), 'x'), 400, 'VALIDATION_ERROR');
    const err = expectAppError(() => generateRoundRobin(teams(4), { legs: 0 }), 400, 'VALIDATION_ERROR');
    assert.deepEqual(err.details, { fields: ['legs'] });
  });
});
