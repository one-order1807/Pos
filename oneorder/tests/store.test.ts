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

  // settings edits persist (GST toggle keeps its lines)
  useStore.getState().setGst({ enabled: true, lines: [{ type: 'GST', percent: '18' }] });
  useStore.getState().setGst({ enabled: false });
  useStore.getState().setGst({ enabled: true });
  await flushWrites();
  const gst = (await loadState()).state.settings.main.gst;
  assert.deepEqual([gst.enabled, gst.lines], [true, [{ type: 'GST', percent: '18' }]]);

  // table mode off hides tab
  useStore.getState().setTab('tables');
  useStore.getState().setTableMode(false);
  assert.equal(useStore.getState().tab, 'order');
  assert.equal(useStore.getState().data.settings.main.tableMode, false);
  assert.equal(Object.keys(useStore.getState().data.tables).length, 8, 'tables kept while hidden');

  // Chef Mode: wrong code does nothing and stays locked; right code exits; the flag is a
  // per-device SQLite pref (device_prefs table), never one of the synced "docs" rows.
  assert.equal(useStore.getState().chefMode, false);
  useStore.getState().enterChefMode();
  assert.equal(useStore.getState().chefMode, true);
  assert.equal(useStore.getState().tab, 'kitchen');
  assert.equal(useStore.getState().exitChefMode('0000'), false, 'wrong code is rejected');
  assert.equal(useStore.getState().chefMode, true, 'still in Chef Mode after a wrong code');
  assert.equal(useStore.getState().exitChefMode('1807'), true);
  assert.equal(useStore.getState().chefMode, false);
  await wait(20); // setDevicePref() is fire-and-forget from the store action
  const pref = shim.db.prepare('SELECT value FROM device_prefs WHERE key = ?').get('chefMode') as { value: string } | undefined;
  assert.equal(pref?.value, '0', 'persisted in the separate per-device table, not as a synced doc');
});

test('applyRemoteChanges: last-write-wins by timestamp, and a dirty (pending local) row always wins regardless', async () => {
  const { applyRemoteChanges, getDirty } = require('../src/db/sqlite');
  const row = (collection: string, id: string) =>
    shim.db.prepare('SELECT json, updated_at, dirty, deleted FROM docs WHERE collection = ? AND id = ?').get(collection, id) as
      | { json: string; updated_at: number; dirty: number; deleted: number }
      | undefined;
  const seed = (collection: string, id: string, json: string, updatedAt: number, dirty: number) =>
    shim.db
      .prepare('INSERT INTO docs (collection, id, json, updated_at, dirty, deleted) VALUES (?, ?, ?, ?, ?, 0)')
      .run(collection, id, json, updatedAt, dirty);

  // 1. brand new doc from another device: applied even though nothing existed locally.
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_new', doc: { id: 'rc_new', name: 'Remote', sort: 99 }, updatedAt: 100 }]);
  assert.equal(row('categories', 'rc_new')?.dirty, 0, 'written as not-dirty, so it is never pushed back out');
  assert.deepEqual(JSON.parse(row('categories', 'rc_new')!.json), { id: 'rc_new', name: 'Remote', sort: 99 });

  // 2. a newer remote update overwrites an older, already-synced (not dirty) local copy.
  seed('categories', 'rc_a', JSON.stringify({ id: 'rc_a', name: 'Old', sort: 1 }), 100, 0);
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_a', doc: { id: 'rc_a', name: 'New', sort: 2 }, updatedAt: 200 }]);
  assert.equal(JSON.parse(row('categories', 'rc_a')!.json).name, 'New', 'newer remote write applied');

  // 3. an *older* remote update never overwrites a newer local copy - classic last-write-wins.
  seed('categories', 'rc_b', JSON.stringify({ id: 'rc_b', name: 'Local-newer', sort: 1 }), 500, 0);
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_b', doc: { id: 'rc_b', name: 'Remote-older', sort: 2 }, updatedAt: 300 }]);
  assert.equal(JSON.parse(row('categories', 'rc_b')!.json).name, 'Local-newer', 'older remote write is dropped');

  // 4. a row with a *pending local edit* (dirty=1) is never clobbered by an incoming remote
  // change, even one with a later timestamp - unsynced local work always wins.
  seed('categories', 'rc_c', JSON.stringify({ id: 'rc_c', name: 'Local-pending', sort: 1 }), 100, 1);
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_c', doc: { id: 'rc_c', name: 'Remote-later', sort: 2 }, updatedAt: 9999 }]);
  assert.equal(JSON.parse(row('categories', 'rc_c')!.json).name, 'Local-pending', 'dirty row is protected from remote overwrite');
  const stillDirty = (await getDirty(1000)).find((r: any) => r.collection === 'categories' && r.id === 'rc_c');
  assert.ok(stillDirty, 'the pending local edit is still queued to push, untouched');

  // 5. a remote delete removes a non-dirty local row.
  seed('categories', 'rc_d', JSON.stringify({ id: 'rc_d', name: 'ToDelete', sort: 1 }), 100, 0);
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_d', doc: null, updatedAt: 999 }]);
  assert.equal(row('categories', 'rc_d')?.deleted, 1);

  // 6. a remote delete does not remove a row with a pending local edit.
  seed('categories', 'rc_e', JSON.stringify({ id: 'rc_e', name: 'KeepMe', sort: 1 }), 100, 1);
  await applyRemoteChanges([{ collection: 'categories', id: 'rc_e', doc: null, updatedAt: 999 }]);
  assert.equal(row('categories', 'rc_e')?.deleted, 0, 'dirty row survives a concurrent remote delete');
});
