import { parseGstPercent, round2 } from './money';
import type { FinalTotals, GstSettings, OrderLine, Session, TicketItem } from './types';

export interface BillLine {
  key: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface BillTotals extends FinalTotals {
  gstEnabled: boolean;
}

export function consolidateLines(lines: OrderLine[]): BillLine[] {
  const map = new Map<string, BillLine>();
  for (const l of lines) {
    const key = `${l.itemId}@${l.unitPrice}`;
    const existing = map.get(key);
    if (existing) {
      existing.qty += l.qty;
      existing.amount = round2(existing.qty * existing.unitPrice);
    } else {
      map.set(key, {
        key,
        name: l.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        amount: round2(l.qty * l.unitPrice),
      });
    }
  }
  return Array.from(map.values());
}

export function computeTotals(lines: OrderLine[], gst: GstSettings): BillTotals {
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const pct = gst.enabled ? parseGstPercent(gst.percent) : 0;
  const gstAmount = gst.enabled ? round2((subtotal * pct) / 100) : 0;
  return {
    subtotal,
    gstPercent: pct,
    gstAmount,
    total: round2(subtotal + gstAmount),
    gstEnabled: gst.enabled,
  };
}

export function sessionTotals(session: Session, gst: GstSettings): BillTotals {
  if (session.final) {
    return { ...session.final, gstEnabled: session.final.gstPercent > 0 || session.final.gstAmount > 0 };
  }
  return computeTotals(session.lines, gst);
}

export function consolidateTicketItems(lines: OrderLine[]): TicketItem[] {
  const map = new Map<string, TicketItem>();
  for (const l of lines) {
    const key = `${l.itemId}#${l.note.trim().toLowerCase()}`;
    const existing = map.get(key);
    if (existing) existing.qty += l.qty;
    else map.set(key, { name: l.name, qty: l.qty, note: l.note.trim() });
  }
  return Array.from(map.values());
}

export function roundGroups(lines: OrderLine[]): { round: number | null; lines: OrderLine[] }[] {
  const groups = new Map<number | null, OrderLine[]>();
  for (const l of lines) {
    const arr = groups.get(l.round) ?? [];
    arr.push(l);
    groups.set(l.round, arr);
  }
  const keys = Array.from(groups.keys());
  const sent = keys.filter((k): k is number => k !== null).sort((a, b) => a - b);
  const ordered: (number | null)[] = [...sent];
  if (groups.has(null)) ordered.push(null);
  return ordered.map((k) => ({ round: k, lines: groups.get(k)! }));
}
