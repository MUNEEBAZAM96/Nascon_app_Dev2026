import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';

describe('POST /audit/v1/fixtures over HTTP', () => {
  let app: FastifyInstance;

  before(async () => {
    const { buildApp } = await import('../../backend/src/app');
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('round robin 200 with spec shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/fixtures',
      payload: { format: 'round_robin', teams: ['t1', 't2', 't3', 't4', 't5'], params: { legs: 1 } },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.format, 'round_robin');
    assert.equal(body.round_count, 5);
    assert.equal(body.rounds.length, 5);
    assert.ok(body.rounds.every((r: { byes: string[] }) => r.byes.length === 1));
    assert.deepEqual(body.summary, { total: 10, scheduled: 10, forfeit: 0, voided: 0 });
  });

  test('unknown format → 400 VALIDATION_ERROR envelope', async () => {
    const res = await app.inject({ method: 'POST', url: '/audit/v1/fixtures', payload: { format: 'ladder', teams: ['a', 'b'] } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.json().error.details.fields));
  });

  test('domain validation reaches the client as 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/audit/v1/fixtures', payload: { format: 'round_robin', teams: ['a'] } });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json().error.details, { fields: ['teams'] });
  });

  test('swiss with no legal pairing → 409 NO_VALID_PAIRING', async () => {
    const history = [
      { round: 1, bye: 't5', matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
      { round: 2, bye: 't5', matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
      { round: 3, bye: 't5', matches: [{ home: 't1', away: 't4', result: 'home' }, { home: 't2', away: 't3', result: 'home' }] },
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/fixtures',
      payload: { format: 'swiss', teams: ['t1', 't2', 't3', 't4', 't5'], params: { total_rounds: 4, round: 4, history } },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'NO_VALID_PAIRING');
    assert.deepEqual(res.json().error.details, { round: 4 });
  });

  test('single and double elimination respond 200', async () => {
    const single = await app.inject({ method: 'POST', url: '/audit/v1/fixtures', payload: { format: 'single_elim', teams: ['a', 'b', 'c'] } });
    assert.equal(single.statusCode, 200);
    assert.equal(single.json().bracket_size, 4);
    const dbl = await app.inject({ method: 'POST', url: '/audit/v1/fixtures', payload: { format: 'double_elim', teams: ['a', 'b', 'c'], params: { bracket_reset: true } } });
    assert.equal(dbl.statusCode, 200);
    assert.equal(dbl.json().grand_final.length, 2);
  });
});
