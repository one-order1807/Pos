import { consolidateLines } from './bill';
import { dayKey, round2 } from './money';
import type { OrderType, PaymentMethod, Session, State } from './types';

export type RangeKey = 'today' | '7d' | '30d' | 'all';
export type Tier = 'Gold' | 'Silver' | 'Regular';

export const TIER_RULES = {
  gold: { visits: 10, spend: 5000 },
  silver: { visits: 5, spend: 2000 },
};

export function tierFor(visits: number, spend: number): Tier {
  if (visits >= TIER_RULES.gold.visits || spend >= TIER_RULES.gold.spend) return 'Gold';
  if (visits >= TIER_RULES.silver.visits || spend >= TIER_RULES.silver.spend) return 'Silver';
  return 'Regular';
}

export function paidSessions(state: State): Session[] {
  return Object.values(state.sessions).filter((s) => s.status === 'paid' && s.paidAt && s.final);
}

export function rangeStart(range: RangeKey, now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const startOfToday = d.getTime();
  if (range === 'today') return startOfToday;
  if (range === '7d') return startOfToday - 6 * 86400000;
  if (range === '30d') return startOfToday - 29 * 86400000;
  return 0;
}

export interface Dashboard {
  sales: number;
  orders: number;
  avgOrder: number;
  typeSplit: Record<OrderType, { orders: number; sales: number }>;
  paySplit: Record<PaymentMethod, { orders: number; sales: number }>;
  bestSelling: { name: string; qty: number; sales: number }[];
  peakHours: number[];
  categorySales: { categoryId: string; name: string; sales: number }[];
  customers: {
    identified: number;
    returning: number;
    top: { key: string; name: string; phone: string; visits: number; spend: number; tier: Tier }[];
    tiers: Record<Tier, number>;
  };
}

export function buildDashboard(state: State, range: RangeKey, now: number): Dashboard {
  const start = rangeStart(range, now);
  const inRange = paidSessions(state).filter((s) => (s.paidAt as number) >= start);

  const typeSplit: Dashboard['typeSplit'] = {
    'dine-in': { orders: 0, sales: 0 },
    takeaway: { orders: 0, sales: 0 },
    delivery: { orders: 0, sales: 0 },
  };
  const paySplit: Dashboard['paySplit'] = {
    cash: { orders: 0, sales: 0 },
    upi: { orders: 0, sales: 0 },
    card: { orders: 0, sales: 0 },
  };
  const itemMap = new Map<string, { name: string; qty: number; sales: number }>();
  const catMap = new Map<string, number>();
  const peakHours = new Array<number>(24).fill(0);
  let sales = 0;

  for (const s of inRange) {
    const total = s.final!.total;
    sales += total;
    typeSplit[s.type].orders += 1;
    typeSplit[s.type].sales += total;
    if (s.paymentMethod) {
      paySplit[s.paymentMethod].orders += 1;
      paySplit[s.paymentMethod].sales += total;
    }
    peakHours[new Date(s.createdAt).getHours()] += 1;
    for (const l of consolidateLines(s.lines)) {
      const prev = itemMap.get(l.name) ?? { name: l.name, qty: 0, sales: 0 };
      prev.qty += l.qty;
      prev.sales += l.amount;
      itemMap.set(l.name, prev);
    }
    for (const l of s.lines) {
      catMap.set(l.categoryId, (catMap.get(l.categoryId) ?? 0) + l.qty * l.unitPrice);
    }
  }

  // customers use full history (visits/spend accumulate across all time, tiers are lifetime)
  const byPhone = new Map<string, { visits: number; spend: number; name: string }>();
  for (const s of paidSessions(state)) {
    if (!s.customerPhone) continue;
    const prev = byPhone.get(s.customerPhone) ?? { visits: 0, spend: 0, name: '' };
    prev.visits += 1;
    prev.spend += s.final!.total;
    prev.name = s.customerName || state.customers[s.customerPhone]?.name || prev.name;
    byPhone.set(s.customerPhone, prev);
  }
  const custList = Array.from(byPhone.entries()).map(([phone, c]) => ({
    key: phone,
    phone,
    name: c.name,
    visits: c.visits,
    spend: round2(c.spend),
    tier: tierFor(c.visits, c.spend),
  }));
  const tiers: Record<Tier, number> = { Gold: 0, Silver: 0, Regular: 0 };
  custList.forEach((c) => (tiers[c.tier] += 1));

  return {
    sales: round2(sales),
    orders: inRange.length,
    avgOrder: inRange.length ? round2(sales / inRange.length) : 0,
    typeSplit,
    paySplit,
    bestSelling: Array.from(itemMap.values())
      .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
      .slice(0, 5),
    peakHours,
    categorySales: Array.from(catMap.entries())
      .map(([categoryId, s]) => ({
        categoryId,
        name: state.categories[categoryId]?.name ?? 'Other',
        sales: round2(s),
      }))
      .sort((a, b) => b.sales - a.sales),
    customers: {
      identified: custList.length,
      returning: custList.filter((c) => c.visits > 1).length,
      top: custList.sort((a, b) => b.spend - a.spend || b.visits - a.visits).slice(0, 5),
      tiers,
    },
  };
}

export function todayKey(now: number): string {
  return dayKey(now);
}

export const DRILLDOWN_DAYS = 7;

export interface OrderRow {
  id: string;
  orderNo: number;
  label: string;
  paidAt: number;
  total: number;
  typeLabel: string;
  paymentMethod: PaymentMethod | null;
  customer: string;
}

export function drilldownStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - (DRILLDOWN_DAYS - 1) * 86400000;
}

const TYPE_TEXT: Record<OrderType, string> = { 'dine-in': 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };

export function recentOrders(state: State, now: number, onlyToday = false): OrderRow[] {
  const start = onlyToday ? rangeStart('today', now) : drilldownStart(now);
  return paidSessions(state)
    .filter((s) => (s.paidAt as number) >= start)
    .sort((a, b) => (b.paidAt as number) - (a.paidAt as number))
    .map((s) => ({
      id: s.id,
      orderNo: s.orderNo,
      label: s.tableId ? state.tables[s.tableId]?.label ?? TYPE_TEXT[s.type] : TYPE_TEXT[s.type],
      paidAt: s.paidAt as number,
      total: s.final!.total,
      typeLabel: TYPE_TEXT[s.type],
      paymentMethod: s.paymentMethod,
      customer: s.customerName || s.customerPhone,
    }));
}

export function hourLabel(h: number, hours12: boolean): string {
  if (!hours12) return String(h);
  const suffix = h < 12 ? 'a' : 'p';
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base}${suffix}`;
}
