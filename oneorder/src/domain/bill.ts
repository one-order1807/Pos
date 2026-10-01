import { parseGstPercent, round2 } from './money';
import type { FinalTotals, GstLineAmount, GstSettings, OrderLine, Session, TicketItem } from './types';

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
  const gstLines: GstLineAmount[] = gst.enabled
    ? gst.lines
        .map((l) => ({ type: l.type.trim() || 'GST', percent: parseGstPercent(l.percent) }))
        .filter((l) => l.percent > 0)
        .map((l) => ({ ...l, amount: round2((subtotal * l.percent) / 100) }))
    : [];
  const gstAmount = round2(gstLines.reduce((s, l) => s + l.amount, 0));
  const gstPercent = round2(gstLines.reduce((s, l) => s + l.percent, 0));
  return {
    subtotal,
    gstPercent,
    gstAmount,
    gstLines,
    total: round2(subtotal + gstAmount),
    gstEnabled: gst.enabled,
  };
}

/** Pre-Round-5 paid orders have no `gstLines` (only the old aggregate gstPercent/gstAmount) -
 * rebuild a single-line display for them so every call site can treat gstLines as always present. */
function legacyGstLines(gstPercent: number, gstAmount: number): GstLineAmount[] {
  return gstAmount > 0 || gstPercent > 0 ? [{ type: 'GST', percent: gstPercent, amount: gstAmount }] : [];
}

export function sessionTotals(session: Session, gst: GstSettings): BillTotals {
  if (session.final) {
    const gstLines = session.final.gstLines ?? legacyGstLines(session.final.gstPercent, session.final.gstAmount);
    return { ...session.final, gstLines, gstEnabled: session.final.gstPercent > 0 || session.final.gstAmount > 0 };
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
