export type OrderType = 'dine-in' | 'takeaway' | 'delivery';
export type PaymentMethod = 'cash' | 'upi' | 'card';
export type TicketStatus = 'pending' | 'cooking' | 'ready';
export type TableStatus = 'available' | 'occupied' | 'cooking' | 'payment';

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface MenuItem {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  price: number;
  active: boolean;
}

export interface TableDef {
  id: string;
  label: string;
  x: number;
  y: number;
  members?: string[];
  mergedInto?: string;
}

export interface OrderLine {
  id: string;
  itemId: string;
  name: string;
  categoryId: string;
  unitPrice: number;
  qty: number;
  note: string;
  round: number | null;
}

export interface Session {
  id: string;
  orderNo: number;
  type: OrderType;
  tableId: string | null;
  status: 'open' | 'paid' | 'closed';
  lines: OrderLine[];
  rounds: number;
  createdAt: number;
  startedAt: number | null;
  billPrintedAt: number | null;
  customerName: string;
  customerPhone: string;
  paymentMethod: PaymentMethod | null;
  paidAt: number | null;
  final: FinalTotals | null;
  mergedMembers?: string[];
}

export interface FinalTotals {
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  total: number;
}

export interface TicketItem {
  name: string;
  qty: number;
  note: string;
}

export interface Ticket {
  id: string;
  sessionId: string;
  round: number;
  label: string;
  items: TicketItem[];
  status: TicketStatus;
  sentAt: number;
  startedAt: number | null;
  readyAt: number | null;
  priority: number;
  printed: boolean;
}

export type EventType = 'Birthday' | 'Anniversary' | 'Celebration' | 'Other';
export const EVENT_TYPES: EventType[] = ['Birthday', 'Anniversary', 'Celebration', 'Other'];

export interface Customer {
  id: string;
  name: string;
  phone: string;
  event: EventType | '';
  createdAt: number;
}

export interface GstSettings {
  enabled: boolean;
  percent: string;
  number: string;
}

export interface RasterAsset {
  width: number;
  height: number;
  bitsB64: string; // packed 1bpp, MSB-first, row-major, 1 = black
}

export interface BillSettings {
  name: string;
  logoUri: string;
  logoRaster: RasterAsset | null; // dithered print/preview bitmap, derived from logoUri
  address: string;
  phone: string;
  footer: string;
  qrText: string; // e.g. a Google Review link; '' = no QR printed
  qrRaster: RasterAsset | null; // derived from qrText
  showOccasionGreeting: boolean;
}

export interface PrinterSettings {
  templateId: string;
  deviceId: string;
  deviceName: string;
}

export interface Settings {
  id: 'main';
  tableMode: boolean;
  gst: GstSettings;
  bill: BillSettings;
  printer: PrinterSettings;
  pinHash: string;
  pinSalt: string;
  orderCounter: { date: string; n: number };
  priorityCounter: number;
  layoutPrev: TableDef[];
}

export interface State {
  categories: Record<string, Category>;
  items: Record<string, MenuItem>;
  tables: Record<string, TableDef>;
  sessions: Record<string, Session>;
  tickets: Record<string, Ticket>;
  customers: Record<string, Customer>;
  settings: Record<string, Settings>;
}

export type CollectionName = keyof State;
export const COLLECTIONS: CollectionName[] = [
  'categories',
  'items',
  'tables',
  'sessions',
  'tickets',
  'customers',
  'settings',
];
