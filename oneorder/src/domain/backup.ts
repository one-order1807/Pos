import type { Category, Customer, MenuItem, Session, Settings, State, TableDef } from './types';

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'oneorder';
  version: number;
  exportedAt: number;
  data: {
    categories: Category[];
    items: MenuItem[];
    tables: TableDef[];
    sessions: Session[];
    customers: Customer[];
    settings: Omit<Settings, 'pinHash' | 'pinSalt' | 'orderCounter' | 'priorityCounter'> | null;
  };
}

export function stripSecrets(s: Settings) {
  const { pinHash: _h, pinSalt: _s, orderCounter: _o, priorityCounter: _p, ...rest } = s;
  return rest;
}

export function buildBackup(state: State, now: number): BackupFile {
  const settings = state.settings.main ?? null;
  return {
    app: 'oneorder',
    version: BACKUP_VERSION,
    exportedAt: now,
    data: {
      categories: Object.values(state.categories),
      items: Object.values(state.items),
      tables: Object.values(state.tables),
      sessions: Object.values(state.sessions),
      customers: Object.values(state.customers),
      settings: settings ? stripSecrets(settings) : null,
    },
  };
}

export interface BackupPreview {
  categories: number;
  items: number;
  tables: number;
  sessions: number;
  paidSessions: number;
  customers: number;
  hasSettings: boolean;
  exportedAt: number;
  openSessionsLost: number;
}

export function parseBackup(text: string): { backup?: BackupFile; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'This file is not valid JSON.' };
  }
  const b = raw as Partial<BackupFile>;
  if (!b || b.app !== 'oneorder' || typeof b.version !== 'number' || !b.data) {
    return { error: 'This is not a ONEORDER backup file.' };
  }
  if (b.version > BACKUP_VERSION) return { error: 'This backup was made by a newer version of the app.' };
  const d = b.data;
  const arrays: (keyof BackupFile['data'])[] = ['categories', 'items', 'tables', 'sessions', 'customers'];
  for (const k of arrays) {
    if (!Array.isArray(d[k])) return { error: `Backup is missing "${k}".` };
  }
  return { backup: b as BackupFile };
}

export function previewBackup(backup: BackupFile, current: State): BackupPreview {
  return {
    categories: backup.data.categories.length,
    items: backup.data.items.length,
    tables: backup.data.tables.length,
    sessions: backup.data.sessions.length,
    paidSessions: backup.data.sessions.filter((s) => s.status === 'paid').length,
    customers: backup.data.customers.length,
    hasSettings: !!backup.data.settings,
    exportedAt: backup.exportedAt,
    openSessionsLost: Object.values(current.sessions).filter((s) => s.status === 'open').length,
  };
}

function byId<T extends { id: string }>(arr: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of arr) out[x.id] = x;
  return out;
}

export function applyBackup(current: State, backup: BackupFile): State {
  const cur = current.settings.main;
  const incoming = backup.data.settings;
  const settings: Settings = incoming
    ? { ...cur, ...incoming, id: 'main', pinHash: cur.pinHash, pinSalt: cur.pinSalt, orderCounter: cur.orderCounter, priorityCounter: cur.priorityCounter }
    : cur;
  const sessions = byId(backup.data.sessions);
  const keptTickets: State['tickets'] = {};
  for (const t of Object.values(current.tickets)) {
    if (sessions[t.sessionId]) keptTickets[t.id] = t;
  }
  return {
    categories: byId(backup.data.categories),
    items: byId(backup.data.items),
    tables: byId(backup.data.tables),
    sessions,
    tickets: keptTickets,
    customers: byId(backup.data.customers),
    settings: { main: settings },
  };
}

// ---------- menu import/export (additive only) ----------

export interface MenuExport {
  app: 'oneorder-menu';
  version: 1;
  categories: Category[];
  items: MenuItem[];
}

export function buildMenuExport(state: State): MenuExport {
  return {
    app: 'oneorder-menu',
    version: 1,
    categories: Object.values(state.categories).sort((a, b) => a.sort - b.sort),
    items: Object.values(state.items),
  };
}

export interface MenuImportResult {
  state: State;
  addedCategories: number;
  updatedCategories: number;
  addedItems: number;
  updatedItems: number;
  skipped: number;
  error?: string;
}

export function importMenu(state: State, text: string): MenuImportResult {
  const result: MenuImportResult = {
    state,
    addedCategories: 0,
    updatedCategories: 0,
    addedItems: 0,
    updatedItems: 0,
    skipped: 0,
  };
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...result, error: 'This file is not valid JSON.' };
  }
  if (!raw || raw.app !== 'oneorder-menu' || !Array.isArray(raw.items)) {
    return { ...result, error: 'This is not a ONEORDER menu file.' };
  }
  const categories = { ...state.categories };
  const items = { ...state.items };
  const nextSort = () => Object.values(categories).reduce((m, c) => Math.max(m, c.sort), -1) + 1;

  for (const c of Array.isArray(raw.categories) ? raw.categories : []) {
    if (!c || typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim()) {
      result.skipped += 1;
      continue;
    }
    if (categories[c.id]) {
      categories[c.id] = { ...categories[c.id], name: c.name.trim() };
      result.updatedCategories += 1;
    } else {
      categories[c.id] = { id: c.id, name: c.name.trim(), sort: typeof c.sort === 'number' ? c.sort : nextSort() };
      result.addedCategories += 1;
    }
  }
  for (const i of raw.items) {
    const price = Number(i?.price);
    if (
      !i ||
      typeof i.id !== 'string' ||
      typeof i.name !== 'string' ||
      !i.name.trim() ||
      typeof i.categoryId !== 'string' ||
      !categories[i.categoryId] ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      result.skipped += 1;
      continue;
    }
    const item: MenuItem = {
      id: i.id,
      code: typeof i.code === 'string' && i.code.trim() ? i.code.trim() : i.id,
      name: i.name.trim(),
      categoryId: i.categoryId,
      price,
      active: i.active !== false,
    };
    if (items[i.id]) result.updatedItems += 1;
    else result.addedItems += 1;
    items[i.id] = item;
  }
  return { ...result, state: { ...state, categories, items } };
}
