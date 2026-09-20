import NetInfo from '@react-native-community/netinfo';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, initializeFirestore, setDoc, type Firestore } from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { dirtyCount, getDirty, markSynced } from '../db/sqlite';
import { emptyState } from '../domain/seed';
import { COLLECTIONS, type CollectionName, type State } from '../domain/types';

const cfg = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};
const STORE_ID = process.env.EXPO_PUBLIC_FIREBASE_STORE_ID || 'default';

export const isFirebaseConfigured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

export interface SyncStatus {
  configured: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncAt: number | null;
  lastError: string;
  label: string;
}

let status: SyncStatus = {
  configured: isFirebaseConfigured,
  online: true,
  syncing: false,
  pending: 0,
  lastSyncAt: null,
  lastError: '',
  label: isFirebaseConfigured ? 'Starting...' : 'Not configured (local only)',
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

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let authed = false;

async function getDb(): Promise<Firestore> {
  if (!isFirebaseConfigured) throw new Error('Firebase is not configured.');
  if (!app) app = getApps().length ? getApp() : initializeApp(cfg);
  if (!db) db = initializeFirestore(app, { experimentalForceLongPolling: true });
  if (!authed) {
    await signInAnonymously(getAuth(app));
    authed = true;
  }
  return db;
}

function cleanForCloud(collectionName: CollectionName, json: string): Record<string, unknown> {
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (collectionName === 'settings') {
    delete obj.pinHash;
    delete obj.pinSalt;
  }
  return obj;
}

let running = false;

export async function syncNow(): Promise<void> {
  if (!isFirebaseConfigured || running) return;
  running = true;
  setStatus({ syncing: true });
  try {
    const firestore = await getDb();
    for (let guard = 0; guard < 50; guard++) {
      const rows = await getDirty(100);
      if (rows.length === 0) break;
      for (const r of rows) {
        const ref = doc(firestore, 'stores', STORE_ID, r.collection, r.id);
        if (r.deleted) await deleteDoc(ref);
        else await setDoc(ref, cleanForCloud(r.collection, r.json));
      }
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
  if (!isFirebaseConfigured) return null;
  const work = (async () => {
    const firestore = await getDb();
    const state = emptyState();
    let total = 0;
    for (const c of COLLECTIONS) {
      const snap = await getDocs(collection(firestore, 'stores', STORE_ID, c));
      snap.forEach((d) => {
        (state[c] as Record<string, unknown>)[d.id] = d.data();
        total += 1;
      });
    }
    return total > 0 && state.settings.main ? state : null;
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    return await Promise.race([work, timeout]);
  } catch {
    return null;
  }
}

let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(delayMs = 3000) {
  if (!isFirebaseConfigured) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    dirtyCount()
      .then((n) => setStatus({ pending: n }))
      .catch(() => {});
    syncNow();
  }, delayMs);
}

export function startSync() {
  if (started) return;
  started = true;
  if (!isFirebaseConfigured) return;
  NetInfo.addEventListener((s) => {
    const online = Boolean(s.isConnected && s.isInternetReachable !== false);
    setStatus({ online });
    if (online) scheduleSync(500);
  });
  setInterval(() => scheduleSync(0), 30000);
  scheduleSync(1500);
}
