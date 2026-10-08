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
  /** The waiter account that opened this order, if any (Waiter Mode). Unset for orders opened
   * from the normal admin/counter screen. */
  openedBy?: string;
}

export interface FinalTotals {
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  gstLines: GstLineAmount[];
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
  servedAt: number | null;
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

export interface GstLine {
  type: string; // free text, e.g. "SGST", "CGST"
  percent: string;
}

export interface GstSettings {
  enabled: boolean;
  lines: GstLine[];
  number: string;
}

export interface GstLineAmount {
  type: string;
  percent: number;
  amount: number;
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
  fssaiNumber: string; // '' = not printed; presence of a value is the only switch
}

export type PrinterRole = 'both' | 'customer' | 'cook';

export interface PrinterDevice {
  id: string;
  name: string;
  role: PrinterRole;
}

export interface PrinterSettings {
  templateId: string;
  // Remembered printers for this device to auto-reconnect to, each with a role: 'both' (default
  // for a single printer - everything routes to it) or scoped to just Customer or Cook Bills once
  // a second printer is assigned a specific job. BLE pairings are inherently per-device hardware,
  // not something a second tablet could use even if this list syncs along with the rest of
  // Settings - same as the deviceId/deviceName fields this replaces.
  devices: PrinterDevice[];
}

export interface WaiterAccount {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  canPrintCustomerBill: boolean;
  /** Disabled accounts can't log in, but stay around so order history attribution isn't lost. */
  active: boolean;
}

export interface WaiterSettings {
  enabled: boolean;
  accounts: WaiterAccount[];
}

export interface NotificationSettings {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  /** Seconds between repeat alerts for an unacknowledged ready ticket; 0 = fire once, no repeat. */
  repeatSeconds: number;
}

export interface Settings {
  id: 'main';
  tableMode: boolean;
  /** When on, the Order tab shows a single "Print Bill" button that sends+prints the Cook Bill
   * automatically and then opens the Customer Bill popup, instead of two separate buttons - for
   * counter-service cafes where the customer orders and pays in one step. */
  combinedBillPrint: boolean;
  gst: GstSettings;
  bill: BillSettings;
  printer: PrinterSettings;
  waiter: WaiterSettings;
  notifications: NotificationSettings;
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
