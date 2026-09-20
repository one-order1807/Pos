import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

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
// Expo Go: the native module is missing, so constructing the manager throws.
mock.module('react-native-ble-plx', {
  exports: {
    BleManager: class {
      constructor() {
        throw new Error('BlePlx native module not found');
      }
    },
  },
});

test('without native Bluetooth the printer is never "Connected" and printing fails honestly', async () => {
  const p = require('../src/printing/printer');
  assert.equal(p.isBluetoothSupported(), false);
  assert.equal(p.getPrinterSnapshot().status, 'unsupported');
  assert.match(p.getPrinterSnapshot().message, /development build/);
  await p.startScan();
  assert.notEqual(p.getPrinterSnapshot().status, 'connected');
  assert.equal(await p.connectTo('AA', 'Fake'), false);
  assert.equal(await p.verifyConnection(), false);
  await assert.rejects(() => p.printLines([{ text: 'hello' }]), (e: Error) => e instanceof p.PrintError);
  assert.equal(p.getPrinterSnapshot().status, 'unsupported');
});
