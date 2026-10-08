import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { UpdateManifest } from './check';

// One shared handler for the whole app (expo-notifications only honors the single most recently
// set one) - this module is always loaded on launch via App.tsx -> UpdateBanner -> update/state,
// so it's safe for other notification sources (e.g. notifications/ticketReady.ts) to rely on it
// already being in place rather than each registering their own and racing over which wins. The
// update-available notification itself stays silent; anything tagged `kind: 'ticket-ready'` in its
// data plays sound, since that one genuinely needs to cut through a busy floor.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: notification.request.content.data?.kind === 'ticket-ready',
    shouldSetBadge: false,
  }),
});

/**
 * Requests the POST_NOTIFICATIONS permission the proper Android way: an in-app system dialog,
 * asked right here, in context, the moment there's an actual notification to show - never asked
 * up front on cold start "just in case". Returns whether it's safe to actually send one.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!existing.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

const notifiedForVersionCode = new Set<number>();

/** Fires a local "update available" notification once per version, only after real permission. */
export async function notifyUpdateAvailable(manifest: UpdateManifest): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (notifiedForVersionCode.has(manifest.versionCode)) return;
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  notifiedForVersionCode.add(manifest.versionCode);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'ONE-ORDER update available',
      body: `Version ${manifest.version} is ready to install. Tap to open the app and update.`,
    },
    trigger: null,
  });
}
