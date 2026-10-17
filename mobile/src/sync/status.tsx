import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type SyncStatus = 'online' | 'offline' | 'syncing';

interface SyncStatusValue {
  status: SyncStatus;
  setStatus: (status: SyncStatus) => void;
}

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

export function SyncStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('online');
  const value = useMemo(() => ({ status, setStatus }), [status]);
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}

export function useSyncStatus(): SyncStatusValue {
  const value = useContext(SyncStatusContext);
  if (!value) throw new Error('useSyncStatus must be used inside SyncStatusProvider');
  return value;
}
