import { COLLECTIONS, type CollectionName, type State } from './types';

export interface DocChange {
  collection: CollectionName;
  id: string;
  doc: unknown | null;
}

export function diffStates(prev: State, next: State): DocChange[] {
  const changes: DocChange[] = [];
  for (const c of COLLECTIONS) {
    const a = prev[c] as Record<string, unknown>;
    const b = next[c] as Record<string, unknown>;
    if (a === b) continue;
    for (const id of Object.keys(b)) {
      if (a[id] !== b[id]) changes.push({ collection: c, id, doc: b[id] });
    }
    for (const id of Object.keys(a)) {
      if (!(id in b)) changes.push({ collection: c, id, doc: null });
    }
  }
  return changes;
}

export function allDocs(state: State): DocChange[] {
  const out: DocChange[] = [];
  for (const c of COLLECTIONS) {
    const rec = state[c] as Record<string, unknown>;
    for (const id of Object.keys(rec)) out.push({ collection: c, id, doc: rec[id] });
  }
  return out;
}
