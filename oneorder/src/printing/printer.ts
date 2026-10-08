import { PermissionsAndroid, Platform } from 'react-native';
import { encodeEscPos, toBase64 } from './escpos';
import type { PrintBlock } from './layout';

// Worst/most-relevant single status, kept for simple single-dot UI (Shell's top-bar pill,
// printerStatusInfo). Per-printer detail lives in PrinterSnapshot.connections instead - this
// module supports any number of simultaneous BLE connections, not just one.
export type PrinterStatus =
  | 'unsupported'
  | 'bluetooth-off'
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected';

export interface FoundDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface ConnectedPrinter {
  id: string;
  name: string;
  status: 'connecting' | 'connected';
  message: string;
}

export interface PrinterSnapshot {
  status: PrinterStatus;
  message: string;
  devices: FoundDevice[];
  connections: ConnectedPrinter[];
}

declare const require: (name: string) => any;

const PRINTER_SERVICES = [
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
];
const GENERIC_SERVICE_PREFIXES = ['00001800', '00001801', '0000180a', '0000180f'];

const UNSUPPORTED_MESSAGE =
  'Bluetooth printing needs the ONE-ORDER development build (Expo Go cannot access native Bluetooth). Status stays Disconnected until a real printer is connected.';

let snapshot: PrinterSnapshot = {
  status: 'disconnected',
  message: 'No printer connected.',
  devices: [],
  connections: [],
};
const listeners = new Set<() => void>();
let manager: any = null;
let managerTried = false;
// Live BLE handles per connected device id - everything the module needs to write to or tear down
// that specific connection. snapshot.connections is the public, serializable mirror of this map's
// keys (id/name/status/message only, no live SDK objects).
const conns = new Map<string, { dev: any; writeChar: any; disconnectSub: any }>();
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let scanning = false;
// Set fresh by every bluetoothOn() check (not derived from the previous snapshot) - deriving it
// from stale `snapshot.status` would make 'bluetooth-off' stick forever once set, even after
// Bluetooth is switched back on, since nothing would ever re-clear it.
let bluetoothOff = false;

function topStatus(): PrinterStatus {
  if (!manager) return 'unsupported';
  if (scanning) return 'scanning';
  if (bluetoothOff) return 'bluetooth-off';
  if (snapshot.connections.some((c) => c.status === 'connecting')) return 'connecting';
  if (snapshot.connections.length > 0) return 'connected';
  return 'disconnected';
}

function emit(patch: Partial<PrinterSnapshot> = {}) {
  snapshot = { ...snapshot, ...patch };
  snapshot = { ...snapshot, status: topStatus() };
  listeners.forEach((l) => l());
}

function upsertConnection(entry: ConnectedPrinter) {
  const next = snapshot.connections.filter((c) => c.id !== entry.id);
  next.push(entry);
  emit({ connections: next });
}

function dropConnection(id: string, message?: string) {
  conns.delete(id);
  emit({ connections: snapshot.connections.filter((c) => c.id !== id), ...(message ? { message } : {}) });
}

export function getPrinterSnapshot(): PrinterSnapshot {
  return snapshot;
}

export function subscribePrinter(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getManager(): any | null {
  if (managerTried) return manager;
  managerTried = true;
  if (Platform.OS === 'web') return null;
  try {
    const mod = require('react-native-ble-plx');
    manager = new mod.BleManager();
  } catch {
    manager = null;
  }
  if (!manager) emit({ message: UNSUPPORTED_MESSAGE });
  return manager;
}

export function isBluetoothSupported(): boolean {
  return getManager() !== null;
}

async function ensurePermissions(request: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (!request) {
    for (const p of wanted) if (!(await PermissionsAndroid.check(p))) return false;
    return true;
  }
  const res = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED);
}

async function bluetoothOn(m: any): Promise<boolean> {
  try {
    const on = (await m.state()) === 'PoweredOn';
    bluetoothOff = !on;
    return on;
  } catch {
    manager = null;
    bluetoothOff = false;
    emit({ message: UNSUPPORTED_MESSAGE });
    return false;
  }
}

export async function startScan(durationMs = 10000): Promise<void> {
  const m = getManager();
  if (!m) return;
  if (!(await ensurePermissions(true))) {
    emit({ message: 'Bluetooth permission was denied. Allow it in system settings to scan.' });
    return;
  }
  if (!(await bluetoothOn(m))) {
    emit({ message: 'Bluetooth is turned off. Turn it on and scan again.' });
    return;
  }
  stopScan();
  scanning = true;
  emit({ message: 'Scanning for Bluetooth printers...', devices: [] });
  const seen = new Map<string, FoundDevice>();
  m.startDeviceScan(null, { allowDuplicates: false }, (error: any, dev: any) => {
    if (error) {
      scanning = false;
      emit({ message: `Scan failed: ${error.message ?? error}` });
      return;
    }
    const name = (dev?.name || dev?.localName || '').trim();
    if (!dev || !name) return;
    seen.set(dev.id, { id: dev.id, name, rssi: typeof dev.rssi === 'number' ? dev.rssi : null });
    emit({ devices: Array.from(seen.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)) });
  });
  scanTimer = setTimeout(() => {
    scanning = false;
    emit({
      message: seen.size
        ? 'Scan finished. Tap a printer to connect.'
        : 'No Bluetooth LE devices found. Make sure the printer is on, close to the tablet, and supports Bluetooth LE.',
    });
  }, durationMs);
}

export function stopScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
  try {
    manager?.stopDeviceScan?.();
  } catch {}
  if (scanning) {
    scanning = false;
    emit({});
  }
}

async function pickWriteCharacteristic(device: any): Promise<any | null> {
  const services = await device.services();
  const all: { service: string; ch: any }[] = [];
  for (const s of services) {
    const chars = await s.characteristics();
    for (const ch of chars) {
      if (ch.isWritableWithResponse || ch.isWritableWithoutResponse) all.push({ service: String(s.uuid).toLowerCase(), ch });
    }
  }
  const known = all.find((c) => PRINTER_SERVICES.includes(c.service));
  if (known) return known.ch;
  const custom = all.find((c) => !GENERIC_SERVICE_PREFIXES.some((p) => c.service.startsWith(p)));
  return custom ? custom.ch : null;
}

export async function connectTo(id: string, name: string): Promise<boolean> {
  const m = getManager();
  if (!m) return false;
  if (!(await ensurePermissions(true))) {
    emit({ message: 'Bluetooth permission was denied.' });
    return false;
  }
  if (!(await bluetoothOn(m))) {
    emit({ message: 'Bluetooth is turned off.' });
    return false;
  }
  stopScan();
  if (conns.has(id)) await disconnectPrinter(id, false);
  upsertConnection({ id, name, status: 'connecting', message: `Connecting to ${name}...` });
  try {
    let dev = await m.connectToDevice(id, { requestMTU: 185, timeout: 10000 });
    dev = await dev.discoverAllServicesAndCharacteristics();
    const ch = await pickWriteCharacteristic(dev);
    if (!ch) {
      await dev.cancelConnection().catch(() => {});
      dropConnection(id, `${name} connected but exposes no writable print channel. It may be a Bluetooth Classic-only printer.`);
      return false;
    }
    const disconnectSub = m.onDeviceDisconnected(id, () => {
      dropConnection(id, `${name} disconnected.`);
    });
    conns.set(id, { dev, writeChar: ch, disconnectSub });
    upsertConnection({ id, name, status: 'connected', message: `Connected to ${name}.` });
    return true;
  } catch (e: any) {
    dropConnection(id, `Could not connect to ${name}: ${e?.message ?? e}`);
    return false;
  }
}

export async function disconnectPrinter(id: string, announce = true): Promise<void> {
  const m = manager;
  const entry = conns.get(id);
  conns.delete(id);
  try {
    if (entry?.dev && m) await m.cancelDeviceConnection(entry.dev.id);
  } catch {}
  try {
    entry?.disconnectSub?.remove?.();
  } catch {}
  const next = snapshot.connections.filter((c) => c.id !== id);
  emit({ connections: next, ...(announce ? { message: 'Printer disconnected.' } : {}) });
}

/** Verifies one connection (by id) or, with no id, every currently tracked connection - drops any
 * that have actually gone away so the snapshot never claims a fake "Connected" (Part F.1). */
export async function verifyConnection(id?: string): Promise<boolean> {
  const m = manager;
  if (!m) return false;
  const ids = id ? [id] : Array.from(conns.keys());
  let anyOk = false;
  for (const checkId of ids) {
    const entry = conns.get(checkId);
    if (!entry) continue;
    try {
      const ok = await m.isDeviceConnected(entry.dev.id);
      if (ok) anyOk = true;
      else {
        const name = snapshot.connections.find((c) => c.id === checkId)?.name ?? 'Printer';
        dropConnection(checkId, `${name} is no longer connected.`);
      }
    } catch {
      // leave it as-is on a transient check failure rather than dropping a possibly-fine connection
    }
  }
  return id ? anyOk : conns.size > 0;
}

export async function reconnectSaved(id: string, name: string): Promise<void> {
  if (!id) return;
  const m = getManager();
  if (!m) return;
  if (!(await ensurePermissions(false))) return;
  if (!(await bluetoothOn(m))) return;
  await connectTo(id, name);
}

export class PrintError extends Error {}

/** Sends to a specific connected printer id, or - with none given - whichever one connected
 * first. Role resolution (which id a Cook/Customer Bill should target) lives in
 * printing/actions.ts, which has access to Settings; this module only knows about live hardware
 * connections, not app-level printer roles. */
export async function printLines(lines: PrintBlock[], deviceId?: string): Promise<void> {
  if (!getManager()) throw new PrintError('Bluetooth printing is not available in this build.');
  const targetId = deviceId ?? conns.keys().next().value;
  if (!targetId || !(await verifyConnection(targetId))) throw new PrintError('Printer is not connected.');
  const entry = conns.get(targetId);
  if (!entry?.writeChar) throw new PrintError('Printer is not connected.');
  const data = encodeEscPos(lines);
  const chunk = 100;
  try {
    for (let i = 0; i < data.length; i += chunk) {
      const b64 = toBase64(data.subarray(i, i + chunk));
      if (entry.writeChar.isWritableWithResponse) await entry.writeChar.writeWithResponse(b64);
      else {
        await entry.writeChar.writeWithoutResponse(b64);
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  } catch (e: any) {
    await verifyConnection(targetId);
    throw new PrintError(`Print failed: ${e?.message ?? e}`);
  }
}
