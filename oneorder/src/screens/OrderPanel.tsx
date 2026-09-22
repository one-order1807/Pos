import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { roundGroups, sessionTotals } from '../domain/bill';
import { formatDuration, formatMoney, formatPercent } from '../domain/money';
import { sessionLabel, unsentLines } from '../domain/ops';
import { printCookTicket, TYPE_LABEL } from '../printing/actions';
import { useStore } from '../store/store';
import { Btn, Confirm, EmptyState, Icon, toast, useNow } from '../ui/components';
import { colors, fonts } from '../ui/theme';
import { BillModal } from './BillModal';
import { RoundsModal } from './RoundsModal';
import { TablePicker } from './TablePicker';

export function OrderPanel({ sessionId }: { sessionId: string | null }) {
  const data = useStore((s) => s.data);
  const changeLine = useStore((s) => s.changeLine);
  const sendCook = useStore((s) => s.sendCook);
  const assign = useStore((s) => s.assignTableToActive);
  const now = useNow(15000);
  const [picker, setPicker] = useState<null | 'cook' | 'chip'>(null);
  const [showBill, setShowBill] = useState(false);
  const [askSend, setAskSend] = useState(false);
  const [roundsOpen, setRoundsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const session = sessionId ? data.sessions[sessionId] : undefined;
  if (!session || session.status !== 'open') {
    return (
      <View style={styles.panel}>
        <EmptyState icon="shopping-bag" text="No order open. Tap + New Order above to start one." />
      </View>
    );
  }

  const settings = data.settings.main;
  const label = sessionLabel(data, session);
  const totals = sessionTotals(session, settings.gst);
  const unsent = unsentLines(session);
  const groups = roundGroups(session.lines);
  const needsTable = settings.tableMode && session.type === 'dine-in';

  async function doSend(): Promise<boolean> {
    const r = sendCook();
    if (r.error === 'needs-table') {
      setPicker('cook');
      return false;
    }
    if (r.error === 'nothing-to-send') {
      toast('Nothing new to send to the kitchen.');
      return false;
    }
    if (r.error || !r.ticketId) {
      toast('Could not send the Cook Bill.', 'error');
      return false;
    }
    const out = await printCookTicket(r.ticketId);
    if (out.ok) toast('Cook Bill sent and printed.', 'success');
    else toast(`Sent to the kitchen. Not printed: ${out.error}`, 'error', 5000);
    return true;
  }

  async function onCook() {
    if (busy) return;
    if (unsent.length === 0) {
      toast('Nothing new to send to the kitchen.');
      return;
    }
    setBusy(true);
    try {
      await doSend();
    } finally {
      setBusy(false);
    }
  }

  function onCustomerBill() {
    if (session!.lines.length === 0) {
      toast('Add items before generating the bill.');
      return;
    }
    if (unsent.length > 0) {
      setAskSend(true);
      return;
    }
    setShowBill(true);
  }

  // Combined-bill mode (Dev Mode toggle): one tap sends+prints the Cook Bill (if there's anything
  // new to send) and then opens the same Customer Bill popup as usual - the two bills stay exactly
  // as they were, just triggered together instead of by two separate buttons.
  async function onPrintBill() {
    if (busy) return;
    if (session!.lines.length === 0) {
      toast('Add items before generating the bill.');
      return;
    }
    setBusy(true);
    try {
      if (unsent.length > 0) {
        const ok = await doSend();
        if (!ok) return;
      }
      setShowBill(true);
    } finally {
      setBusy(false);
    }
  }

  async function pickTable(tableId: string) {
    const mode = picker;
    setPicker(null);
    const r = assign(tableId);
    if (!r) return;
    if (r.error === 'locked') {
      toast('The table cannot be changed after the first Cook Bill.', 'error');
      return;
    }
    if (r.error) {
      toast('Could not select that table.', 'error');
      return;
    }
    if (r.redirected) {
      const t = useStore.getState().data.tables[useStore.getState().data.sessions[r.sessionId]?.tableId ?? ''];
      toast(
        `${t?.label ?? 'That table'} already has an order — opened it${r.movedItems ? ` and added ${r.movedItems} new item(s)` : ''}.`,
      );
    }
    if (mode === 'cook') {
      setBusy(true);
      try {
        await doSend();
      } finally {
        setBusy(false);
      }
    }
  }

  const started = session.startedAt ? formatDuration(now - session.startedAt) : null;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.sub}>
            Order #{session.orderNo} · {TYPE_LABEL[session.type]}
            {started ? ` · ${started}` : ''}
          </Text>
        </View>
        {needsTable ? (
          <Btn
            small
            variant="secondary"
            icon="grid"
            label={session.tableId ? 'Change' : 'Table'}
            onPress={() => (session.rounds > 0 ? toast('The table is fixed after the first Cook Bill.') : setPicker('chip'))}
          />
        ) : null}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
        {session.lines.length === 0 ? (
          <EmptyState icon="coffee" text="Tap an item to add it. Tap the item name for quantity and notes." />
        ) : (
          groups.map((g) => (
            <View key={String(g.round)} style={{ marginBottom: 10 }}>
              <Text style={[styles.roundHead, g.round === null && { color: colors.primary }]}>
                {g.round === null ? 'New — not sent yet' : `Round ${g.round} — sent`}
              </Text>
              {g.lines.map((l) => (
                <View key={l.id} style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName}>{l.name}</Text>
                    {l.note ? <Text style={styles.lineNote}>{l.note}</Text> : null}
                    <Text style={styles.lineUnit}>{formatMoney(l.unitPrice)} each</Text>
                  </View>
                  {g.round === null ? (
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityLabel={`Decrease ${l.name}`}
                        style={styles.stepBtn}
                        onPress={() => changeLine(l.id, { qty: l.qty - 1 })}
                      >
                        <Icon name={l.qty <= 1 ? 'trash-2' : 'minus'} size={18} color={l.qty <= 1 ? colors.red : colors.text} />
                      </Pressable>
                      <Text style={styles.qty}>{l.qty}</Text>
                      <Pressable
                        accessibilityLabel={`Increase ${l.name}`}
                        style={styles.stepBtn}
                        onPress={() => changeLine(l.id, { qty: l.qty + 1 })}
                      >
                        <Icon name="plus" size={18} />
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.qtyFixed}>x{l.qty}</Text>
                  )}
                  <Text style={styles.amount}>{formatMoney(l.qty * l.unitPrice)}</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.totals}>
        {settings.gst.enabled ? (
          <>
            <Row a="Subtotal" b={formatMoney(totals.subtotal)} />
            <Row a={`GST (${formatPercent(totals.gstPercent)}%)`} b={formatMoney(totals.gstAmount)} />
          </>
        ) : null}
        <Row a="TOTAL" b={formatMoney(totals.total)} big />
      </View>

      <View style={styles.actions}>
        {settings.combinedBillPrint ? (
          <Btn
            label="Print Bill"
            icon="printer"
            onPress={onPrintBill}
            onLongPress={() => setRoundsOpen(true)}
            delayLongPress={3000}
            disabled={busy}
            style={{ flex: 1 }}
          />
        ) : (
          <>
            <Btn
              label={unsent.length ? `Cook Bill (${unsent.reduce((n, l) => n + l.qty, 0)})` : 'Cook Bill'}
              icon="send"
              onPress={onCook}
              onLongPress={() => setRoundsOpen(true)}
              delayLongPress={3000}
              disabled={busy}
              style={{ flex: 1 }}
            />
            <Btn label="Customer Bill" icon="file-text" variant="secondary" onPress={onCustomerBill} disabled={busy} style={{ flex: 1 }} />
          </>
        )}
      </View>

      {roundsOpen ? <RoundsModal sessionId={session.id} onClose={() => setRoundsOpen(false)} /> : null}
      <TablePicker
        visible={picker !== null}
        title={picker === 'cook' ? 'Select a table to send the Cook Bill' : 'Select a table'}
        onClose={() => setPicker(null)}
        onPick={pickTable}
      />
      <Confirm
        visible={askSend}
        title="Items not sent yet"
        message={`${unsent.reduce((n, l) => n + l.qty, 0)} new item(s) haven't gone to the kitchen. Send the Cook Bill first, then continue to the Customer Bill?`}
        confirmLabel="Send & continue"
        onCancel={() => setAskSend(false)}
        onConfirm={async () => {
          setAskSend(false);
          setBusy(true);
          try {
            const ok = await doSend();
            if (ok) setShowBill(true);
          } finally {
            setBusy(false);
          }
        }}
      />
      {showBill ? <BillModal sessionId={session.id} onClose={() => setShowBill(false)} /> : null}
    </View>
  );
}

function Row({ a, b, big }: { a: string; b: string; big?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, big && styles.totalBig]}>{a}</Text>
      <Text style={[styles.totalLabel, big && styles.totalBig]}>{b}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: colors.white, borderLeftWidth: 1, borderLeftColor: colors.border },
  head: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 8, gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 28, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
  list: { flex: 1, paddingHorizontal: 14 },
  roundHead: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSoft, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.muted },
  lineName: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  lineNote: { fontFamily: fonts.body, fontSize: 12, color: colors.coral },
  lineUnit: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.muted, borderRadius: 10 },
  stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qty: { fontFamily: fonts.bold, fontSize: 15, minWidth: 22, textAlign: 'center', color: colors.text },
  qtyFixed: { fontFamily: fonts.bold, fontSize: 15, color: colors.textSoft, minWidth: 44, textAlign: 'center' },
  amount: { fontFamily: fonts.semibold, fontSize: 14, minWidth: 72, textAlign: 'right', color: colors.text },
  totals: { paddingHorizontal: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  totalBig: { fontFamily: fonts.heading, fontSize: 26 },
  actions: { flexDirection: 'row', gap: 10, padding: 14, paddingTop: 8 },
});
