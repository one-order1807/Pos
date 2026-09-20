import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { formatDuration } from '../domain/money';
import { pendingTickets } from '../domain/ops';
import type { Ticket } from '../domain/types';
import { printCookTicket } from '../printing/actions';
import { useStore } from '../store/store';
import { Btn, EmptyState, Icon, toast, useNow } from '../ui/components';
import { colors, fonts, shadow } from '../ui/theme';

const FRESH_MIN = 10;
const OLD_MIN = 20;
const READY_WINDOW_MS = 2 * 60 * 60 * 1000;

function urgency(ms: number): { color: string; bg: string; text: string } {
  const min = ms / 60000;
  if (min >= OLD_MIN) return { color: colors.red, bg: '#FEF2F2', text: 'Overdue' };
  if (min >= FRESH_MIN) return { color: '#B45309', bg: '#FFFBEB', text: 'Getting old' };
  return { color: '#15803D', bg: '#F0FDF4', text: 'Fresh' };
}

export function KitchenScreen() {
  const data = useStore((s) => s.data);
  const startTicket = useStore((s) => s.startTicket);
  const markReady = useStore((s) => s.markReady);
  const reorder = useStore((s) => s.reorderPending);
  const now = useNow(10000);
  const { width } = useWindowDimensions();
  const stacked = width < 900;

  const pending = pendingTickets(data);
  const cooking = useMemo(
    () =>
      Object.values(data.tickets)
        .filter((t) => t.status === 'cooking')
        .sort((a, b) => (a.startedAt ?? a.sentAt) - (b.startedAt ?? b.sentAt)),
    [data.tickets],
  );
  const ready = useMemo(
    () =>
      Object.values(data.tickets)
        .filter((t) => t.status === 'ready' && Date.now() - (t.readyAt ?? 0) < READY_WINDOW_MS)
        .sort((a, b) => (b.readyAt ?? 0) - (a.readyAt ?? 0))
        .slice(0, 20),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.tickets, now],
  );

  const [dragScroll, setDragScroll] = useState(false);

  async function reprint(t: Ticket) {
    const r = await printCookTicket(t.id);
    if (r.ok) toast('Cook Bill printed.', 'success');
    else toast(`Not printed: ${r.error}`, 'error');
  }

  const cols = (
    <>
      <Column title="Pending" count={pending.length} color={colors.amber} stacked={stacked}>
        {pending.length === 0 ? <EmptyState icon="inbox" text="No pending orders." /> : null}
        <PendingList
          tickets={pending}
          now={now}
          onStart={(t) => startTicket(t.id)}
          onReorder={reorder}
          onReprint={reprint}
          setDragging={setDragScroll}
        />
      </Column>
      <Column title="Cooking" count={cooking.length} color={colors.coral} stacked={stacked}>
        {cooking.length === 0 ? <EmptyState icon="coffee" text="Nothing cooking." /> : null}
        {cooking.map((t) => (
          <TicketCard key={t.id} t={t} now={now} baseTime={t.sentAt} timeLabel="Sent">
            <View style={styles.btnRow}>
              <Btn small label="Mark Ready" icon="check" variant="success" onPress={() => markReady(t.id)} style={{ flex: 1 }} />
              <Btn small icon="printer" variant="secondary" onPress={() => reprint(t)} />
            </View>
          </TicketCard>
        ))}
      </Column>
      <Column title="Ready" count={ready.length} color={colors.green} stacked={stacked}>
        {ready.length === 0 ? <EmptyState icon="check-circle" text="Nothing ready yet." /> : null}
        {ready.map((t) => (
          <TicketCard key={t.id} t={t} now={now} baseTime={t.readyAt ?? t.sentAt} timeLabel="Done" noUrgency />
        ))}
      </Column>
    </>
  );

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Kitchen</Text>
      {stacked ? (
        <ScrollView scrollEnabled={!dragScroll} contentContainerStyle={{ padding: 12, gap: 12 }}>
          {cols}
        </ScrollView>
      ) : (
        <View style={styles.colsRow}>{cols}</View>
      )}
    </View>
  );
}

function Column({
  title,
  count,
  color,
  children,
  stacked,
}: {
  title: string;
  count: number;
  color: string;
  children: React.ReactNode;
  stacked: boolean;
}) {
  return (
    <View style={[styles.col, stacked ? { flex: 0 } : { flex: 1 }]}>
      <View style={[styles.colHead, { borderBottomColor: color }]}>
        <Text style={styles.colTitle}>{title}</Text>
        <View style={[styles.count, { backgroundColor: color }]}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      </View>
      {stacked ? <View style={{ padding: 10, gap: 10 }}>{children}</View> : <ScrollView contentContainerStyle={{ padding: 10, gap: 10 }}>{children}</ScrollView>}
    </View>
  );
}

function TicketCard({
  t,
  now,
  baseTime,
  timeLabel,
  noUrgency,
  children,
  handle,
  style,
}: {
  t: Ticket;
  now: number;
  baseTime: number;
  timeLabel: string;
  noUrgency?: boolean;
  children?: React.ReactNode;
  handle?: React.ReactNode;
  style?: object;
}) {
  const age = now - t.sentAt;
  const u = urgency(age);
  return (
    <View style={[styles.ticket, !noUrgency && { borderLeftColor: u.color, borderLeftWidth: 5 }, style]}>
      <View style={styles.ticketHead}>
        {handle}
        <Text style={styles.ticketLabel} numberOfLines={1}>
          {t.label}
        </Text>
        <Text style={styles.round}>Round {t.round}</Text>
      </View>
      {t.items.map((it, i) => (
        <View key={i} style={{ marginBottom: 2 }}>
          <Text style={styles.item}>
            {it.qty}x {it.name}
          </Text>
          {it.note ? <Text style={styles.note}>{it.note}</Text> : null}
        </View>
      ))}
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {timeLabel} {formatDuration(now - baseTime)} ago
        </Text>
        {!noUrgency ? (
          <View style={[styles.badge, { backgroundColor: u.bg }]}>
            <Text style={[styles.badgeText, { color: u.color }]}>{u.text}</Text>
          </View>
        ) : null}
        {!t.printed && !noUrgency ? <Text style={styles.unprinted}>Not printed</Text> : null}
      </View>
      {children}
    </View>
  );
}

function PendingList({
  tickets,
  now,
  onStart,
  onReorder,
  onReprint,
  setDragging,
}: {
  tickets: Ticket[];
  now: number;
  onStart: (t: Ticket) => void;
  onReorder: (id: string, toIndex: number) => void;
  onReprint: (t: Ticket) => void;
  setDragging: (d: boolean) => void;
}) {
  const heights = useRef<Record<string, number>>({});
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const ref = useRef({ tickets, onReorder, drag });
  ref.current = { tickets, onReorder, drag };

  function targetIndex(id: string, dy: number): number {
    const list = ref.current.tickets;
    const from = list.findIndex((t) => t.id === id);
    const gap = 10;
    let center = 0;
    for (let i = 0; i < from; i++) center += (heights.current[list[i].id] ?? 120) + gap;
    center += (heights.current[id] ?? 120) / 2 + dy;
    let top = 0;
    for (let i = 0; i < list.length; i++) {
      const h = heights.current[list[i].id] ?? 120;
      if (center < top + h + gap) return i;
      top += h + gap;
    }
    return list.length - 1;
  }

  function makePan(id: string) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        setDragging(true);
        setDrag({ id, dy: 0 });
      },
      onPanResponderMove: (_e, g) => setDrag({ id, dy: g.dy }),
      onPanResponderRelease: (_e, g) => {
        setDragging(false);
        const idx = targetIndex(id, g.dy);
        setDrag(null);
        ref.current.onReorder(id, idx);
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        setDrag(null);
      },
    });
  }

  const pans = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  return (
    <View style={{ gap: 10 }}>
      {tickets.map((t, i) => {
        if (!pans.current[t.id]) pans.current[t.id] = makePan(t.id);
        const isDrag = drag?.id === t.id;
        return (
          <View
            key={t.id}
            onLayout={(e) => (heights.current[t.id] = e.nativeEvent.layout.height)}
            style={isDrag ? { zIndex: 10, transform: [{ translateY: drag!.dy }], opacity: 0.92 } : undefined}
          >
            <TicketCard
              t={t}
              now={now}
              baseTime={t.sentAt}
              timeLabel="Sent"
              style={isDrag ? { ...(shadow as object), borderColor: colors.primary } : undefined}
              handle={
                <View style={styles.handleWrap}>
                  <View {...pans.current[t.id].panHandlers} style={styles.handle} accessibilityLabel="Drag to change cook order">
                    <Icon name="menu" size={20} color={colors.textSoft} />
                  </View>
                </View>
              }
            >
              <View style={styles.btnRow}>
                <Btn small label="Start Cooking" icon="play" onPress={() => onStart(t)} style={{ flex: 1 }} />
                <Btn small icon="chevron-up" variant="secondary" disabled={i === 0} onPress={() => onReorder(t.id, i - 1)} />
                <Btn small icon="chevron-down" variant="secondary" disabled={i === tickets.length - 1} onPress={() => onReorder(t.id, i + 1)} />
                <Btn small icon="printer" variant="secondary" onPress={() => onReprint(t)} />
              </View>
            </TicketCard>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text, paddingHorizontal: 14, paddingTop: 10 },
  colsRow: { flex: 1, flexDirection: 'row', padding: 12, gap: 12 },
  col: { backgroundColor: colors.muted, borderRadius: 14, overflow: 'hidden' },
  colHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 3 },
  colTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.6 },
  count: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13 },
  ticket: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, ...(shadow as object) },
  ticketHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 },
  ticketLabel: { flex: 1, fontFamily: fonts.heading, fontSize: 22, color: colors.text },
  round: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSoft },
  item: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  note: { fontFamily: fonts.body, fontSize: 12, color: colors.coral, marginLeft: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
  unprinted: { fontFamily: fonts.semibold, fontSize: 11, color: colors.red },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  handleWrap: { marginLeft: -6 },
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
