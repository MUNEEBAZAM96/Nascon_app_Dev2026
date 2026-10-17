import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

const KABADDI = {
  sport_id: 'kabaddi',
  name: 'Kabaddi',
  scoring_model: 'event',
  periods: { count: 2, duration_minutes: 20 },
  scoring_events: {
    raid_point: { points: 1 },
    tackle_point: { points: 1 },
    bonus: { points: 1 },
    all_out: { points: 2 },
  },
  draw_allowed: true,
  overtime: { policy: 'golden_raid' },
  tie_break_order: ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'],
  roster: { min_squad_size: 7, max_squad_size: 12, required_positions: {} },
};

const INNINGS = {
  sport_id: 'sample_innings',
  name: 'Sample Innings',
  scoring_model: 'innings',
  periods: { innings_per_team: 1, balls_per_over: 6 },
  scoring_events: {
    wide: { runs: 1, legal_ball: false, wicket: false },
  },
  draw_allowed: true,
  overtime: { policy: 'none' },
  tie_break_order: ['scored'],
  roster: { min_squad_size: 11, max_squad_size: 15, required_positions: {} },
};

describe('sports as data', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let getSport: (id: string) => Promise<typeof KABADDI>;

  before(async () => {
    ({ reset } = await import('../../backend/src/db/seed'));
    ({ getSport } = await import('../../backend/src/domain/sports'));
    const { buildApp } = await import('../../backend/src/app');
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  async function post(payload: unknown) {
    return app.inject({ method: 'POST', url: '/audit/v1/sports', payload });
  }

  test('kabaddi example returns 201 and getSport reads the same row', async () => {
    const res = await post(KABADDI);
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.sport_id, 'kabaddi');
    assert.equal(body.status, 'created');
    assert.equal(body.config.scoring_events.all_out.points, 2);
    assert.equal(body.config.overtime.policy, 'golden_raid');
    assert.deepEqual(await getSport('kabaddi'), body.config);
  });

  test('the same sport_id again returns 409 SPORT_EXISTS', async () => {
    const res = await post(KABADDI);
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'SPORT_EXISTS');
  });

  test('a seeded sport_id returns 409 SPORT_EXISTS', async () => {
    const res = await post({ ...KABADDI, sport_id: 'football', name: 'Already seeded' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'SPORT_EXISTS');
  });

  test('a bad sport_id returns 400 VALIDATION_ERROR', async () => {
    for (const sport_id of ['Kabaddi', 'bad id', '9kabaddi']) {
      const res = await post({ ...KABADDI, sport_id });
      assert.equal(res.statusCode, 400, sport_id);
      const body = res.json();
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(body.error.details.fields.includes('sport_id'), sport_id);
    }
  });

  test('missing name, bad scoring_model, and inverted roster limits are 400', async () => {
    const missingName = await post({ ...KABADDI, sport_id: 'fresh_name', name: undefined });
    assert.equal(missingName.statusCode, 400);
    assert.ok(missingName.json().error.details.fields.includes('name'));

    const badModel = await post({ ...KABADDI, sport_id: 'fresh_model', scoring_model: 'magic' });
    assert.equal(badModel.statusCode, 400);
    assert.ok(badModel.json().error.details.fields.includes('scoring_model'));

    const badRoster = await post({
      ...KABADDI,
      sport_id: 'fresh_roster',
      roster: { min_squad_size: 12, max_squad_size: 7, required_positions: {} },
    });
    assert.equal(badRoster.statusCode, 400);
    assert.ok(badRoster.json().error.details.fields.includes('roster'));
  });

  test('an innings sport keeps numeric and boolean event fields', async () => {
    const res = await post(INNINGS);
    assert.equal(res.statusCode, 201);
    const stored = await getSport('sample_innings');
    assert.deepEqual(stored.scoring_events.wide, { runs: 1, legal_ball: false, wicket: false });
    assert.equal(stored.scoring_model, 'innings');
  });

  test('an unknown id is 404 SPORT_NOT_FOUND', async () => {
    await assert.rejects(getSport('no-such-sport'), (err: unknown) => {
      assert.equal((err as { statusCode: number }).statusCode, 404);
      assert.equal((err as { code: string }).code, 'SPORT_NOT_FOUND');
      return true;
    });
  });

  test('reset removes the created sport, so it lived in Postgres', async () => {
    await reset();
    await assert.rejects(getSport('kabaddi'), (err: unknown) => {
      assert.equal((err as { statusCode: number }).statusCode, 404);
      assert.equal((err as { code: string }).code, 'SPORT_NOT_FOUND');
      return true;
    });
  });
});
