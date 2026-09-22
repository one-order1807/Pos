import * as SQLite from 'expo-sqlite';
import { emptyState } from '../domain/seed';
import { COLLECTIONS, type CollectionName, type State } from '../domain/types';
import type { DocChange } from '../domain/diff';

let db: SQLite.SQLiteDatabase | null = null;
let lastStamp = 0;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const d = await SQLite.openDatabaseAsync('oneorder.db');
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS docs_dirty ON docs (dirty);
  `);
  db = d;
  return d;
}

// The single shared connection above is safe from two calls racing to open it, but not from two
// calls running concurrently once open: store.ts's local write queue and sync/engine.ts's
// background push/pull loop are two independent async chains that both call into this module, and
// nothing previously stopped their transactions from overlapping on the same connection - which is
// exactly what SQLite's "database is locked" means. Every exported operation below is funneled
// through this one FIFO chain so at most one is ever in flight against the connection at a time,
// regardless of which part of the app called it.
let dbQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = dbQueue.then(fn, fn);
  dbQueue = run.catch(() => {});
  return run;
}

interface Row {
  collection: string;
  id: string;
  json: string;
}

export function loadState(): Promise<{ state: State; count: number }> {
  return serialized(async () => {
    const d = await openDb();
    const rows = await d.getAllAsync<Row>('SELECT collection, id, json FROM docs WHERE deleted = 0');
    const state = emptyState();
    for (const r of rows) {
      if (!(COLLECTIONS as string[]).includes(r.collection)) continue;
      try {
        (state[r.collection as CollectionName] as Record<string, unknown>)[r.id] = JSON.parse(r.json);
      } catch {
        // skip a corrupt row rather than failing the whole app
      }
    }
    return { state, count: rows.length };
  });
}

export function writeChanges(changes: DocChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve();
  return serialized(async () => {
    const d = await openDb();
    await d.withTransactionAsync(async () => {
      for (const c of changes) {
        lastStamp = Math.max(Date.now(), lastStamp + 1);
        const now = lastStamp;
        if (c.doc === null) {
          await d.runAsync(
            `INSERT INTO docs (collection, id, json, updated_at, dirty, deleted) VALUES (?, ?, '{}', ?, 1, 1)
             ON CONFLICT(collection, id) DO UPDATE SET json = '{}', updated_at = excluded.updated_at, dirty = 1, deleted = 1`,
            c.collection,
            c.id,
            now,
          );
        } else {
          await d.runAsync(
            `INSERT INTO docs (collection, id, json, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, 1, 0)
             ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, dirty = 1, deleted = 0`,
            c.collection,
            c.id,
            JSON.stringify(c.doc),
            now,
          );
        }
      }
    });
  });
}

export interface DirtyRow {
  collection: CollectionName;
  id: string;
  json: string;
  deleted: boolean;
  updatedAt: number;
}

export function getDirty(limit: number): Promise<DirtyRow[]> {
  return serialized(async () => {
    const d = await openDb();
    const rows = await d.getAllAsync<{ collection: string; id: string; json: string; deleted: number; updated_at: number }>(
      'SELECT collection, id, json, deleted, updated_at FROM docs WHERE dirty = 1 ORDER BY updated_at ASC LIMIT ?',
      limit,
    );
    return rows.map((r) => ({
      collection: r.collection as CollectionName,
      id: r.id,
      json: r.json,
      deleted: r.deleted === 1,
      updatedAt: r.updated_at,
    }));
  });
}

export function markSynced(rows: DirtyRow[]): Promise<void> {
  if (rows.length === 0) return Promise.resolve();
  return serialized(async () => {
    const d = await openDb();
    await d.withTransactionAsync(async () => {
      for (const r of rows) {
        await d.runAsync(
          `UPDATE docs SET dirty = 0 WHERE collection = ? AND id = ? AND updated_at = ?`,
          r.collection,
          r.id,
          r.updatedAt,
        );
        if (r.deleted) {
          await d.runAsync(`DELETE FROM docs WHERE collection = ? AND id = ? AND deleted = 1 AND dirty = 0`, r.collection, r.id);
        }
      }
    });
  });
}

export function dirtyCount(): Promise<number> {
  return serialized(async () => {
    const d = await openDb();
    const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM docs WHERE dirty = 1');
    return row?.n ?? 0;
  });
}
