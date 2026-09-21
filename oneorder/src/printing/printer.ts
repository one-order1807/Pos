import { PermissionsAndroid, Platform } from 'react-native';
import { encodeEscPos, toBase64 } from './escpos';
import type { PrintBlock } from './layout';

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

export interface PrinterSnapshot {
  status: PrinterStatus;
  message: string;
  devices: FoundDevice[];
  device: { id: string; name: string } | null;
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
  'Bluetooth printing needs the ONEORDER development build (Expo Go cannot access native Bluetooth). Status stays Disconnected until a real printer is connected.';

let snapshot: PrinterSnapshot = {
  status: 'disconnected',
  message: 'No printer connected.',
  devices: [],
  device: null,
};
const listeners = new Set<() => void>();
let manager: any = null;
let managerTried = false;
let connectedDevice: any = null;
let writeChar: any = null;
let disconnectSub: any = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function emit(patch: Partial<PrinterSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((l) => l());
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
  if (!manager) emit({ status: 'unsupported', message: UNSUPPORTED_MESSAGE });
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
    return (await m.state()) === 'PoweredOn';
  } catch {
    manager = null;
    emit({ status: 'unsupported', message: UNSUPPORTED_MESSAGE, device: null });
    return false;
  }
}

function clearConnection() {
  try {
    disconnectSub?.remove?.();
  } catch {}
  disconnectSub = null;
  connectedDevice = null;
  writeChar = null;
}

export async function startScan(durationMs = 10000): Promise<void> {
  const m = getManager();
  if (!m) return;
  if (!(await ensurePermissions(true))) {
    emit({ status: connectedDevice ? 'connected' : 'disconnected', message: 'Bluetooth permission was denied. Allow it in system settings to scan.' });
    return;
  }
  if (!(await bluetoothOn(m))) {
    if (snapshot.status !== 'unsupported') emit({ status: 'bluetooth-off', message: 'Bluetooth is turned off. Turn it on and scan again.' });
    return;
  }
  stopScan();
  emit({ status: 'scanning', message: 'Scanning for Bluetooth printers...', devices: [] });
  const seen = new Map<string, FoundDevice>();
  m.startDeviceScan(null, { allowDuplicates: false }, (error: any, dev: any) => {
    if (error) {
      stopScan();
      emit({ status: connectedDevice ? 'connected' : 'disconnected', message: `Scan failed: ${error.message ?? error}` });
      return;
    }
    const name = (dev?.name || dev?.localName || '').trim();
    if (!dev || !name) return;
    seen.set(dev.id, { id: dev.id, name, rssi: typeof dev.rssi === 'number' ? dev.rssi : null });
    emit({ devices: Array.from(seen.values()).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)) });
  });
  scanTimer = setTimeout(() => {
    stopScan();
    emit({
      status: connectedDevice ? 'connected' : 'disconnected',
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
  if (snapshot.status === 'scanning') {
    emit({ status: connectedDevice ? 'connected' : 'disconnected' });
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
    emit({ message: 'Bluetooth permission was denied.', status: 'disconnected' });
    return false;
  }
  if (!(await bluetoothOn(m))) {
    if (snapshot.status !== 'unsupported') emit({ status: 'bluetooth-off', message: 'Bluetooth is turned off.' });
    return false;
  }
  stopScan();
  emit({ status: 'connecting', message: `Connecting to ${name}...` });
  try {
    if (connectedDevice) await disconnectPrinter(false);
    let dev = await m.connectToDevice(id, { requestMTU: 185, timeout: 10000 });
    dev = await dev.discoverAllServicesAndCharacteristics();
    const ch = await pickWriteCharacteristic(dev);
    if (!ch) {
      await dev.cancelConnection().catch(() => {});
      emit({
        status: 'disconnected',
        device: null,
        message: `${name} connected but exposes no writable print channel. It may be a Bluetooth Classic-only printer.`,
      });
      return false;
    }
    connectedDevice = dev;
    writeChar = ch;
    disconnectSub = m.onDeviceDisconnected(id, () => {
      clearConnection();
      emit({ status: 'disconnected', message: `${name} disconnected.`, device: null });
    });
    emit({ status: 'connected', message: `Connected to ${name}.`, device: { id, name } });
    return true;
  } catch (e: any) {
    clearConnection();
    emit({ status: 'disconnected', device: null, message: `Could not connect to ${name}: ${e?.message ?? e}` });
    return false;
  }
}

export async function disconnectPrinter(announce = true): Promise<void> {
  const m = manager;
  const dev = connectedDevice;
  clearConnection();
  try {
    if (dev && m) await m.cancelDeviceConnection(dev.id);
  } catch {}
  if (announce) emit({ status: 'disconnected', device: null, message: 'Printer disconnected.' });
}

export async function verifyConnection(): Promise<boolean> {
  const m = manager;
  if (!m || !connectedDevice) {
    if (snapshot.status === 'connected') emit({ status: 'disconnected', device: null, message: 'Printer is not connected.' });
    return false;
  }
  try {
    const ok = await m.isDeviceConnected(connectedDevice.id);
    if (!ok) {
      const name = snapshot.device?.name ?? 'Printer';
      clearConnection();
      emit({ status: 'disconnected', device: null, message: `${name} is no longer connected.` });
    }
    return ok;
  } catch {
    return false;
  }
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

export async function printLines(lines: PrintBlock[]): Promise<void> {
  if (!getManager()) throw new PrintError('Bluetooth printing is not available in this build.');
  if (!(await verifyConnection()) || !writeChar) throw new PrintError('Printer is not connected.');
  const data = encodeEscPos(lines);
  const chunk = 100;
  try {
    for (let i = 0; i < data.length; i += chunk) {
      const b64 = toBase64(data.subarray(i, i + chunk));
      if (writeChar.isWritableWithResponse) await writeChar.writeWithResponse(b64);
      else {
        await writeChar.writeWithoutResponse(b64);
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  } catch (e: any) {
    await verifyConnection();
    throw new PrintError(`Print failed: ${e?.message ?? e}`);
  }
}
