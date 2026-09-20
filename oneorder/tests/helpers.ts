import { DatabaseSync } from 'node:sqlite';

export function makeSqliteShim() {
  const db = new DatabaseSync(':memory:');
  const wrap = {
    execAsync: async (sql: string) => void db.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => void db.prepare(sql).run(...(params as any[])),
    getAllAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).all(...(params as any[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => db.prepare(sql).get(...(params as any[])) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, openDatabaseAsync: async () => wrap };
}
