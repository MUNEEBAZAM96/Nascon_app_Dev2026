import { notImplemented } from '../../http/errors';

/** Reserves stock under row locks, runs the mock gateway, and returns a signed PDF receipt (Section 5.12). */
export async function checkout(_input: unknown): Promise<unknown> {
  return notImplemented('checkout');
}

/** Returns available and in-flight reserved stock for one variant. */
export async function getInventory(_variantId: string): Promise<unknown> {
  return notImplemented('getInventory');
}
