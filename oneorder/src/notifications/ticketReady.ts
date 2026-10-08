import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform, Vibration } from 'react-native';
import { ensureNotificationPermission } from '../update/notify';
import { useStore } from '../store/store';

// Android locks a notification channel's sound/vibration settings at creation time - an app can't
// silently flip them later. So "sound on/off" in Dev Mode picks between two channels created once
// up front, rather than trying to mutate one channel's settings per the live setting.
const CHANNEL_SOUND = 'ticket-ready';
const CHANNEL_SILENT = 'ticket-ready-silent';
const VIBRATION_PATTERN = [0, 400, 200, 400];

/** Called once on app start (see App.tsx). Idempotent - safe to call every launch. */
export async function ensureTicketReadyChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_SOUND, {
    name: 'Order ready',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: VIBRATION_PATTERN,
    enableVibrate: true,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_SILENT, {
    name: 'Order ready (silent)',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    vibrationPattern: VIBRATION_PATTERN,
    enableVibrate: true,
  });
}

async function fireTicketReadyAlert(label: string, soundEnabled: boolean): Promise<void> {
  const ok = await ensureNotificationPermission();
  if (!ok) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Order ready',
      body: `${label} is ready to serve.`,
      data: { kind: 'ticket-ready' },
      sound: soundEnabled ? 'default' : false,
    },
    trigger: Platform.OS === 'android' ? { channelId: soundEnabled ? CHANNEL_SOUND : CHANNEL_SILENT } : null,
  });
}

/**
 * Mounted once while Waiter Mode is active. Fires exactly once per pending/cooking -> ready
 * transition for a ticket belonging to one of this waiter's own open orders, regardless of which
 * device actually marked it ready - cross-device changes arrive via sync's `onRemoteChange` path
 * (store.ts), which writes straight into `data` without going through any single "markReady"
 * call, so this has to watch `data` reactively rather than hook the action itself.
 */
export function useTicketReadyWatcher(waiterId: string | null): void {
  const data = useStore((s) => s.data);
  const notif = useStore((s) => s.data.settings.main.notifications);
  const prevStatus = useRef<Record<string, string>>({});
  const repeatTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    if (!waiterId) return;
    const myOpenSessionIds = new Set(
      Object.values(data.sessions)
        .filter((s) => s.openedBy === waiterId && s.status === 'open')
        .map((s) => s.id),
    );
    const tickets = Object.values(data.tickets).filter((t) => myOpenSessionIds.has(t.sessionId));
    const scopedIds = new Set(tickets.map((t) => t.id));

    for (const id of Object.keys(repeatTimers.current)) {
      if (!scopedIds.has(id)) {
        clearInterval(repeatTimers.current[id]);
        delete repeatTimers.current[id];
      }
    }

    for (const t of tickets) {
      const was = prevStatus.current[t.id];
      if (was !== 'ready' && t.status === 'ready' && !t.servedAt) {
        fireTicketReadyAlert(t.label, notif.soundEnabled);
        if (notif.vibrationEnabled) Vibration.vibrate(VIBRATION_PATTERN);
        if (notif.repeatSeconds > 0 && !repeatTimers.current[t.id]) {
          const ticketId = t.id;
          const label = t.label;
          repeatTimers.current[ticketId] = setInterval(() => {
            const fresh = useStore.getState().data.tickets[ticketId];
            if (!fresh || fresh.servedAt || fresh.status !== 'ready') {
              clearInterval(repeatTimers.current[ticketId]);
              delete repeatTimers.current[ticketId];
              return;
            }
            fireTicketReadyAlert(label, notif.soundEnabled);
            if (notif.vibrationEnabled) Vibration.vibrate(VIBRATION_PATTERN);
          }, notif.repeatSeconds * 1000);
        }
      }
      if (t.servedAt && repeatTimers.current[t.id]) {
        clearInterval(repeatTimers.current[t.id]);
        delete repeatTimers.current[t.id];
      }
    }

    const nextSnapshot: Record<string, string> = {};
    for (const t of tickets) nextSnapshot[t.id] = t.status;
    prevStatus.current = nextSnapshot;
  }, [data, waiterId, notif]);

  useEffect(
    () => () => {
      Object.values(repeatTimers.current).forEach(clearInterval);
      repeatTimers.current = {};
    },
    [],
  );
}
