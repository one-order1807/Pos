import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Print from 'expo-print';
import { SvgXml } from 'react-native-svg';
import { regenerateTableQr, syncMenuToBackend, syncTablesToBackend, type QrTableResult } from '../backend/qrApi';
import { useStore } from '../store/store';
import { Btn, Card, Confirm, Icon, Modal, SectionTitle, toast } from '../ui/components';
import { colors, fonts } from '../ui/theme';
import { shareFileAt } from '../util/files';
import { qrSvgMarkup } from '../util/qrSvg';

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** The Dev Mode card + "Manage QR codes" button - the modal itself only mounts (and only then
 * fetches/generates anything) once opened. */
export function QrManagementSection() {
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.section}>
      <SectionTitle>QR Code Management</SectionTitle>
      <Text style={styles.hint}>
        Generates a unique ordering QR code and link for every table in the Tables section. A customer scans it to
        order from their own phone - the order lands directly in Kitchen and the Dashboard, tagged to that exact
        table.
      </Text>
      <Btn small label="Manage QR codes" icon="grid" onPress={() => setOpen(true)} />
      {open ? <QrManagementModal visible={open} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

function QrManagementModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tables = useStore((s) => s.data.tables);
  const categories = useStore((s) => s.data.categories);
  const items = useStore((s) => s.data.items);

  const [rows, setRows] = useState<QrTableResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [regenTarget, setRegenTarget] = useState<QrTableResult | null>(null);

  // Snapshotted once per load() call, not read live during it - see load()'s own comment.
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const tableList = Object.values(tables).map((t) => ({ id: t.id, label: t.label }));
    const catList = Object.values(categories).map((c) => ({ id: c.id, name: c.name, sort: c.sort }));
    const itemList = Object.values(items);
    // Both calls use the Tables/Menu sections exactly as they are right now - matches the spec's
    // "automatically fetch the total number of tables" requirement with no separate step.
    const [tablesRes] = await Promise.all([syncTablesToBackend(tableList), syncMenuToBackend(catList, itemList)]);
    setLoading(false);
    if (!tablesRes.ok) {
      setError(tablesRes.error);
      return;
    }
    setRows([...tablesRes.data].sort((a, b) => naturalCompare(a.label, b.label)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, categories, items]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  async function copyLink(url: string) {
    await Clipboard.setStringAsync(url);
    toast('Link copied.', 'success');
  }

  async function copyAll() {
    if (!rows || rows.length === 0) return;
    await Clipboard.setStringAsync(rows.map((r) => `${r.label}: ${r.url}`).join('\n'));
    toast('All table links copied.', 'success');
  }

  async function regenerate(row: QrTableResult) {
    const res = await regenerateTableQr(row.table_local_id);
    if (!res.ok) {
      toast(`Could not regenerate: ${res.error}`, 'error', 6000);
      return;
    }
    setRows((prev) => (prev ? prev.map((r) => (r.table_local_id === row.table_local_id ? res.data : r)) : prev));
    toast(`${row.label}'s QR code was regenerated - the old one no longer works.`, 'success', 5000);
  }

  async function downloadPdf() {
    if (!rows || rows.length === 0) return;
    setPdfBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: buildQrPdfHtml(rows) });
      await shareFileAt(uri, 'application/pdf', 'table-qr-codes.pdf');
    } catch (e: any) {
      toast(`Could not create the PDF: ${e?.message ?? e}`, 'error', 6000);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <Modal visible={visible} onClose={onClose} title="QR Code Management" width={640}>
      {loading ? (
        <View style={styles.centerPad}>
          <Text style={styles.hint}>Loading tables and generating QR codes...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerPad}>
          <Text style={styles.err}>{error}</Text>
          <Btn small label="Retry" icon="refresh-cw" variant="secondary" onPress={load} />
        </View>
      ) : !rows || rows.length === 0 ? (
        <View style={styles.centerPad}>
          <Icon name="grid" size={28} color={colors.textSoft} />
          <Text style={styles.hint}>No tables yet. Add tables first (Tables tab -&gt; Arrange), then come back here.</Text>
        </View>
      ) : (
        <View>
          <View style={styles.topBtnRow}>
            <Btn small label="Copy all links" icon="copy" variant="secondary" onPress={copyAll} />
            <Btn small label={pdfBusy ? 'Preparing...' : 'Download PDF'} icon="file-text" onPress={downloadPdf} disabled={pdfBusy} />
            <Btn small label="Refresh" icon="refresh-cw" variant="secondary" onPress={load} />
          </View>
          {rows.map((row) => (
            <View key={row.table_local_id} style={styles.row}>
              <View style={styles.qrBox}>
                <SvgXml xml={qrSvgMarkup(row.url)} width={72} height={72} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Text style={styles.label}>{row.label}</Text>
                <Text style={styles.url} selectable>
                  {row.url}
                </Text>
              </View>
              <View style={styles.rowBtns}>
                <Btn small label="Copy" icon="copy" variant="secondary" onPress={() => copyLink(row.url)} />
                <Btn small label="Regenerate" icon="rotate-ccw" variant="secondary" onPress={() => setRegenTarget(row)} />
              </View>
            </View>
          ))}
        </View>
      )}
      <Confirm
        visible={!!regenTarget}
        title="Regenerate this QR code?"
        message={`${regenTarget?.label ?? ''}'s current QR code and link will stop working immediately. Anyone with the old link, or a table already printed with the old QR code, won't be able to order until you print and place the new one.`}
        confirmLabel="Regenerate"
        danger
        onCancel={() => setRegenTarget(null)}
        onConfirm={() => {
          if (regenTarget) regenerate(regenTarget);
          setRegenTarget(null);
        }}
      />
    </Modal>
  );
}

function buildQrPdfHtml(rows: QrTableResult[]): string {
  const cards = rows
    .map(
      (r) => `
      <div class="card">
        <div class="qr">${qrSvgMarkup(r.url, 10)}</div>
        <div class="label">${escapeHtml(r.label)}</div>
      </div>`,
    )
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 24px; }
  .grid { display: flex; flex-wrap: wrap; gap: 18px; }
  .card { width: 220px; border: 1px solid #ddd; border-radius: 12px; padding: 16px; text-align: center; page-break-inside: avoid; }
  .qr svg { width: 180px; height: 180px; }
  .label { margin-top: 10px; font-size: 18px; font-weight: 700; color: #111111; }
</style>
</head>
<body><div class="grid">${cards}</div></body>
</html>`;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const styles = StyleSheet.create({
  section: { marginBottom: 12 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSoft, marginBottom: 10, lineHeight: 18 },
  err: { fontFamily: fonts.medium, fontSize: 13, color: colors.red, marginBottom: 10, textAlign: 'center' },
  centerPad: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  topBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.muted },
  qrBox: { width: 72, height: 72, backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden' },
  label: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  url: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft, marginTop: 2 },
  rowBtns: { flexDirection: 'row', gap: 6 },
});
