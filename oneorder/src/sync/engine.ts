import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { applyRemoteChanges, dirtyCount, getDirty, markSynced, type RemoteChange } from '../db/sqlite';
import type { State } from '../domain/types';
import { activeBackend } from './active';

export const isSyncConfigured = activeBackend.configured;

export interface SyncStatus {
  backend: string;
  configured: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncAt: number | null;
  lastError: string;
  label: string;
}

let status: SyncStatus = {
  backend: activeBackend.name,
  configured: isSyncConfigured,
  online: true,
  syncing: false,
  pending: 0,
  lastSyncAt: null,
  lastError: '',
  label: isSyncConfigured ? 'Starting...' : 'Not configured (local only)',
};
const listeners = new Set<() => void>();

function labelOf(s: SyncStatus): string {
  if (!s.configured) return 'Not configured (local only)';
  if (s.lastError) return 'Error - will retry';
  if (!s.online) return 'Offline - saved on this tablet';
  if (s.syncing) return 'Syncing...';
  if (s.pending > 0) return 'Waiting to upload';
  return s.lastSyncAt ? 'Up to date' : 'Connected';
}

function setStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  status = { ...next, label: labelOf(next) };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => status,
    () => status,
  );
}

let running = false;

export async function syncNow(): Promise<void> {
  if (!activeBackend.configured || running) return;
  running = true;
  setStatus({ syncing: true });
  try {
    for (let guard = 0; guard < 50; guard++) {
      const rows = await getDirty(100);
      if (rows.length === 0) break;
      await activeBackend.push(rows);
      await markSynced(rows);
    }
    setStatus({ syncing: false, lastError: '', lastSyncAt: Date.now(), pending: await dirtyCount() });
  } catch (e: any) {
    setStatus({ syncing: false, lastError: String(e?.message ?? e), pending: await dirtyCount().catch(() => 0) });
  } finally {
    running = false;
  }
}

export async function fetchCloudState(timeoutMs = 7000): Promise<State | null> {
  if (!activeBackend.configured) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    return await Promise.race([activeBackend.pullAll(), timeout]);
  } catch {
    return null;
  }
}

let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(delayMs = 3000) {
  if (!activeBackend.configured) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    dirtyCount()
      .then((n) => setStatus({ pending: n }))
      .catch(() => {});
    syncNow();
  }, delayMs);
}

// store.ts registers here (via onRemoteChange) to merge incoming docs into the live in-memory
// state the moment they arrive - kept as a plain listener set, not a direct import of store.ts,
// so this module and store.ts (which already imports from here) don't import each other.
const remoteChangeListeners = new Set<(changes: RemoteChange[]) => void>();

export function onRemoteChange(cb: (changes: RemoteChange[]) => void): () => void {
  remoteChangeListeners.add(cb);
  return () => remoteChangeListeners.delete(cb);
}

export function startSync() {
  if (started) return;
  started = true;
  if (!activeBackend.configured) return;
  NetInfo.addEventListener((s) => {
    const online = Boolean(s.isConnected && s.isInternetReachable !== false);
    setStatus({ online });
    if (online) scheduleSync(500);
  });
  setInterval(() => scheduleSync(0), 30000);
  scheduleSync(1500);
  activeBackend.subscribe((changes) => {
    applyRemoteChanges(changes)
      .then(() => remoteChangeListeners.forEach((cb) => cb(changes)))
      .catch((e) => setStatus({ lastError: String(e?.message ?? e) }));
  });
}
