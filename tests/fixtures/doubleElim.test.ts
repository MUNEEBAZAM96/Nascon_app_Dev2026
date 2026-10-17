import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { generateDoubleElim } from '../../backend/src/domain/fixtures/doubleElim';
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

type Result = ReturnType<typeof generateDoubleElim>;
const all = (r: Result) => [...r.winners.flatMap((x) => x.matches), ...r.losers.flatMap((x) => x.matches), ...r.grand_final];
const find = (r: Result, id: string) => all(r).find((m) => m.match_id === id)!;

describe('double elimination structure', () => {
  test('n=8: exact winners/losers counts, GF1 and GF2 when reset is on', () => {
    const result = generateDoubleElim(teams(8), { bracket_reset: true });
    assert.equal(result.format, 'double_elim');
    assert.equal(result.bracket_size, 8);
    assert.equal(result.bracket_reset, true);
    assert.deepEqual(result.winners.map((r) => r.matches.length), [4, 2, 1]);
    assert.deepEqual(result.losers.map((r) => r.matches.length), [2, 2, 1, 1]);
    assert.equal(result.losers.flatMap((r) => r.matches).length, 6);
    assert.deepEqual(result.grand_final.map((m) => m.match_id), ['GF1', 'GF2']);
    assert.equal(find(result, 'GF2').conditional, true);
    assert.equal(find(result, 'GF2').required, null);
    for (const m of result.winners.flatMap((r) => r.matches)) assert.equal(m.bracket, 'winners');
    for (const m of result.losers.flatMap((r) => r.matches)) assert.equal(m.bracket, 'losers');
    assert.ok(find(result, 'WR1M1').match_id === 'WR1M1' && find(result, 'LR4M1').match_id === 'LR4M1');
  });

  test('n=16: losers rounds 2j-1 and 2j each have B/2^(j+1) matches, total B-2', () => {
    const result = generateDoubleElim(teams(16), {});
    assert.deepEqual(result.winners.map((r) => r.matches.length), [8, 4, 2, 1]);
    assert.deepEqual(result.losers.map((r) => r.matches.length), [4, 4, 2, 2, 1, 1]);
    assert.equal(result.losers.flatMap((r) => r.matches).length, 14);
    assert.deepEqual(result.grand_final.map((m) => m.match_id), ['GF1']);
    assert.equal(find(result, 'GF1').winner_to, null);
  });

  test('n=6 WR1 byes match single elimination', () => {
    const result = generateDoubleElim(teams(6), {});
    const r1 = result.winners[0].matches.map((m) => [m.match_id, m.home, m.away, m.bye]);
    assert.deepEqual(r1, [
      ['WR1M1', 't1', null, true],
      ['WR1M2', 't4', 't5', false],
      ['WR1M3', 't2', null, true],
      ['WR1M4', 't3', 't6', false],
    ]);
    assert.equal(find(result, 'WR2M1').home, 't1');
    assert.equal(find(result, 'WR2M2').home, 't2');
  });

  test('routing graph: every non-WR1 slot fed exactly once; loser_to rules; finals wiring', () => {
    for (const n of [5, 8, 12]) {
      const result = generateDoubleElim(teams(n), { bracket_reset: true });
      const feeds = new Map<string, number>();
      const bump = (link: { match_id: string; slot: string } | null) => {
        if (!link) return;
        const key = `${link.match_id}.${link.slot}`;
        feeds.set(key, (feeds.get(key) ?? 0) + 1);
      };
      for (const m of all(result)) {
        bump(m.winner_to);
        bump(m.loser_to);
        if (m.bracket === 'winners') assert.ok(m.loser_to, `${m.match_id} needs loser_to`);
        if (m.bracket === 'losers') assert.equal(m.loser_to, null);
        if (m.match_id !== 'GF2') assert.ok(m.winner_to, `${m.match_id} needs winner_to`);
      }
      for (const m of all(result)) {
        if (m.bracket === 'winners' && m.round === 1) continue;
        assert.equal(feeds.get(`${m.match_id}.home`), 1, `${m.match_id}.home feeders`);
        assert.equal(feeds.get(`${m.match_id}.away`), 1, `${m.match_id}.away feeders`);
      }
      const k = Math.log2(result.bracket_size);
      const wrFinal = find(result, `WR${k}M1`);
      const lbFinal = find(result, `LR${2 * (k - 1)}M1`);
      assert.deepEqual(wrFinal.winner_to, { match_id: 'GF1', slot: 'home' });
      assert.deepEqual(wrFinal.loser_to, { match_id: lbFinal.match_id, slot: 'away' });
      assert.deepEqual(lbFinal.winner_to, { match_id: 'GF1', slot: 'away' });
      assert.deepEqual(find(result, 'WR1M1').loser_to, { match_id: 'LR1M1', slot: 'home' });
      assert.deepEqual(find(result, 'WR1M2').loser_to, { match_id: 'LR1M1', slot: 'away' });
    }
  });
});

describe('double elimination play-through and bracket reset', () => {
  const played = (winner: (id: string, home: string, away: string) => string, reset = true) => {
    const ids = ['WR1M1', 'WR1M2', 'WR1M3', 'WR1M4', 'WR2M1', 'WR2M2', 'LR1M1', 'LR1M2', 'LR2M1', 'LR2M2', 'WR3M1', 'LR3M1', 'LR4M1', 'GF1'];
    let result = generateDoubleElim(teams(8), { bracket_reset: reset });
    const results: { match_id: string; winner: string }[] = [];
    for (const id of ids) {
      const m = find(result, id);
      assert.ok(m.home && m.away, `${id} should have both teams before it is played`);
      results.push({ match_id: id, winner: winner(id, m.home, m.away) });
      result = generateDoubleElim(teams(8), { bracket_reset: reset, results });
    }
    return result;
  };

  test('winners champion wins GF1 → GF2.required false', () => {
    const result = played((_, home) => home);
    const gf1 = find(result, 'GF1');
    assert.equal(gf1.home, 't1');
    assert.equal(gf1.winner, 't1');
    assert.equal(find(result, 'GF2').required, false);
    assert.equal(find(result, 'GF2').conditional, true);
  });

  test('losers champion wins GF1 → GF2.required true, same two teams', () => {
    const result = played((id, home, away) => (id === 'GF1' ? away : home));
    const gf1 = find(result, 'GF1');
    const gf2 = find(result, 'GF2');
    assert.equal(gf1.winner, gf1.away);
    assert.equal(gf2.required, true);
    assert.deepEqual(new Set([gf2.home, gf2.away]), new Set([gf1.home, gf1.away]));
  });

  test('without bracket_reset there is no GF2 and GF1 is terminal', () => {
    const result = played((_, home) => home, false);
    assert.equal(result.grand_final.length, 1);
    assert.equal(find(result, 'GF1').winner_to, null);
    assert.equal(find(result, 'GF1').winner, 't1');
  });

  test('before GF1 is decided GF2 mirrors GF1 teams and required stays null', () => {
    const ids = ['WR1M1', 'WR1M2', 'WR1M3', 'WR1M4', 'WR2M1', 'WR2M2', 'LR1M1', 'LR1M2', 'LR2M1', 'LR2M2', 'WR3M1', 'LR3M1', 'LR4M1'];
    let result = generateDoubleElim(teams(8), { bracket_reset: true });
    const results: { match_id: string; winner: string }[] = [];
    for (const id of ids) {
      const m = find(result, id);
      results.push({ match_id: id, winner: m.home! });
      result = generateDoubleElim(teams(8), { bracket_reset: true, results });
    }
    const gf1 = find(result, 'GF1');
    const gf2 = find(result, 'GF2');
    assert.ok(gf1.home && gf1.away);
    assert.equal(gf1.winner, null);
    assert.equal(gf2.required, null);
    assert.equal(gf2.home, gf1.home);
    assert.equal(gf2.away, gf1.away);
  });

  test('WR1 byes auto-advance through the losers bracket (5 teams)', () => {
    let result = generateDoubleElim(teams(5), {});
    // WR1M2 is the only real round-1 match (t4 v t5).
    result = generateDoubleElim(teams(5), { results: [{ match_id: 'WR1M2', winner: 't4' }] });
    assert.equal(find(result, 'LR1M1').winner, 't5', 'lone loser advances past the empty slot');
    assert.equal(find(result, 'LR2M1').home, 't5');
  });

  test('validation: 3..128 teams, bad winner → 400', () => {
    expectAppError(() => generateDoubleElim(teams(2), {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateDoubleElim(teams(129), {}), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateDoubleElim(teams(4), { results: [{ match_id: 'WR1M1', winner: 't2' }] }), 400, 'VALIDATION_ERROR');
    expectAppError(() => generateDoubleElim(teams(4), { bracket_reset: 'yes' }), 400, 'VALIDATION_ERROR');
    assert.equal(generateDoubleElim(teams(3), {}).bracket_size, 4);
  });
});
