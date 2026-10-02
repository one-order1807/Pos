import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, initializeFirestore, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import type { DirtyRow, RemoteChange } from '../db/sqlite';
import { emptyState } from '../domain/seed';
import { COLLECTIONS, type CollectionName, type State } from '../domain/types';
import type { CloudBackend } from './backend';

// The Firestore Web SDK's client DocumentSnapshot doesn't expose a server write timestamp the way
// the Admin SDK does, so last-write-wins needs its own timestamp traveling inside the document
// body. Namespaced so it can never collide with a real domain field, and stripped back out before
// the rest of the doc is treated as app data.
const SYNC_TS_FIELD = '__syncUpdatedAt';

const cfg = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};
const STORE_ID = process.env.EXPO_PUBLIC_FIREBASE_STORE_ID || 'default';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let authed = false;

async function getDb(): Promise<Firestore> {
  if (!app) app = getApps().length ? getApp() : initializeApp(cfg);
  if (!db) db = initializeFirestore(app, { experimentalForceLongPolling: true });
  if (!authed) {
    await signInAnonymously(getAuth(app));
    authed = true;
  }
  return db;
}

function cleanForCloud(collectionName: CollectionName, json: string, updatedAt: number): Record<string, unknown> {
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (collectionName === 'settings') {
    delete obj.pinHash;
    delete obj.pinSalt;
  }
  obj[SYNC_TS_FIELD] = updatedAt;
  return obj;
}

function stripSyncTs(data: Record<string, unknown>): { doc: Record<string, unknown>; updatedAt: number } {
  const updatedAt = typeof data[SYNC_TS_FIELD] === 'number' ? (data[SYNC_TS_FIELD] as number) : Date.now();
  const doc = { ...data };
  delete doc[SYNC_TS_FIELD];
  return { doc, updatedAt };
}

export const firebaseBackend: CloudBackend = {
  name: 'Firebase',
  configured: Boolean(cfg.apiKey && cfg.projectId && cfg.appId),

  async push(rows: DirtyRow[]): Promise<void> {
    const firestore = await getDb();
    for (const r of rows) {
      const ref = doc(firestore, 'stores', STORE_ID, r.collection, r.id);
      if (r.deleted) await deleteDoc(ref);
      else await setDoc(ref, cleanForCloud(r.collection, r.json, r.updatedAt));
    }
  },

  async pullAll(): Promise<State | null> {
    const firestore = await getDb();
    const state = emptyState();
    let total = 0;
    for (const c of COLLECTIONS) {
      const snap = await getDocs(collection(firestore, 'stores', STORE_ID, c));
      snap.forEach((d) => {
        (state[c] as Record<string, unknown>)[d.id] = stripSyncTs(d.data()).doc;
        total += 1;
      });
    }
    return total > 0 && state.settings.main ? state : null;
  },

  subscribe(onChange: (changes: RemoteChange[]) => void): () => void {
    let cancelled = false;
    const unsubs: (() => void)[] = [];
    getDb()
      .then((firestore) => {
        if (cancelled) return;
        for (const c of COLLECTIONS) {
          const unsub = onSnapshot(
            collection(firestore, 'stores', STORE_ID, c),
            (snap) => {
              const changes: RemoteChange[] = [];
              for (const change of snap.docChanges()) {
                if (change.type === 'removed') {
                  changes.push({ collection: c, id: change.doc.id, doc: null, updatedAt: Date.now() });
                } else {
                  const { doc: docData, updatedAt } = stripSyncTs(change.doc.data() as Record<string, unknown>);
                  changes.push({ collection: c, id: change.doc.id, doc: docData, updatedAt });
                }
              }
              if (changes.length > 0) onChange(changes);
            },
            // A listener error (e.g. rules reject it) shouldn't crash the app - sync just stops
            // updating live until the next successful push/pull, same as any other offline period.
            () => {},
          );
          unsubs.push(unsub);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  },
};
