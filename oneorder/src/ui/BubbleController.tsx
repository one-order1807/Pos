import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { hasOverlayPermission, hideBubble, isBubbleSupported, requestOverlayPermission, showBubble } from '../../modules/bubble';

// Headless, always-on: there is no setting to turn this off. Whenever the app goes to the
// background it shows the floating bubble (if the "Display over other apps" permission is
// already granted), and hides it the instant the app comes back to the foreground. The one thing
// that needs a user gesture is the Android permission itself - the OS requires that, no app can
// grant it silently - so the very first time the app is backgrounded without it, this opens the
// system permission screen once instead of just doing nothing.
export function BubbleController(): null {
  const stateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!isBubbleSupported()) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      const prev = stateRef.current;
      stateRef.current = next;
      if (next.match(/inactive|background/) && prev === 'active') {
        if (hasOverlayPermission()) {
          showBubble();
        } else {
          requestOverlayPermission();
        }
      } else if (next === 'active') {
        hideBubble();
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}
