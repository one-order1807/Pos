import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Btn, Modal } from './components';
import { colors, fonts } from './theme';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

// Plain month-grid picker, no library - tap a date to start a range, tap a second to complete it,
// or tap Apply after one date for a single day. Used by the Dashboard to add a custom date/range
// on top of the existing Today / 7-day / 30-day / All-time presets, not replacing them.
export function CalendarPicker({
  visible,
  onClose,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (range: { start: number; end: number }) => void;
}) {
  const now = Date.now();
  const [view, setView] = useState(() => {
    const d = new Date(now);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);

  function reset() {
    setStart(null);
    setEnd(null);
  }

  function pick(day: number) {
    const ts = startOfDay(new Date(view.y, view.m, day).getTime());
    if (start === null || end !== null) {
      setStart(ts);
      setEnd(null);
    } else if (ts < start) {
      setStart(ts);
      setEnd(null);
    } else {
      setEnd(ts);
    }
  }

  function apply() {
    if (start === null) return;
    onApply({ start, end: end !== null ? endOfDay(end) : endOfDay(start) });
    reset();
    onClose();
  }

  const first = new Date(view.y, view.m, 1);
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const leadBlank = first.getDay();
  const cells: (number | null)[] = [...Array(leadBlank).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStart = startOfDay(now);
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <Modal
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Select date range"
      width={360}
    >
      <View style={styles.nav}>
        <Pressable
          onPress={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
          style={styles.navBtn}
          accessibilityLabel="Previous month"
        >
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable
          onPress={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
          style={styles.navBtn}
          accessibilityLabel="Next month"
        >
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.dowRow}>
        {DOW.map((d, i) => (
          <Text key={i} style={styles.dow}>
            {d}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={styles.cell} />;
          const ts = startOfDay(new Date(view.y, view.m, day).getTime());
          const isStart = start === ts;
          const isEnd = end === ts;
          const inRange = start !== null && end !== null && ts > start && ts < end;
          const future = ts > todayStart;
          return (
            <Pressable
              key={i}
              disabled={future}
              onPress={() => pick(day)}
              accessibilityRole="button"
              accessibilityLabel={new Date(view.y, view.m, day).toLocaleDateString()}
              style={[styles.cell, (isStart || isEnd) && styles.cellSelected, inRange && styles.cellInRange]}
            >
              <Text style={[styles.cellText, (isStart || isEnd) && styles.cellTextSelected, future && styles.cellTextDisabled]}>{day}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {start === null
          ? 'Tap a date to start, or tap a second date for a range.'
          : end === null
            ? `${new Date(start).toLocaleDateString()} — tap another date for a range, or Apply for a single day.`
            : `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
        <Btn label="Reset" variant="secondary" onPress={reset} style={{ flex: 1 }} />
        <Btn label="Apply" icon="check" onPress={apply} disabled={start === null} style={{ flex: 1 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 22, color: colors.primary, fontFamily: fonts.bold },
  monthLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  dowRow: { flexDirection: 'row' },
  dow: { flex: 1, textAlign: 'center', fontFamily: fonts.medium, fontSize: 11, color: colors.textSoft },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  cellSelected: { backgroundColor: colors.primary },
  cellInRange: { backgroundColor: colors.primaryTint },
  cellText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  cellTextSelected: { color: '#fff', fontFamily: fonts.bold },
  cellTextDisabled: { color: colors.border },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginTop: 10, textAlign: 'center' },
});
