import { getStoredDeviceToken } from '../activation/activate';
import type { MenuItem } from '../domain/types';

// Same per-build config activation/activate.ts already reads - this is the one backend a given
// build ever talks to (see backend/.env.example's ORG_ID side), so reusing it here means QR
// Management works on exactly the builds that already have a backend configured, with no
// separate setup step.
const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/+$/, '');

export interface QrTableResult {
  table_local_id: string;
  label: string;
  token: string;
  url: string;
  status: string;
}

export type QrApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function apiRequest<T>(path: string, options: { method: string; body?: unknown }, timeoutMs = 10000): Promise<QrApiResult<T>> {
  if (!BACKEND_URL) return { ok: false, error: 'This build has no backend configured - contact support.' };
  const token = await getStoredDeviceToken();
  if (!token) return { ok: false, error: "This device isn't activated yet - activate it first (see Dev Mode)." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: options.method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      return { ok: false, error: (errBody && errBody.detail) || `Request failed (HTTP ${res.status}).` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return { ok: false, error: timedOut ? 'Could not reach the server - check your connection and try again.' : String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mints/keeps-current a QR token for every table passed in, and revokes any table's token that's
 * no longer in the list - called whenever QR Management opens and right after every table-layout
 * save (see store.ts's saveTables), so a deleted table's QR stops working automatically per the
 * spec's "dynamic" requirement, with no separate step for the admin to remember.
 */
export function syncTablesToBackend(tables: { id: string; label: string }[]): Promise<QrApiResult<QrTableResult[]>> {
  return apiRequest<QrTableResult[]>('/tables/sync', {
    method: 'POST',
    body: { tables, full_sync: true },
  });
}

export function regenerateTableQr(tableLocalId: string): Promise<QrApiResult<QrTableResult>> {
  return apiRequest<QrTableResult>(`/tables/${encodeURIComponent(tableLocalId)}/qr/regenerate`, { method: 'POST' });
}

/** Mirrors the current menu into the backend so the customer-ordering site has something to read
 * and validate orders against - see backend/api/app/main.py's /menu/sync. The app stays the one
 * place the menu is actually edited; this never reads anything back. */
export function syncMenuToBackend(categories: { id: string; name: string; sort: number }[], items: MenuItem[]): Promise<QrApiResult<{ status: string }>> {
  return apiRequest('/menu/sync', {
    method: 'POST',
    body: {
      categories,
      items: items.map((i) => ({ id: i.id, category_id: i.categoryId, name: i.name, price: i.price, active: i.active })),
    },
  });
}
