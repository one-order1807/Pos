import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const writes: string[] = [];
let linkUp = true;
let disconnectCb: (() => void) | null = null;
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

const printerService = {
  uuid: '000018F0-0000-1000-8000-00805F9B34FB',
  characteristics: async () => [
    { isWritableWithResponse: true, isWritableWithoutResponse: false, writeWithResponse: async (b64: string) => void writes.push(b64) },
  ],
};

mock.module('react-native-ble-plx', {
  exports: {
    BleManager: class {
      async state() {
        return btState;
      }
      startDeviceScan(_u: unknown, _o: unknown, cb: (e: unknown, d: unknown) => void) {
        cb(null, { id: 'AA:01', name: 'MHT-P58', rssi: -50 });
        cb(null, { id: 'AA:02', name: null, rssi: -40 });
        cb(null, { id: 'AA:03', name: 'Speaker', rssi: -70 });
      }
      stopDeviceScan() {}
      async connectToDevice(id: string) {
        linkUp = true;
        const dev = {
          id,
          discoverAllServicesAndCharacteristics: async () => dev,
          services: async () => [{ uuid: '00001800-0000-1000-8000-00805f9b34fb', characteristics: async () => [] }, printerService],
          cancelConnection: async () => {},
        };
        return dev;
      }
      onDeviceDisconnected(_id: string, cb: () => void) {
        disconnectCb = cb;
        return { remove() {} };
      }
      async isDeviceConnected() {
        return linkUp;
      }
      async cancelDeviceConnection() {
        linkUp = false;
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
  assert.deepEqual(snap.devices.map((d: any) => d.name), ['MHT-P58', 'Speaker'], 'unnamed devices are hidden, sorted by signal');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  await assert.rejects(() => p.printLines([{ text: 'x' }]), /not connected/);

  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), true);
  assert.equal(p.getPrinterSnapshot().status, 'connected');
  assert.equal(p.getPrinterSnapshot().device.name, 'MHT-P58');

  const lines = Array.from({ length: 30 }, (_, i) => ({ text: `Line ${i} `.padEnd(30, '.') }));
  await p.printLines(lines);
  const sent = Buffer.concat(writes.map((w) => Buffer.from(w, 'base64')));
  assert.deepEqual([...sent], [...encodeEscPos(lines)], 'exact ESC/POS bytes reach the printer, chunked');
  assert.ok(writes.length > 1, 'large jobs are chunked');
  assert.ok(writes.every((w) => Buffer.from(w, 'base64').length <= 100));

  // link silently drops (printer powered off): status must follow on verify, and printing must refuse
  linkUp = false;
  assert.equal(await p.verifyConnection(), false);
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');
  await assert.rejects(() => p.printLines(lines), /not connected/);

  // reconnect, then OS-reported disconnect event
  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), true);
  disconnectCb!();
  assert.equal(p.getPrinterSnapshot().status, 'disconnected');

  // Bluetooth turned off blocks scan and connect
  btState = 'PoweredOff';
  await p.startScan(10);
  assert.equal(p.getPrinterSnapshot().status, 'bluetooth-off');
  assert.equal(await p.connectTo('AA:01', 'MHT-P58'), false);
  assert.equal(p.getPrinterSnapshot().status, 'bluetooth-off');
});
