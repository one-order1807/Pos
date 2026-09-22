import { useEffect, useRef, type ReactElement } from 'react';
import * as Updates from 'expo-updates';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { runUpdateCheck, useUpdateState } from '../update/state';
import { Icon, toast } from './components';
import { colors, fonts } from './theme';

// Purely informational - never blocks or forces a reload. Two cases:
// 1. This launch IS an OTA update that was applied on startup -> confirm it happened.
// 2. An update finished downloading in the background during this session -> it will
//    apply next time the app is opened.
// expo-updates is a no-op (isEnabled=false, everything undefined/false) in Expo Go and any dev
// build without EAS Update configured, so this safely does nothing there. This is for JS-only OTA
// bundle updates; a new native APK build (a new versionCode) is a separate concern, handled below.
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

/**
 * A new APK build (a new versionCode) instead of a JS-only OTA bundle. Checked once, a few
 * seconds after launch so it never competes with initial load, against the small public
 * version-manifest repo (see src/update/check.ts) - no login, no token, works even once the main
 * source repo goes private. Shows a persistent banner with a direct Update button when one is
 * available; tapping it opens the browser to the APK download, which installs *over* the current
 * app (an ordinary Android update) - existing data is never touched, unlike uninstalling first.
 */
export function UpdateAvailableBanner(): ReactElement | null {
  const state = useUpdateState();

  useEffect(() => {
    const id = setTimeout(() => runUpdateCheck(), 4000);
    return () => clearTimeout(id);
  }, []);

  if (!state.available || !state.manifest) return null;
  const m = state.manifest;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner}>
        <Icon name="download" size={18} color="#fff" />
        <Text style={styles.text} numberOfLines={2}>
          ONEORDER {m.version} is available.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.btn}
          onPress={() => Linking.openURL(m.apkUrl)}
        >
          <Text style={styles.btnText}>Update</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 998 },
  banner: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    maxWidth: 480,
  },
  text: { flex: 1, color: '#fff', fontFamily: fonts.medium, fontSize: 13 },
  btn: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  btnText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 13 },
});
