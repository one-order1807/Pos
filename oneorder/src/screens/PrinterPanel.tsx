import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { printTest, testLines, usePrinter } from '../printing/actions';
import { connectTo, disconnectPrinter, startScan, stopScan, verifyConnection } from '../printing/printer';
import { templateById, TEMPLATES } from '../printing/templates';
import { useStore } from '../store/store';
import { Btn, Card, Chip, Dot, Modal, toast } from '../ui/components';
import { Receipt } from '../ui/Receipt';
import { colors, fonts } from '../ui/theme';

export function printerStatusInfo(status: ReturnType<typeof usePrinter>['status']): { label: string; color: string } {
  switch (status) {
    case 'connected':
      return { label: 'Connected', color: colors.green };
    case 'connecting':
      return { label: 'Connecting...', color: colors.amber };
    case 'scanning':
      return { label: 'Scanning...', color: colors.amber };
    case 'bluetooth-off':
      return { label: 'Bluetooth off', color: colors.red };
    default:
      return { label: 'Disconnected', color: colors.red };
  }
}

export function PrinterPanel({ active = true }: { active?: boolean }) {
  const snap = usePrinter();
  const setPrinterSettings = useStore((s) => s.setPrinterSettings);
  const templateId = useStore((s) => s.data.settings.main.printer.templateId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) return;
    verifyConnection();
    const id = setInterval(() => verifyConnection(), 5000);
    return () => {
      clearInterval(id);
      stopScan();
    };
  }, [active]);

  const info = printerStatusInfo(snap.status);
  const scanning = snap.status === 'scanning';

  async function connect(id: string, name: string) {
    const ok = await connectTo(id, name);
    if (ok) {
      setPrinterSettings({ deviceId: id, deviceName: name });
      toast(`Connected to ${name}.`, 'success');
    }
  }

  async function test(kind: 'customer' | 'cook') {
    if (busy) return;
    setBusy(true);
    const r = await printTest(templateId, kind);
    setBusy(false);
    if (r.ok) toast('Test receipt sent to the printer.', 'success');
    else toast(`Test print failed: ${r.error} Tap Print Test to retry.`, 'error', 5000);
  }

  return (
    <View>
      <View style={styles.statusRow}>
        <Dot color={info.color} size={14} />
        <Text style={styles.statusLabel}>{info.label}</Text>
        {snap.device ? <Text style={styles.device}>{snap.device.name}</Text> : null}
      </View>
      <Text style={styles.message}>{snap.message}</Text>

      <View style={styles.btnRow}>
        {scanning ? (
          <Btn small label="Stop scan" icon="square" variant="secondary" onPress={stopScan} />
        ) : (
          <Btn small label="Scan for printers" icon="bluetooth" onPress={() => startScan()} disabled={snap.status === 'unsupported' || snap.status === 'connecting'} />
        )}
        {snap.status === 'connected' ? (
          <Btn small label="Disconnect" icon="x" variant="secondary" onPress={() => disconnectPrinter()} />
        ) : null}
        <Btn small label="Print Test" icon="printer" variant="secondary" onPress={() => test('customer')} disabled={busy} />
        <Btn small label="Test Cook Bill" icon="printer" variant="secondary" onPress={() => test('cook')} disabled={busy} />
      </View>

      {snap.devices.length > 0 ? (
        <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
          {snap.devices.map((d) => {
            const isCurrent = snap.device?.id === d.id;
            return (
              <View key={d.id} style={styles.devRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.devName}>{d.name}</Text>
                  <Text style={styles.devSub}>
                    {d.id}
                    {d.rssi !== null ? ` · ${d.rssi} dBm` : ''}
                  </Text>
                </View>
                {isCurrent ? (
                  <Text style={styles.connectedTag}>Connected</Text>
                ) : (
                  <Btn small label="Connect" onPress={() => connect(d.id, d.name)} disabled={snap.status === 'connecting'} />
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

export function PrinterModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} onClose={onClose} title="Thermal printer" width={560}>
      <PrinterPanel active={visible} />
    </Modal>
  );
}

export function TemplatePicker() {
  const data = useStore((s) => s.data);
  const setPrinterSettings = useStore((s) => s.setPrinterSettings);
  const current = data.settings.main.printer.templateId;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [kind, setKind] = useState<'customer' | 'cook'>('customer');
  const [busy, setBusy] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const preview = previewId ? templateById(previewId) : null;

  async function printThis() {
    if (!previewId || busy) return;
    setBusy(true);
    const r = await printTest(previewId, kind);
    setBusy(false);
    setScrollSignal(Date.now());
    if (r.ok) toast('Test receipt sent to the printer.', 'success');
    else toast(`Test print failed: ${r.error}`, 'error', 5000);
  }

  return (
    <View>
      {TEMPLATES.map((t) => (
        <Card key={t.id} style={[styles.tpl, t.id === current && { borderColor: colors.primary, borderWidth: 2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tplName}>
              {t.name} <Text style={styles.tplPaper}>· {t.paper} · {t.columns} chars</Text>
            </Text>
            <Text style={styles.devSub}>{t.description}</Text>
          </View>
          {t.id === current ? <Text style={styles.connectedTag}>Default</Text> : null}
          <Btn small label="Preview" icon="eye" variant="secondary" onPress={() => setPreviewId(t.id)} />
        </Card>
      ))}
      <Modal visible={!!preview} onClose={() => setPreviewId(null)} title={preview?.name ?? ''} width={620}>
        {preview ? (
          <View>
            <View style={{ flexDirection: 'row', marginBottom: 10 }}>
              <Chip label="Customer Bill" active={kind === 'customer'} onPress={() => setKind('customer')} />
              <Chip label="Cook Bill" active={kind === 'cook'} onPress={() => setKind('cook')} />
            </View>
            <Receipt lines={testLines(data, preview.id, kind)} columns={preview.columns} maxHeight={380} autoScrollSignal={scrollSignal} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Btn
                label={preview.id === current ? 'Default template' : 'Use as default'}
                icon="check"
                disabled={preview.id === current}
                onPress={() => {
                  setPrinterSettings({ templateId: preview.id });
                  toast(`${preview.name} is now the default.`, 'success');
                }}
                style={{ flex: 1 }}
              />
              <Btn label="Print test receipt" icon="printer" variant="secondary" onPress={printThis} disabled={busy} style={{ flex: 1 }} />
            </View>
            <Text style={styles.note}>The test receipt is clearly marked "TEST - no customer order placed" and uses the same print engine as real bills.</Text>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusLabel: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
  device: { fontFamily: fonts.body, fontSize: 13, color: colors.textSoft },
  message: { fontFamily: fonts.body, fontSize: 13, color: colors.textSoft, marginVertical: 8, lineHeight: 19 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  devRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.muted },
  devName: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  devSub: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
  connectedTag: { fontFamily: fonts.semibold, fontSize: 12, color: colors.green, marginRight: 8 },
  tpl: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  tplName: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  tplPaper: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft },
  note: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft, marginTop: 8, textAlign: 'center' },
});
