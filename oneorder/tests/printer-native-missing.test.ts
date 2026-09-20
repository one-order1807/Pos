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
// Manager constructs, but every native call fails (JS wrapper present, native module absent).
mock.module('react-native-ble-plx', {
  exports: {
    BleManager: class {
      async state() {
        throw new Error('Cannot read property of null (native module missing)');
      }
    },
  },
});

test('missing native module discovered at first call is reported as unsupported, not "Bluetooth off"', async () => {
  const p = require('../src/printing/printer');
  await p.startScan();
  assert.equal(p.getPrinterSnapshot().status, 'unsupported');
  assert.equal(await p.connectTo('AA', 'X'), false);
  assert.equal(p.getPrinterSnapshot().status, 'unsupported');
  await assert.rejects(() => p.printLines([{ text: 'x' }]), /not available|not connected/);
});
