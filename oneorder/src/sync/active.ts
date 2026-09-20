import type { CloudBackend } from './backend';
import { firebaseBackend } from './firebaseBackend';

// Phase 1: Firebase. Phase 2 (after a VPS exists): return the PostgreSQL backend here instead.
export const activeBackend: CloudBackend = firebaseBackend;
