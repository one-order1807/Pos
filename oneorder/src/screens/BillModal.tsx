import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sessionTotals } from '../domain/bill';
import { formatMoney } from '../domain/money';
import type { PaymentMethod } from '../domain/types';
import { customerBillLines, PAY_LABEL, printCustomerBill } from '../printing/actions';
import { templateById } from '../printing/templates';
import { useStore } from '../store/store';
import { Btn, Chip, CountdownBtn, CLOSE_DELAY_SECONDS, Field, Modal, toast } from '../ui/components';
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
  const [busy, setBusy] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  useEffect(() => {
    if (session) {
      setName(session.customerName);
      setPhone(session.customerPhone);
      setMethod('cash');
      setCloseOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!sessionId || !session || session.status !== 'open') return null;
  const settings = data.settings.main;
  const template = templateById(settings.printer.templateId);
  const lines = customerBillLines(data, session, Date.now());
  const totals = sessionTotals(session, settings.gst);

  async function onPrint() {
    if (busy) return;
    setBusy(true);
    setCustomer(sessionId!, name, phone);
    const r = await printCustomerBill(sessionId!);
    setBusy(false);
    if (r.ok) toast('Customer Bill printed.', 'success');
    else toast(`Not printed: ${r.error}`, 'error');
  }

  function completePayment(): boolean {
    const res = pay(sessionId!, method, { name, phone });
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

  return (
    <>
      <Modal visible onClose={onClose} title="Customer Bill" width={720}>
        <View style={styles.body}>
          <View style={styles.left}>
            <Receipt lines={lines} columns={template.columns} maxHeight={420} />
          </View>
          <View style={styles.right}>
            <Field label="Customer name (optional)" value={name} onChangeText={setName} placeholder="Name" />
            <Field
              label="Phone (optional, builds the Users list)"
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/[^0-9+]/g, ''))}
              placeholder="Phone number"
              keyboardType="phone-pad"
              maxLength={15}
            />
            <Text style={styles.label}>Payment method</Text>
            <View style={styles.methods}>
              {(['cash', 'upi', 'card'] as PaymentMethod[]).map((m) => (
                <Chip key={m} label={PAY_LABEL[m]} active={method === m} onPress={() => setMethod(m)} />
              ))}
            </View>
            <Btn label="Print Customer Bill" icon="printer" variant="secondary" full onPress={onPrint} disabled={busy} style={{ marginBottom: 10 }} />
            <Btn label="Payment Received / Close Order" icon="check-circle" variant="success" full onPress={() => setCloseOpen(true)} disabled={busy} />
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
          variant="secondary"
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
  right: { flexGrow: 1, flexBasis: 260 },
  label: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 8 },
  methods: { flexDirection: 'row', marginBottom: 12 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginTop: 8, textAlign: 'center' },
  summary: { fontFamily: fonts.heading, fontSize: 30, color: colors.text, textAlign: 'center', marginBottom: 14 },
});
