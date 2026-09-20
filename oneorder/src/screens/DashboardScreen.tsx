import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { buildDashboard, type RangeKey, type Tier } from '../domain/analytics';
import { formatDuration, formatMoney } from '../domain/money';
import { activeSessionForTable, tableStatus, visibleTables } from '../domain/ops';
import { useStore } from '../store/store';
import { Chip, EmptyState, FadeIn, Dot, useNow } from '../ui/components';
import { chartColors, colors, fonts, shadow } from '../ui/theme';
import { STATUS_TEXT, statusColor } from './TablePicker';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];
const TIER_COLOR: Record<Tier, string> = { Gold: '#D97706', Silver: '#64748B', Regular: colors.primary };

export function DashboardScreen() {
  const data = useStore((s) => s.data);
  const now = useNow(30000);
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<RangeKey>('today');
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

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      <View style={styles.head}>
        <Text style={styles.title}>Dashboard</Text>
        <View style={{ flexDirection: 'row' }}>
          {RANGES.map((r) => (
            <Chip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />
          ))}
        </View>
      </View>

      <View style={styles.grid}>
        <Kpi w={cardW} label={range === 'today' ? "Today's Sales" : `Sales · ${rangeLabel}`} value={formatMoney(d.sales)} color={colors.primary} />
        <Kpi w={cardW} label="Total Orders" value={String(d.orders)} color={colors.teal} />
        <Kpi w={cardW} label="Average Order Value" value={d.orders ? formatMoney(d.avgOrder) : '—'} color={colors.coral} />

        <Panel w={cardW} title="Order type">
          <Split rows={typeRows} total={d.orders} />
        </Panel>
        <Panel w={cardW} title="Payment method">
          <Split rows={payRows} total={d.orders} />
        </Panel>
        <Panel w={cardW} title="Category sales">
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

        <Panel w={wide ? '49%' : '100%'} title="Best-selling items">
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
        <Panel w={wide ? '49%' : '100%'} title="Peak hours">
          {hours.length === 0 ? (
            <Empty />
          ) : (
            <View>
              <View style={styles.hoursRow}>
                {hours.map(({ n, h }) => (
                  <View key={h} style={styles.hourCol}>
                    <Text style={styles.hourN}>{n || ''}</Text>
                    <View style={[styles.hourBar, { height: Math.max(3, (n / maxHour) * 80), backgroundColor: n === maxHour ? colors.coral : colors.primary }]} />
                    <Text style={styles.hourLabel}>{h}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.axis}>Orders by hour of day (24h)</Text>
            </View>
          )}
        </Panel>

        <Panel w={wide ? '49%' : '100%'} title="Customers">
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
          <Panel w={wide ? '49%' : '100%'} title="Live table status">
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
    </ScrollView>
  );
}

function Kpi({ w, label, value, color }: { w: `${number}%`; label: string; value: string; color: string }) {
  return (
    <FadeIn style={{ width: w }}>
      <View style={[styles.card, { borderTopColor: color, borderTopWidth: 4 }]}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={styles.kpiValue}>{value}</Text>
      </View>
    </FadeIn>
  );
}

function Panel({ w, title, children }: { w: `${number}%`; title: string; children: React.ReactNode }) {
  return (
    <FadeIn style={{ width: w }}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 8, gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 34, color: colors.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, ...(shadow as object) },
  kpiLabel: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
  kpiValue: { fontFamily: fonts.heading, fontSize: 42, color: colors.text, marginTop: 2 },
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
});
