import React, { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { parseBackup, buildBackup, buildMenuExport, previewBackup, type BackupFile, type BackupPreview } from '../domain/backup';
import { computeTotals } from '../domain/bill';
import { formatMoney, formatPercent, parseGstPercent } from '../domain/money';
import { useStore } from '../store/store';
import { syncNow, useSyncStatus } from '../sync/engine';
import { pickLogo, pickTextFile, shareJson } from '../util/files';
import { Btn, Card, Confirm, Field, Icon, Modal, SectionTitle, toast } from '../ui/components';
import { PinGate } from '../ui/PinGate';
import { colors, fonts } from '../ui/theme';
import { PrinterPanel, TemplatePicker } from './PrinterPanel';

export function DevModeScreen() {
  const unlockedUntil = useStore((s) => s.unlockedUntil);
  const lock = useStore((s) => s.lock);
  const [pinOpen, setPinOpen] = useState(false);
  const [, force] = useState(0);
  const unlocked = unlockedUntil > Date.now();

  useEffect(() => {
    if (!unlocked) setPinOpen(true);
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    const id = setTimeout(() => force((n) => n + 1), Math.max(0, unlockedUntil - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [unlocked, unlockedUntil]);

  if (!unlocked) {
    return (
      <View style={styles.locked}>
        <Icon name="lock" size={40} color={colors.primary} />
        <Text style={styles.lockedTitle}>Dev Mode is locked</Text>
        <Text style={styles.lockedSub}>Enter the 6-digit PIN to change billing, printer and data settings.</Text>
        <Btn label="Enter PIN" icon="unlock" onPress={() => setPinOpen(true)} />
        <PinGate
          visible={pinOpen}
          title="Dev Mode PIN"
          onClose={() => setPinOpen(false)}
          onUnlocked={() => {
            setPinOpen(false);
            force((n) => n + 1);
          }}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 12, paddingBottom: 48, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
      <View style={styles.head}>
        <Text style={styles.title}>Dev Mode</Text>
        <Btn small label="Lock" icon="lock" variant="secondary" onPress={lock} />
      </View>
      <BillSetup />
      <GstSetup />
      <TableModeSetup />
      <Card style={styles.section}>
        <SectionTitle>Printer setup</SectionTitle>
        <PrinterPanel />
        <Text style={styles.sub}>Receipt templates</Text>
        <TemplatePicker />
      </Card>
      <DataTools />
      <CloudSync />
    </ScrollView>
  );
}

function BillSetup() {
  const bill = useStore((s) => s.data.settings.main.bill);
  const setBill = useStore((s) => s.setBill);
  const [form, setForm] = useState(bill);
  const [dirty, setDirty] = useState(false);

  function edit(patch: Partial<typeof bill>) {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  }

  async function chooseLogo() {
    try {
      const uri = await pickLogo();
      if (uri) edit({ logoUri: uri });
    } catch (e: any) {
      toast(`Could not load the logo: ${e?.message ?? e}`, 'error');
    }
  }

  return (
    <Card style={styles.section}>
      <SectionTitle>Bill setup</SectionTitle>
      <Text style={styles.hint}>Applied automatically to every Cook Bill and Customer Bill.</Text>
      <Field label="Cafe name" value={form.name} onChangeText={(t) => edit({ name: t })} maxLength={40} />
      <Field label="Address" value={form.address} onChangeText={(t) => edit({ address: t })} multiline maxLength={120} />
      <Field label="Phone" value={form.phone} onChangeText={(t) => edit({ phone: t })} keyboardType="phone-pad" maxLength={20} />
      <Field label="Footer / thank-you text" value={form.footer} onChangeText={(t) => edit({ footer: t })} maxLength={80} />
      <View style={styles.logoRow}>
        {form.logoUri ? <Image source={{ uri: form.logoUri }} style={styles.logo} resizeMode="contain" /> : <View style={[styles.logo, styles.logoEmpty]}><Icon name="image" size={22} color={colors.textSoft} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Logo</Text>
          <Text style={styles.hint}>Shown on the on-screen bill. Thermal receipts print the cafe name as text.</Text>
        </View>
        <Btn small label={form.logoUri ? 'Change' : 'Choose'} icon="upload" variant="secondary" onPress={chooseLogo} />
        {form.logoUri ? <Btn small icon="trash-2" variant="secondary" onPress={() => edit({ logoUri: '' })} /> : null}
      </View>
      <Btn
        label="Save bill setup"
        icon="check"
        disabled={!dirty}
        onPress={() => {
          setBill({
            name: form.name.trim() || 'ONEORDER',
            address: form.address.trim(),
            phone: form.phone.trim(),
            footer: form.footer.trim(),
            logoUri: form.logoUri,
          });
          setDirty(false);
          toast('Bill setup saved.', 'success');
        }}
      />
    </Card>
  );
}

function GstSetup() {
  const gst = useStore((s) => s.data.settings.main.gst);
  const setGst = useStore((s) => s.setGst);
  const [percent, setPercent] = useState(gst.percent);
  const [number, setNumber] = useState(gst.number);

  const sample = useMemo(() => {
    const totals = computeTotals(
      [{ id: 'x', itemId: 'x', name: 'x', categoryId: 'x', unitPrice: 100, qty: 1, note: '', round: null }],
      { enabled: gst.enabled, percent, number },
    );
    return totals;
  }, [gst.enabled, percent, number]);

  const pct = parseGstPercent(percent);
  const invalid = gst.enabled && (percent.trim() === '' || Number.isNaN(Number(percent.replace('%', '').trim())));

  return (
    <Card style={styles.section}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>GST</SectionTitle>
          <Text style={styles.hint}>Off: bills show a clean total with no GST. On: a GST line is added above the total on every bill.</Text>
        </View>
        <Switch
          value={gst.enabled}
          onValueChange={(v) => {
            setGst({ enabled: v });
            toast(v ? 'GST is ON for new bills.' : 'GST is OFF — new bills have no GST.', 'success');
          }}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="GST toggle"
        />
      </View>
      <View style={{ opacity: gst.enabled ? 1 : 0.45 }} pointerEvents={gst.enabled ? 'auto' : 'none'}>
        <Field
          label="GST percentage (type any value, e.g. 1, 5, 18)"
          value={percent}
          onChangeText={setPercent}
          onBlur={() => gst.enabled && !invalid && setGst({ percent: percent.trim() })}
          keyboardType="decimal-pad"
          maxLength={6}
          editable={gst.enabled}
        />
        <Field
          label="GST registration number / label"
          value={number}
          onChangeText={setNumber}
          onBlur={() => setGst({ number: number.trim() })}
          autoCapitalize="characters"
          maxLength={30}
          editable={gst.enabled}
        />
        <Btn
          small
          label="Save GST details"
          icon="check"
          disabled={!gst.enabled || invalid}
          onPress={() => {
            setGst({ percent: percent.trim(), number: number.trim() });
            toast(`GST saved: ${formatPercent(pct)}%.`, 'success');
          }}
        />
        {invalid ? <Text style={styles.err}>Enter a number for the GST percentage.</Text> : null}
      </View>
      <View style={styles.preview}>
        <Text style={styles.label}>Bill preview (Rs 100 order)</Text>
        {gst.enabled ? (
          <>
            <PreviewRow a="Subtotal" b={formatMoney(sample.subtotal)} />
            <PreviewRow a={`GST (${formatPercent(pct)}%)`} b={formatMoney(sample.gstAmount)} />
          </>
        ) : null}
        <PreviewRow a="TOTAL" b={formatMoney(sample.total)} bold />
        {!gst.enabled ? <Text style={styles.hint}>Turn GST on to see the tax line. Your saved percentage ({formatPercent(parseGstPercent(gst.percent))}%) is remembered.</Text> : null}
      </View>
    </Card>
  );
}

function PreviewRow({ a, b, bold }: { a: string; b: string; bold?: boolean }) {
  return (
    <View style={styles.pRow}>
      <Text style={[styles.pText, bold && { fontFamily: fonts.bold }]}>{a}</Text>
      <Text style={[styles.pText, bold && { fontFamily: fonts.bold }]}>{b}</Text>
    </View>
  );
}

function TableModeSetup() {
  const tableMode = useStore((s) => s.data.settings.main.tableMode);
  const setTableMode = useStore((s) => s.setTableMode);
  return (
    <Card style={styles.section}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>Table mode</SectionTitle>
          <Text style={styles.hint}>
            On: Tables tab and table selection for Dine-in. Off: the Tables tab is hidden and the POS runs as Takeaway / Delivery ordering. Your tables are kept, just hidden.
          </Text>
        </View>
        <Switch
          value={tableMode}
          onValueChange={(v) => {
            setTableMode(v);
            toast(v ? 'Table mode ON.' : 'Table mode OFF — Tables tab hidden.', 'success');
          }}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Table mode toggle"
        />
      </View>
    </Card>
  );
}

function DataTools() {
  const data = useStore((s) => s.data);
  const importMenuText = useStore((s) => s.importMenuText);
  const restoreBackup = useStore((s) => s.restoreBackup);
  const [pending, setPending] = useState<{ backup: BackupFile; preview: BackupPreview } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast(e?.message ?? 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.section}>
      <SectionTitle>Menu import / export</SectionTitle>
      <Text style={styles.hint}>Import only adds new items and updates existing ones (matched by ID). It never deletes anything.</Text>
      <View style={styles.btnRow}>
        <Btn small label="Export menu (JSON)" icon="download" variant="secondary" disabled={busy} onPress={() => guard(() => shareJson('oneorder-menu.json', buildMenuExport(data)))} />
        <Btn
          small
          label="Import menu (JSON)"
          icon="upload"
          variant="secondary"
          disabled={busy}
          onPress={() =>
            guard(async () => {
              const f = await pickTextFile();
              if (!f) return;
              const r = importMenuText(f.text);
              if (r.error) toast(r.error, 'error');
              else
                toast(
                  `Menu imported: ${r.addedItems} added, ${r.updatedItems} updated${r.skipped ? `, ${r.skipped} skipped` : ''}.`,
                  'success',
                  5000,
                );
            })
          }
        />
      </View>

      <SectionTitle>Full backup / restore</SectionTitle>
      <Text style={styles.hint}>
        One JSON file with the menu, tables, customers, full sales history and bill setup. The PIN is never included. Restoring shows a preview first and replaces the current data.
      </Text>
      <View style={styles.btnRow}>
        <Btn small label="Export full backup" icon="download" disabled={busy} onPress={() => guard(() => shareJson(`oneorder-backup-${new Date().toISOString().slice(0, 10)}.json`, buildBackup(data, Date.now())))} />
        <Btn
          small
          label="Restore from file"
          icon="rotate-ccw"
          variant="secondary"
          disabled={busy}
          onPress={() =>
            guard(async () => {
              const f = await pickTextFile();
              if (!f) return;
              const r = parseBackup(f.text);
              if (!r.backup) {
                toast(r.error ?? 'Invalid backup.', 'error');
                return;
              }
              setPending({ backup: r.backup, preview: previewBackup(r.backup, data) });
            })
          }
        />
      </View>

      <Modal visible={!!pending && !confirm} onClose={() => setPending(null)} title="Restore preview" width={480}>
        {pending ? (
          <View>
            <Text style={styles.hint}>Backup made {new Date(pending.preview.exportedAt).toLocaleString()}</Text>
            <PreviewRow a="Menu categories" b={String(pending.preview.categories)} />
            <PreviewRow a="Menu items" b={String(pending.preview.items)} />
            <PreviewRow a="Tables" b={String(pending.preview.tables)} />
            <PreviewRow a="Orders (all)" b={String(pending.preview.sessions)} />
            <PreviewRow a="Paid orders (sales history)" b={String(pending.preview.paidSessions)} />
            <PreviewRow a="Users (customer directory)" b={String(pending.preview.customers)} />
            <PreviewRow a="Bill setup / GST / printer settings" b={pending.preview.hasSettings ? 'Included' : 'Not included'} />
            {pending.preview.openSessionsLost > 0 ? (
              <Text style={styles.err}>{pending.preview.openSessionsLost} currently open order(s) will be replaced.</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Btn label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPending(null)} />
              <Btn label="Restore" icon="rotate-ccw" style={{ flex: 1 }} onPress={() => setConfirm(true)} />
            </View>
          </View>
        ) : null}
      </Modal>
      <Confirm
        visible={confirm}
        title="Replace current data?"
        message="This replaces your menu, tables, orders and customers with the backup. Export a backup of the current data first if unsure."
        confirmLabel="Replace"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          if (pending) {
            restoreBackup(pending.backup);
            toast('Backup restored.', 'success');
          }
          setConfirm(false);
          setPending(null);
        }}
      />
    </Card>
  );
}

function CloudSync() {
  const st = useSyncStatus();
  return (
    <Card style={styles.section}>
      <SectionTitle>Cloud backup (Firebase)</SectionTitle>
      <Text style={styles.hint}>
        Data is always saved on this tablet first. When Firebase is configured and the tablet is online, changes are copied to Firestore.
      </Text>
      <PreviewRow a="Status" b={st.label} />
      <PreviewRow a="Waiting to upload" b={String(st.pending)} />
      {st.lastError ? <Text style={styles.err}>{st.lastError}</Text> : null}
      <Btn small label="Sync now" icon="refresh-cw" variant="secondary" onPress={() => syncNow()} disabled={!st.configured || st.syncing} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text },
  section: { marginBottom: 12 },
  locked: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg },
  lockedTitle: { fontFamily: fonts.heading, fontSize: 30, color: colors.text },
  lockedSub: { fontFamily: fonts.body, fontSize: 14, color: colors.textSoft, textAlign: 'center', maxWidth: 360 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginBottom: 10, lineHeight: 18 },
  err: { fontFamily: fonts.medium, fontSize: 12, color: colors.red, marginTop: 6 },
  label: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, marginBottom: 4 },
  sub: { fontFamily: fonts.heading, fontSize: 22, color: colors.text, marginTop: 14, marginBottom: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  logo: { width: 56, height: 56, borderRadius: 10 },
  logoEmpty: { backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { marginTop: 14, padding: 12, backgroundColor: colors.bg, borderRadius: 10 },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  pText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
});
