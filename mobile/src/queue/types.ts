// Exact action shape of Section 5.14; synced to POST /audit/v1/offline-sync.
export type OfflineActionType = 'score_event' | 'roster_transfer';

export interface OfflineAction {
  action_id: string;
  type: OfflineActionType;
  queued_at: string;
  base_version: number;
  payload: Record<string, unknown>;
}

export function stamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

let actionSerial = 0;

export function newActionId(): string {
  actionSerial += 1;
  return `act-${Date.now()}-${actionSerial}`;
}
