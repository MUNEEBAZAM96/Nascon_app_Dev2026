process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.MINIO_ENDPOINT ??= '127.0.0.1';
process.env.MINIO_PORT ??= '9000';
process.env.MINIO_ACCESS_KEY ??= 'sideline';
process.env.MINIO_SECRET_KEY ??= 'sideline-secret';
process.env.MINIO_BUCKET ??= 'receipts';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

const GUEST = 'guest_anon_tok_7721';
const L = 'var-jersey-001-L';
const M = 'var-jersey-001-M';
const PLAYER = 'player-alpha-1';

describe('guest cart merge and write guard', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let signDay2: (entityId: string, sigPayload: unknown) => string;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const crypto = await import('../../backend/src/crypto/sign');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    signDay2 = crypto.signDay2;
    query = (sql, params) => pool.getPool().query(sql, params);
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
    for (const handle of handles) handle.unref?.();
  });

  function guestHeaders() {
    return { authorization: `Bearer ${GUEST}` };
  }

  function mergeBody(over: Record<string, unknown> = {}) {
    return {
      guest_token: GUEST,
      registered_user_id: PLAYER,
      cart: [{ variant_id: L, quantity: 1 }],
      ...over,
    };
  }

  test('cart merge adds one L jersey with signed totals', async () => {
    const res = await app.inject({ method: 'POST', url: '/audit/v1/guest/cart-merge', payload: mergeBody() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.total_items, 1);
    assert.equal(body.subtotal_minor, 450000);
    assert.equal(body.currency, 'PKR');
    assert.equal(body.write_block_verified, true);
    assert.equal(body.write_rejection_code, 403);
    assert.equal(
      body.signature,
      signDay2(GUEST, {
        cart_merged: true,
        guest_token: GUEST,
        registered_user_id: PLAYER,
        total_items: 1,
        write_rejection_code: 403,
      }),
    );
  });

  test('identical cart merge replay stays at one item', async () => {
    const res = await app.inject({ method: 'POST', url: '/audit/v1/guest/cart-merge', payload: mergeBody() });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().total_items, 1);
    const cart = await query('SELECT items FROM carts WHERE user_id = $1', [PLAYER]);
    const items = cart.rows[0].items as Array<{ variant_id: string; quantity: number }>;
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 1);
  });

  test('changed cart after merge returns 409 GUEST_TOKEN_ALREADY_MERGED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/guest/cart-merge',
      payload: mergeBody({ cart: [{ variant_id: L, quantity: 2 }] }),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'GUEST_TOKEN_ALREADY_MERGED');
  });

  test('guest bearer is forbidden on checkout, events, and chat without side effects', async () => {
    await reset();
    const baselineM = await app.inject({ method: 'GET', url: `/audit/v1/inventory/${M}` });
    const baselineL = await app.inject({ method: 'GET', url: `/audit/v1/inventory/${L}` });
    assert.equal(baselineM.json().stock, 1);
    assert.equal(baselineL.json().stock, 5);

    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/audit/v1/checkout',
      headers: guestHeaders(),
      payload: {
        order_id: 'ord-guest-block',
        customer_id: 'cust-guest',
        items: [{ variant_id: M, quantity: 1 }],
        payment: { token: 'tok_success' },
      },
    });
    assert.equal(checkoutRes.statusCode, 403);
    assert.equal(checkoutRes.json().error.code, 'GUEST_WRITE_FORBIDDEN');

    const eventsRes = await app.inject({
      method: 'POST',
      url: '/audit/v1/events',
      headers: guestHeaders(),
      payload: { event_id: 'guest-block', match_id: 'match-m1', type: 'match_end', payload: {} },
    });
    assert.equal(eventsRes.statusCode, 403);
    assert.equal(eventsRes.json().error.code, 'GUEST_WRITE_FORBIDDEN');

    const chatRes = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: guestHeaders(),
      payload: { message: 'hello' },
    });
    assert.equal(chatRes.statusCode, 403);
    assert.equal(chatRes.json().error.code, 'GUEST_WRITE_FORBIDDEN');

    const events = await query('SELECT count(*)::int AS n FROM match_events WHERE match_id = $1', ['match-m1']);
    assert.equal(events.rows[0].n, 2);
    assert.deepEqual((await app.inject({ method: 'GET', url: `/audit/v1/inventory/${M}` })).json(), baselineM.json());
    assert.deepEqual((await app.inject({ method: 'GET', url: `/audit/v1/inventory/${L}` })).json(), baselineL.json());
  });

  test('checkout without guest header still validates the body first', async () => {
    await reset();
    const res = await app.inject({ method: 'POST', url: '/audit/v1/checkout', payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('merge validation rejects bad token prefix', async () => {
    await reset();
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/guest/cart-merge',
      payload: mergeBody({ guest_token: 'not-guest-token' }),
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('merge validation rejects unknown player and variant', async () => {
    await reset();
    const missingPlayer = await app.inject({
      method: 'POST',
      url: '/audit/v1/guest/cart-merge',
      payload: mergeBody({ registered_user_id: 'player-missing' }),
    });
    assert.equal(missingPlayer.statusCode, 404);
    assert.equal(missingPlayer.json().error.code, 'PLAYER_NOT_FOUND');

    const missingVariant = await app.inject({
      method: 'POST',
      url: '/audit/v1/guest/cart-merge',
      payload: mergeBody({ cart: [{ variant_id: 'var-missing', quantity: 1 }] }),
    });
    assert.equal(missingVariant.statusCode, 404);
    assert.equal(missingVariant.json().error.code, 'VARIANT_NOT_FOUND');
  });

  test('merge validation rejects quantity above stock', async () => {
    await reset();
    const res = await app.inject({
      method: 'POST',
      url: '/audit/v1/guest/cart-merge',
      payload: mergeBody({ cart: [{ variant_id: M, quantity: 2 }] }),
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'OUT_OF_STOCK');
    assert.equal(res.json().error.details.variant_id, M);
  });
});
