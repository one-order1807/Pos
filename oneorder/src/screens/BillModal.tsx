import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { sessionTotals } from '../domain/bill';
import { formatMoney } from '../domain/money';
import { EVENT_TYPES, type EventType, type PaymentMethod } from '../domain/types';
import { matchCustomersByName } from '../domain/users';
import { customerBillLines, PAY_LABEL, printCustomerBill } from '../printing/actions';
import { templateById } from '../printing/templates';
import { useStore } from '../store/store';
import { Btn, Chip, CountdownBtn, CLOSE_DELAY_SECONDS, Field, Modal, toast } from '../ui/components';
import { AutoScrollView } from '../ui/AutoScrollView';
import { Receipt } from '../ui/Receipt';
import { colors, fonts } from '../ui/theme';

export function BillModal({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const pay = useStore((s) => s.pay);
  const setCustomer = useStore((s) => s.setCustomer);
  const session = sessionId ? data.sessions[sessionId] : undefined;
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [event, setEvent] = useState<EventType | ''>('');
  const [dismissedMatchId, setDismissedMatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);

  useEffect(() => {
    if (session) {
      setName(session.customerName);
      setPhone(session.customerPhone);
      setEvent(session.customerPhone ? data.customers[session.customerPhone]?.event ?? '' : '');
      setMethod('cash');
      setCloseOpen(false);
      setDismissedMatchId(null);
      // Triggers AutoScrollView's delayed scroll-to-bottom the moment the popup opens, so a long
      // bill's last items are reachable without the person having to find the scroll themselves.
      setScrollSignal(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const nameMatches = useMemo(() => matchCustomersByName(data.customers, name), [data.customers, name]);
  // Only offer suggestions while the typed phone hasn't already settled on one of the matches -
  // once it has, the person has effectively linked to that existing customer already.
  const suggestions = nameMatches.filter((m) => m.phone !== phone);
  const topMatch = nameMatches[0];
  // Ambiguous case: the typed name matches an existing customer, but the typed phone is for
  // someone else (or blank) - ask directly instead of silently creating a second record for the
  // same person, or silently merging two different people who happen to share a name.
  const showSameCustomerAsk =
    !!topMatch && topMatch.id !== dismissedMatchId && topMatch.phone !== phone && !!phone.trim() && phone.trim().length >= 6;

  function pickSuggestion(m: (typeof nameMatches)[number]) {
    setName(m.name);
    setPhone(m.phone);
    if (m.event) setEvent(m.event);
    setDismissedMatchId(null);
  }

  if (!sessionId || !session || session.status !== 'open') return null;
  const settings = data.settings.main;
  const template = templateById(settings.printer.templateId);
  const lines = customerBillLines(data, session, Date.now());
  const totals = sessionTotals(session, settings.gst);
  const alreadyBilled = !!session.billPrintedAt;

  async function onPrint() {
    if (busy) return;
    setBusy(true);
    setCustomer(sessionId!, name, phone);
    const r = await printCustomerBill(sessionId!);
    setBusy(false);
    setScrollSignal(Date.now());
    if (r.ok) toast('Customer Bill printed.', 'success');
    else toast(`Not printed: ${r.error}`, 'error');
  }

  function completePayment(): boolean {
    const res = pay(sessionId!, method, { name, phone, event });
    if (res.error === 'unsent-items') {
      toast('Send the Cook Bill for new items before payment.', 'error');
      return false;
    }
    if (res.error) {
      toast('Could not record payment.', 'error');
      return false;
    }
    setCloseOpen(false);
    toast(`Payment recorded — ${PAY_LABEL[method]}. Table released.`, 'success');
    onClose();
    return true;
  }

  async function printAndClose() {
    if (busy) return;
    setBusy(true);
    setCustomer(sessionId!, name, phone);
    const r = await printCustomerBill(sessionId!);
    setBusy(false);
    if (!r.ok) {
      toast(`Not printed, order kept open: ${r.error}`, 'error', 5000);
      return;
    }
    completePayment();
  }

  function onCloseOrder() {
    // The countdown popup exists to protect against closing an order that hasn't been billed
    // yet. Once the Customer Bill has already been printed, that protection has done its job -
    // closing goes straight through.
    if (alreadyBilled) {
      completePayment();
      return;
    }
    setCloseOpen(true);
  }

  return (
    <>
      <Modal visible onClose={onClose} title="Customer Bill" width={720}>
        <View style={styles.body}>
          <View style={styles.left}>
            <AutoScrollView autoScrollSignal={scrollSignal} style={styles.receiptScroll}>
              <Receipt lines={lines} columns={template.columns} />
            </AutoScrollView>
          </View>
          <View style={styles.right}>
            <Field label="Customer name (optional)" value={name} onChangeText={setName} placeholder="Name" />
            {suggestions.length > 0 ? (
              <View style={styles.suggestBox}>
                {suggestions.map((m) => (
                  <Pressable
                    key={m.id}
                    style={styles.suggestRow}
                    onPress={() => pickSuggestion(m)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use existing customer ${m.name}`}
                  >
                    <Text style={styles.suggestName}>{m.name}</Text>
                    <Text style={styles.suggestPhone}>{m.phone}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Field
              label="Phone (optional, builds the Users list)"
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^0-9+]/g, ''))}
              placeholder="Phone number"
              keyboardType="phone-pad"
              maxLength={15}
            />
            {showSameCustomerAsk ? (
              <View style={styles.sameAsk}>
                <Text style={styles.sameAskText}>
                  Same {topMatch.name} as before ({topMatch.phone})?
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Btn small label="Yes, same" onPress={() => pickSuggestion(topMatch)} style={{ flex: 1 }} />
                  <Btn
                    small
                    label="No, different"
                    variant="secondary"
                    onPress={() => setDismissedMatchId(topMatch.id)}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : null}
            <Text style={styles.label}>Occasion (optional)</Text>
            <View style={styles.methods}>
              {EVENT_TYPES.map((e) => (
                <Chip key={e} label={e} active={event === e} onPress={() => setEvent(event === e ? '' : e)} />
              ))}
            </View>
            <Text style={styles.label}>Payment method</Text>
            <View style={styles.methods}>
              {(['cash', 'upi', 'card'] as PaymentMethod[]).map((m) => (
                <Chip key={m} label={PAY_LABEL[m]} active={method === m} onPress={() => setMethod(m)} />
              ))}
            </View>
            <Btn label="Print Customer Bill" icon="printer" variant="secondary" full onPress={onPrint} disabled={busy} style={{ marginBottom: 10 }} />
            <Btn label="Payment Received / Close Order" icon="check-circle" variant="success" full onPress={onCloseOrder} disabled={busy} />
            <Text style={styles.hint}>Closing releases the table and resets its timer.</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={closeOpen} onClose={() => setCloseOpen(false)} title="Close this order?" width={440}>
        <Text style={styles.summary}>
          {formatMoney(totals.total)} · {PAY_LABEL[method]}
        </Text>
        <Btn
          label="Print Bill & Close"
          icon="printer"
          variant="success"
          full
          onPress={printAndClose}
          disabled={busy}
          style={{ marginBottom: 10 }}
        />
        <CountdownBtn
          label="Close Anyway"
          seconds={CLOSE_DELAY_SECONDS}
          active={closeOpen}
          full
          onPress={completePayment}
        />
        <Text style={styles.hint}>Close Anyway closes without printing and unlocks after {CLOSE_DELAY_SECONDS} seconds.</Text>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  left: { flexGrow: 1, flexBasis: 300, alignItems: 'center' },
  receiptScroll: { alignSelf: 'stretch', maxHeight: 420 },
  right: { flexGrow: 1, flexBasis: 260 },
  label: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 8 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginTop: 8, textAlign: 'center' },
  summary: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, textAlign: 'center', marginBottom: 14 },
  suggestBox: {
    marginTop: -6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
  },
  suggestName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
  suggestPhone: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
  sameAsk: { backgroundColor: colors.primaryTint, borderRadius: 10, padding: 10, marginBottom: 12, gap: 8 },
  sameAskText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primaryDark },
});
