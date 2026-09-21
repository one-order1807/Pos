import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { hasOverlayPermission, hideBubble, isBubbleSupported, showBubble } from '../../modules/bubble';
import { useStore } from '../store/store';

// Headless: shows the bubble the instant the app goes to background (if the Dev Mode toggle is
// on and the overlay permission is already granted), hides it the instant the app comes back to
// the foreground. Never touches any existing screen, navigation, or data.
export function BubbleController(): null {
  const enabled = useStore((s) => s.data.settings.main.bubbleEnabled);
  const stateRef = useRef<AppStateStatus>(AppState.currentState);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = stateRef.current;
      stateRef.current = next;
      if (!isBubbleSupported()) return;
      if (next.match(/inactive|background/) && prev === 'active') {
        if (enabledRef.current && hasOverlayPermission()) showBubble();
      } else if (next === 'active') {
        hideBubble();
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}
