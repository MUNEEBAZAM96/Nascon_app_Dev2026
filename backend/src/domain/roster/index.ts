import { notImplemented } from '../../http/errors';

/** Replaces a league's roster scenario: squads, players, and in-progress matches (Section 5.11). */
export async function setupRoster(_input: unknown): Promise<unknown> {
  return notImplemented('setupRoster');
}

/** Applies a transfer, loan, or release after the eight ordered rule checks; idempotent by request_id. */
export async function transferPlayer(_input: unknown): Promise<unknown> {
  return notImplemented('transferPlayer');
}

/** Returns the append-only audit trail as of a date, writing any due loan_return entry once. */
export async function playerHistory(_playerId: string, _asOf?: string): Promise<unknown> {
  return notImplemented('playerHistory');
}
