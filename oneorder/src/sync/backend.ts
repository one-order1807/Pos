import type { DirtyRow, RemoteChange } from '../db/sqlite';
import type { State } from '../domain/types';

// The app only ever talks to this interface. Phase 1 implements it with Firebase.
// Phase 2 (once a VPS exists) adds a self-hosted PostgreSQL implementation in its own file and
// changes the one line in sync/active.ts that picks the backend. Nothing else in the app changes.
export interface CloudBackend {
  readonly name: string;
  readonly configured: boolean;
  push(rows: DirtyRow[]): Promise<void>;
  pullAll(): Promise<State | null>;
  /** Live updates from other devices, one listener per collection under the hood. Returns an
   * unsubscribe function. Fires once up front with every existing doc (same as a fresh pullAll),
   * then again on every future change - callers merge via applyRemoteChanges, which is a safe
   * no-op for anything already up to date. */
  subscribe(onChange: (changes: RemoteChange[]) => void): () => void;
}
