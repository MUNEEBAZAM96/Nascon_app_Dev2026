import { createHash } from 'node:crypto';

import PDFDocument from 'pdfkit';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { canonical, sign } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { loadConfig } from '../../config';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';
import { enqueueOrderStatus } from '../../queue/orders';
import { ensureReceiptsBucket, getMinio } from '../../storage/minio';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);

const CheckoutBody = z.object({
  order_id: Id,
  customer_id: z.string(),
  items: z.array(z.object({
    variant_id: Id,
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(10),
  discount_code: z.string().nullable().optional(),
  payment: z.object({
    token: z.enum(['tok_success', 'tok_declined', 'tok_capture_fail']),
  }),
});

type CheckoutInput = z.infer<typeof CheckoutBody>;

interface VariantRow {
  id: string;
  price_minor: number;
  currency: string;
  stock: number;
  reserved: number;
}

interface OrderRow {
  status: string;
  request_hash: string;
  response: Record<string, unknown>;
}

interface Line {
  variant_id: string;
  quantity: number;
  unit_price_minor: number;
}

interface Priced {
  currency: string;
  items: Line[];
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
}

interface SuccessBody {
  order_id: string;
  status: 'paid';
  currency: string;
  items: Line[];
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  payment: { authorization_id: string; capture_id: string; state: 'captured' };
  receipt: {
    payload: {
      order_id: string;
      customer_id: string;
      items: Line[];
      subtotal_minor: number;
      discount_minor: number;
      total_minor: number;
      currency: string;
      paid_at: string;
    };
    signature: string;
    pdf_base64: string;
  };
}

/** Reserves stock under row locks, runs the mock gateway, and returns a signed PDF receipt (Section 5.12). */
export async function checkout(input: unknown): Promise<{ http_status: 200 | 201 | 402 } & Record<string, unknown>> {
  const body = parseBody(CheckoutBody, input ?? {});
  const seen = new Set<string>();
  for (const item of body.items) {
    if (seen.has(item.variant_id)) invalid(['items']);
    seen.add(item.variant_id);
  }
  const hash = requestHash(body);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`order:${body.order_id}`]);
    const existing = await loadOrder(client, body.order_id);
    if (existing) {
      const replay = replayOf(body.order_id, existing, hash);
      await client.query('COMMIT');
      return replay;
    }

    await assertVariants(client, body.items);
    const percent = await discountPercent(client, body.discount_code);
    const locked = await lockVariants(client, body.items.map((item) => item.variant_id));
    const priced = priceLines(body.items, locked, percent);
    const short = body.items.find((item) => {
      const row = locked.get(item.variant_id);
      return !row || row.stock < item.quantity;
    });
    if (short) {
      throw new AppError(409, 'OUT_OF_STOCK', 'Not enough stock.', { variant_id: short.variant_id });
    }

    for (const item of body.items) {
      await client.query(
        'UPDATE variants SET stock = stock - $2, reserved = reserved + $2 WHERE id = $1',
        [item.variant_id, item.quantity],
      );
    }

    if (body.payment.token !== 'tok_success') {
      const failure = paymentError(body.payment.token);
      await client.query('ROLLBACK');
      const stored = await storeFailure(client, body, hash, failure);
      return { http_status: 402, ...stored };
    }

    for (const item of body.items) {
      await client.query('UPDATE variants SET reserved = reserved - $2 WHERE id = $1', [item.variant_id, item.quantity]);
    }
    const success = await paidReceipt(body, priced);
    await client.query(
      `INSERT INTO orders (id, customer_id, status, request_hash, response)
       VALUES ($1, $2, 'paid', $3, $4::jsonb)`,
      [body.order_id, body.customer_id, hash, JSON.stringify(success)],
    );
    await client.query('COMMIT');
    await publishReceipt(body.order_id, Buffer.from(success.receipt.pdf_base64, 'base64'));
    return { http_status: 201, ...success };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Returns available and in-flight reserved stock for one variant. */
export async function getInventory(variantId: string): Promise<{ variant_id: string; stock: number; reserved: number }> {
  const result = await getPool().query<{ id: string; stock: number; reserved: number }>(
    'SELECT id, stock, reserved FROM variants WHERE id = $1',
    [variantId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found.', { variant_id: variantId });
  return { variant_id: row.id, stock: Number(row.stock), reserved: Number(row.reserved) };
}

function requestHash(body: CheckoutInput): string {
  const value: Record<string, unknown> = {
    order_id: body.order_id,
    customer_id: body.customer_id,
    items: body.items.map((item) => ({ variant_id: item.variant_id, quantity: item.quantity })),
    payment: { token: body.payment.token },
  };
  if (body.discount_code !== undefined) value.discount_code = body.discount_code;
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

async function loadOrder(client: PoolClient, orderId: string): Promise<OrderRow | null> {
  const result = await client.query<OrderRow>(
    'SELECT status, request_hash, response FROM orders WHERE id = $1',
    [orderId],
  );
  return result.rows[0] ?? null;
}

function replayOf(orderId: string, row: OrderRow, hash: string): { http_status: 200 | 402 } & Record<string, unknown> {
  if (row.request_hash !== hash) {
    throw new AppError(409, 'DUPLICATE_ORDER_ID', 'Order already exists.', { order_id: orderId });
  }
  if (row.status === 'paid') return { http_status: 200, ...row.response };
  return { http_status: 402, ...row.response };
}

async function assertVariants(client: PoolClient, items: CheckoutInput['items']): Promise<void> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM variants WHERE id = ANY($1::text[])',
    [items.map((item) => item.variant_id)],
  );
  const found = new Set(result.rows.map((row) => row.id));
  for (const item of items) {
    if (!found.has(item.variant_id)) {
      throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found.', { variant_id: item.variant_id });
    }
  }
}

async function discountPercent(client: PoolClient, code: string | null | undefined): Promise<number> {
  if (code === undefined || code === null) return 0;
  const result = await client.query<{ percent: number }>('SELECT percent FROM discount_codes WHERE code = $1', [code]);
  const row = result.rows[0];
  if (!row) throw new AppError(400, 'INVALID_DISCOUNT_CODE', 'Discount code is not valid.');
  return Number(row.percent);
}

async function lockVariants(client: PoolClient, ids: string[]): Promise<Map<string, VariantRow>> {
  const result = await client.query<VariantRow>(
    `SELECT id, price_minor, currency, stock, reserved
     FROM variants WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, {
    ...row,
    price_minor: Number(row.price_minor),
    stock: Number(row.stock),
    reserved: Number(row.reserved),
  }]));
}

function priceLines(items: CheckoutInput['items'], locked: Map<string, VariantRow>, percent: number): Priced {
  let subtotal = 0;
  const lines = items.map((item) => {
    const variant = locked.get(item.variant_id);
    const unit = variant?.price_minor ?? 0;
    subtotal += unit * item.quantity;
    return { variant_id: item.variant_id, quantity: item.quantity, unit_price_minor: unit };
  });
  const discount = Math.floor(subtotal * percent / 100);
  return {
    currency: locked.get(items[0].variant_id)?.currency ?? 'PKR',
    items: lines,
    subtotal_minor: subtotal,
    discount_minor: discount,
    total_minor: subtotal - discount,
  };
}

function paymentError(token: 'tok_declined' | 'tok_capture_fail'): { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (token === 'tok_declined') {
    return { error: { code: 'PAYMENT_DECLINED', message: 'Payment was declined.', details: {} } };
  }
  return { error: { code: 'PAYMENT_CAPTURE_FAILED', message: 'Payment capture failed.', details: {} } };
}

async function storeFailure(
  client: PoolClient,
  body: CheckoutInput,
  hash: string,
  failure: { error: { code: string; message: string; details: Record<string, unknown> } },
): Promise<Record<string, unknown>> {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`order:${body.order_id}`]);
  const existing = await loadOrder(client, body.order_id);
  if (existing) {
    await client.query('COMMIT');
    const replay = replayOf(body.order_id, existing, hash);
    return replay;
  }
  await client.query(
    `INSERT INTO orders (id, customer_id, status, request_hash, response)
     VALUES ($1, $2, 'payment_failed', $3, $4::jsonb)`,
    [body.order_id, body.customer_id, hash, JSON.stringify(failure)],
  );
  await client.query('COMMIT');
  return failure;
}

async function paidReceipt(body: CheckoutInput, priced: Priced): Promise<SuccessBody> {
  const paidAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const payload = {
    order_id: body.order_id,
    customer_id: body.customer_id,
    items: priced.items,
    subtotal_minor: priced.subtotal_minor,
    discount_minor: priced.discount_minor,
    total_minor: priced.total_minor,
    currency: priced.currency,
    paid_at: paidAt,
  };
  const pdf = await renderReceipt(body.order_id, priced.total_minor);
  return {
    order_id: body.order_id,
    status: 'paid',
    currency: priced.currency,
    items: priced.items,
    subtotal_minor: priced.subtotal_minor,
    discount_minor: priced.discount_minor,
    total_minor: priced.total_minor,
    payment: {
      authorization_id: `auth_${body.order_id}`,
      capture_id: `cap_${body.order_id}`,
      state: 'captured',
    },
    receipt: {
      payload,
      signature: sign(loadConfig().day1Salt, body.order_id, payload),
      pdf_base64: pdf.toString('base64'),
    },
  };
}

function renderReceipt(orderId: string, totalMinor: number): Promise<Buffer> {
  const price = `PKR ${(totalMinor / 100).toFixed(2)}`;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ font: 'Helvetica', compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica');
    // PDFKit's text operator hex-encodes the glyphs. A literal string is what the receipt test reads back.
    doc.page.write(`BT /F1 18 Tf 72 720 Td (${pdfLiteral(orderId)}) Tj ET\n`);
    doc.page.write(`BT /F1 18 Tf 72 690 Td (${pdfLiteral(price)}) Tj ET\n`);
    doc.end();
  });
}

function pdfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

async function publishReceipt(orderId: string, pdf: Buffer): Promise<void> {
  await ensureReceiptsBucket();
  const bucket = loadConfig().minio.bucket;
  await getMinio().putObject(bucket, `${orderId}.pdf`, pdf, pdf.length, { 'Content-Type': 'application/pdf' });
  await enqueueOrderStatus({ orderId, from: null, to: 'paid' });
}

function invalid(fields: string[]): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields });
}
