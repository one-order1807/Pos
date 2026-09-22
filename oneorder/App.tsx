import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { WorkSans_400Regular } from '@expo-google-fonts/work-sans/400Regular';
import { WorkSans_500Medium } from '@expo-google-fonts/work-sans/500Medium';
import { WorkSans_600SemiBold } from '@expo-google-fonts/work-sans/600SemiBold';
import { WorkSans_700Bold } from '@expo-google-fonts/work-sans/700Bold';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from './src/store/store';
import { Btn, Skeleton } from './src/ui/components';
import { BubbleController } from './src/ui/BubbleController';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { Shell } from './src/ui/Shell';
import { Splash } from './src/ui/Splash';
import { UpdateWatcher } from './src/ui/UpdateBanner';
import { colors, fonts } from './src/ui/theme';

let splashShown = false;

// RN's default long-press-cancels-on-drift is 10px, tuned for the ~500ms long presses most apps
// use. The Cook Bill reprint gesture asks for a full 5s hold (see OrderPanel's delayLongPress),
// and no human hand holds a fingertip on glass within 10px for 5 whole seconds - the natural
// drift silently cancelled the long press before it could fire, so onLongPress never ran and the
// touch just completed as a normal tap on release. A generous deactivation distance fixes this
// app-wide (it's a single global setting inside Pressability, not per-component). Deep import
// because Pressability's static setter isn't re-exported from the top-level 'react-native' index.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Pressability = require('react-native/Libraries/Pressability/Pressability').default;
Pressability.setLongPressDeactivationDistance(60);

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    WorkSans_400Regular,
    WorkSans_500Medium,
    WorkSans_600SemiBold,
    WorkSans_700Bold,
  });
  const ready = useStore((s) => s.ready);
  const loadError = useStore((s) => s.loadError);
  const init = useStore((s) => s.init);
  const cafeName = useStore((s) => s.data.settings.main?.bill.name);
  const [splash, setSplash] = useState(!splashShown);

  useEffect(() => {
    init();
  }, [init]);

  if (!fontsLoaded && !fontError) return <View style={styles.blank} />;

  if (splash) {
    return (
      <>
        <StatusBar style="dark" />
        <Splash
          name={cafeName || 'ONEORDER'}
          onDone={() => {
            splashShown = true;
            setSplash(false);
          }}
        />
      </>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errTitle}>Could not open the local database</Text>
        <Text style={styles.errMsg}>{loadError}</Text>
        <Btn label="Try again" icon="refresh-cw" onPress={() => init()} />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <Skeleton width={220} height={20} />
        <Skeleton width={160} height={20} style={{ marginTop: 10 }} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Shell />
        <UpdateWatcher />
        <BubbleController />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errTitle: { fontFamily: fonts.heading, fontSize: 28, color: colors.text },
  errMsg: { fontFamily: fonts.body, fontSize: 14, color: colors.textSoft, textAlign: 'center' },
});
