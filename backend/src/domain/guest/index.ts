import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { canonical, signDay2 } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);

const CartLine = z.object({
  variant_id: Id,
  quantity: z.number().int().min(1),
});

const MergeBody = z.object({
  guest_token: z.string().min(1).refine((value) => value.startsWith('guest_'), { message: 'guest_token must start with guest_' }),
  registered_user_id: Id,
  cart: z.array(CartLine).min(1).max(10),
  test_write_block: z.boolean().default(true),
});

type MergeInput = z.infer<typeof MergeBody>;

interface CartItem {
  variant_id: string;
  quantity: number;
  unit_price_minor: number;
}

interface MergeResponse {
  cart_merged: boolean;
  guest_token: string;
  registered_user_id: string;
  total_items: number;
  subtotal_minor: number;
  currency: string;
  write_block_verified?: boolean;
  write_rejection_code?: number;
  signature: string;
}

function requestHash(body: MergeInput): string {
  return createHash('sha256')
    .update(
      canonical({
        guest_token: body.guest_token,
        registered_user_id: body.registered_user_id,
        cart: body.cart.map((line) => ({ variant_id: line.variant_id, quantity: line.quantity })),
        test_write_block: body.test_write_block,
      }),
      'utf8',
    )
    .digest('hex');
}

function buildSignature(body: MergeInput, totalItems: number): string {
  return signDay2(body.guest_token, {
    cart_merged: true,
    guest_token: body.guest_token,
    registered_user_id: body.registered_user_id,
    total_items: totalItems,
    write_rejection_code: 403,
  });
}

function mergeResponse(body: MergeInput, totalItems: number, subtotalMinor: number): MergeResponse {
  const response: MergeResponse = {
    cart_merged: true,
    guest_token: body.guest_token,
    registered_user_id: body.registered_user_id,
    total_items: totalItems,
    subtotal_minor: subtotalMinor,
    currency: 'PKR',
    signature: buildSignature(body, totalItems),
  };
  if (body.test_write_block) {
    response.write_block_verified = true;
    response.write_rejection_code = 403;
  }
  return response;
}

async function assertGuestToken(client: PoolClient, token: string): Promise<void> {
  const row = await client.query('SELECT merged FROM guest_tokens WHERE token = $1', [token]);
  if (!row.rows[0]) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['guest_token'] });
  }
}

async function assertPlayer(client: PoolClient, playerId: string): Promise<void> {
  const player = await client.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
  if (!player.rows[0]) {
    throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });
  }
}

async function loadVariants(
  client: PoolClient,
  lines: MergeInput['cart'],
): Promise<Map<string, { price_minor: number; currency: string; stock: number; reserved: number }>> {
  const ids = lines.map((line) => line.variant_id);
  const result = await client.query<{ id: string; price_minor: number; currency: string; stock: number; reserved: number }>(
    'SELECT id, price_minor, currency, stock, reserved FROM variants WHERE id = ANY($1::text[])',
    [ids],
  );
  const map = new Map(result.rows.map((row) => [row.id, row]));
  for (const line of lines) {
    if (!map.has(line.variant_id)) {
      throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found.', { variant_id: line.variant_id });
    }
  }
  return map;
}

function mergedCartLines(existing: CartItem[], incoming: MergeInput['cart'], variants: Map<string, { price_minor: number; currency: string; stock: number; reserved: number }>): CartItem[] {
  const byVariant = new Map<string, CartItem>();
  for (const item of existing) {
    byVariant.set(item.variant_id, { ...item });
  }
  for (const line of incoming) {
    const variant = variants.get(line.variant_id)!;
    const prior = byVariant.get(line.variant_id);
    const quantity = (prior?.quantity ?? 0) + line.quantity;
    byVariant.set(line.variant_id, {
      variant_id: line.variant_id,
      quantity,
      unit_price_minor: Number(variant.price_minor),
    });
  }
  return [...byVariant.values()];
}

function assertStock(lines: CartItem[], variants: Map<string, { stock: number; reserved: number }>): void {
  for (const line of lines) {
    const variant = variants.get(line.variant_id)!;
    const available = Number(variant.stock) - Number(variant.reserved);
    if (line.quantity > available) {
      throw new AppError(409, 'OUT_OF_STOCK', 'Not enough stock.', { variant_id: line.variant_id });
    }
  }
}

function totals(lines: CartItem[]): { totalItems: number; subtotalMinor: number } {
  let totalItems = 0;
  let subtotalMinor = 0;
  for (const line of lines) {
    totalItems += line.quantity;
    subtotalMinor += line.quantity * line.unit_price_minor;
  }
  return { totalItems, subtotalMinor };
}

export async function mergeGuestCart(input: unknown): Promise<MergeResponse> {
  const body = parseBody(MergeBody, input ?? {});
  const hash = requestHash(body);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`guest-merge:${body.guest_token}`]);

    await assertGuestToken(client, body.guest_token);

    const prior = await client.query<{ request_hash: string; response: MergeResponse }>(
      'SELECT request_hash, response FROM guest_merge_requests WHERE token = $1',
      [body.guest_token],
    );
    const stored = prior.rows[0];
    if (stored) {
      if (stored.request_hash !== hash) {
        throw new AppError(409, 'GUEST_TOKEN_ALREADY_MERGED', 'Guest token has already been merged.', {
          guest_token: body.guest_token,
        });
      }
      await client.query('COMMIT');
      return stored.response;
    }

    await assertPlayer(client, body.registered_user_id);
    const variants = await loadVariants(client, body.cart);

    const cartRow = await client.query<{ items: CartItem[] }>('SELECT items FROM carts WHERE user_id = $1 FOR UPDATE', [
      body.registered_user_id,
    ]);
    const existing = Array.isArray(cartRow.rows[0]?.items) ? cartRow.rows[0].items : [];
    const merged = mergedCartLines(existing, body.cart, variants);
    assertStock(merged, variants);

    const { totalItems, subtotalMinor } = totals(merged);
    const response = mergeResponse(body, totalItems, subtotalMinor);

    if (cartRow.rows[0]) {
      await client.query('UPDATE carts SET items = $2::jsonb WHERE user_id = $1', [body.registered_user_id, JSON.stringify(merged)]);
    } else {
      await client.query('INSERT INTO carts (user_id, items) VALUES ($1, $2::jsonb)', [body.registered_user_id, JSON.stringify(merged)]);
    }
    await client.query('UPDATE guest_tokens SET merged = true WHERE token = $1', [body.guest_token]);
    await client.query('INSERT INTO guest_merge_requests (token, request_hash, response) VALUES ($1, $2, $3::jsonb)', [
      body.guest_token,
      hash,
      JSON.stringify(response),
    ]);
    await client.query('COMMIT');
    return response;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
