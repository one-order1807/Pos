import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, initializeFirestore, setDoc, type Firestore } from 'firebase/firestore';
import type { DirtyRow } from '../db/sqlite';
import { emptyState } from '../domain/seed';
import { COLLECTIONS, type CollectionName, type State } from '../domain/types';
import type { CloudBackend } from './backend';

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

function cleanForCloud(collectionName: CollectionName, json: string): Record<string, unknown> {
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (collectionName === 'settings') {
    delete obj.pinHash;
    delete obj.pinSalt;
  }
  return obj;
}

export const firebaseBackend: CloudBackend = {
  name: 'Firebase',
  configured: Boolean(cfg.apiKey && cfg.projectId && cfg.appId),

  async push(rows: DirtyRow[]): Promise<void> {
    const firestore = await getDb();
    for (const r of rows) {
      const ref = doc(firestore, 'stores', STORE_ID, r.collection, r.id);
      if (r.deleted) await deleteDoc(ref);
      else await setDoc(ref, cleanForCloud(r.collection, r.json));
    }
  },

  async pullAll(): Promise<State | null> {
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
  },
};
