import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

describe('phase II reset', { concurrency: 1 }, () => {
  test('a second reset keeps the day 1 seed and the day 2 rows', async () => {
    const { migrate, getPool } = await import('../../backend/src/db/pool');
    const { reset } = await import('../../backend/src/db/seed');
    const { projectScore } = await import('../../backend/src/domain/scoring');
    await migrate();

    const first = await reset();
    const second = await reset();
    assert.deepEqual(second, first);
    assert.deepEqual(second.sports, ['football', 'basketball', 'cricket', 'esports']);
    assert.deepEqual(second.tenants, ['tenant-alpha', 'tenant-beta']);
    assert.deepEqual(second.stock, { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 });

    const pool = getPool();
    const players = await pool.query<{ id: string; club_id: string }>(
      `SELECT id, club_id FROM players WHERE id = ANY($1) ORDER BY id`,
      [['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2']],
    );
    assert.deepEqual(players.rows, [
      { id: 'player-alpha-1', club_id: 'club-alpha-1' },
      { id: 'player-alpha-2', club_id: 'club-alpha-2' },
      { id: 'player-beta-1', club_id: 'club-beta-1' },
      { id: 'player-beta-2', club_id: 'club-beta-1' },
    ]);

    const score = await projectScore('match-m1');
    assert.equal(score.status, 'in_progress');
    assert.equal(score.home.score, 1);
    assert.equal(score.away.score, 0);

    const links = await pool.query<{ entity_id: string; short_url: string; scan_count: number }>(
      'SELECT entity_id, short_url, scan_count FROM qr_links ORDER BY entity_id',
    );
    assert.deepEqual(links.rows, [
      { entity_id: 'club-alpha-1', short_url: 'http://localhost:8080/q/c-alpha-1', scan_count: 0 },
      { entity_id: 'match-m1', short_url: 'http://localhost:8080/q/m1-live', scan_count: 0 },
      { entity_id: 'player-alpha-1', short_url: 'http://localhost:8080/q/p-alpha-1', scan_count: 0 },
    ]);

    const guest = await pool.query<{ token: string; merged: boolean; role: string }>(
      'SELECT token, merged, role FROM guest_tokens WHERE token = $1',
      ['guest_anon_tok_7721'],
    );
    assert.deepEqual(guest.rows, [{ token: 'guest_anon_tok_7721', merged: false, role: 'read-only' }]);

    const cart = await pool.query<{ items: unknown[] }>('SELECT items FROM carts WHERE user_id = $1', ['player-alpha-1']);
    assert.equal(cart.rows.length, 1);
    assert.equal(cart.rows[0].items.length, 0);

    const demo = await projectScore('demo-match-1');
    const demoTwo = await projectScore('demo-match-2');
    assert.equal(demo.status, 'upcoming');
    assert.equal(demoTwo.status, 'upcoming');
  });
});
