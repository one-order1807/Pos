import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { roundGroups } from '../domain/bill';
import { printCookRound } from '../printing/actions';
import { useStore } from '../store/store';
import { Btn, EmptyState, Icon, Modal, toast } from '../ui/components';
import { colors, fonts } from '../ui/theme';

export function RoundsModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const session = useStore((s) => s.data.sessions[sessionId]);
  const [busy, setBusy] = useState<string | null>(null);
  const sent = session ? roundGroups(session.lines).filter((g) => g.round !== null) : [];

  async function print(round: number | null) {
    if (busy) return;
    const key = round === null ? 'all' : String(round);
    setBusy(key);
    const r = await printCookRound(sessionId, round);
    setBusy(null);
    if (r.ok) {
      toast(round === null ? 'Whole Cook Bill reprinted.' : `Round ${round} reprinted.`, 'success');
      onClose();
    } else {
      toast(`Not printed: ${r.error}`, 'error', 5000);
    }
  }

  return (
    <Modal visible onClose={onClose} title="Reprint Cook Bill" width={480}>
      {sent.length === 0 ? (
        <EmptyState icon="inbox" text="No rounds have been sent to the kitchen yet." />
      ) : (
        <>
          <Text style={styles.hint}>Tap a round to reprint only that round.</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {sent.map((g) => (
              <Pressable
                key={String(g.round)}
                style={styles.row}
                disabled={busy !== null}
                onPress={() => print(g.round)}
                accessibilityRole="button"
                accessibilityLabel={`Reprint round ${g.round}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.round}>Round {g.round}</Text>
                  <Text style={styles.items} numberOfLines={2}>
                    {g.lines.map((l) => `${l.qty}x ${l.name}`).join(', ')}
                  </Text>
                </View>
                <Icon name={busy === String(g.round) ? 'loader' : 'printer'} size={20} color={colors.primary} />
              </Pressable>
            ))}
          </ScrollView>
          <Btn
            label="Print Whole Bill"
            icon="printer"
            full
            disabled={busy !== null}
            onPress={() => print(null)}
            style={{ marginTop: 12 }}
          />
          <Text style={styles.note}>Whole Bill prints every round combined into one Cook Bill.</Text>
        </>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.textSoft, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
    paddingVertical: 8,
  },
  round: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  items: { fontFamily: fonts.body, fontSize: 13, color: colors.textSoft },
  note: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft, textAlign: 'center', marginTop: 8 },
});
