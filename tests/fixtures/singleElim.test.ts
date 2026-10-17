import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { seedOrder } from '../../backend/src/domain/fixtures/common';
import { generateSingleElim } from '../../backend/src/domain/fixtures/singleElim';
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

const find = (result: ReturnType<typeof generateSingleElim>, id: string) =>
  result.rounds.flatMap((r) => r.matches).find((m) => m.match_id === id)!;

describe('single elimination bracket', () => {
  test('seed order is recursive: order(8) = [1,8,4,5,2,7,3,6]', () => {
    assert.deepEqual(seedOrder(2), [1, 2]);
    assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
    assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    assert.deepEqual(seedOrder(16).slice(0, 4), [1, 16, 8, 9]);
  });

  test('n=6 → bracket 8 with the exact spec round-1 layout and byes', () => {
    const result = generateSingleElim(teams(6), {});
    assert.equal(result.format, 'single_elim');
    assert.equal(result.bracket_size, 8);
    assert.equal(result.rounds.length, 3);
    const r1 = result.rounds[0].matches.map((m) => [m.match_id, m.home, m.away, m.home_seed, m.away_seed, m.bye]);
    assert.deepEqual(r1, [
      ['R1M1', 't1', null, 1, null, true],
      ['R1M2', 't4', 't5', 4, 5, false],
      ['R1M3', 't2', null, 2, null, true],
      ['R1M4', 't3', 't6', 3, 6, false],
    ]);
    // Bye winners propagate immediately.
    assert.equal(find(result, 'R1M1').winner, 't1');
    assert.equal(find(result, 'R2M1').home, 't1');
    assert.equal(find(result, 'R2M1').home_seed, 1);
    assert.equal(find(result, 'R2M2').home, 't2');
    assert.equal(find(result, 'R2M1').away, null);
    assert.equal(find(result, 'R3M1').winner_to, null);
    for (const m of result.rounds.flatMap((r) => r.matches)) {
      assert.equal(m.bracket, 'main');
      assert.equal(m.loser_to, null);
    }
  });

  test('advancement: R{r}M{i} → R{r+1}M{ceil(i/2)}, home when i odd, away when i even', () => {
    const result = generateSingleElim(teams(8), {});
    assert.deepEqual(find(result, 'R1M1').winner_to, { match_id: 'R2M1', slot: 'home' });
    assert.deepEqual(find(result, 'R1M2').winner_to, { match_id: 'R2M1', slot: 'away' });
    assert.deepEqual(find(result, 'R1M3').winner_to, { match_id: 'R2M2', slot: 'home' });
    assert.deepEqual(find(result, 'R1M4').winner_to, { match_id: 'R2M2', slot: 'away' });
    assert.deepEqual(find(result, 'R2M2').winner_to, { match_id: 'R3M1', slot: 'away' });
    assert.equal(find(result, 'R3M1').winner_to, null);
    assert.equal(result.rounds.map((r) => r.matches.length).join(), '4,2,1');
    for (const m of result.rounds[0].matches) assert.equal(m.bye, false);
  });

  test('results fill winner/loser and propagate into the next slot', () => {
    const result = generateSingleElim(teams(6), { results: [{ match_id: 'R1M2', winner: 't4' }] });
    const m = find(result, 'R1M2');
    assert.equal(m.winner, 't4');
    assert.equal(m.loser, 't5');
    assert.equal(find(result, 'R2M1').away, 't4');
    assert.equal(find(result, 'R2M1').away_seed, 4);

    const chained = generateSingleElim(teams(4), {
      results: [
        { match_id: 'R2M1', winner: 't1' },
        { match_id: 'R1M1', winner: 't1' },
        { match_id: 'R1M2', winner: 't2' },
      ],
    });
    assert.equal(find(chained, 'R2M1').winner, 't1');
    assert.equal(find(chained, 'R2M1').loser, 't2');
  });

  test('unknown match id or non-participant winner → 400', () => {
    expectAppError(() => generateSingleElim(teams(4), { results: [{ match_id: 'R9M9', winner: 't1' }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSingleElim(teams(4), { results: [{ match_id: 'R1M1', winner: 't3' }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSingleElim(teams(4), { results: [{ match_id: 'R2M1', winner: 't1' }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSingleElim(teams(4), { results: 'x' }), 400, 'VALIDATION_ERROR');
  });

  test('third place match TP between semifinal losers', () => {
    const result = generateSingleElim(teams(4), {
      third_place_match: true,
      results: [
        { match_id: 'R1M1', winner: 't1' },
        { match_id: 'R1M2', winner: 't2' },
      ],
    });
    const tp = find(result, 'TP');
    assert.equal(tp.bracket, 'third_place');
    assert.deepEqual(find(result, 'R1M1').loser_to, { match_id: 'TP', slot: 'home' });
    assert.deepEqual(find(result, 'R1M2').loser_to, { match_id: 'TP', slot: 'away' });
    assert.equal(tp.home, 't4');
    assert.equal(tp.away, 't3');
    assert.equal(tp.winner_to, null);
    assert.equal(find(result, 'R2M1').loser_to, null);
  });

  test('field limits 2..128; two teams is a single final', () => {
    const two = generateSingleElim(teams(2), {});
    assert.equal(two.bracket_size, 2);
    assert.equal(two.rounds.length, 1);
    assert.equal(two.rounds[0].matches[0].winner_to, null);
    expectAppError(() => generateSingleElim(['solo'], {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateSingleElim(teams(129), {}), 400, 'VALIDATION_ERROR');
    assert.equal(generateSingleElim(teams(128), {}).rounds.length, 7);
    expectAppError(() => generateSingleElim(teams(4), { third_place_match: 'yes' }), 400, 'VALIDATION_ERROR');
  });
});
