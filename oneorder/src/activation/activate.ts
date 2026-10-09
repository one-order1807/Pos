import { getDevicePref, setDevicePref } from '../db/sqlite';

const DEVICE_ID_PREF_KEY = 'deviceId';
// Where a successful activate() below stores the resulting device_token (see store.ts's
// activate() action, the only writer) - exported so any other module that needs to authenticate
// to the backend (e.g. backend/qrApi.ts) reads it from this one place instead of each keeping its
// own copy of the pref key string.
export const ACTIVATION_PREF_KEY = 'deviceToken';

export async function getStoredDeviceToken(): Promise<string | null> {
  return getDevicePref(ACTIVATION_PREF_KEY);
}

// Baked in at build time per client deployment (see backend/.env.example's ORG_ID/ORG_NAME side -
// this is the matching client-side half: which backend domain THIS build's activation key gets
// checked against). Empty in a build nobody configured a backend for - activation is then
// reported as unavailable rather than silently calling nothing.
const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/+$/, '');

/** A random id generated once per install and persisted locally - not a hardware identifier, so a
 * reinstall just activates again as a "new" device rather than being blocked by OS privacy limits
 * on reading real hardware ids. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getDevicePref(DEVICE_ID_PREF_KEY);
  if (existing) return existing;
  // Required lazily, not at module load - this file is imported by store.ts, which tests exercise
  // directly under plain Node (no Metro/babel transform), and expo-crypto pulls in expo-modules-core
  // the same way expo-constants does (see printing/printer.ts for the same pattern with ble-plx).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Crypto = require('expo-crypto');
  const id: string = Crypto.randomUUID();
  await setDevicePref(DEVICE_ID_PREF_KEY, id);
  return id;
}

export interface ActivateResult {
  ok: boolean;
  error?: string;
  deviceToken?: string;
  orgName?: string;
}

/** Redeems a one-time access key against this build's configured backend (see backend/README.md's
 * "Device activation" section for the server side of this flow). */
export async function activateDevice(
  code: string,
  appVariant: string,
  appVersion: string,
  timeoutMs = 10000,
): Promise<ActivateResult> {
  if (!BACKEND_URL) {
    return { ok: false, error: 'This build has no activation server configured - contact support.' };
  }
  const deviceId = await getOrCreateDeviceId();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BACKEND_URL}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), device_id: deviceId, app_variant: appVariant, app_version: appVersion }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, error: (body && body.detail) || `Activation failed (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as { device_token: string; org_name: string };
    return { ok: true, deviceToken: body.device_token, orgName: body.org_name };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return { ok: false, error: timedOut ? 'Could not reach the server - check your connection and try again.' : String(e?.message ?? e) };
  }
}
