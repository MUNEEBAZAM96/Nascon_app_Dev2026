import { notImplemented } from '../../http/errors';

/** Validates and appends one signed event (or compensation) to a match's log; idempotent by event_id. */
export async function appendEvent(_input: unknown): Promise<unknown> {
  return notImplemented('appendEvent');
}

/** Rebuilds a match's score, status, and outcome by replaying its event log (Section 5.9). */
export async function projectScore(_matchId: string): Promise<unknown> {
  return notImplemented('projectScore');
}
