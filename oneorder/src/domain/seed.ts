import { hashPin, makeSalt } from './sha256';
import type { Category, MenuItem, Settings, State, TableDef } from './types';

export const DEFAULT_DEV_PIN = '180704';

export function defaultSettings(): Settings {
  const salt = makeSalt();
  return {
    id: 'main',
    tableMode: true,
    gst: { enabled: false, percent: '5', number: '' },
    bill: {
      name: 'ONEORDER Cafe',
      logoUri: '',
      address: '',
      phone: '',
      footer: 'Thank you! Visit again.',
    },
    printer: { templateId: 't2', deviceId: '', deviceName: '' },
    pinHash: hashPin(DEFAULT_DEV_PIN, salt),
    pinSalt: salt,
    orderCounter: { date: '', n: 0 },
    priorityCounter: 0,
    layoutPrev: [],
  };
}

const CATS: [string, string][] = [
  ['cat_hot', 'Hot Drinks'],
  ['cat_cold', 'Cold Drinks'],
  ['cat_break', 'Breakfast'],
  ['cat_snack', 'Snacks'],
  ['cat_sweet', 'Desserts'],
];

const ITEMS: [string, string, string, number][] = [
  ['cat_hot', 'H01', 'Masala Chai', 20],
  ['cat_hot', 'H02', 'Filter Coffee', 40],
  ['cat_hot', 'H03', 'Cappuccino', 120],
  ['cat_hot', 'H04', 'Hot Chocolate', 140],
  ['cat_cold', 'C01', 'Cold Coffee', 130],
  ['cat_cold', 'C02', 'Lemon Soda', 60],
  ['cat_cold', 'C03', 'Mango Shake', 110],
  ['cat_break', 'B01', 'Masala Dosa', 90],
  ['cat_break', 'B02', 'Idli Sambar', 60],
  ['cat_break', 'B03', 'Poha', 40],
  ['cat_snack', 'S01', 'Veg Sandwich', 80],
  ['cat_snack', 'S02', 'French Fries', 90],
  ['cat_snack', 'S03', 'Samosa', 20],
  ['cat_sweet', 'D01', 'Brownie', 100],
  ['cat_sweet', 'D02', 'Gulab Jamun', 50],
];

export function seedState(): State {
  const categories: Record<string, Category> = {};
  CATS.forEach(([id, name], i) => {
    categories[id] = { id, name, sort: i };
  });
  const items: Record<string, MenuItem> = {};
  ITEMS.forEach(([categoryId, code, name, price]) => {
    const id = `itm_${code.toLowerCase()}`;
    items[id] = { id, code, name, categoryId, price, active: true };
  });
  const tables: Record<string, TableDef> = {};
  for (let i = 1; i <= 8; i++) {
    const id = `tbl_${i}`;
    const col = (i - 1) % 4;
    const row = Math.floor((i - 1) / 4);
    tables[id] = { id, label: `T-${i}`, x: 24 + col * 150, y: 24 + row * 150 };
  }
  const settings = defaultSettings();
  return {
    categories,
    items,
    tables,
    sessions: {},
    tickets: {},
    customers: {},
    settings: { main: settings },
  };
}

export function emptyState(): State {
  return {
    categories: {},
    items: {},
    tables: {},
    sessions: {},
    tickets: {},
    customers: {},
    settings: {},
  };
}
