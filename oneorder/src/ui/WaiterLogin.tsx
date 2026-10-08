import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from '../store/store';
import { Btn, Field, Modal } from './components';
import { LogoMark } from './Logo';
import { colors, fonts } from './theme';

function WaiterLoginForm({ onLoggedIn, resetKey }: { onLoggedIn: () => void; resetKey: unknown }) {
  const loginWaiter = useStore((s) => s.loginWaiter);
  const waiterModeEnabled = useStore((s) => s.data.settings.main.waiter.enabled);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setUsername('');
    setPassword('');
    setError('');
  }, [resetKey]);

  function submit() {
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    if (loginWaiter(username, password)) {
      onLoggedIn();
    } else {
      setError('Incorrect username or password.');
      setPassword('');
    }
  }

  return (
    <View>
      {!waiterModeEnabled ? <Text style={styles.hint}>Waiter Mode isn't turned on for this café yet - ask your admin to enable it in Dev Mode first.</Text> : null}
      <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoFocus returnKeyType="next" />
      <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" secureTextEntry returnKeyType="done" onSubmitEditing={submit} />
      <Text style={styles.error}>{error || ' '}</Text>
      <Btn label="Log in" icon="log-in" full onPress={submit} />
    </View>
  );
}

/** A popup opened from a button inside the main (admin/counter) app - this device keeps its
 * normal nav underneath; logging in just swaps the whole Shell into the restricted waiter view. */
export function WaiterLogin({ visible, onClose, onLoggedIn }: { visible: boolean; onClose: () => void; onLoggedIn: () => void }) {
  return (
    <Modal visible={visible} onClose={onClose} title="Waiter login" width={360}>
      <WaiterLoginForm onLoggedIn={onLoggedIn} resetKey={visible} />
    </Modal>
  );
}

/** The dedicated waiter-app build's entire boot screen when nobody's logged in yet on this device
 * - there's no "other app" underneath to fall back to, so this is a full screen, not a dialog. */
export function WaiterLoginScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <LogoMark size={96} />
        <Text style={styles.title}>Waiter login</Text>
        <View style={styles.form}>
          <WaiterLoginForm onLoggedIn={() => {}} resetKey={null} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  error: { textAlign: 'center', color: colors.red, fontFamily: fonts.medium, fontSize: 13, marginBottom: 8, minHeight: 18 },
  hint: { textAlign: 'center', color: colors.textSoft, fontFamily: fonts.medium, fontSize: 13, marginBottom: 14 },
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, marginTop: 16, marginBottom: 20 },
  form: { width: '100%', maxWidth: 360 },
});
