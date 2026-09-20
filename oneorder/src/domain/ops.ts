import { computeTotals, consolidateTicketItems } from './bill';
import { dayKey } from './money';
import type {
  MenuItem,
  OrderLine,
  OrderType,
  PaymentMethod,
  Session,
  Settings,
  State,
  TableDef,
  TableStatus,
  Ticket,
} from './types';

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function settingsOf(state: State): Settings {
  return state.settings.main;
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------- sessions & tables: lookups ----------

export function openSessions(state: State): Session[] {
  return Object.values(state.sessions)
    .filter((s) => s.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function activeSessionForTable(state: State, tableId: string): Session | undefined {
  const table = state.tables[tableId];
  const resolved = table?.mergedInto ?? tableId;
  return Object.values(state.sessions).find((s) => s.status === 'open' && s.tableId === resolved);
}

export function sessionLabel(state: State, s: Session): string {
  if (s.tableId) {
    const t = state.tables[s.tableId];
    if (t) return t.label;
  }
  if (s.type === 'takeaway') return `Takeaway #${s.orderNo}`;
  if (s.type === 'delivery') return `Delivery #${s.orderNo}`;
  return `Order #${s.orderNo}`;
}

export function unsentLines(s: Session): OrderLine[] {
  return s.lines.filter((l) => l.round === null);
}

export function tableStatus(state: State, tableId: string): TableStatus {
  const s = activeSessionForTable(state, tableId);
  if (!s) return 'available';
  if (s.billPrintedAt) return 'payment';
  const cooking = Object.values(state.tickets).some(
    (t) => t.sessionId === s.id && (t.status === 'pending' || t.status === 'cooking'),
  );
  return cooking ? 'cooking' : 'occupied';
}

export function visibleTables(state: State): TableDef[] {
  return Object.values(state.tables)
    .filter((t) => !t.mergedInto)
    .sort((a, b) => {
      const am = a.members ? 0 : 1;
      const bm = b.members ? 0 : 1;
      if (am !== bm) return am - bm;
      return naturalCompare(a.label, b.label);
    });
}

// ---------- sessions: create / table assignment ----------

function withSession(state: State, s: Session): State {
  return { ...state, sessions: { ...state.sessions, [s.id]: s } };
}

function withoutKey<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec };
  delete next[key];
  return next;
}

function nextOrderNo(state: State, now: number): { state: State; orderNo: number } {
  const st = settingsOf(state);
  const today = dayKey(now);
  const n = st.orderCounter.date === today ? st.orderCounter.n + 1 : 1;
  return {
    orderNo: n,
    state: {
      ...state,
      settings: { ...state.settings, main: { ...st, orderCounter: { date: today, n } } },
    },
  };
}

function rollbackOrderNo(state: State, orderNo: number, now: number): State {
  const st = settingsOf(state);
  if (st.orderCounter.date === dayKey(now) && st.orderCounter.n === orderNo && orderNo > 0) {
    return {
      ...state,
      settings: {
        ...state.settings,
        main: { ...st, orderCounter: { ...st.orderCounter, n: orderNo - 1 } },
      },
    };
  }
  return state;
}

export interface CreateResult {
  state: State;
  sessionId: string;
  redirected: boolean;
}

export function createSession(
  state: State,
  type: OrderType,
  now: number,
  tableId: string | null = null,
): CreateResult {
  if (type === 'dine-in' && tableId) {
    const table = state.tables[tableId];
    if (!table) throw new Error('Unknown table');
    const existing = activeSessionForTable(state, tableId);
    if (existing) return { state, sessionId: existing.id, redirected: true };
    tableId = table.mergedInto ?? tableId;
  }
  const { state: s1, orderNo } = nextOrderNo(state, now);
  const session: Session = {
    id: uid('ses'),
    orderNo,
    type,
    tableId: type === 'dine-in' ? tableId : null,
    status: 'open',
    lines: [],
    rounds: 0,
    createdAt: now,
    startedAt: null,
    billPrintedAt: null,
    customerName: '',
    customerPhone: '',
    paymentMethod: null,
    paidAt: null,
    final: null,
  };
  return { state: withSession(s1, session), sessionId: session.id, redirected: false };
}

export interface AssignResult {
  state: State;
  sessionId: string;
  redirected: boolean;
  movedItems: number;
  error?: 'locked' | 'not-open' | 'not-dine-in' | 'unknown-table';
}

export function assignTable(state: State, sessionId: string, tableId: string, now: number): AssignResult {
  const session = state.sessions[sessionId];
  const fail = (error: AssignResult['error']): AssignResult => ({
    state,
    sessionId,
    redirected: false,
    movedItems: 0,
    error,
  });
  if (!session || session.status !== 'open') return fail('not-open');
  if (session.type !== 'dine-in') return fail('not-dine-in');
  const table = state.tables[tableId];
  if (!table) return fail('unknown-table');
  const resolved = table.mergedInto ?? tableId;
  if (session.tableId === resolved) {
    return { state, sessionId, redirected: false, movedItems: 0 };
  }
  if (session.rounds > 0) return fail('locked');

  const existing = activeSessionForTable(state, resolved);
  if (existing && existing.id !== sessionId) {
    const movable = unsentLines(session);
    let next = state;
    let target = existing;
    for (const l of movable) {
      target = mergeLineInto(target, l);
    }
    next = withSession(next, target);
    next = discardSession(next, sessionId, now);
    return {
      state: next,
      sessionId: existing.id,
      redirected: true,
      movedItems: movable.reduce((n, l) => n + l.qty, 0),
    };
  }
  return {
    state: withSession(state, { ...session, tableId: resolved }),
    sessionId,
    redirected: false,
    movedItems: 0,
  };
}

function mergeLineInto(target: Session, line: OrderLine): Session {
  const note = line.note.trim();
  const idx = target.lines.findIndex(
    (l) => l.round === null && l.itemId === line.itemId && l.unitPrice === line.unitPrice && l.note.trim() === note,
  );
  if (idx >= 0) {
    const lines = target.lines.slice();
    lines[idx] = { ...lines[idx], qty: lines[idx].qty + line.qty };
    return { ...target, lines };
  }
  return { ...target, lines: [...target.lines, { ...line, id: uid('ln') }] };
}

function discardSession(state: State, sessionId: string, now: number): State {
  const s = state.sessions[sessionId];
  if (!s) return state;
  let next: State = { ...state, sessions: withoutKey(state.sessions, sessionId) };
  next = rollbackOrderNo(next, s.orderNo, now);
  return next;
}

// ---------- order lines ----------

export function addLine(
  state: State,
  sessionId: string,
  item: Pick<MenuItem, 'id' | 'name' | 'price' | 'categoryId'>,
  qty = 1,
  note = '',
): State {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open' || qty <= 0) return state;
  const cleanNote = note.trim();
  const idx = s.lines.findIndex(
    (l) => l.round === null && l.itemId === item.id && l.unitPrice === item.price && l.note.trim() === cleanNote,
  );
  let lines: OrderLine[];
  if (idx >= 0) {
    lines = s.lines.slice();
    lines[idx] = { ...lines[idx], qty: lines[idx].qty + qty };
  } else {
    lines = [
      ...s.lines,
      {
        id: uid('ln'),
        itemId: item.id,
        name: item.name,
        categoryId: item.categoryId,
        unitPrice: item.price,
        qty,
        note: cleanNote,
        round: null,
      },
    ];
  }
  return withSession(state, { ...s, lines });
}

export function updateLine(
  state: State,
  sessionId: string,
  lineId: string,
  patch: { qty?: number; note?: string },
): State {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open') return state;
  const idx = s.lines.findIndex((l) => l.id === lineId);
  if (idx < 0 || s.lines[idx].round !== null) return state;
  const line = s.lines[idx];
  const qty = patch.qty ?? line.qty;
  let lines: OrderLine[];
  if (qty <= 0) {
    lines = s.lines.filter((l) => l.id !== lineId);
  } else {
    lines = s.lines.slice();
    lines[idx] = { ...line, qty, note: (patch.note ?? line.note).trim() };
  }
  return withSession(state, { ...s, lines });
}

// ---------- cook bill ----------

export interface CookResult {
  state: State;
  ticketId?: string;
  error?: 'nothing-to-send' | 'needs-table' | 'not-open';
}

export function sendCookBill(state: State, sessionId: string, now: number): CookResult {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open') return { state, error: 'not-open' };
  const fresh = unsentLines(s);
  if (fresh.length === 0) return { state, error: 'nothing-to-send' };
  const st = settingsOf(state);
  if (st.tableMode && s.type === 'dine-in' && !s.tableId) return { state, error: 'needs-table' };

  const round = s.rounds + 1;
  const lines = s.lines.map((l) => (l.round === null ? { ...l, round } : l));
  const updated: Session = { ...s, lines, rounds: round, startedAt: s.startedAt ?? now };
  const priority = st.priorityCounter + 1;
  const ticket: Ticket = {
    id: uid('tkt'),
    sessionId: s.id,
    round,
    label: sessionLabel(state, updated),
    items: consolidateTicketItems(fresh),
    status: 'pending',
    sentAt: now,
    startedAt: null,
    readyAt: null,
    priority,
    printed: false,
  };
  let next = withSession(state, updated);
  next = { ...next, tickets: { ...next.tickets, [ticket.id]: ticket } };
  next = {
    ...next,
    settings: { ...next.settings, main: { ...settingsOf(next), priorityCounter: priority } },
  };
  return { state: next, ticketId: ticket.id };
}

export function markTicketPrinted(state: State, ticketId: string): State {
  const t = state.tickets[ticketId];
  if (!t) return state;
  return { ...state, tickets: { ...state.tickets, [ticketId]: { ...t, printed: true } } };
}

export function markBillPrinted(state: State, sessionId: string, now: number): State {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open') return state;
  return withSession(state, { ...s, billPrintedAt: s.billPrintedAt ?? now });
}

export function setCustomer(state: State, sessionId: string, name: string, phone: string): State {
  const s = state.sessions[sessionId];
  if (!s) return state;
  return withSession(state, { ...s, customerName: name.trim(), customerPhone: phone.trim() });
}

// ---------- closing / paying ----------

function unmergeIfMerged(state: State, tableId: string | null): State {
  if (!tableId) return state;
  const t = state.tables[tableId];
  if (!t || !t.members) return state;
  const tables = { ...state.tables };
  for (const m of t.members) {
    if (tables[m]) {
      const { mergedInto: _drop, ...rest } = tables[m];
      tables[m] = rest;
    }
  }
  delete tables[tableId];
  return { ...state, tables };
}

export function closeSession(state: State, sessionId: string, now: number): State {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open') return state;
  if (s.rounds === 0) {
    return unmergeIfMerged(discardSession(state, sessionId, now), s.tableId);
  }
  const tickets = { ...state.tickets };
  for (const t of Object.values(state.tickets)) {
    if (t.sessionId === sessionId && t.status !== 'ready') delete tickets[t.id];
  }
  let next: State = { ...state, tickets };
  next = withSession(next, { ...s, status: 'closed' });
  return unmergeIfMerged(next, s.tableId);
}

export interface PayResult {
  state: State;
  error?: 'unsent-items' | 'empty' | 'not-open';
}

export function payAndClose(
  state: State,
  sessionId: string,
  method: PaymentMethod,
  now: number,
  customer?: { name: string; phone: string },
): PayResult {
  const s = state.sessions[sessionId];
  if (!s || s.status !== 'open') return { state, error: 'not-open' };
  if (s.lines.length === 0) return { state, error: 'empty' };
  if (unsentLines(s).length > 0) return { state, error: 'unsent-items' };
  const totals = computeTotals(s.lines, settingsOf(state).gst);
  const name = (customer?.name ?? s.customerName).trim();
  const phone = (customer?.phone ?? s.customerPhone).trim();
  const paid: Session = {
    ...s,
    status: 'paid',
    paymentMethod: method,
    paidAt: now,
    billPrintedAt: s.billPrintedAt ?? now,
    customerName: name,
    customerPhone: phone,
    final: {
      subtotal: totals.subtotal,
      gstPercent: totals.gstPercent,
      gstAmount: totals.gstAmount,
      total: totals.total,
    },
  };
  let next = withSession(state, paid);
  if (phone) {
    const existing = next.customers[phone];
    next = {
      ...next,
      customers: {
        ...next.customers,
        [phone]: { id: phone, phone, name: name || existing?.name || '' },
      },
    };
  }
  return { state: unmergeIfMerged(next, s.tableId) };
}

// ---------- kitchen ----------

export function pendingTickets(state: State): Ticket[] {
  return Object.values(state.tickets)
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.priority - b.priority || a.sentAt - b.sentAt);
}

export function startTicket(state: State, ticketId: string, now: number): State {
  const t = state.tickets[ticketId];
  if (!t || t.status !== 'pending') return state;
  return { ...state, tickets: { ...state.tickets, [ticketId]: { ...t, status: 'cooking', startedAt: now } } };
}

export function markReady(state: State, ticketId: string, now: number): State {
  const t = state.tickets[ticketId];
  if (!t || t.status === 'ready') return state;
  return {
    ...state,
    tickets: { ...state.tickets, [ticketId]: { ...t, status: 'ready', readyAt: now, startedAt: t.startedAt ?? now } },
  };
}

export function reorderPending(state: State, ticketId: string, toIndex: number): State {
  const list = pendingTickets(state);
  const from = list.findIndex((t) => t.id === ticketId);
  if (from < 0) return state;
  const clamped = Math.max(0, Math.min(list.length - 1, toIndex));
  if (clamped === from) return state;
  const [moved] = list.splice(from, 1);
  list.splice(clamped, 0, moved);
  const tickets = { ...state.tickets };
  list.forEach((t, i) => {
    if (t.priority !== i + 1) tickets[t.id] = { ...t, priority: i + 1 };
  });
  const st = settingsOf(state);
  return {
    ...state,
    tickets,
    settings: { ...state.settings, main: { ...st, priorityCounter: list.length } },
  };
}

// ---------- table layout (draft operations) ----------

export type TableMap = Record<string, TableDef>;

export function lockedTableIds(state: State): Set<string> {
  const locked = new Set<string>();
  for (const s of Object.values(state.sessions)) {
    if (s.status === 'open' && s.tableId) {
      locked.add(s.tableId);
      const t = state.tables[s.tableId];
      t?.members?.forEach((m) => locked.add(m));
    }
  }
  return locked;
}

export function mergedLabel(labels: string[]): string {
  const parsed = labels.map((l) => /^(.*?)(\d+)$/.exec(l.trim()));
  if (parsed.every((p) => p !== null)) {
    const prefix = parsed[0]![1];
    if (parsed.every((p) => p![1] === prefix)) {
      const nums = parsed.map((p) => Number(p![2])).sort((a, b) => a - b);
      return `${prefix}${nums[0]}M${nums[nums.length - 1]}`;
    }
  }
  return labels.join('+');
}

export function nextTableLabel(tables: TableMap): string {
  let max = 0;
  for (const t of Object.values(tables)) {
    const m = /(\d+)\s*$/.exec(t.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const count = Object.values(tables).filter((t) => !t.members).length;
  return `T-${Math.max(max, count) + 1}`;
}

export function addTableDraft(tables: TableMap, x: number, y: number): TableMap {
  const id = uid('tbl');
  return { ...tables, [id]: { id, label: nextTableLabel(tables), x: Math.max(0, x), y: Math.max(0, y) } };
}

export function moveTableDraft(tables: TableMap, id: string, x: number, y: number): TableMap {
  const t = tables[id];
  if (!t) return tables;
  return { ...tables, [id]: { ...t, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } };
}

export function renameTableDraft(tables: TableMap, id: string, label: string): TableMap {
  const t = tables[id];
  const clean = label.trim();
  if (!t || !clean) return tables;
  return { ...tables, [id]: { ...t, label: clean } };
}

export function removeTableDraft(tables: TableMap, id: string, locked: Set<string>): TableMap {
  const t = tables[id];
  if (!t || locked.has(id) || t.members || t.mergedInto) return tables;
  return withoutKey(tables, id);
}

export function mergeTablesDraft(
  tables: TableMap,
  ids: string[],
  locked: Set<string>,
): { tables: TableMap; mergedId?: string; error?: string } {
  const unique = Array.from(new Set(ids));
  if (unique.length < 2) return { tables, error: 'Select at least 2 tables to merge.' };
  const picked = unique.map((i) => tables[i]);
  if (picked.some((t) => !t)) return { tables, error: 'Unknown table.' };
  if (picked.some((t) => t.members || t.mergedInto)) return { tables, error: 'A merged table cannot be merged again.' };
  if (unique.some((i) => locked.has(i))) return { tables, error: 'A table with an active order cannot be merged.' };
  const sorted = picked.slice().sort((a, b) => naturalCompare(a.label, b.label));
  const id = uid('mrg');
  const next: TableMap = { ...tables };
  for (const t of sorted) next[t.id] = { ...t, mergedInto: id };
  next[id] = {
    id,
    label: mergedLabel(sorted.map((t) => t.label)),
    x: sorted[0].x,
    y: sorted[0].y,
    members: sorted.map((t) => t.id),
  };
  return { tables: next, mergedId: id };
}

export function unmergeTableDraft(
  tables: TableMap,
  mergedId: string,
  locked: Set<string>,
): { tables: TableMap; error?: string } {
  const m = tables[mergedId];
  if (!m || !m.members) return { tables };
  if (locked.has(mergedId)) return { tables, error: 'This merged table has an active order.' };
  const next: TableMap = { ...tables };
  for (const id of m.members) {
    if (next[id]) {
      const { mergedInto: _drop, ...rest } = next[id];
      next[id] = rest;
    }
  }
  delete next[mergedId];
  return { tables: next };
}

export function validateTables(state: State, tables: TableMap): string | null {
  for (const s of Object.values(state.sessions)) {
    if (s.status === 'open' && s.tableId && !tables[s.tableId]) {
      return 'A table with an active order was removed or unmerged.';
    }
  }
  for (const t of Object.values(tables)) {
    if (t.mergedInto && !tables[t.mergedInto]) return 'Merged table data is inconsistent.';
    if (t.members && t.members.some((m) => tables[m]?.mergedInto !== t.id)) {
      return 'Merged table data is inconsistent.';
    }
  }
  return null;
}

export function applyTables(state: State, tables: TableMap): State {
  return { ...state, tables };
}
