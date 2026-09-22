import * as Application from 'expo-application';
import { Platform } from 'react-native';
import appJson from '../../app.json';

// Which client/branch this build belongs to, baked in at build time via app.json's
// extra.updateChannel. Every branch/client eventually gets its own value here, and its own
// channels/<name>.json file in the public manifest repo below - so an install only ever hears
// about updates published for ITS OWN channel, never another client's.
const CHANNEL = (appJson.expo.extra as { updateChannel?: string } | undefined)?.updateChannel ?? 'default';

// A small, separate PUBLIC repo whose only job is hosting one version-manifest JSON file per
// channel. The main source repo can be private with no effect on this - raw.githubusercontent.com
// serves a public repo's files with a plain, unauthenticated GET, so the app never needs to embed
// any credential to check for updates. CI publishes to it using a repo secret (never committed);
// see .github/workflows/build-apk.yml.
const MANIFEST_URL = `https://raw.githubusercontent.com/one-order1807/oneorder-updates/main/channels/${CHANNEL}.json`;

export interface UpdateManifest {
  versionCode: number;
  version: string;
  tag: string;
  apkUrl: string;
  notes?: string;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  available: boolean;
  manifest: UpdateManifest | null;
  installedVersionCode: number | null;
  error: string | null;
}

/** The versionCode of the APK actually installed on this device right now (Android only). */
export function installedVersionCode(): number | null {
  if (Platform.OS !== 'android') return null;
  const raw = Application.nativeBuildVersion;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function checkForUpdate(timeoutMs = 8000): Promise<UpdateCheckResult> {
  const installed = installedVersionCode();
  if (Platform.OS !== 'android') {
    return { available: false, manifest: null, installedVersionCode: installed, error: null };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Cache-busted: raw.githubusercontent.com fronts a CDN that can otherwise serve a stale copy
    // for a few minutes, which would make a fresh publish invisible to a "Check for update" tap.
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      const notYetPublished = res.status === 404;
      throw new Error(
        notYetPublished
          ? 'No update channel published yet for this build.'
          : `Update check failed (HTTP ${res.status}).`,
      );
    }
    const manifest = (await res.json()) as UpdateManifest;
    const available =
      installed !== null && typeof manifest.versionCode === 'number' && manifest.versionCode > installed;
    return { available, manifest, installedVersionCode: installed, error: null };
  } catch (e: any) {
    return { available: false, manifest: null, installedVersionCode: installed, error: String(e?.message ?? e) };
  }
}
