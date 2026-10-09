import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '../store/store';
import { Btn, Field } from './components';
import { LogoMark, LogoWordmark } from './Logo';
import { colors, fonts } from './theme';

/** The whole app's first-launch gate, shown after Splash and before anything else - admin or
 * waiter build, same screen either way (see store.ts's `activate`/`activated`). Once a device
 * activates it's remembered locally (device_prefs) and this never shows again on that device. */
export function ActivationGateScreen({ appVariant }: { appVariant: string }) {
  const activate = useStore((s) => s.activate);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!code.trim()) {
      setError('Enter the access key you were given.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await activate(code, appVariant);
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'Invalid access key.');
      setCode('');
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <LogoMark size={96} />
        <View style={styles.wordmark}>
          <LogoWordmark size={24} />
        </View>
        <Text style={styles.title}>Enter your access key</Text>
        <Text style={styles.subtitle}>
          A one-time access key was provided when this app was set up for you. It's only needed
          once, the first time this device is activated.
        </Text>
        <View style={styles.form}>
          <Field
            label="Access key"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submit}
            editable={!busy}
          />
          <Text style={styles.error}>{error || ' '}</Text>
          <Btn label={busy ? 'Checking…' : 'Activate'} icon="check" onPress={submit} full disabled={busy} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  wordmark: { marginTop: 16, marginBottom: 20 },
  title: { fontFamily: fonts.heading, fontSize: 26, color: colors.text, textAlign: 'center' },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textSoft,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    maxWidth: 320,
  },
  form: { width: '100%', maxWidth: 360 },
  error: { textAlign: 'center', color: colors.red, fontFamily: fonts.medium, fontSize: 13, marginBottom: 8, minHeight: 18 },
});
