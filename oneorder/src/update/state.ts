import { useSyncExternalStore } from 'react';
import { checkForUpdate, type UpdateCheckResult } from './check';
import { notifyUpdateAvailable } from './notify';

interface UpdateState extends UpdateCheckResult {
  checking: boolean;
  lastCheckedAt: number | null;
}

let state: UpdateState = {
  available: false,
  manifest: null,
  installedVersionCode: null,
  error: null,
  checking: false,
  lastCheckedAt: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

let running = false;

export async function runUpdateCheck(): Promise<void> {
  if (running) return;
  running = true;
  setState({ checking: true });
  try {
    const r = await checkForUpdate();
    setState({ ...r, checking: false, lastCheckedAt: Date.now() });
    if (r.available && r.manifest) notifyUpdateAvailable(r.manifest);
  } finally {
    running = false;
  }
}
