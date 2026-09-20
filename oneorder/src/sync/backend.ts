import type { DirtyRow } from '../db/sqlite';
import type { State } from '../domain/types';

// The app only ever talks to this interface. Phase 1 implements it with Firebase.
// Phase 2 (once a VPS exists) adds a self-hosted PostgreSQL implementation in its own file and
// changes the one line in sync/active.ts that picks the backend. Nothing else in the app changes.
export interface CloudBackend {
  readonly name: string;
  readonly configured: boolean;
  push(rows: DirtyRow[]): Promise<void>;
  pullAll(): Promise<State | null>;
}
