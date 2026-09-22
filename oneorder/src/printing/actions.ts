import { useSyncExternalStore } from 'react';
import { consolidateLines, consolidateTicketItems, sessionTotals } from '../domain/bill';
import { occasionLine } from '../domain/occasion';
import { sessionLabel } from '../domain/ops';
import type { OrderType, PaymentMethod, Session, State } from '../domain/types';
import { useStore } from '../store/store';
import { layoutCookBill, layoutCustomerBill, sampleBillData, sampleCookData, type BillData, type PrintBlock } from './layout';
import { getPrinterSnapshot, printLines, subscribePrinter, type PrinterSnapshot } from './printer';
import { templateById } from './templates';

export function usePrinter(): PrinterSnapshot {
  return useSyncExternalStore(subscribePrinter, getPrinterSnapshot, getPrinterSnapshot);
}

export const TYPE_LABEL: Record<OrderType, string> = {
  'dine-in': 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

export const PAY_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' };

export function buildBillData(state: State, s: Session, when: number): BillData {
  const settings = state.settings.main;
  const totals = sessionTotals(s, settings.gst);
  return {
    bill: settings.bill,
    gst: { ...settings.gst, enabled: totals.gstEnabled },
    label: sessionLabel(state, s),
    tableLabel: s.type === 'dine-in' && s.tableId ? state.tables[s.tableId]?.label : undefined,
    orderNo: s.orderNo,
    typeLabel: TYPE_LABEL[s.type],
    lines: consolidateLines(s.lines),
    subtotal: totals.subtotal,
    gstPercent: totals.gstPercent,
    gstAmount: totals.gstAmount,
    total: totals.total,
    when,
    paymentLabel: s.paymentMethod ? PAY_LABEL[s.paymentMethod] : undefined,
    customer: s.customerName || undefined,
    occasionLine: occasionLine(s.customerPhone ? state.customers[s.customerPhone] : undefined, s.customerName, settings.bill.showOccasionGreeting),
  };
}

export function customerBillLines(state: State, s: Session, when: number): PrintBlock[] {
  const t = templateById(state.settings.main.printer.templateId);
  return layoutCustomerBill(t, buildBillData(state, s, when));
}

export function cookBillLines(state: State, ticketId: string): PrintBlock[] | null {
  const ticket = state.tickets[ticketId];
  const s = ticket ? state.sessions[ticket.sessionId] : undefined;
  if (!ticket || !s) return null;
  const t = templateById(state.settings.main.printer.templateId);
  return layoutCookBill(t, {
    bill: state.settings.main.bill,
    label: ticket.label,
    orderNo: s.orderNo,
    typeLabel: TYPE_LABEL[s.type],
    round: ticket.round,
    items: ticket.items,
    when: ticket.sentAt,
  });
}

export interface PrintOutcome {
  ok: boolean;
  error?: string;
}

async function run(lines: PrintBlock[] | null): Promise<PrintOutcome> {
  if (!lines) return { ok: false, error: 'Nothing to print.' };
  try {
    await printLines(lines);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Print failed.' };
  }
}

export async function printCookTicket(ticketId: string): Promise<PrintOutcome> {
  const r = await run(cookBillLines(useStore.getState().data, ticketId));
  if (r.ok) useStore.getState().markTicketPrinted(ticketId);
  return r;
}

export function cookRoundLines(state: State, sessionId: string, round: number | null): PrintBlock[] | null {
  const s = state.sessions[sessionId];
  if (!s) return null;
  const lines = s.lines.filter((l) => l.round !== null && (round === null || l.round === round));
  if (lines.length === 0) return null;
  const t = templateById(state.settings.main.printer.templateId);
  return layoutCookBill(t, {
    bill: state.settings.main.bill,
    label: sessionLabel(state, s),
    orderNo: s.orderNo,
    typeLabel: TYPE_LABEL[s.type],
    round,
    items: consolidateTicketItems(lines),
    when: Date.now(),
  });
}

export async function printCookRound(sessionId: string, round: number | null): Promise<PrintOutcome> {
  return run(cookRoundLines(useStore.getState().data, sessionId, round));
}

export async function printCustomerBill(sessionId: string): Promise<PrintOutcome> {
  const state = useStore.getState().data;
  const s = state.sessions[sessionId];
  if (!s) return { ok: false, error: 'Order not found.' };
  const r = await run(customerBillLines(state, s, Date.now()));
  if (r.ok && s.status === 'open') useStore.getState().markBillPrinted(sessionId);
  return r;
}

/**
 * Deliberately not a bill: no items, totals, GST or template layout - this exists only so staff
 * can confirm the printer is actually connected and printing before service starts, without
 * pulling in any real order data or looking like an actual Cook/Customer Bill.
 */
export function connectivityTestLines(): PrintBlock[] {
  return [
    { text: 'ONEORDER', bold: true, size: 2, align: 'center' },
    { text: 'Printer connection test', align: 'center' },
    { text: '--------------------------------', align: 'center' },
    { text: new Date().toLocaleString(), align: 'center' },
    { text: 'If you can read this, the printer', align: 'center' },
    { text: 'is connected and working.', align: 'center' },
    { text: ' ' },
    { text: ' ' },
  ];
}

export async function printConnectivityTest(): Promise<PrintOutcome> {
  return run(connectivityTestLines());
}

export function testLines(state: State, templateId: string, kind: 'customer' | 'cook'): PrintBlock[] {
  const st = state.settings.main;
  const t = templateById(templateId);
  return kind === 'customer'
    ? layoutCustomerBill(t, sampleBillData(st.bill, st.gst, Date.now()))
    : layoutCookBill(t, sampleCookData(st.bill, Date.now()));
}

export async function printTest(templateId: string, kind: 'customer' | 'cook'): Promise<PrintOutcome> {
  return run(testLines(useStore.getState().data, templateId, kind));
}
