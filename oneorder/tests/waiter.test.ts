import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { makeSqliteShim } from './helpers';

const shim = makeSqliteShim();
mock.module('expo-sqlite', { exports: { openDatabaseAsync: shim.openDatabaseAsync } });
mock.module('@react-native-community/netinfo', { exports: { default: { addEventListener: () => () => {} } } });
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
// Same "native module missing" shape as tests/printer-unsupported.test.ts - irrelevant to what's
// under test here (the bill-print permission gate runs before any BLE call), just needed so
// importing printing/actions.ts doesn't crash on module load.
mock.module('react-native-ble-plx', {
  exports: {
    BleManager: class {
      constructor() {
        throw new Error('BlePlx native module not found');
      }
    },
  },
});

test('waiter accounts: login/logout, disabled accounts, Chef Mode exclusion, bill-print permission gate', async () => {
  const { useStore } = require('../src/store/store');
  const { printCustomerBill } = require('../src/printing/actions');
  const { hashPin, makeSalt } = require('../src/domain/sha256');

  await useStore.getState().init();

  const raviSalt = makeSalt();
  const ravi = {
    id: 'wtr_ravi',
    username: 'ravi',
    passwordHash: hashPin('ravi@002', raviSalt),
    passwordSalt: raviSalt,
    canPrintCustomerBill: true,
    active: true,
  };
  const kishanSalt = makeSalt();
  const kishan = {
    id: 'wtr_kishan',
    username: 'kishan',
    passwordHash: hashPin('kishan@001', kishanSalt),
    passwordSalt: kishanSalt,
    canPrintCustomerBill: false,
    active: false,
  };
  useStore.getState().setWaiterSettings({ enabled: true, accounts: [ravi, kishan] });

  // wrong password rejected
  assert.equal(useStore.getState().loginWaiter('ravi', 'wrong-password'), false);
  assert.equal(useStore.getState().loggedInWaiterId, null);

  // disabled account can't log in even with the right password
  assert.equal(useStore.getState().loginWaiter('kishan', 'kishan@001'), false);

  // right username/password logs in, and resets any stale active order from a previous user
  useStore.getState().setActive('some-stale-session-id');
  assert.equal(useStore.getState().loginWaiter('ravi', 'ravi@002'), true);
  assert.equal(useStore.getState().loggedInWaiterId, 'wtr_ravi');
  assert.equal(useStore.getState().activeSessionId, null);

  // Chef Mode and Waiter Mode are mutually exclusive
  useStore.getState().logoutWaiter();
  useStore.getState().enterChefMode();
  assert.equal(useStore.getState().loginWaiter('ravi', 'ravi@002'), false, 'cannot log in as a waiter while Chef Mode is active');
  assert.equal(useStore.getState().exitChefMode('1807'), true);

  // ravi opens a dine-in order - the session is attributed to him
  assert.equal(useStore.getState().loginWaiter('ravi', 'ravi@002'), true);
  const waiterId = useStore.getState().loggedInWaiterId as string;
  const { sessionId } = useStore.getState().openTable('tbl_1', waiterId);
  assert.equal(useStore.getState().data.sessions[sessionId].openedBy, waiterId);

  // ravi can print the Customer Bill (permission granted) - the gate itself must not be what
  // blocks him. It still fails end-to-end in this test environment because there's no real BLE
  // printer, but that failure must be the unrelated "unsupported" one, never the permission error.
  const raviResult = await printCustomerBill(sessionId);
  assert.equal(raviResult.ok, false);
  assert.doesNotMatch(raviResult.error ?? '', /cannot print the Customer Bill/);

  // switch to kishan (now enabled, but without bill-print permission) on the same order
  useStore.getState().logoutWaiter();
  useStore.getState().setWaiterSettings({ accounts: [ravi, { ...kishan, active: true }] });
  assert.equal(useStore.getState().loginWaiter('kishan', 'kishan@001'), true);
  const kishanResult = await printCustomerBill(sessionId);
  assert.equal(kishanResult.ok, false);
  assert.match(kishanResult.error ?? '', /cannot print the Customer Bill/);

  // the admin/counter flow (no waiter logged in) is completely unaffected by any of this
  useStore.getState().logoutWaiter();
  const adminResult = await printCustomerBill(sessionId);
  assert.doesNotMatch(adminResult.error ?? '', /cannot print the Customer Bill/);
});
