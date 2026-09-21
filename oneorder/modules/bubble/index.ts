import { Platform } from 'react-native';

interface BubbleNativeModule {
  isSupported(): boolean;
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  show(): void;
  hide(): void;
}

let native: BubbleNativeModule | null = null;
if (Platform.OS === 'android') {
  try {
    // Deferred require: on iOS/web, or a JS-only Expo Go session, this native module doesn't
    // exist and the app must keep working with the bubble simply unavailable.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo');
    native = requireNativeModule('Bubble');
  } catch {
    native = null;
  }
}

/** True only on Android, API 26+, with the native module actually linked (a real dev/production build, not Expo Go). */
export function isBubbleSupported(): boolean {
  try {
    return !!native?.isSupported();
  } catch {
    return false;
  }
}

export function hasOverlayPermission(): boolean {
  try {
    return !!native?.hasOverlayPermission();
  } catch {
    return false;
  }
}

/** Opens the system "Display over other apps" settings screen for this app. */
export function requestOverlayPermission(): void {
  native?.requestOverlayPermission();
}

/** Shows the floating bubble. No-ops silently if unsupported or the permission isn't granted. */
export function showBubble(): void {
  native?.show();
}

/** Hides the bubble and stops its background service. Safe to call even if it isn't showing. */
export function hideBubble(): void {
  native?.hide();
}
