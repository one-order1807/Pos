import type { BillLine } from '../domain/bill';
import { formatMoney, formatPercent } from '../domain/money';
import type { BillSettings, GstSettings, TicketItem } from '../domain/types';
import type { PrintTemplate } from './templates';
import { rasterAssetToPrintImage } from './raster';

export interface PrintLine {
  kind?: 'text';
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: 1 | 2;
  tall?: boolean;
  brand?: boolean; // the fixed "ONE ORDER x Cloud Build" line - Receipt.tsx styles this with the wordmark font
}

export interface PrintImage {
  kind: 'image';
  width: number;
  height: number;
  bits: Uint8Array; // packed 1bpp, MSB-first, row-major, 1 = black
  align?: 'left' | 'center' | 'right';
}

export type PrintBlock = PrintLine | PrintImage;

export function isPrintImage(b: PrintBlock): b is PrintImage {
  return b.kind === 'image';
}

export function isPrintLine(b: PrintBlock): b is PrintLine {
  return b.kind !== 'image';
}

export function textOnly(blocks: PrintBlock[]): PrintLine[] {
  return blocks.filter(isPrintLine);
}

const BRAND_FOOTER = 'ONE ORDER x Cloud Build';

export interface BillData {
  bill: BillSettings;
  gst: GstSettings;
  label: string;
  tableLabel?: string;
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
  occasionLine?: string;
  isTest?: boolean;
}

export interface CookData {
  bill: BillSettings;
  label: string;
  orderNo: number;
  typeLabel: string;
  round: number | null;
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

function fmtDatePart(ms: number): string {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTimePart(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h < 12 ? 'AM' : 'PM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m} ${suffix}`;
}

function ruleChar(t: PrintTemplate): string {
  return t.style === 'boxed' ? '=' : '-';
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

function headerBlocks(t: PrintTemplate, bill: BillSettings, gst?: GstSettings): PrintBlock[] {
  const out: PrintBlock[] = [];
  const w = t.columns;
  const logo = rasterAssetToPrintImage(bill.logoRaster);
  if (logo) out.push({ ...logo, align: 'center' });
  const name = bill.name.trim() || 'ONEORDER';
  for (const l of wrapText(name.toUpperCase(), w)) out.push({ text: l, align: 'center', bold: true });
  if (bill.address.trim()) for (const l of wrapText(bill.address, w)) out.push({ text: l, align: 'center' });
  if (bill.phone.trim()) out.push({ text: `Ph: ${bill.phone.trim()}`, align: 'center' });
  if (gst?.enabled && gst.number.trim()) {
    for (const l of wrapText(`GST: ${gst.number.trim()}`, w)) out.push({ text: l, align: 'center' });
  }
  return out;
}

function footerBlocks(t: PrintTemplate, bill: BillSettings): PrintBlock[] {
  const out: PrintBlock[] = [];
  const w = t.columns;
  if (bill.footer.trim()) {
    for (const l of wrapText(bill.footer, w)) out.push({ text: l, align: 'center' });
  }
  const qr = rasterAssetToPrintImage(bill.qrRaster);
  if (qr) out.push({ ...qr, align: 'center' });
  out.push({ text: BRAND_FOOTER, align: 'center', bold: true, brand: true });
  return out;
}

function amountColumnWidth(lines: BillLine[], total: number): number {
  let longest = formatMoney(total).length;
  for (const l of lines) longest = Math.max(longest, formatMoney(l.amount).length);
  return longest + 1;
}

export function layoutCustomerBill(t: PrintTemplate, d: BillData): PrintBlock[] {
  const w = t.columns;
  const out: PrintBlock[] = [];
  const rc = ruleChar(t);
  if (d.isTest) out.push(...testBanner(t));
  out.push(...headerBlocks(t, d.bill, d.gst));
  out.push(rule(w, rc));

  for (const l of twoCol(`Bill #${d.orderNo}`, d.tableLabel ? `Table ${d.tableLabel}` : d.typeLabel, w)) {
    out.push({ text: l });
  }
  for (const l of twoCol(fmtDatePart(d.when), fmtTimePart(d.when), w)) out.push({ text: l });
  if (d.customer) for (const l of wrapText(`Customer: ${d.customer}`, w)) out.push({ text: l });
  out.push(rule(w, rc));

  const amtW = amountColumnWidth(d.lines, d.total);
  if (t.style === 'wide') {
    const qtyW = 5;
    const rateW = 11;
    const nameW = w - qtyW - rateW - amtW;
    out.push({ text: pad('Item', nameW) + padLeft('Qty', qtyW) + padLeft('Rate', rateW) + padLeft('Amt', amtW), bold: true });
    out.push(rule(w));
    for (const l of d.lines) {
      const nameLines = wrapText(l.name, nameW - 1);
      out.push({
        text:
          pad(nameLines[0], nameW) + padLeft(`${l.qty}x`, qtyW) + padLeft(formatMoney(l.unitPrice), rateW) + padLeft(formatMoney(l.amount), amtW),
      });
      for (const extra of nameLines.slice(1)) out.push({ text: extra });
    }
  } else if (t.style === 'boxed') {
    const qtyW = 5;
    const nameW = w - qtyW - amtW;
    out.push({ text: pad('Qty  Item', nameW + qtyW) + padLeft('Amt', amtW), bold: true });
    out.push(rule(w, '.'));
    for (const l of d.lines) {
      const left = `${padLeft(String(l.qty) + 'x', qtyW - 1)} ${l.name}`;
      const nameLines = wrapText(left, nameW + qtyW - 1);
      nameLines.forEach((ln, i) => {
        if (i === nameLines.length - 1) out.push({ text: pad(ln, w - amtW) + padLeft(formatMoney(l.amount), amtW), bold: true });
        else out.push({ text: ln, bold: true });
      });
    }
  } else {
    const qtyW = 4;
    const nameW = w - qtyW - amtW;
    out.push({ text: pad('Item', nameW) + padLeft('Qty', qtyW) + padLeft('Amt', amtW), bold: true });
    out.push(rule(w));
    for (const l of d.lines) {
      const nameLines = wrapText(l.name, nameW - 1);
      out.push({ text: pad(nameLines[0], nameW) + padLeft(String(l.qty), qtyW) + padLeft(formatMoney(l.amount), amtW) });
      for (const extra of nameLines.slice(1)) out.push({ text: extra });
    }
  }
  out.push(rule(w, rc));

  if (d.gst.enabled) {
    for (const l of twoCol('Subtotal', formatMoney(d.subtotal), w)) out.push({ text: l });
    for (const l of twoCol(`GST (${formatPercent(d.gstPercent)}%)`, formatMoney(d.gstAmount), w)) out.push({ text: l });
    out.push(rule(w, rc));
  }
  for (const l of twoCol('TOTAL', formatMoney(d.total), w)) out.push({ text: l, bold: true, tall: true });
  out.push(rule(w, rc));

  if (d.paymentLabel) out.push({ text: `Payment: ${d.paymentLabel}`, align: 'center' });
  if (d.occasionLine) out.push({ text: d.occasionLine, align: 'center', bold: true });
  out.push(rule(w, rc));

  out.push(...footerBlocks(t, d.bill));
  if (d.isTest) out.push(...testBanner(t));
  return out;
}

export function layoutCookBill(t: PrintTemplate, d: CookData): PrintBlock[] {
  const w = t.columns;
  const out: PrintBlock[] = [];
  const rc = ruleChar(t);
  if (d.isTest) out.push(...testBanner(t));
  out.push({ text: 'COOK BILL', align: 'center', bold: true, size: 2 });
  for (const l of wrapText(d.label, Math.floor(w / 2))) out.push({ text: l, align: 'center', bold: true, size: 2 });
  out.push(rule(w, rc));
  const roundText = d.round === null ? 'ALL ROUNDS' : `Round ${d.round}`;
  for (const l of twoCol(`Order #${d.orderNo}  ${roundText}`, d.typeLabel, w)) out.push({ text: l });
  out.push({ text: `${fmtDatePart(d.when)}  ${fmtTimePart(d.when)}` });
  out.push(rule(w, rc));
  for (const it of d.items) {
    const wrapped = wrapText(`${it.qty} x ${it.name}`, Math.floor(w / 2));
    for (const l of wrapped) out.push({ text: l, bold: true, size: 2 });
    if (it.note) {
      for (const n of wrapText(`* ${it.note}`, w - 2)) out.push({ text: `  ${n}` });
    }
  }
  out.push(rule(w, rc));
  if (d.isTest) out.push(...testBanner(t));
  return out;
}

export function sampleBillData(bill: BillSettings, gst: GstSettings, now: number): BillData {
  const lines: BillLine[] = [
    { key: 'a', name: 'Espresso', qty: 5, unitPrice: 90, amount: 450 },
    { key: 'b', name: 'Hot Chocolate', qty: 2, unitPrice: 140, amount: 280 },
    { key: 'c', name: 'Green Tea', qty: 1, unitPrice: 35, amount: 35 },
  ];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const pct = gst.enabled ? Number(String(gst.percent).replace('%', '')) || 0 : 0;
  const gstAmount = Math.round(subtotal * pct) / 100;
  return {
    bill,
    gst,
    label: 'T-1',
    tableLabel: 'T-1',
    orderNo: 1025,
    typeLabel: 'Dine-in',
    lines,
    subtotal,
    gstPercent: pct,
    gstAmount,
    total: subtotal + gstAmount,
    when: now,
    paymentLabel: 'UPI',
    occasionLine: bill.showOccasionGreeting ? 'Happy Birthday, Rahul!' : undefined,
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
