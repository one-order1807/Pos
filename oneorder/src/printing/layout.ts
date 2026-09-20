import type { BillLine } from '../domain/bill';
import { formatMoney, formatPercent } from '../domain/money';
import type { BillSettings, GstSettings, TicketItem } from '../domain/types';
import type { PrintTemplate } from './templates';

export interface PrintLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 1 | 2;
  tall?: boolean;
}

export interface BillData {
  bill: BillSettings;
  gst: GstSettings;
  label: string;
  orderNo: number;
  typeLabel: string;
  lines: BillLine[];
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  total: number;
  when: number;
  paymentLabel?: string;
  customer?: string;
  isTest?: boolean;
}

export interface CookData {
  bill: BillSettings;
  label: string;
  orderNo: number;
  typeLabel: string;
  round: number;
  items: TicketItem[];
  when: number;
  isTest?: boolean;
}

export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let cur = '';
  for (let w of words) {
    if (w === '') continue;
    while (w.length > width) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padLeft(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

export function twoCol(left: string, right: string, width: number): string[] {
  const avail = width - right.length - 1;
  if (avail < 4) return [...wrapText(left, width), padLeft(right, width)];
  const parts = wrapText(left, avail);
  const last = parts.length - 1;
  return parts.map((p, i) => (i === last ? pad(p, width - right.length) + right : p));
}

function rule(width: number, ch = '-'): PrintLine {
  return { text: ch.repeat(width) };
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function header(t: PrintTemplate, bill: BillSettings, gst?: GstSettings): PrintLine[] {
  const out: PrintLine[] = [];
  const w = t.columns;
  const name = bill.name.trim() || 'ONEORDER';
  const big = t.style !== 'compact' || name.length <= Math.floor(w / 2);
  if (big) {
    for (const l of wrapText(name.toUpperCase(), Math.floor(w / 2))) {
      out.push({ text: l, align: 'center', bold: true, size: 2 });
    }
  } else {
    for (const l of wrapText(name.toUpperCase(), w)) out.push({ text: l, align: 'center', bold: true });
  }
  if (bill.address.trim()) for (const l of wrapText(bill.address, w)) out.push({ text: l, align: 'center' });
  if (bill.phone.trim()) out.push({ text: `Ph: ${bill.phone.trim()}`, align: 'center' });
  if (gst?.enabled && gst.number.trim()) {
    for (const l of wrapText(`GST: ${gst.number.trim()}`, w)) out.push({ text: l, align: 'center' });
  }
  return out;
}

function testBanner(t: PrintTemplate): PrintLine[] {
  return [
    { text: '*'.repeat(t.columns), align: 'center' },
    ...wrapText('TEST - no customer order placed', t.columns).map<PrintLine>((l) => ({
      text: l,
      align: 'center',
      bold: true,
    })),
    { text: '*'.repeat(t.columns), align: 'center' },
  ];
}

export function layoutCustomerBill(t: PrintTemplate, d: BillData): PrintLine[] {
  const w = t.columns;
  const out: PrintLine[] = [];
  if (d.isTest) out.push(...testBanner(t));
  out.push(...header(t, d.bill, d.gst));
  const boxed = t.style === 'boxed';
  out.push(rule(w, boxed ? '=' : '-'));
  const orderTitle = `Order #${d.orderNo}`;
  for (const l of twoCol(orderTitle, d.label, w)) out.push({ text: l });
  for (const l of twoCol(fmtDate(d.when), d.typeLabel, w)) out.push({ text: l });
  if (d.customer) for (const l of wrapText(`Customer: ${d.customer}`, w)) out.push({ text: l });
  out.push(rule(w, boxed ? '=' : '-'));

  if (t.style === 'compact') {
    out.push({ text: twoCol('Item', 'Amount', w)[0], bold: true });
    out.push(rule(w));
    for (const l of d.lines) {
      for (const n of wrapText(l.name, w)) out.push({ text: n });
      const left = `  ${l.qty} x ${formatMoney(l.unitPrice).replace('Rs ', '')}`;
      for (const r of twoCol(left, formatMoney(l.amount).replace('Rs ', ''), w)) out.push({ text: r });
    }
  } else if (t.style === 'wide') {
    const qtyW = 5;
    const rateW = 11;
    const amtW = 12;
    const nameW = w - qtyW - rateW - amtW;
    out.push({
      text: pad('Item', nameW) + padLeft('Qty', qtyW) + padLeft('Rate', rateW) + padLeft('Amount', amtW),
      bold: true,
    });
    out.push(rule(w));
    for (const l of d.lines) {
      const nameLines = wrapText(l.name, nameW - 1);
      out.push({
        text:
          pad(nameLines[0], nameW) +
          padLeft(`${l.qty}x`, qtyW) +
          padLeft(formatMoney(l.unitPrice), rateW) +
          padLeft(formatMoney(l.amount), amtW),
      });
      for (const extra of nameLines.slice(1)) out.push({ text: extra });
    }
  } else {
    out.push({ text: twoCol('QTY  ITEM', 'AMOUNT', w)[0], bold: true });
    out.push(rule(w, '.'));
    for (const l of d.lines) {
      const left = `${padLeft(String(l.qty) + 'x', 4)}  ${l.name}`;
      const amount = formatMoney(l.amount);
      const avail = w - amount.length - 1;
      const wrapped = wrapText(left.trimStart(), avail);
      wrapped.forEach((ln, i) => {
        if (i === wrapped.length - 1) out.push({ text: pad(ln, w - amount.length) + amount, bold: true });
        else out.push({ text: ln, bold: true });
      });
    }
  }

  out.push(rule(w, boxed ? '=' : '-'));
  const totalsWidth = w;
  if (d.gst.enabled) {
    for (const l of twoCol('Subtotal', formatMoney(d.subtotal), totalsWidth)) out.push({ text: l });
    for (const l of twoCol(`GST (${formatPercent(d.gstPercent)}%)`, formatMoney(d.gstAmount), totalsWidth)) {
      out.push({ text: l });
    }
  }
  const totalStr = formatMoney(d.total);
  const halfW = Math.floor(w / 2);
  if (`TOTAL ${totalStr}`.length <= halfW) {
    out.push({ text: twoCol('TOTAL', totalStr, halfW)[0], bold: true, size: 2, align: 'right' });
  } else {
    for (const l of twoCol('TOTAL', totalStr, w)) out.push({ text: l, bold: true, tall: true });
  }
  out.push(rule(w, boxed ? '=' : '-'));
  if (d.paymentLabel) out.push({ text: `Paid by: ${d.paymentLabel}`, align: 'center' });
  if (d.bill.footer.trim()) {
    for (const l of wrapText(d.bill.footer, w)) out.push({ text: l, align: 'center' });
  }
  if (d.isTest) out.push(...testBanner(t));
  return out;
}

export function layoutCookBill(t: PrintTemplate, d: CookData): PrintLine[] {
  const w = t.columns;
  const out: PrintLine[] = [];
  if (d.isTest) out.push(...testBanner(t));
  out.push({ text: 'COOK BILL', align: 'center', bold: true, size: 2 });
  for (const l of wrapText(d.label, Math.floor(w / 2))) out.push({ text: l, align: 'center', bold: true, size: 2 });
  out.push(rule(w, t.style === 'boxed' ? '=' : '-'));
  for (const l of twoCol(`Order #${d.orderNo}  Round ${d.round}`, d.typeLabel, w)) out.push({ text: l });
  out.push({ text: fmtDate(d.when) });
  out.push(rule(w, t.style === 'boxed' ? '=' : '-'));
  for (const it of d.items) {
    const wrapped = wrapText(`${it.qty} x ${it.name}`, Math.floor(w / 2));
    for (const l of wrapped) out.push({ text: l, bold: true, size: 2 });
    if (it.note) {
      for (const n of wrapText(`* ${it.note}`, w - 2)) out.push({ text: `  ${n}` });
    }
  }
  out.push(rule(w, t.style === 'boxed' ? '=' : '-'));
  if (d.isTest) out.push(...testBanner(t));
  return out;
}

export function sampleBillData(bill: BillSettings, gst: GstSettings, now: number): BillData {
  const lines: BillLine[] = [
    { key: 'a', name: 'Sample Masala Dosa', qty: 5, unitPrice: 90, amount: 450 },
    { key: 'b', name: 'Sample Filter Coffee with Extra Long Name Here', qty: 8, unitPrice: 40, amount: 320 },
    { key: 'c', name: 'Sample Brownie', qty: 1, unitPrice: 100, amount: 100 },
  ];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const pct = gst.enabled ? Number(String(gst.percent).replace('%', '')) || 0 : 0;
  const gstAmount = Math.round(subtotal * pct) / 100;
  return {
    bill,
    gst,
    label: 'T-5',
    orderNo: 0,
    typeLabel: 'Dine-in',
    lines,
    subtotal,
    gstPercent: pct,
    gstAmount,
    total: subtotal + gstAmount,
    when: now,
    isTest: true,
  };
}

export function sampleCookData(bill: BillSettings, now: number): CookData {
  return {
    bill,
    label: 'T-5',
    orderNo: 0,
    typeLabel: 'Dine-in',
    round: 1,
    items: [
      { name: 'Sample Masala Dosa', qty: 3, note: 'less spicy' },
      { name: 'Sample Tea', qty: 3, note: '' },
    ],
    when: now,
    isTest: true,
  };
}
