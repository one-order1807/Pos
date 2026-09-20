import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { makeSqliteShim } from './helpers';

const shim = makeSqliteShim();
mock.module('expo-sqlite', { exports: { openDatabaseAsync: shim.openDatabaseAsync } });
mock.module('@react-native-community/netinfo', {
  exports: { default: { addEventListener: () => () => {} } },
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('store + real SQLite: seed, persist, double-tap guard, reload', async () => {
  const { useStore, flushWrites } = require('../src/store/store');
  const { loadState, getDirty, markSynced, dirtyCount } = require('../src/db/sqlite');
  const ops = require('../src/domain/ops');

  await useStore.getState().init();
  let st = useStore.getState();
  assert.equal(st.ready, true);
  assert.equal(Object.keys(st.data.items).length, 15);
  assert.equal(Object.keys(st.data.tables).length, 8);

  // first-run rows are on disk
  const first = await loadState();
  assert.equal(first.count > 20, true);

  const id = st.newOrder('takeaway');
  const item = Object.values(st.data.items).find((i: any) => i.code === 'H01') as any;
  assert.equal(st.quickAdd(item.id), true);
  assert.equal(st.quickAdd(item.id), false, 'second tap inside 150ms is ignored');
  assert.equal(useStore.getState().data.sessions[id].lines[0].qty, 1);
  await wait(200);
  assert.equal(st.quickAdd(item.id), true);
  assert.equal(useStore.getState().data.sessions[id].lines[0].qty, 2);

  await flushWrites();
  const disk = await loadState();
  assert.deepEqual(disk.state, useStore.getState().data, 'SQLite content equals in-memory state');

  // simulated refresh: wipe memory, reload from SQLite
  useStore.setState({ data: require('../src/domain/seed').emptyState(), ready: false, activeSessionId: null });
  await useStore.getState().init();
  const after = useStore.getState();
  assert.equal(after.ready, true);
  assert.equal(after.data.sessions[id].lines[0].qty, 2);
  assert.equal(after.activeSessionId, id);
  assert.equal(after.data.settings.main.orderCounter.n, 1);

  // dine-in flow through the store
  after.newOrder('dine-in');
  const dineId = useStore.getState().activeSessionId!;
  useStore.getState().quickAdd(item.id);
  assert.equal(useStore.getState().sendCook().error, 'needs-table');
  const res = useStore.getState().assignTableToActive('tbl_1');
  assert.equal(res.redirected, false);
  const cook = useStore.getState().sendCook();
  assert.ok(cook.ticketId);
  assert.equal(ops.tableStatus(useStore.getState().data, 'tbl_1'), 'cooking');
  const pay = useStore.getState().pay(dineId, 'cash', { name: 'Ravi', phone: '9000000001' });
  assert.equal(pay.error, undefined);
  assert.equal(ops.tableStatus(useStore.getState().data, 'tbl_1'), 'available');

  // closing an empty draft deletes its row
  useStore.getState().newOrder('takeaway');
  const draftId = useStore.getState().activeSessionId!;
  await flushWrites();
  assert.ok((await loadState()).state.sessions[draftId]);
  useStore.getState().closeTab(draftId);
  await flushWrites();
  assert.equal((await loadState()).state.sessions[draftId], undefined);

  // PIN: right/wrong, hashed, lockout
  const s0 = useStore.getState();
  assert.equal(s0.verifyPin('000000').ok, false);
  assert.equal(s0.isUnlocked(), false);
  assert.equal(s0.verifyPin('180704').ok, true);
  assert.equal(useStore.getState().isUnlocked(), true);
  useStore.getState().lock();
  assert.equal(useStore.getState().isUnlocked(), false);
  const pinRow = shim.db.prepare("SELECT json FROM docs WHERE collection='settings'").get() as { json: string };
  assert.ok(!pinRow.json.includes('180704'));
  for (let i = 0; i < 5; i++) useStore.getState().verifyPin('111111');
  const locked = useStore.getState().verifyPin('180704');
  assert.equal(locked.ok, false);
  assert.ok(locked.waitMs > 0, 'brute force lockout');

  // sync bookkeeping: dirty rows drain, deletions purge
  assert.ok((await dirtyCount()) > 0);
  const rows = await getDirty(1000);
  await markSynced(rows);
  assert.equal(await dirtyCount(), 0);
  assert.equal(
    (shim.db.prepare('SELECT COUNT(*) AS n FROM docs WHERE deleted = 1').get() as { n: number }).n,
    0,
    'synced deletions are purged',
  );

  // settings edits persist (GST toggle keeps percent)
  useStore.getState().setGst({ enabled: true, percent: '18' });
  useStore.getState().setGst({ enabled: false });
  useStore.getState().setGst({ enabled: true });
  await flushWrites();
  const gst = (await loadState()).state.settings.main.gst;
  assert.deepEqual([gst.enabled, gst.percent], [true, '18']);

  // table mode off hides tab
  useStore.getState().setTab('tables');
  useStore.getState().setTableMode(false);
  assert.equal(useStore.getState().tab, 'order');
  assert.equal(useStore.getState().data.settings.main.tableMode, false);
  assert.equal(Object.keys(useStore.getState().data.tables).length, 8, 'tables kept while hidden');
});
