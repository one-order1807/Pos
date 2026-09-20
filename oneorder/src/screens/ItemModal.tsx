import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '../domain/money';
import type { MenuItem } from '../domain/types';
import { Btn, Chip, Field, Modal } from '../ui/components';
import { colors, fonts } from '../ui/theme';

const PRESETS = ['Less sugar', 'No sugar', 'Extra spicy', 'Less spicy', 'No onion', 'Extra hot', 'Take away'];

export function ItemModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onAdd: (item: MenuItem, qty: number, note: string) => void;
}) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (item) {
      setQty(1);
      setNote('');
    }
  }, [item]);
  if (!item) return null;
  const addPreset = (p: string) => {
    setNote((n) => {
      const parts = n
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      return parts.includes(p) ? parts.filter((x) => x !== p).join(', ') : [...parts, p].join(', ');
    });
  };
  return (
    <Modal visible={!!item} onClose={onClose} title={item.name} width={460}>
      <Text style={styles.price}>{formatMoney(item.price)} each</Text>
      <View style={styles.qtyRow}>
        <Btn icon="minus" variant="secondary" onPress={() => setQty((q) => Math.max(1, q - 1))} />
        <Text style={styles.qty}>{qty}</Text>
        <Btn icon="plus" variant="secondary" onPress={() => setQty((q) => Math.min(99, q + 1))} />
      </View>
      <Text style={styles.label}>Notes for the kitchen</Text>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Chip key={p} label={p} active={note.split(',').map((x) => x.trim()).includes(p)} onPress={() => addPreset(p)} />
        ))}
      </View>
      <Field placeholder="e.g. spice level, less sugar" value={note} onChangeText={setNote} maxLength={120} />
      <Btn
        label={`Add ${qty} · ${formatMoney(item.price * qty)}`}
        icon="plus-circle"
        full
        onPress={() => {
          onAdd(item, qty, note);
          onClose();
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  price: { fontFamily: fonts.body, color: colors.textSoft, marginBottom: 12, fontSize: 14 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 },
  qty: { fontFamily: fonts.heading, fontSize: 40, color: colors.text, minWidth: 56, textAlign: 'center' },
  label: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 8 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, marginBottom: 12 },
});
