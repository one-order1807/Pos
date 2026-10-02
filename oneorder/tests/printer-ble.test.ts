import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const writes: Record<string, string[]> = {};
const linkUp: Record<string, boolean> = {};
const disconnectCb: Record<string, () => void> = {};
let btState = 'PoweredOn';

mock.module('react-native', {
  exports: {
    Platform: { OS: 'android', Version: 34 },
    PermissionsAndroid: {
      PERMISSIONS: { BLUETOOTH_SCAN: 's', BLUETOOTH_CONNECT: 'c', ACCESS_FINE_LOCATION: 'l' },
      RESULTS: { GRANTED: 'granted' },
      check: async () => true,
      requestMultiple: async () => ({ s: 'granted', c: 'granted', l: 'granted' }),
    },
  },
});

function printerService(id: string) {
  return {
    uuid: '000018F0-0000-1000-8000-00805F9B34FB',
    characteristics: async () => [
      {
        isWritableWithResponse: true,
        isWritableWithoutResponse: false,
        writeWithResponse: async (b64: string) => void (writes[id] ??= []).push(b64),
      },
    ],
  };
}

mock.module('react-native-ble-plx', {
  exports: {
    BleManager: class {
      async state() {
        return btState;
      }
      startDeviceScan(_u: unknown, _o: unknown, cb: (e: unknown, d: unknown) => void) {
        cb(null, { id: 'AA:01', name: 'MHT-P58', rssi: -40 });
        cb(null, { id: 'AA:02', name: 'Kitchen-P2', rssi: -50 });
        cb(null, { id: 'AA:03', name: 'Speaker', rssi: -70 });
        cb(null, { id: 'AA:04', name: null, rssi: -30 });
      }
      stopDeviceScan() {}
      async connectToDevice(id: string) {
        linkUp[id] = true;
        const dev = {
          id,
          discoverAllServicesAndCharacteristics: async () => dev,
          services: async () => [{ uuid: '00001800-0000-1000-8000-00805f9b34fb', characteristics: async () => [] }, printerService(id)],
          cancelConnection: async () => {
            linkUp[id] = false;
          },
        };
        return dev;
      }
      onDeviceDisconnected(id: string, cb: () => void) {
        disconnectCb[id] = cb;
        return { remove() {} };
      }
      async isDeviceConnected(id: string) {
        return !!linkUp[id];
      }
      async cancelDeviceConnection(id: string) {
        linkUp[id] = false;
      }
    },
  },
});

test('BLE: scan, connect, print bytes, and status follows the real link', async () => {
  const p = require('../src/printing/printer');
  const { encodeEscPos } = require('../src/printing/escpos');
  assert.equal(p.isBluetoothSupported(), true);
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  await p.startScan(50);
  let snap = p.getPrinterSnapshot();
  assert.equal(snap.status, 'scanning');
  assert.deepEqual(
    snap.devices.map((d: any) => d.name),
    ['MHT-P58', 'Kitchen-P2', 'Speaker'],
    'unnamed devices are hidden, sorted by signal',
  );
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  await assert.rejects(() => p.printLines([{ text: 'x' }]), /not connected/);

  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), true);
  snap = p.getPrinterSnapshot();
  assert.equal(snap.status, 'connected');
  assert.equal(snap.connections.length, 1);
  assert.equal(snap.connections[0].name, 'MHT-P58');

  const lines = Array.from({ length: 30 }, (_, i) => ({ text: `Line ${i} `.padEnd(30, '.') }));
  await p.printLines(lines);
  const sent = Buffer.concat((writes['AA:01'] ?? []).map((w) => Buffer.from(w, 'base64')));
  assert.deepEqual([...sent], [...encodeEscPos(lines)], 'exact ESC/POS bytes reach the printer, chunked');
  assert.ok((writes['AA:01'] ?? []).length > 1, 'large jobs are chunked');
  assert.ok((writes['AA:01'] ?? []).every((w) => Buffer.from(w, 'base64').length <= 100));

  // A second, different printer connects *alongside* the first - this is the actual new
  // capability: both stay independently connected, neither replaces the other.
  assert.equal(await p.connectTo('AA:02', 'Kitchen-P2'), true);
  snap = p.getPrinterSnapshot();
  assert.equal(snap.connections.length, 2, 'both printers stay connected at once');
  assert.deepEqual(
    snap.connections.map((c: any) => c.name).sort(),
    ['Kitchen-P2', 'MHT-P58'],
  );

  // Printing targets a *specific* device id - bytes for one printer never reach the other.
  await p.printLines([{ text: 'to kitchen' }], 'AA:02');
  assert.ok((writes['AA:02'] ?? []).length > 0, 'the targeted printer received the job');
  const beforeFirstPrinterBytes = (writes['AA:01'] ?? []).length;
  await p.printLines([{ text: 'to kitchen again' }], 'AA:02');
  assert.equal((writes['AA:01'] ?? []).length, beforeFirstPrinterBytes, 'the other printer received nothing extra');

  // AA:01's link silently drops (printer powered off): only that one connection goes away.
  linkUp['AA:01'] = false;
  assert.equal(await p.verifyConnection('AA:01'), false);
  snap = p.getPrinterSnapshot();
  assert.equal(snap.connections.length, 1, 'the still-healthy second printer is untouched');
  assert.equal(snap.connections[0].id, 'AA:02');
  await assert.rejects(() => p.printLines(lines, 'AA:01'), /not connected/);
  // with no explicit target and only AA:02 left connected, printing still succeeds against it
  await p.printLines([{ text: 'fallback' }]);

  // disconnecting the remaining printer by id leaves nothing connected
  await p.disconnectPrinter('AA:02');
  assert.equal(p.getPrinterSnapshot().connections.length, 0);
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  // reconnect, then OS-reported disconnect event
  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), true);
  disconnectCb['AA:01']!();
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  // Bluetooth turned off blocks scan and connect
  btState = 'PoweredOff';
  await p.startScan(10);
  assert.equal(p.getPrinterSnapshot().status, 'bluetooth-off');
  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), false);
  assert.equal(p.getPrinterSnapshot().status, 'bluetooth-off');
});
