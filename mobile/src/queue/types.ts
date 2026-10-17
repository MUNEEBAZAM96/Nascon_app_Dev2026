// Exact action shape of Section 5.14; synced to POST /audit/v1/offline-sync.
export type OfflineActionType = 'score_event' | 'roster_transfer';

export interface OfflineAction {
  action_id: string;
  type: OfflineActionType;
  queued_at: string;
  base_version: number;
  payload: Record<string, unknown>;
}
