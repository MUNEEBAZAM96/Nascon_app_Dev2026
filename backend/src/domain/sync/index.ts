import { notImplemented } from '../../http/errors';

/** Replays queued device actions in queued_at order and reports per-action conflict resolution (Section 5.14). */
export async function replayOffline(_input: unknown): Promise<unknown> {
  return notImplemented('replayOffline');
}
