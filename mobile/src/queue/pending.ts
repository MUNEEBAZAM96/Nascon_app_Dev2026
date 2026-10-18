import { getDb } from '../db';
import type { OfflineAction } from './types';

export async function enqueue(action: OfflineAction): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO pending_actions (action_id, body, created_at) VALUES (?, ?, ?)', [
    action.action_id,
    JSON.stringify(action),
    new Date().toISOString(),
  ]);
}

export async function list(): Promise<OfflineAction[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ body: string }>('SELECT body FROM pending_actions ORDER BY created_at ASC');
  return rows.map((row) => JSON.parse(row.body) as OfflineAction);
}

export async function clear(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_actions');
}

export async function remove(actionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_actions WHERE action_id = ?', [actionId]);
}
