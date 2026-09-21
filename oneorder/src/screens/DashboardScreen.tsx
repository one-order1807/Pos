import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  buildDashboard,
  DRILLDOWN_DAYS,
  hourLabel,
  recentOrders,
  type OrderRow,
  type RangeKey,
  type Tier,
} from '../domain/analytics';
import { consolidateLines } from '../domain/bill';
import { formatDuration, formatMoney, formatPercent } from '../domain/money';
import { activeSessionForTable, tableStatus, visibleTables } from '../domain/ops';
import { PAY_LABEL } from '../printing/actions';
import { useStore } from '../store/store';
import { Chip, Dot, EmptyState, FadeIn, Icon, Modal, useNow, type IconName } from '../ui/components';
import { blue, chartColors, colors, fonts, shadow } from '../ui/theme';
import { STATUS_TEXT, statusColor } from './TablePicker';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];
const TIER_COLOR: Record<Tier, string> = { Gold: '#D97706', Silver: '#64748B', Regular: colors.primary };

function fmtTime(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h < 12 ? 'AM' : 'PM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m} ${suffix}`;
}

function dayHeading(ms: number, now: number): string {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function DashboardScreen() {
  const data = useStore((s) => s.data);
  const now = useNow(30000);
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<RangeKey>('today');
  const [hours12, setHours12] = useState(false);
  const [drill, setDrill] = useState<null | 'orders' | 'sales'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const d = useMemo(() => buildDashboard(data, range, now), [data, range, now]);
  const wide = width >= 900;
  const tableMode = data.settings.main.tableMode;
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;
  const cardW = wide ? '32%' : '100%';

  const tables = visibleTables(data);
  const live = tables.map((t) => ({ t, status: tableStatus(data, t.id), s: activeSessionForTable(data, t.id) }));
  const liveCounts = { available: 0, occupied: 0, cooking: 0, payment: 0 };
  live.forEach((l) => (liveCounts[l.status] += 1));

  const typeRows = [
    { label: 'Dine-in', v: d.typeSplit['dine-in'], color: chartColors[0] },
    { label: 'Takeaway', v: d.typeSplit.takeaway, color: chartColors[1] },
    { label: 'Delivery', v: d.typeSplit.delivery, color: chartColors[2] },
  ];
  const payRows = [
    { label: 'Cash', v: d.paySplit.cash, color: chartColors[1] },
    { label: 'UPI', v: d.paySplit.upi, color: chartColors[0] },
    { label: 'Card', v: d.paySplit.card, color: chartColors[3] },
  ];
  const maxQty = Math.max(1, ...d.bestSelling.map((b) => b.qty));
  const maxHour = Math.max(1, ...d.peakHours);
  const firstHour = d.peakHours.findIndex((n) => n > 0);
  const lastHour = d.peakHours.length - 1 - [...d.peakHours].reverse().findIndex((n) => n > 0);
  const hours = firstHour === -1 ? [] : d.peakHours.map((n, h) => ({ n, h })).slice(firstHour, lastHour + 1);
  const peak = hours.length ? hours.reduce((a, b) => (b.n > a.n ? b : a)) : null;

  const headline = d.orders
    ? `${rangeLabel}: ${formatMoney(d.sales)} from ${d.orders} order${d.orders === 1 ? '' : 's'}` +
      (d.bestSelling[0] ? ` · top item ${d.bestSelling[0].name} (${d.bestSelling[0].qty})` : '') +
      (peak ? ` · busiest ${hourLabel(peak.h, true)}` : '')
    : `${rangeLabel}: no paid orders yet.`;

  const drillRows = useMemo(
    () => (drill ? recentOrders(data, now, drill === 'sales' && range === 'today') : []),
    [drill, data, now, range],
  );

  return (
    <View style={styles.root}>
      <View style={styles.backdrop} pointerEvents="none">
        <View style={[styles.blob, { top: -60, left: -40, backgroundColor: blue.mid500 }]} />
        <View style={[styles.blob, { top: 140, right: -70, backgroundColor: colors.coral }]} />
        <View style={[styles.blob, { top: 420, left: -60, backgroundColor: colors.teal }]} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <View style={styles.head}>
        <Text style={styles.title}>Dashboard</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {RANGES.map((r) => (
            <Chip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />
          ))}
        </ScrollView>
      </View>
      <View style={styles.headline}>
        <Icon name="zap" size={16} color={colors.primaryDark} />
        <Text style={styles.headlineText}>{headline}</Text>
      </View>

      <View style={styles.grid}>
        <Kpi
          w={cardW}
          icon="trending-up"
          label={range === 'today' ? "Today's Sales" : `Sales · ${rangeLabel}`}
          value={formatMoney(d.sales)}
          bg={blue.deep700}
          fg="#fff"
          onPress={() => setDrill('sales')}
          hint="Tap for orders"
        />
        <Kpi
          w={cardW}
          icon="shopping-bag"
          label="Total Orders"
          value={String(d.orders)}
          bg="#0F766E"
          fg="#fff"
          onPress={() => setDrill('orders')}
          hint="Tap for the list"
        />
        <Kpi
          w={cardW}
          icon="divide-circle"
          label="Average Order Value"
          value={d.orders ? formatMoney(d.avgOrder) : '—'}
          bg="#EA580C"
          fg="#fff"
        />

        <Panel w={cardW} title="Order type" accent={chartColors[0]}>
          <Split rows={typeRows} total={d.orders} />
        </Panel>
        <Panel w={cardW} title="Payment method" accent={chartColors[1]}>
          <Split rows={payRows} total={d.orders} />
        </Panel>
        <Panel w={cardW} title="Category sales" accent={chartColors[3]}>
          {d.categorySales.length === 0 ? (
            <Empty />
          ) : (
            <View style={styles.donutRow}>
              <Donut values={d.categorySales.map((c) => c.sales)} />
              <View style={{ flex: 1, gap: 4 }}>
                {d.categorySales.slice(0, 6).map((c, i) => (
                  <View key={c.categoryId} style={styles.legendRow}>
                    <Dot color={chartColors[i % chartColors.length]} />
                    <Text style={styles.legendName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.legendVal}>{formatMoney(c.sales)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </Panel>

        <Panel w={wide ? '49%' : '100%'} title="Best-selling items" accent={chartColors[2]}>
          {d.bestSelling.length === 0 ? (
            <Empty />
          ) : (
            d.bestSelling.map((b, i) => (
              <View key={b.name} style={{ marginBottom: 8 }}>
                <View style={styles.barLabel}>
                  <Text style={styles.legendName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={styles.legendVal}>
                    {b.qty} sold · {formatMoney(b.sales)}
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(b.qty / maxQty) * 100}%`, backgroundColor: chartColors[i % chartColors.length] }]} />
                </View>
              </View>
            ))
          )}
        </Panel>
        <Panel
          w={wide ? '49%' : '100%'}
          title="Peak hours"
          accent={colors.coral}
          right={
            <View style={{ flexDirection: 'row' }}>
              <Chip label="12h" active={hours12} onPress={() => setHours12(true)} />
              <Chip label="24h" active={!hours12} onPress={() => setHours12(false)} />
            </View>
          }
        >
          {hours.length === 0 ? (
            <Empty />
          ) : (
            <View>
              <View style={styles.hoursRow}>
                {hours.map(({ n, h }) => (
                  <View key={h} style={styles.hourCol}>
                    <Text style={styles.hourN}>{n || ''}</Text>
                    <View style={[styles.hourBar, { height: Math.max(3, (n / maxHour) * 80), backgroundColor: n === maxHour ? colors.coral : colors.primary }]} />
                    <Text style={styles.hourLabel}>{hourLabel(h, hours12)}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.axis}>Orders by hour of day ({hours12 ? '12-hour' : '24-hour'})</Text>
            </View>
          )}
        </Panel>

        <Panel w={wide ? '49%' : '100%'} title="Customers" accent={chartColors[4]}>
          <View style={styles.tierRow}>
            <Stat label="Identified" value={d.customers.identified} />
            <Stat label="Returning" value={d.customers.returning} />
            {(['Gold', 'Silver', 'Regular'] as Tier[]).map((t) => (
              <Stat key={t} label={t} value={d.customers.tiers[t]} color={TIER_COLOR[t]} />
            ))}
          </View>
          <Text style={styles.axis}>Gold: 10+ visits or Rs 5,000+ · Silver: 5+ visits or Rs 2,000+ (all-time, by phone number)</Text>
          <Text style={[styles.cardTitle, { marginTop: 12 }]}>Top 5 customers</Text>
          {d.customers.top.length === 0 ? (
            <Empty text="Add a phone number at payment to build customer history." />
          ) : (
            d.customers.top.map((c, i) => (
              <View key={c.key} style={styles.topRow}>
                <Text style={styles.rank}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendName}>{c.name || c.phone}</Text>
                  <Text style={styles.axis}>
                    {c.name ? `${c.phone} · ` : ''}
                    {c.visits} visit(s)
                  </Text>
                </View>
                <View style={[styles.tierBadge, { backgroundColor: TIER_COLOR[c.tier] }]}>
                  <Text style={styles.tierText}>{c.tier}</Text>
                </View>
                <Text style={styles.legendVal}>{formatMoney(c.spend)}</Text>
              </View>
            ))
          )}
        </Panel>

        {tableMode ? (
          <Panel w={wide ? '49%' : '100%'} title="Live table status" accent={colors.green}>
            {tables.length === 0 ? (
              <Empty text="No tables set up." />
            ) : (
              <>
                <View style={styles.tierRow}>
                  <Stat label="Free" value={liveCounts.available} color={colors.green} />
                  <Stat label="Occupied" value={liveCounts.occupied} color={colors.red} />
                  <Stat label="Cooking" value={liveCounts.cooking} color={colors.coral} />
                  <Stat label="Payment" value={liveCounts.payment} color={colors.amber} />
                </View>
                <View style={styles.liveGrid}>
                  {live.map(({ t, status, s }) => (
                    <View key={t.id} style={styles.liveCell}>
                      <Dot color={statusColor(status)} />
                      <Text style={styles.legendName}>{t.label}</Text>
                      <Text style={styles.axis}>
                        {STATUS_TEXT[status]}
                        {s?.startedAt ? ` · ${formatDuration(now - s.startedAt)}` : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Panel>
        ) : null}
      </View>

      <Modal
        visible={drill !== null}
        onClose={() => setDrill(null)}
        title={drill === 'sales' ? (range === 'today' ? "Today's sales" : 'Recent sales') : 'All orders'}
        width={720}
      >
        <Text style={styles.axis}>
          {drill === 'sales' && range === 'today'
            ? 'Tap an order to see its full detail.'
            : `Showing the last ${DRILLDOWN_DAYS} days of orders. Totals on the dashboard are not limited to this window.`}
        </Text>
        <DrillList rows={drillRows} now={now} cards={drill === 'sales'} onOpen={setDetailId} />
      </Modal>
      <OrderDetail id={detailId} onClose={() => setDetailId(null)} />
      </ScrollView>
    </View>
  );
}

function DrillList({ rows, now, cards, onOpen }: { rows: OrderRow[]; now: number; cards: boolean; onOpen: (id: string) => void }) {
  if (rows.length === 0) return <EmptyState icon="inbox" text="No paid orders in this window yet." />;
  const groups: { heading: string; rows: OrderRow[] }[] = [];
  for (const r of rows) {
    const h = dayHeading(r.paidAt, now);
    const last = groups[groups.length - 1];
    if (last && last.heading === h) last.rows.push(r);
    else groups.push({ heading: h, rows: [r] });
  }
  return (
    <ScrollView style={{ maxHeight: 460, marginTop: 8 }} nestedScrollEnabled>
      {groups.map((g) => (
        <View key={g.heading} style={{ marginBottom: 10 }}>
          <Text style={styles.dayHead}>{g.heading}</Text>
          {cards ? (
            <View style={styles.cardGrid}>
              {g.rows.map((r) => (
                <Pressable key={r.id} style={styles.orderCard} onPress={() => onOpen(r.id)} accessibilityRole="button" accessibilityLabel={`Order ${r.orderNo}`}>
                  <Text style={styles.ocNo}>#{r.orderNo}</Text>
                  <Text style={styles.ocTime}>{fmtTime(r.paidAt)}</Text>
                  <Text style={styles.ocPrice}>{formatMoney(r.total)}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            g.rows.map((r) => (
              <Pressable key={r.id} style={styles.orderRow} onPress={() => onOpen(r.id)} accessibilityRole="button" accessibilityLabel={`Order ${r.orderNo}`}>
                <Text style={styles.orNo}>#{r.orderNo}</Text>
                <Text style={styles.orTime}>{fmtTime(r.paidAt)}</Text>
                <Text style={styles.orLabel} numberOfLines={1}>
                  {r.label}
                  {r.customer ? ` · ${r.customer}` : ''}
                </Text>
                <Text style={styles.orPrice}>{formatMoney(r.total)}</Text>
                <Icon name="chevron-right" size={16} color={colors.textSoft} />
              </Pressable>
            ))
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function OrderDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const s = id ? data.sessions[id] : undefined;
  if (!id || !s || !s.final) return null;
  const lines = consolidateLines(s.lines);
  const label = s.tableId ? data.tables[s.tableId]?.label : undefined;
  return (
    <Modal visible onClose={onClose} title={`Order #${s.orderNo}`} width={480}>
      <Text style={styles.detailMeta}>
        {label ? `${label} · ` : ''}
        {s.type === 'dine-in' ? 'Dine-in' : s.type === 'takeaway' ? 'Takeaway' : 'Delivery'} · {fmtTime(s.paidAt as number)} ·{' '}
        {new Date(s.paidAt as number).toLocaleDateString()}
      </Text>
      {s.customerName || s.customerPhone ? (
        <Text style={styles.detailMeta}>
          Customer: {s.customerName || '—'} {s.customerPhone ? `(${s.customerPhone})` : ''}
        </Text>
      ) : null}
      <View style={styles.detailBox}>
        {lines.map((l) => (
          <View key={l.key} style={styles.detailLine}>
            <Text style={styles.detailQty}>{l.qty}x</Text>
            <Text style={styles.detailName} numberOfLines={2}>
              {l.name}
            </Text>
            <Text style={styles.detailAmt}>{formatMoney(l.amount)}</Text>
          </View>
        ))}
        <View style={styles.detailDivider} />
        {s.final.gstAmount > 0 || s.final.gstPercent > 0 ? (
          <>
            <DetailRow a="Subtotal" b={formatMoney(s.final.subtotal)} />
            <DetailRow a={`GST (${formatPercent(s.final.gstPercent)}%)`} b={formatMoney(s.final.gstAmount)} />
          </>
        ) : null}
        <DetailRow a="TOTAL" b={formatMoney(s.final.total)} big />
      </View>
      <Text style={styles.detailMeta}>Paid by {s.paymentMethod ? PAY_LABEL[s.paymentMethod] : '—'}</Text>
    </Modal>
  );
}

function DetailRow({ a, b, big }: { a: string; b: string; big?: boolean }) {
  return (
    <View style={styles.detailLine}>
      <Text style={[styles.detailName, big && styles.detailBig]}>{a}</Text>
      <Text style={[styles.detailAmt, big && styles.detailBig]}>{b}</Text>
    </View>
  );
}

function Kpi({
  w,
  icon,
  label,
  value,
  bg,
  fg,
  onPress,
  hint,
}: {
  w: `${number}%`;
  icon: IconName;
  label: string;
  value: string;
  bg: string;
  fg: string;
  onPress?: () => void;
  hint?: string;
}) {
  const body = (
    <View style={[styles.kpi, { backgroundColor: bg }]}>
      <View style={styles.kpiTop}>
        <View style={styles.kpiIcon}>
          <Icon name={icon} size={18} color={fg} />
        </View>
        <Text style={[styles.kpiLabel, { color: fg }]}>{label}</Text>
      </View>
      <Text style={[styles.kpiValue, { color: fg }]}>{value}</Text>
      {hint ? (
        <Text style={[styles.kpiHint, { color: fg }]}>
          {hint} ›
        </Text>
      ) : (
        <Text style={[styles.kpiHint, { color: fg }]}> </Text>
      )}
    </View>
  );
  return (
    <FadeIn style={{ width: w }}>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${hint}`}>
          {body}
        </Pressable>
      ) : (
        body
      )}
    </FadeIn>
  );
}

function Panel({
  w,
  title,
  accent,
  right,
  children,
}: {
  w: `${number}%`;
  title: string;
  accent: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <FadeIn style={{ width: w }}>
      <View style={[styles.card, { borderTopColor: accent, borderTopWidth: 4 }]}>
        <View style={styles.panelHead}>
          <Text style={styles.cardTitle}>{title}</Text>
          {right}
        </View>
        {children}
      </View>
    </FadeIn>
  );
}

function Empty({ text = 'No data yet.' }: { text?: string }) {
  return <EmptyState icon="bar-chart-2" text={text} />;
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.axis}>{label}</Text>
    </View>
  );
}

function Split({ rows, total }: { rows: { label: string; v: { orders: number; sales: number }; color: string }[]; total: number }) {
  if (total === 0) return <Empty />;
  return (
    <View>
      <View style={styles.stack}>
        {rows.map((r) =>
          r.v.orders > 0 ? <View key={r.label} style={{ flex: r.v.orders, backgroundColor: r.color }} /> : null,
        )}
      </View>
      {rows.map((r) => (
        <View key={r.label} style={styles.legendRow}>
          <Dot color={r.color} />
          <Text style={styles.legendName}>{r.label}</Text>
          <Text style={styles.legendVal}>
            {r.v.orders} · {formatMoney(r.v.sales)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Donut({ values }: { values: number[] }) {
  const size = 110;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sum = values.reduce((a, b) => a + b, 0) || 1;
  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.muted} strokeWidth={stroke} fill="none" />
      {values.map((v, i) => {
        const len = (v / sum) * c;
        const el = (
          <Circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={chartColors[i % chartColors.length]}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        );
        offset += len;
        return el;
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 6, gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primaryTint,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  headlineText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  backdrop: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  blob: { position: 'absolute', width: 260, height: 260, borderRadius: 130, opacity: 0.1 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    padding: 14,
    ...(shadow as object),
  },
  kpi: { borderRadius: 16, padding: 16, ...(shadow as object) },
  kpiTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kpiIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontFamily: fonts.semibold, fontSize: 14, opacity: 0.95, flex: 1 },
  kpiValue: { fontFamily: fonts.heading, fontSize: 46, marginTop: 6 },
  kpiHint: { fontFamily: fonts.medium, fontSize: 12, opacity: 0.85 },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: fonts.heading, fontSize: 22, color: colors.text, marginBottom: 8 },
  stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: colors.muted, marginBottom: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 },
  legendName: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  legendVal: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3, gap: 8 },
  barTrack: { height: 10, backgroundColor: colors.muted, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5 },
  hoursRow: { flexDirection: 'row', alignItems: 'flex-end', height: 116, gap: 3 },
  hourCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  hourBar: { width: '80%', borderRadius: 3 },
  hourN: { fontFamily: fonts.medium, fontSize: 10, color: colors.textSoft },
  hourLabel: { fontFamily: fonts.medium, fontSize: 10, color: colors.textSoft, marginTop: 2 },
  axis: { fontFamily: fonts.body, fontSize: 11, color: colors.textSoft },
  tierRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 6 },
  stat: { minWidth: 64 },
  statValue: { fontFamily: fonts.heading, fontSize: 30, color: colors.text },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.muted },
  rank: { fontFamily: fonts.heading, fontSize: 22, color: colors.textSoft, width: 22 },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  tierText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 11 },
  liveGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  liveCell: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  dayHead: { fontFamily: fonts.semibold, fontSize: 12, color: colors.textSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  orderCard: {
    width: 150,
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.midSoft,
    backgroundColor: colors.primaryTint,
    padding: 12,
    justifyContent: 'space-between',
  },
  ocNo: { fontFamily: fonts.heading, fontSize: 26, color: colors.primaryDark },
  ocTime: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSoft },
  ocPrice: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.muted,
  },
  orNo: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryDark, width: 52 },
  orTime: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft, width: 76 },
  orLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.text },
  orPrice: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  detailMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.textSoft, marginBottom: 6 },
  detailBox: { backgroundColor: colors.bg, borderRadius: 12, padding: 12, marginVertical: 8 },
  detailLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  detailQty: { fontFamily: fonts.bold, fontSize: 15, color: colors.primaryDark, width: 40 },
  detailName: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  detailAmt: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  detailDivider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  detailBig: { fontFamily: fonts.heading, fontSize: 26 },
});
