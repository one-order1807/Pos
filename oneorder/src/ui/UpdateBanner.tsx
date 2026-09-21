import { useEffect, useRef } from 'react';
import * as Updates from 'expo-updates';
import { toast } from './components';

// Purely informational - never blocks or forces a reload. Two cases:
// 1. This launch IS an OTA update that was applied on startup -> confirm it happened.
// 2. An update finished downloading in the background during this session -> it will
//    apply next time the app is opened.
// expo-updates is a no-op (isEnabled=false, everything undefined/false) in Expo Go and any dev
// build without EAS Update configured, so this safely does nothing there.
export function UpdateWatcher(): null {
  const { currentlyRunning, isUpdatePending } = Updates.useUpdates();
  const announcedFresh = useRef(false);
  const announcedPending = useRef(false);

  useEffect(() => {
    if (announcedFresh.current) return;
    if (currentlyRunning.updateId && !currentlyRunning.isEmbeddedLaunch) {
      announcedFresh.current = true;
      toast('ONEORDER updated to the latest version.', 'success', 4000);
    }
  }, [currentlyRunning]);

  useEffect(() => {
    if (isUpdatePending && !announcedPending.current) {
      announcedPending.current = true;
      toast('A new update has been downloaded. It will apply next time the app is opened.', 'success', 5000);
    }
  }, [isUpdatePending]);

  return null;
}
