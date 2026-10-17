import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

process.env.DAY1_SALT ??= 'test-salt';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.MINIO_ENDPOINT ??= '127.0.0.1';
process.env.MINIO_PORT ??= '9000';
process.env.MINIO_ACCESS_KEY ??= 'sideline';
process.env.MINIO_SECRET_KEY ??= 'sideline-secret';
process.env.MINIO_BUCKET ??= 'receipts';

const M = 'var-jersey-001-M';
const L = 'var-jersey-001-L';

describe('store checkout', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: (input?: { stock?: Record<string, number> }) => Promise<unknown>;
  let sign: (salt: string, id: string, payload: unknown) => string;
  let salt: string;
  let query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

  before(async () => {
    const seed = await import('../../backend/src/db/seed');
    const config = await import('../../backend/src/config');
    const crypto = await import('../../backend/src/crypto/sign');
    const pool = await import('../../backend/src/db/pool');
    const { buildApp } = await import('../../backend/src/app');
    reset = seed.reset;
    sign = crypto.sign;
    salt = config.loadConfig().day1Salt;
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

  function order(over: Record<string, unknown> = {}) {
    return {
      order_id: 'ord-001',
      customer_id: 'cust-001',
      items: [{ variant_id: M, quantity: 1 }],
      payment: { token: 'tok_success' },
      ...over,
    };
  }

  async function checkout(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/checkout', payload: body });
  }

  async function inventory(variantId: string) {
    const res = await app.inject({ method: 'GET', url: `/audit/v1/inventory/${variantId}` });
    assert.equal(res.statusCode, 200, JSON.stringify(res.json()));
    return res.json() as { variant_id: string; stock: number; reserved: number };
  }

  function pdfBytes(body: { receipt: { pdf_base64: string } }): Buffer {
    return Buffer.from(body.receipt.pdf_base64, 'base64');
  }

  test('a paid checkout signs the receipt payload and clears the last unit', async () => {
    await reset();
    const res = await checkout(order());
    assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
    const body = res.json();
    assert.equal(body.status, 'paid');
    assert.equal(body.total_minor, 450000);
    assert.equal(body.discount_minor, 0);
    assert.equal(body.http_status, undefined);
    assert.equal(body.receipt.signature, sign(salt, 'ord-001', body.receipt.payload));
    const pdf = pdfBytes(body);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.includes(Buffer.from('ord-001')), true);
    assert.equal(pdf.includes(Buffer.from('PKR 4500.00')), true);
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 0, reserved: 0 });
  });

  test('the identical paid body replays as 200 and does not sell the unit again', async () => {
    await reset();
    const body = order({ order_id: 'ord-replay' });
    const first = await checkout(body);
    assert.equal(first.statusCode, 201, JSON.stringify(first.json()));
    const paid = first.json();
    const second = await checkout(body);
    assert.equal(second.statusCode, 200);
    const again = second.json();
    assert.equal(again.receipt.payload.paid_at, paid.receipt.payload.paid_at);
    assert.equal(again.receipt.signature, paid.receipt.signature);
    assert.equal(again.payment.authorization_id, paid.payment.authorization_id);
    assert.equal(again.payment.capture_id, paid.payment.capture_id);
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 0, reserved: 0 });
    const rows = await query('SELECT id FROM orders WHERE id = $1', ['ord-replay']);
    assert.equal(rows.rows.length, 1);
  });

  test('a different body for the same order id is a duplicate', async () => {
    await reset();
    const first = await checkout(order({ order_id: 'ord-dup' }));
    assert.equal(first.statusCode, 201, JSON.stringify(first.json()));
    const changed = await checkout(order({ order_id: 'ord-dup', customer_id: 'cust-002' }));
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error.code, 'DUPLICATE_ORDER_ID');
    assert.equal(changed.json().error.details.order_id, 'ord-dup');
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 0, reserved: 0 });
  });

  test('WELCOME10 discounts one jersey to 405000 and prints PKR 4050.00', async () => {
    await reset();
    const res = await checkout(order({ order_id: 'ord-welcome', discount_code: 'WELCOME10' }));
    assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
    const body = res.json();
    assert.equal(body.discount_minor, 45000);
    assert.equal(body.total_minor, 405000);
    assert.equal(pdfBytes(body).includes(Buffer.from('PKR 4050.00')), true);
  });

  test('an unknown discount code does not change stock', async () => {
    await reset();
    const res = await checkout(order({ order_id: 'ord-nope', discount_code: 'NOPE' }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_DISCOUNT_CODE');
    assert.notEqual(res.json().error.code, 'VALIDATION_ERROR');
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 1, reserved: 0 });
  });

  test('a missing variant is 404 even when the discount code is also bad', async () => {
    await reset();
    const missing = await checkout(order({
      order_id: 'ord-missing',
      items: [{ variant_id: 'var-missing', quantity: 1 }],
    }));
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'VARIANT_NOT_FOUND');
    assert.equal(missing.json().error.details.variant_id, 'var-missing');

    const both = await checkout(order({
      order_id: 'ord-missing-2',
      items: [{ variant_id: 'var-missing', quantity: 1 }],
      discount_code: 'NOPE',
    }));
    assert.equal(both.statusCode, 404);
    assert.equal(both.json().error.code, 'VARIANT_NOT_FOUND');
  });

  test('a declined token puts the unit back and a new order can buy it', async () => {
    await reset();
    const declined = await checkout(order({ order_id: 'ord-declined', payment: { token: 'tok_declined' } }));
    assert.equal(declined.statusCode, 402);
    assert.equal(declined.json().error.code, 'PAYMENT_DECLINED');
    assert.equal(declined.json().http_status, undefined);
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 1, reserved: 0 });
    const bought = await checkout(order({ order_id: 'ord-after-decline' }));
    assert.equal(bought.statusCode, 201, JSON.stringify(bought.json()));
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 0, reserved: 0 });
  });

  test('a capture failure puts the unit back on sale', async () => {
    await reset();
    const failed = await checkout(order({ order_id: 'ord-capture', payment: { token: 'tok_capture_fail' } }));
    assert.equal(failed.statusCode, 402);
    assert.equal(failed.json().error.code, 'PAYMENT_CAPTURE_FAILED');
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 1, reserved: 0 });
  });

  test('replaying a declined checkout does not take the unit twice', async () => {
    await reset();
    const body = order({ order_id: 'ord-decline-replay', payment: { token: 'tok_declined' } });
    const first = await checkout(body);
    const second = await checkout(body);
    assert.equal(first.statusCode, 402);
    assert.equal(second.statusCode, 402);
    assert.equal(first.json().error.code, 'PAYMENT_DECLINED');
    assert.equal(second.json().error.code, 'PAYMENT_DECLINED');
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 1, reserved: 0 });
  });

  test('a short line rolls back every variant in the checkout', async () => {
    await reset({ stock: { [M]: 1, [L]: 5 } });
    const res = await checkout(order({
      order_id: 'ord-short',
      items: [
        { variant_id: M, quantity: 2 },
        { variant_id: L, quantity: 1 },
      ],
    }));
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'OUT_OF_STOCK');
    assert.equal(res.json().error.details.variant_id, M);
    assert.deepEqual(await inventory(L), { variant_id: L, stock: 5, reserved: 0 });
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 1, reserved: 0 });
  });

  test('twenty buyers of the last unit produce one paid order', async () => {
    await reset({ stock: { [M]: 1, [L]: 5 } });
    const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => checkout(order({
      order_id: `ord-burst-${index}`,
      customer_id: `cust-${index}`,
    }))));
    const paid = responses.filter((res) => res.statusCode === 201);
    const stockouts = responses.filter((res) => res.statusCode === 409 && res.json().error.code === 'OUT_OF_STOCK');
    const failures = responses.filter((res) => res.statusCode === 500);
    assert.equal(failures.length, 0, JSON.stringify(failures.map((res) => res.json())));
    assert.equal(paid.length, 1);
    assert.equal(stockouts.length, 19);
    assert.deepEqual(await inventory(M), { variant_id: M, stock: 0, reserved: 0 });
    assert.deepEqual(await inventory(L), { variant_id: L, stock: 5, reserved: 0 });
  });

  test('a customer id with quotes and a script tag still pays', async () => {
    await reset();
    const res = await checkout(order({
      order_id: 'ord-text',
      customer_id: 'cust-"<script>',
      items: [{ variant_id: L, quantity: 1 }],
    }));
    assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
    assert.equal(res.json().status, 'paid');
    assert.equal(res.json().receipt.payload.customer_id, 'cust-"<script>');
  });
});
