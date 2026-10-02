import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store/store';
import { Icon, Modal } from './components';
import { colors, fonts } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

export function PinGate({
  visible,
  title = 'Enter 6-digit PIN',
  pinLength = 6,
  onVerify,
  onClose,
  onUnlocked,
}: {
  visible: boolean;
  title?: string;
  /** Defaults to 6, matching the Dev Mode PIN this was originally built for. */
  pinLength?: number;
  /**
   * Defaults to the Dev Mode PIN/lockout check (store's verifyPin). Pass this to reuse the same
   * keypad UI for a different, simpler fixed-code check (e.g. Chef Mode's exit code) without
   * touching Dev Mode's brute-force lockout logic at all.
   */
  onVerify?: (pin: string) => boolean;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const verifyPin = useStore((s) => s.verifyPin);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setPin('');
      setError('');
    }
  }, [visible]);

  function press(k: string) {
    if (k === 'back') {
      setPin((p) => p.slice(0, -1));
      setError('');
      return;
    }
    if (!k) return;
    const next = (pin + k).slice(0, pinLength);
    setPin(next);
    setError('');
    if (next.length === pinLength) {
      if (onVerify) {
        if (onVerify(next)) {
          setPin('');
          onUnlocked();
        } else {
          setPin('');
          setError('Incorrect code.');
        }
        return;
      }
      const r = verifyPin(next);
      if (r.ok) {
        setPin('');
        onUnlocked();
      } else {
        setPin('');
        setError(
          r.waitMs > 0
            ? `Too many attempts. Try again in ${Math.ceil(r.waitMs / 1000)}s.`
            : 'Incorrect PIN.',
        );
      }
    }
  }

  return (
    <Modal visible={visible} onClose={onClose} title={title} width={360}>
      <View style={styles.dots}>
        {Array.from({ length: pinLength }, (_, i) => (
          <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
        ))}
      </View>
      <Text style={styles.error}>{error || ' '}</Text>
      <View style={styles.pad}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={k === 'back' ? 'Backspace' : k || undefined}
            disabled={!k}
            onPress={() => press(k)}
            style={[styles.key, !k && { opacity: 0 }]}
          >
            {k === 'back' ? <Icon name="delete" size={22} /> : <Text style={styles.keyText}>{k}</Text>}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginVertical: 8 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.primary },
  dotOn: { backgroundColor: colors.primary },
  error: { textAlign: 'center', color: colors.red, fontFamily: fonts.medium, fontSize: 13, marginBottom: 8, minHeight: 18 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  key: {
    width: 88,
    height: 60,
    borderRadius: 14,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontFamily: fonts.semibold, fontSize: 24, color: colors.text },
});
