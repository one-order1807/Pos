import { create } from 'zustand';
import { loadState, writeChanges } from '../db/sqlite';
import { applyBackup, importMenu, parseBackup, type BackupFile, type MenuImportResult } from '../domain/backup';
import { allDocs, diffStates, type DocChange } from '../domain/diff';
import { makeTapGuard } from '../domain/guard';
import * as ops from '../domain/ops';
import { hashPin } from '../domain/sha256';
import { fetchCloudState, scheduleSync, startSync } from '../sync/engine';
import { defaultSettings, emptyState, seedState } from '../domain/seed';
import type {
  BillSettings,
  Category,
  Customer,
  GstSettings,
  MenuItem,
  OrderType,
  PaymentMethod,
  PrinterSettings,
  Settings,
  State,
} from '../domain/types';

export type TabKey = 'order' | 'tables' | 'kitchen' | 'menu' | 'users' | 'dashboard' | 'dev';

const UNLOCK_MS = 10 * 60 * 1000;
const tapGuard = makeTapGuard(150);

interface StoreShape {
  ready: boolean;
  loadError: string | null;
  saveError: string | null;
  data: State;
  tab: TabKey;
  activeSessionId: string | null;
  unlockedUntil: number;
  init: () => Promise<void>;
  retrySave: () => void;
  setTab: (t: TabKey) => void;
  setActive: (id: string | null) => void;

  newOrder: (type: OrderType) => string;
  openTable: (tableId: string) => { sessionId: string; redirected: boolean };
  assignTableToActive: (tableId: string) => ops.AssignResult | null;
  quickAdd: (itemId: string) => boolean;
  addCustom: (itemId: string, qty: number, note: string) => void;
  changeLine: (lineId: string, patch: { qty?: number; note?: string }) => void;
  sendCook: () => ops.CookResult;
  markTicketPrinted: (ticketId: string) => void;
  markBillPrinted: (sessionId: string) => void;
  setCustomer: (sessionId: string, name: string, phone: string) => void;
  closeTab: (sessionId: string) => void;
  pay: (sessionId: string, method: PaymentMethod, customer?: { name: string; phone: string }) => ops.PayResult;

  startTicket: (id: string) => void;
  markReady: (id: string) => void;
  reorderPending: (id: string, toIndex: number) => void;

  saveTables: (draft: ops.TableMap) => string | null;
  rollbackTables: () => string | null;
  saveCustomer: (input: { oldId?: string; name: string; phone: string; event: Customer['event'] }) => string | null;
  deleteCustomer: (id: string) => void;

  setTableMode: (on: boolean) => void;
  setGst: (patch: Partial<GstSettings>) => void;
  setBill: (patch: Partial<BillSettings>) => void;
  setPrinterSettings: (patch: Partial<PrinterSettings>) => void;
  verifyPin: (pin: string) => { ok: boolean; waitMs: number };
  isUnlocked: (now?: number) => boolean;
  lock: () => void;

  upsertCategory: (c: Category) => void;
  deleteCategory: (id: string) => string | null;
  upsertItem: (i: MenuItem) => void;
  deleteItem: (id: string) => void;

  importMenuText: (text: string) => MenuImportResult;
  restoreBackup: (b: BackupFile) => void;
}

const pending = new Map<string, DocChange>();
let queue: Promise<void> = Promise.resolve();
const failTimes: number[] = [];

function enqueue(changes: DocChange[]) {
  for (const c of changes) pending.set(`${c.collection}/${c.id}`, c);
  queue = queue.then(flush);
}

export function flushWrites(): Promise<void> {
  queue = queue.then(flush);
  return queue;
}

async function flush(): Promise<void> {
  if (pending.size === 0) return;
  const batch = Array.from(pending.entries());
  try {
    await writeChanges(batch.map(([, c]) => c));
    for (const [k, c] of batch) if (pending.get(k) === c) pending.delete(k);
    scheduleSync();
    if (useStore.getState().saveError) useStore.setState({ saveError: null });
  } catch (e: any) {
    useStore.setState({ saveError: String(e?.message ?? e) });
  }
}

export const useStore = create<StoreShape>((set, get) => {
  function commit(fn: (s: State) => State): boolean {
    const prev = get().data;
    const next = fn(prev);
    if (next === prev) return false;
    set({ data: next });
    enqueue(diffStates(prev, next));
    return true;
  }

  function withSettings(patch: (s: Settings) => Settings) {
    commit((d) => ({ ...d, settings: { ...d.settings, main: patch(d.settings.main) } }));
  }

  const activeOrNull = () => {
    const id = get().activeSessionId;
    return id && get().data.sessions[id]?.status === 'open' ? id : null;
  };

  return {
    ready: false,
    loadError: null,
    saveError: null,
    data: emptyState(),
    tab: 'order',
    activeSessionId: null,
    unlockedUntil: 0,

    async init() {
      try {
        const { state, count } = await loadState();
        let data = state;
        if (count === 0 || !data.settings.main) {
          const cloud = await fetchCloudState();
          if (cloud) {
            const def = defaultSettings();
            data = { ...cloud, settings: { main: { ...cloud.settings.main, pinHash: def.pinHash, pinSalt: def.pinSalt } } };
          } else {
            data = seedState();
          }
          set({ data });
          enqueue(allDocs(data));
          await queue;
        }
        const open = ops.openSessions(data);
        set({ data, ready: true, activeSessionId: open.length ? open[0].id : null, loadError: null });
        startSync();
      } catch (e: any) {
        set({ loadError: String(e?.message ?? e), ready: false });
      }
    },

    retrySave() {
      queue = queue.then(flush);
    },

    setTab(t) {
      set({ tab: t });
    },

    setActive(id) {
      set({ activeSessionId: id });
    },

    newOrder(type) {
      const prev = get().data;
      const r = ops.createSession(prev, type, Date.now(), null);
      set({ data: r.state, activeSessionId: r.sessionId });
      enqueue(diffStates(prev, r.state));
      return r.sessionId;
    },

    openTable(tableId) {
      const prev = get().data;
      const r = ops.createSession(prev, 'dine-in', Date.now(), tableId);
      if (r.state !== prev) {
        set({ data: r.state });
        enqueue(diffStates(prev, r.state));
      }
      set({ activeSessionId: r.sessionId, tab: 'order' });
      return { sessionId: r.sessionId, redirected: r.redirected };
    },

    assignTableToActive(tableId) {
      const id = activeOrNull();
      if (!id) return null;
      const prev = get().data;
      const r = ops.assignTable(prev, id, tableId, Date.now());
      if (r.error) return r;
      commit(() => r.state);
      set({ activeSessionId: r.sessionId });
      return r;
    },

    quickAdd(itemId) {
      const id = activeOrNull();
      if (!id) return false;
      const item = get().data.items[itemId];
      if (!item || !item.active) return false;
      if (!tapGuard(`${id}:${itemId}`, Date.now())) return false;
      return commit((d) => ops.addLine(d, id, item, 1, ''));
    },

    addCustom(itemId, qty, note) {
      const id = activeOrNull();
      const item = get().data.items[itemId];
      if (!id || !item) return;
      commit((d) => ops.addLine(d, id, item, qty, note));
    },

    changeLine(lineId, patch) {
      const id = activeOrNull();
      if (!id) return;
      commit((d) => ops.updateLine(d, id, lineId, patch));
    },

    sendCook() {
      const id = activeOrNull();
      const prev = get().data;
      if (!id) return { state: prev, error: 'not-open' };
      const r = ops.sendCookBill(prev, id, Date.now());
      if (!r.error) commit(() => r.state);
      return r;
    },

    markTicketPrinted(ticketId) {
      commit((d) => ops.markTicketPrinted(d, ticketId));
    },

    markBillPrinted(sessionId) {
      commit((d) => ops.markBillPrinted(d, sessionId, Date.now()));
    },

    setCustomer(sessionId, name, phone) {
      commit((d) => ops.setCustomer(d, sessionId, name, phone));
    },

    closeTab(sessionId) {
      commit((d) => ops.closeSession(d, sessionId, Date.now()));
      const open = ops.openSessions(get().data);
      if (get().activeSessionId === sessionId || !open.some((s) => s.id === get().activeSessionId)) {
        set({ activeSessionId: open.length ? open[open.length - 1].id : null });
      }
    },

    pay(sessionId, method, customer) {
      const prev = get().data;
      const r = ops.payAndClose(prev, sessionId, method, Date.now(), customer);
      if (!r.error) {
        commit(() => r.state);
        const open = ops.openSessions(get().data);
        set({ activeSessionId: open.length ? open[open.length - 1].id : null });
      }
      return r;
    },

    startTicket(id) {
      commit((d) => ops.startTicket(d, id, Date.now()));
    },
    markReady(id) {
      commit((d) => ops.markReady(d, id, Date.now()));
    },
    reorderPending(id, toIndex) {
      commit((d) => ops.reorderPending(d, id, toIndex));
    },

    saveTables(draft) {
      const err = ops.validateTables(get().data, draft);
      if (err) return err;
      commit((d) => ops.applyTables(d, draft));
      return null;
    },

    rollbackTables() {
      const r = ops.rollbackTables(get().data);
      if (r.error) return r.error;
      commit(() => r.state);
      return null;
    },

    saveCustomer(input) {
      const r = ops.saveCustomer(get().data, input, Date.now());
      if (r.error) return r.error;
      commit(() => r.state);
      return null;
    },

    deleteCustomer(id) {
      commit((d) => ops.deleteCustomer(d, id));
    },

    setTableMode(on) {
      withSettings((s) => ({ ...s, tableMode: on }));
      if (get().tab === 'tables' && !on) set({ tab: 'order' });
    },
    setGst(patch) {
      withSettings((s) => ({ ...s, gst: { ...s.gst, ...patch } }));
    },
    setBill(patch) {
      withSettings((s) => ({ ...s, bill: { ...s.bill, ...patch } }));
    },
    setPrinterSettings(patch) {
      withSettings((s) => ({ ...s, printer: { ...s.printer, ...patch } }));
    },

    verifyPin(pin) {
      const now = Date.now();
      const recent = failTimes.filter((t) => now - t < 60000);
      failTimes.length = 0;
      failTimes.push(...recent);
      if (recent.length >= 5) {
        return { ok: false, waitMs: 60000 - (now - recent[0]) };
      }
      const s = get().data.settings.main;
      const ok = hashPin(pin, s.pinSalt) === s.pinHash;
      if (ok) {
        failTimes.length = 0;
        set({ unlockedUntil: now + UNLOCK_MS });
        return { ok: true, waitMs: 0 };
      }
      failTimes.push(now);
      return { ok: false, waitMs: 0 };
    },
    isUnlocked(now = Date.now()) {
      return get().unlockedUntil > now;
    },
    lock() {
      set({ unlockedUntil: 0 });
    },

    upsertCategory(c) {
      commit((d) => ({ ...d, categories: { ...d.categories, [c.id]: c } }));
    },
    deleteCategory(id) {
      const d = get().data;
      if (Object.values(d.items).some((i) => i.categoryId === id)) {
        return 'Move or delete the items in this category first.';
      }
      commit((s) => {
        const categories = { ...s.categories };
        delete categories[id];
        return { ...s, categories };
      });
      return null;
    },
    upsertItem(i) {
      commit((d) => ({ ...d, items: { ...d.items, [i.id]: i } }));
    },
    deleteItem(id) {
      commit((d) => {
        const items = { ...d.items };
        delete items[id];
        return { ...d, items };
      });
    },

    importMenuText(text) {
      const r = importMenu(get().data, text);
      if (!r.error) commit(() => r.state);
      return r;
    },

    restoreBackup(b) {
      // A restored field that's the wrong shape (a corrupt/foreign backup file, a future app
      // version's settings, etc.) must never take the whole app down to a white screen - fail
      // the restore and keep whatever was running before.
      try {
        commit((d) => applyBackup(d, b));
      } catch (e: any) {
        useStore.setState({ saveError: `Restore failed: ${String(e?.message ?? e)}` });
        throw e;
      }
      const open = ops.openSessions(get().data);
      set({ activeSessionId: open.length ? open[0].id : null });
    },

  };
});

export { parseBackup };
