import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useStore } from '../store/store';
import { Btn, Field, Modal } from './components';
import { colors, fonts } from './theme';

export function WaiterLogin({ visible, onClose, onLoggedIn }: { visible: boolean; onClose: () => void; onLoggedIn: () => void }) {
  const loginWaiter = useStore((s) => s.loginWaiter);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setUsername('');
      setPassword('');
      setError('');
    }
  }, [visible]);

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
    <Modal visible={visible} onClose={onClose} title="Waiter login" width={360}>
      <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoFocus returnKeyType="next" />
      <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" secureTextEntry returnKeyType="done" onSubmitEditing={submit} />
      <Text style={styles.error}>{error || ' '}</Text>
      <Btn label="Log in" icon="log-in" full onPress={submit} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  error: { textAlign: 'center', color: colors.red, fontFamily: fonts.medium, fontSize: 13, marginBottom: 8, minHeight: 18 },
});
