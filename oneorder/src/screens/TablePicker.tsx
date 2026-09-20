import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '../domain/money';
import { activeSessionForTable, tableStatus, visibleTables } from '../domain/ops';
import { useStore } from '../store/store';
import { Dot, EmptyState, Modal, useNow } from '../ui/components';
import { colors, fonts } from '../ui/theme';

export const STATUS_TEXT = {
  available: 'Free',
  occupied: 'Occupied',
  cooking: 'Cooking',
  payment: 'Payment pending',
} as const;

export function statusColor(status: keyof typeof STATUS_TEXT): string {
  return status === 'available' ? colors.green : colors.red;
}

export function TablePicker({
  visible,
  title = 'Select a table',
  onClose,
  onPick,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onPick: (tableId: string) => void;
}) {
  const data = useStore((s) => s.data);
  const now = useNow(15000);
  const tables = visibleTables(data);
  return (
    <Modal visible={visible} onClose={onClose} title={title} width={620}>
      <View style={styles.legend}>
        <Dot color={colors.green} />
        <Text style={styles.legendText}>Free — starts a new order</Text>
        <Dot color={colors.red} />
        <Text style={styles.legendText}>Active — opens its existing order</Text>
      </View>
      {tables.length === 0 ? (
        <EmptyState icon="grid" text="No tables yet. Add tables in Tables > Arrange." />
      ) : (
        <ScrollView style={{ maxHeight: 420 }}>
          <View style={styles.grid}>
            {tables.map((t) => {
              const status = tableStatus(data, t.id);
              const s = activeSessionForTable(data, t.id);
              return (
                <Pressable
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${t.label} ${STATUS_TEXT[status]}`}
                  onPress={() => onPick(t.id)}
                  style={[styles.cell, status !== 'available' && { borderColor: colors.red, backgroundColor: '#FEF2F2' }]}
                >
                  <View style={styles.cellTop}>
                    <Dot color={statusColor(status)} />
                    <Text style={styles.cellLabel} numberOfLines={1}>
                      {t.label}
                    </Text>
                  </View>
                  <Text style={styles.cellSub}>
                    {STATUS_TEXT[status]}
                    {s?.startedAt ? ` · ${formatDuration(now - s.startedAt)}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  legendText: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginRight: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: {
    width: 140,
    minHeight: 76,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    justifyContent: 'space-between',
  },
  cellTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text, flexShrink: 1 },
  cellSub: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginTop: 6 },
});
