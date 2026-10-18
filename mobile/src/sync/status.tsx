import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Network from 'expo-network';

import { ApiError, api } from '../api/client';
import { deviceId } from '../db';
import { list, remove } from '../queue/pending';

export type SyncStatus = 'online' | 'offline' | 'syncing';

interface SyncStatusValue {
  status: SyncStatus;
  setStatus: (status: SyncStatus) => void;
  pending: number;
  notice: string | null;
  refreshPending: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('online');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const syncing = useRef(false);

  const refreshPending = useCallback(async () => {
    const rows = await list();
    setPending(rows.length);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing.current) return;
    const actions = await list();
    setPending(actions.length);
    if (actions.length === 0) {
      const net = await Network.getNetworkStateAsync();
      setStatus(net.isConnected === false ? 'offline' : 'online');
      return;
    }
    syncing.current = true;
    setStatus('syncing');
    try {
      const response = await api.offlineSync({ device_id: await deviceId(), actions });
      let sentence: string | null = null;
      for (const result of response.results) {
        await remove(result.action_id);
        if (result.status === 'rejected' && sentence === null) sentence = explain(result.error_code);
      }
      setNotice(sentence);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'The sync did not finish.');
    } finally {
      syncing.current = false;
      const left = await list();
      setPending(left.length);
      const net = await Network.getNetworkStateAsync();
      setStatus(net.isConnected === false ? 'offline' : 'online');
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const net = await Network.getNetworkStateAsync();
      if (!alive) return;
      if (net.isConnected === false) setStatus('offline');
      const rows = await list();
      if (!alive) return;
      setPending(rows.length);
      if (net.isConnected !== false && rows.length > 0) void syncNow();
    })();
    const subscription = Network.addNetworkStateListener((event) => {
      if (event.isConnected === false) {
        setStatus('offline');
        return;
      }
      void syncNow();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [syncNow]);

  const value = useMemo(
    () => ({ status, setStatus, pending, notice, refreshPending, syncNow }),
    [status, pending, notice, refreshPending, syncNow],
  );
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusValue {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error('useSyncStatus must be used inside SyncStatusProvider');
  return value;
}

function explain(code: string | null): string {
  if (code === 'MATCH_NOT_IN_PROGRESS') return 'Start the match before you add a goal.';
  if (code === 'NOT_IN_SQUAD') return 'That player is not on this squad.';
  const shown = code && code.length > 0 ? code : 'UNKNOWN';
  return `The server kept its copy (${shown}).`;
}
