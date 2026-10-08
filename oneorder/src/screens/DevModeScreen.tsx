import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import appJson from '../../app.json';
import { parseBackup, buildBackup, buildMenuExport, previewBackup, type BackupFile, type BackupPreview } from '../domain/backup';
import { computeTotals } from '../domain/bill';
import { formatMoney, formatPercent } from '../domain/money';
import { uid } from '../domain/ops';
import { hashPin, makeSalt } from '../domain/sha256';
import type { GstLine, GstSettings, WaiterAccount } from '../domain/types';
import { useStore } from '../store/store';
import { syncNow, useSyncStatus } from '../sync/engine';
import { rasterizeLogo, rasterizeQr } from '../printing/assets';
import { rasterAssetToBmpDataUri } from '../printing/raster';
import { pickLogo, pickTextFile, shareJson } from '../util/files';
import { hasOverlayPermission, isBubbleSupported, requestOverlayPermission } from '../../modules/bubble';
import { runUpdateCheck, useUpdateState } from '../update/state';
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
        <View>
          <Text style={styles.title}>Dev Mode</Text>
          <Text style={styles.version}>ONE-ORDER v{appJson.expo.version}</Text>
        </View>
        <Btn small label="Lock" icon="lock" variant="secondary" onPress={lock} />
      </View>
      <UpdateSetup />
      <BillSetup />
      <GstSetup />
      <TableModeSetup />
      <CombinedBillSetup />
      <WaiterModeSetup />
      <NotificationSetup />
      <BubbleStatus />
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

function UpdateSetup() {
  const st = useUpdateState();
  return (
    <Card style={styles.section}>
      <SectionTitle>Updates</SectionTitle>
      {st.error ? (
        <Text style={styles.hint}>{st.error}</Text>
      ) : st.available && st.manifest ? (
        <Text style={styles.hint}>Version {st.manifest.version} is available.</Text>
      ) : st.lastCheckedAt ? (
        <Text style={styles.hint}>You're on the latest version.</Text>
      ) : (
        <Text style={styles.hint}>Not checked yet this session.</Text>
      )}
      <View style={styles.btnRow}>
        <Btn
          small
          label={st.checking ? 'Checking...' : 'Check for update'}
          icon="refresh-cw"
          variant="secondary"
          disabled={st.checking}
          onPress={() => runUpdateCheck()}
        />
        {st.available && st.manifest ? (
          <Btn small label="Update now" icon="download" onPress={() => Linking.openURL(st.manifest!.apkUrl)} />
        ) : null}
      </View>
    </Card>
  );
}

function BubbleStatus() {
  const [, force] = useState(0);

  useEffect(() => {
    // Granting the permission means leaving the app for the system Settings screen and coming
    // back - re-check the moment that happens so this card reflects the real state immediately.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') force((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  if (!isBubbleSupported()) return null;
  const granted = hasOverlayPermission();
  return (
    <Card style={styles.section}>
      <SectionTitle>Floating bubble</SectionTitle>
      {granted ? (
        <Text style={styles.hint}>Permission granted.</Text>
      ) : (
        <Btn small label="Grant permission" icon="external-link" variant="secondary" onPress={requestOverlayPermission} />
      )}
    </Card>
  );
}

function BillSetup() {
  const bill = useStore((s) => s.data.settings.main.bill);
  const setBill = useStore((s) => s.setBill);
  const [form, setForm] = useState(bill);
  const [dirty, setDirty] = useState(false);
  const [qrText, setQrText] = useState(bill.qrText);
  const [busy, setBusy] = useState(false);

  function edit(patch: Partial<typeof bill>) {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  }

  async function chooseLogo() {
    if (busy) return;
    setBusy(true);
    try {
      const uri = await pickLogo();
      if (!uri) return;
      const logoRaster = await rasterizeLogo(uri);
      // Commits straight to the store (like the QR code does) instead of only updating local
      // form state - so the bill template preview picks up the new logo immediately, with no
      // separate "Save bill setup" step required first.
      edit({ logoUri: uri, logoRaster });
      setBill({ logoUri: uri, logoRaster });
      toast('Logo updated.', 'success');
    } catch (e: any) {
      // decodePng()'s own error messages are already specific and actionable (wrong file type,
      // unsupported bit depth, etc.) - no need to pad them with a generic suffix on top.
      toast(`Logo not saved: ${e?.message ?? e}`, 'error', 6000);
    } finally {
      setBusy(false);
    }
  }

  function removeLogo() {
    edit({ logoUri: '', logoRaster: null });
    setBill({ logoUri: '', logoRaster: null });
  }

  function saveQr() {
    const text = qrText.trim();
    const qrRaster = text ? rasterizeQr(text) : null;
    setBill({ qrText: text, qrRaster });
    toast(text ? 'QR code saved.' : 'QR code removed.', 'success');
  }

  return (
    <Card style={styles.section}>
      <SectionTitle>Bill setup</SectionTitle>
      <Text style={styles.hint}>Applied automatically to every Cook Bill and Customer Bill.</Text>
      <Field label="Cafe name" value={form.name} onChangeText={(t) => edit({ name: t })} maxLength={40} />
      <Field label="Address" value={form.address} onChangeText={(t) => edit({ address: t })} multiline maxLength={120} />
      <Field label="Phone" value={form.phone} onChangeText={(t) => edit({ phone: t })} keyboardType="phone-pad" maxLength={20} />
      <Field label="Footer / thank-you text" value={form.footer} onChangeText={(t) => edit({ footer: t })} maxLength={80} />
      <Field
        label="FSSAI number (optional)"
        value={form.fssaiNumber}
        onChangeText={(t) => edit({ fssaiNumber: t })}
        maxLength={20}
        placeholder="Leave blank to not print it"
      />
      <View style={styles.logoRow}>
        {form.logoRaster ? (
          <Image source={{ uri: rasterAssetToBmpDataUri(form.logoRaster) }} style={styles.logo} resizeMode="contain" />
        ) : (
          <View style={[styles.logo, styles.logoEmpty]}>
            <Icon name="image" size={22} color={colors.textSoft} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Logo</Text>
          <Text style={styles.hint}>
            PNG only (not JPEG/HEIC/WebP) - most "Save/Export Image" flows offer a PNG option even for a photo. Any
            size works, it's scaled down automatically. Prints at the top of every bill, shown here exactly as it
            will print.
          </Text>
        </View>
        <Btn small label={form.logoRaster ? 'Change' : 'Choose'} icon="upload" variant="secondary" onPress={chooseLogo} disabled={busy} />
        {form.logoRaster ? <Btn small icon="trash-2" variant="secondary" onPress={removeLogo} disabled={busy} /> : null}
      </View>
      <Btn
        label="Save bill setup"
        icon="check"
        disabled={!dirty || busy}
        onPress={() => {
          setBill({
            name: form.name.trim() || 'ONE-ORDER',
            address: form.address.trim(),
            phone: form.phone.trim(),
            footer: form.footer.trim(),
            fssaiNumber: form.fssaiNumber.trim(),
            logoUri: form.logoUri,
            logoRaster: form.logoRaster,
          });
          setDirty(false);
          toast('Bill setup saved.', 'success');
        }}
        style={{ marginBottom: 16 }}
      />

      <Text style={styles.sub}>QR code</Text>
      <Text style={styles.hint}>A Google Review link, or any other URL. Printed at a size that actually scans on thermal paper.</Text>
      <Field label="QR link" value={qrText} onChangeText={setQrText} placeholder="https://g.page/r/..." autoCapitalize="none" />
      {bill.qrRaster ? <Image source={{ uri: rasterAssetToBmpDataUri(bill.qrRaster) }} style={styles.qrPreview} resizeMode="contain" /> : null}
      <Btn small label="Save QR code" icon="check" onPress={saveQr} disabled={qrText.trim() === bill.qrText.trim()} style={{ marginBottom: 16 }} />

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Show occasion greetings on bill</Text>
          <Text style={styles.hint}>If the customer has a Birthday or Anniversary set in Users, print a line for it near the footer.</Text>
        </View>
        <Switch
          value={bill.showOccasionGreeting}
          onValueChange={(v) => setBill({ showOccasionGreeting: v })}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Occasion greeting toggle"
        />
      </View>
    </Card>
  );
}

function GstSetup() {
  const gst = useStore((s) => s.data.settings.main.gst);
  const setGst = useStore((s) => s.setGst);
  const [lines, setLines] = useState<GstLine[]>(gst.lines.length ? gst.lines : [{ type: 'GST', percent: '' }]);
  const [number, setNumber] = useState(gst.number);
  const [dirty, setDirty] = useState(false);

  const sample = useMemo(() => {
    const draftGst: GstSettings = { enabled: gst.enabled, lines, number };
    return computeTotals(
      [{ id: 'x', itemId: 'x', name: 'x', categoryId: 'x', unitPrice: 100, qty: 1, note: '', round: null }],
      draftGst,
    );
  }, [gst.enabled, lines, number]);

  function updateLine(i: number, patch: Partial<GstLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
    setDirty(true);
  }
  function addLine() {
    setLines((ls) => [...ls, { type: '', percent: '' }]);
    setDirty(true);
  }
  function removeLine(i: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
    setDirty(true);
  }
  function save() {
    const cleaned = lines.filter((l) => l.type.trim() || l.percent.trim());
    const toSave = cleaned.length ? cleaned : [{ type: 'GST', percent: '' }];
    setGst({ lines: toSave, number: number.trim() });
    setLines(toSave);
    setDirty(false);
    toast('GST saved.', 'success');
  }

  return (
    <Card style={styles.section}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>GST</SectionTitle>
          <Text style={styles.hint}>
            Off: bills show a clean total with no GST. On: every line below (e.g. SGST, CGST) prints as its own row
            above the total.
          </Text>
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
        {lines.map((l, i) => (
          <View key={i} style={styles.gstRow}>
            <View style={{ flex: 1 }}>
              <Field label="Type" value={l.type} onChangeText={(t) => updateLine(i, { type: t })} placeholder="SGST" editable={gst.enabled} />
            </View>
            <View style={{ width: 90 }}>
              <Field
                label="%"
                value={l.percent}
                onChangeText={(t) => updateLine(i, { percent: t })}
                placeholder="2.5"
                keyboardType="decimal-pad"
                maxLength={6}
                editable={gst.enabled}
              />
            </View>
            <Pressable
              onPress={() => removeLine(i)}
              style={styles.gstRemove}
              accessibilityLabel={`Remove ${l.type || 'GST'} line`}
              disabled={!gst.enabled || lines.length <= 1}
            >
              <Icon name="x" size={18} color={lines.length > 1 ? colors.red : colors.border} />
            </Pressable>
          </View>
        ))}
        <Btn small label="Add line" icon="plus" variant="secondary" onPress={addLine} disabled={!gst.enabled} style={{ alignSelf: 'flex-start', marginBottom: 16 }} />
        <Field
          label="GST registration number / label"
          value={number}
          onChangeText={(t) => {
            setNumber(t);
            setDirty(true);
          }}
          autoCapitalize="characters"
          maxLength={30}
          editable={gst.enabled}
        />
        <Btn small label="Save GST details" icon="check" disabled={!gst.enabled || !dirty} onPress={save} />
      </View>
      <View style={styles.preview}>
        <Text style={styles.label}>Bill preview (Rs 100 order)</Text>
        {gst.enabled ? (
          <>
            <PreviewRow a="Subtotal" b={formatMoney(sample.subtotal)} />
            {sample.gstLines.map((gl, i) => (
              <PreviewRow key={i} a={`${gl.type} (${formatPercent(gl.percent)}%)`} b={formatMoney(gl.amount)} />
            ))}
          </>
        ) : null}
        <PreviewRow a="TOTAL" b={formatMoney(sample.total)} bold />
        {!gst.enabled ? <Text style={styles.hint}>Turn GST on to see the tax lines - your saved rates are remembered.</Text> : null}
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

function CombinedBillSetup() {
  const combined = useStore((s) => s.data.settings.main.combinedBillPrint);
  const setCombinedBillPrint = useStore((s) => s.setCombinedBillPrint);
  return (
    <Card style={styles.section}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>Combined Cook + Customer Bill</SectionTitle>
          <Text style={styles.hint}>
            For counter-service: the Order tab shows one "Print Bill" button instead of two. One tap sends and
            prints the Cook Bill, prints the Customer Bill, records payment as Cash, and closes/releases the order -
            with no further steps. Table selection is skipped too, the same way it is when Table Mode is off.
            Nothing about either bill's layout changes.
          </Text>
        </View>
        <Switch
          value={combined}
          onValueChange={(v) => {
            setCombinedBillPrint(v);
            toast(v ? 'Combined bill printing ON.' : 'Combined bill printing OFF.', 'success');
          }}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Combined bill toggle"
        />
      </View>
    </Card>
  );
}

function WaiterModeSetup() {
  const waiter = useStore((s) => s.data.settings.main.waiter);
  const setWaiterSettings = useStore((s) => s.setWaiterSettings);
  const [addOpen, setAddOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [canPrint, setCanPrint] = useState(true);
  const [removing, setRemoving] = useState<WaiterAccount | null>(null);

  useEffect(() => {
    if (addOpen) {
      setUsername('');
      setPassword('');
      setCanPrint(true);
    }
  }, [addOpen]);

  function addWaiter() {
    const name = username.trim();
    if (!name || !password) {
      toast('Enter a username and password.', 'error');
      return;
    }
    if (waiter.accounts.some((a) => a.username.toLowerCase() === name.toLowerCase())) {
      toast('A waiter with this username already exists.', 'error');
      return;
    }
    const salt = makeSalt();
    const acct: WaiterAccount = {
      id: uid('wtr'),
      username: name,
      passwordHash: hashPin(password, salt),
      passwordSalt: salt,
      canPrintCustomerBill: canPrint,
      active: true,
    };
    setWaiterSettings({ accounts: [...waiter.accounts, acct] });
    setUsername('');
    setPassword('');
    setCanPrint(true);
    setAddOpen(false);
    toast(`${name} added.`, 'success');
  }

  function updateAccount(id: string, patch: Partial<WaiterAccount>) {
    setWaiterSettings({ accounts: waiter.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }

  return (
    <Card style={styles.section}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <SectionTitle>Waiter Mode</SectionTitle>
          <Text style={styles.hint}>
            Lets waiters log into a phone/tablet with their own account to take dine-in orders and track their own
            tickets. Each waiter gets their own username and password; only orders they open show up for them.
          </Text>
        </View>
        <Switch
          value={waiter.enabled}
          onValueChange={(v) => setWaiterSettings({ enabled: v })}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Waiter Mode toggle"
        />
      </View>
      {waiter.enabled ? (
        <View>
          {waiter.accounts.length === 0 ? <Text style={styles.hint}>No waiter accounts yet.</Text> : null}
          {waiter.accounts.map((a) => (
            <View key={a.id} style={styles.waiterRow}>
              <View style={{ flex: 1, minWidth: 100 }}>
                <Text style={styles.label}>{a.username}</Text>
                <Text style={styles.hint}>{a.active ? 'Active' : 'Disabled'}</Text>
              </View>
              <View style={styles.waiterToggle}>
                <Text style={styles.hint}>Print Bill</Text>
                <Switch
                  value={a.canPrintCustomerBill}
                  onValueChange={(v) => updateAccount(a.id, { canPrintCustomerBill: v })}
                  trackColor={{ true: colors.primary }}
                  accessibilityLabel={`${a.username} can print Customer Bill`}
                />
              </View>
              <View style={styles.waiterToggle}>
                <Text style={styles.hint}>Active</Text>
                <Switch
                  value={a.active}
                  onValueChange={(v) => updateAccount(a.id, { active: v })}
                  trackColor={{ true: colors.primary }}
                  accessibilityLabel={`${a.username} account active`}
                />
              </View>
              <Pressable onPress={() => setRemoving(a)} accessibilityLabel={`Remove ${a.username}`} style={styles.waiterRemove} hitSlop={8}>
                <Icon name="trash-2" size={18} color={colors.red} />
              </Pressable>
            </View>
          ))}
          <Btn small label="+ Add waiter" icon="plus" variant="secondary" onPress={() => setAddOpen(true)} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        </View>
      ) : null}
      <Modal visible={addOpen} onClose={() => setAddOpen(false)} title="Add waiter" width={400}>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" maxLength={24} />
        <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" maxLength={40} />
        <View style={[styles.switchRow, { marginBottom: 16 }]}>
          <Text style={[styles.label, { flex: 1 }]}>Can print Customer Bill</Text>
          <Switch value={canPrint} onValueChange={setCanPrint} trackColor={{ true: colors.primary }} accessibilityLabel="New waiter can print Customer Bill" />
        </View>
        <Btn label="Add waiter" icon="check" full onPress={addWaiter} />
      </Modal>
      <Confirm
        visible={!!removing}
        title="Remove this waiter?"
        message={`${removing?.username ?? ''}'s account will be removed. Orders they already placed keep their history, but they'll no longer be able to log in.`}
        confirmLabel="Remove"
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) setWaiterSettings({ accounts: waiter.accounts.filter((a) => a.id !== removing.id) });
          setRemoving(null);
        }}
      />
    </Card>
  );
}

function NotificationSetup() {
  const notif = useStore((s) => s.data.settings.main.notifications);
  const setNotificationSettings = useStore((s) => s.setNotificationSettings);
  const [repeatText, setRepeatText] = useState(String(notif.repeatSeconds));

  return (
    <Card style={styles.section}>
      <SectionTitle>Waiter notifications</SectionTitle>
      <Text style={styles.hint}>Alerts a waiter with a sound and/or vibration the moment the kitchen marks their order ready.</Text>
      <View style={styles.switchRow}>
        <Text style={[styles.label, { flex: 1 }]}>Sound</Text>
        <Switch
          value={notif.soundEnabled}
          onValueChange={(v) => setNotificationSettings({ soundEnabled: v })}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Notification sound toggle"
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={[styles.label, { flex: 1 }]}>Vibration</Text>
        <Switch
          value={notif.vibrationEnabled}
          onValueChange={(v) => setNotificationSettings({ vibrationEnabled: v })}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Notification vibration toggle"
        />
      </View>
      <Field
        label="Repeat every N seconds until served (0 = alert once)"
        value={repeatText}
        onChangeText={setRepeatText}
        keyboardType="number-pad"
        maxLength={3}
        onBlur={() => {
          const n = Math.max(0, Math.min(300, Number(repeatText) || 0));
          setRepeatText(String(n));
          setNotificationSettings({ repeatSeconds: n });
        }}
      />
    </Card>
  );
}

function DataTools() {
  const data = useStore((s) => s.data);
  const importMenuText = useStore((s) => s.importMenuText);
  const restoreBackup = useStore((s) => s.restoreBackup);
  const mergeBackupIn = useStore((s) => s.mergeBackupIn);
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
        One JSON file with the menu, tables, customers, full sales history and bill setup. The PIN is never included.
        Restoring shows a preview first, then asks whether to Replace (swap in the backup's data entirely) or Merge
        (add anything from the backup that isn't already here, without touching or deleting what's already in the
        system).
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
              <Text style={styles.err}>{pending.preview.openSessionsLost} currently open order(s) will be replaced if you choose Replace.</Text>
            ) : null}
            <Text style={styles.hint}>
              Merge only adds items, tables, orders and users that aren't already here - nothing existing is ever
              changed or removed. Replace swaps everything in the backup for what's currently here.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <Btn label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setPending(null)} />
              <Btn
                label="Merge"
                icon="git-merge"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => {
                  try {
                    mergeBackupIn(pending.backup);
                    toast('Backup merged in.', 'success');
                  } catch (e: any) {
                    toast(`Merge failed: ${e?.message ?? e} The current data was kept.`, 'error', 6000);
                  }
                  setPending(null);
                }}
              />
              <Btn label="Replace" icon="rotate-ccw" style={{ flex: 1 }} onPress={() => setConfirm(true)} />
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
            try {
              restoreBackup(pending.backup);
              toast('Backup restored.', 'success');
            } catch (e: any) {
              toast(`Restore failed: ${e?.message ?? e} The current data was kept.`, 'error', 6000);
            }
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
  version: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginTop: -4 },
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
  qrPreview: { width: 110, height: 110, marginBottom: 10, borderRadius: 8, backgroundColor: '#fff' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { marginTop: 14, padding: 12, backgroundColor: colors.bg, borderRadius: 10 },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  pText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  gstRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  gstRemove: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  waiterRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.muted },
  waiterToggle: { alignItems: 'center', gap: 2 },
  waiterRemove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
