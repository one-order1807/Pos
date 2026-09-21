import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDashboard, tierFor } from '../src/domain/analytics';
import { applyBackup, buildBackup, buildMenuExport, importMenu, parseBackup, previewBackup } from '../src/domain/backup';
import { computeTotals, consolidateLines, roundGroups } from '../src/domain/bill';
import { makeTapGuard } from '../src/domain/guard';
import { formatMoney, parseGstPercent } from '../src/domain/money';
import * as ops from '../src/domain/ops';
import { seedState } from '../src/domain/seed';
import { hashPin, sha256 } from '../src/domain/sha256';
import type { State } from '../src/domain/types';
import { toBase64, encodeEscPos } from '../src/printing/escpos';
import {
  layoutCookBill,
  layoutCustomerBill,
  sampleBillData,
  sampleCookData,
  textOnly,
} from '../src/printing/layout';
import { TEMPLATES } from '../src/printing/templates';

const T0 = new Date(2026, 8, 16, 12, 0, 0).getTime();
const item = (s: State, code: string) => Object.values(s.items).find((i) => i.code === code)!;

test('sha256 matches known vector and PIN hashing verifies', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const h = hashPin('180704', 'salt1');
  assert.equal(h, hashPin('180704', 'salt1'));
  assert.notEqual(h, hashPin('180705', 'salt1'));
  assert.ok(!h.includes('180704'));
  const s = seedState();
  assert.equal(hashPin('180704', s.settings.main.pinSalt), s.settings.main.pinHash);
});

test('money formatting and GST parsing', () => {
  assert.equal(formatMoney(3200), 'Rs 3,200');
  assert.equal(formatMoney(19.5), 'Rs 19.50');
  assert.equal(formatMoney(409.5), 'Rs 409.50');
  assert.equal(formatMoney(100000), 'Rs 1,00,000');
  assert.equal(formatMoney(1234567), 'Rs 12,34,567');
  assert.equal(parseGstPercent('5%'), 5);
  assert.equal(parseGstPercent(' 1 '), 1);
  assert.equal(parseGstPercent('abc'), 0);
  assert.equal(parseGstPercent('-4'), 0);
  assert.equal(parseGstPercent('250'), 100);
});

test('GST: off => no GST line; on => calculated; percent remembered', () => {
  let s = seedState();
  const cs = createOrder(s, 'dine-in', 'tbl_1');
  s = cs.state;
  s = ops.addLine(s, cs.id, item(s, 'B01'), 3, '');
  s = ops.addLine(s, cs.id, item(s, 'B02'), 2, '');
  const lines = s.sessions[cs.id].lines;
  const off = computeTotals(lines, s.settings.main.gst);
  assert.equal(off.gstAmount, 0);
  assert.equal(off.total, 390);
  const on = computeTotals(lines, { enabled: true, percent: '5', number: 'X' });
  assert.equal(on.subtotal, 390);
  assert.equal(on.gstAmount, 19.5);
  assert.equal(on.total, 409.5);
  const off2 = computeTotals(lines, { enabled: false, percent: '5', number: 'X' });
  assert.equal(off2.total, 390);
  const one = computeTotals(lines, { enabled: true, percent: '1%', number: '' });
  assert.equal(one.gstAmount, 3.9);
});

function createOrder(s: State, type: 'dine-in' | 'takeaway' | 'delivery', tableId?: string) {
  const r = ops.createSession(s, type, T0, tableId ?? null);
  return { state: r.state, id: r.sessionId, redirected: r.redirected };
}

test('Part C workflow: rounds, cook bill only new items, consolidated customer bill', () => {
  let s = seedState();
  const o = createOrder(s, 'dine-in');
  s = o.state;
  // no table yet -> cook bill needs table
  s = ops.addLine(s, o.id, item(s, 'B01'), 3);
  s = ops.addLine(s, o.id, item(s, 'H01'), 3);
  const blocked = ops.sendCookBill(s, o.id, T0);
  assert.equal(blocked.error, 'needs-table');
  const a = ops.assignTable(s, o.id, 'tbl_5', T0);
  assert.equal(a.redirected, false);
  s = a.state;
  const r1 = ops.sendCookBill(s, o.id, T0 + 1000);
  s = r1.state;
  const t1 = s.tickets[r1.ticketId!];
  assert.deepEqual(t1.items.map((i) => `${i.name} x${i.qty}`).sort(), ['Masala Chai x3', 'Masala Dosa x3']);
  assert.equal(ops.tableStatus(s, 'tbl_5'), 'cooking');
  assert.equal(s.sessions[o.id].startedAt, T0 + 1000);

  // "later": same table again -> same session
  const again = ops.createSession(s, 'dine-in', T0 + 5000, 'tbl_5');
  assert.equal(again.redirected, true);
  assert.equal(again.sessionId, o.id);

  s = ops.addLine(s, o.id, item(s, 'B01'), 2);
  s = ops.addLine(s, o.id, item(s, 'H01'), 5);
  const r2 = ops.sendCookBill(s, o.id, T0 + 9000);
  s = r2.state;
  const t2 = s.tickets[r2.ticketId!];
  assert.deepEqual(t2.items.map((i) => `${i.name} x${i.qty}`).sort(), ['Masala Chai x5', 'Masala Dosa x2']);
  const nothing = ops.sendCookBill(s, o.id, T0 + 9500);
  assert.equal(nothing.error, 'nothing-to-send');

  const groups = roundGroups(s.sessions[o.id].lines);
  assert.deepEqual(groups.map((g) => g.round), [1, 2]);
  const bill = consolidateLines(s.sessions[o.id].lines);
  assert.equal(bill.length, 2);
  assert.equal(bill.find((b) => b.name === 'Masala Dosa')!.qty, 5);
  assert.equal(bill.find((b) => b.name === 'Masala Chai')!.qty, 8);
});

test('Part F.2: Dal Makhani 2 + 8 + 6 => one line 16x Rs 3,200', () => {
  let s = seedState();
  s = {
    ...s,
    items: { ...s.items, dal: { id: 'dal', code: 'X1', name: 'Dal Makhani', categoryId: 'cat_snack', price: 200, active: true } },
  };
  const o = createOrder(s, 'takeaway');
  s = o.state;
  for (const q of [2, 8, 6]) {
    s = ops.addLine(s, o.id, s.items.dal, q);
    s = ops.sendCookBill(s, o.id, T0).state;
  }
  const bill = consolidateLines(s.sessions[o.id].lines);
  assert.equal(bill.length, 1);
  assert.equal(bill[0].qty, 16);
  assert.equal(formatMoney(bill[0].amount), 'Rs 3,200');
  assert.equal(s.sessions[o.id].rounds, 3);
});

test('E.1 one table = one active session; draft items move into existing session', () => {
  let s = seedState();
  const a = createOrder(s, 'dine-in', 'tbl_2');
  s = a.state;
  s = ops.addLine(s, a.id, item(s, 'H02'), 1);
  s = ops.sendCookBill(s, a.id, T0).state;

  const b = createOrder(s, 'dine-in');
  s = b.state;
  s = ops.addLine(s, b.id, item(s, 'S03'), 4);
  const sessionsBefore = ops.openSessions(s).length;
  const res = ops.assignTable(s, b.id, 'tbl_2', T0);
  assert.equal(res.redirected, true);
  assert.equal(res.sessionId, a.id);
  assert.equal(res.movedItems, 4);
  s = res.state;
  assert.equal(ops.openSessions(s).length, sessionsBefore - 1);
  assert.equal(s.sessions[b.id], undefined);
  const tableSessions = Object.values(s.sessions).filter((x) => x.status === 'open' && x.tableId === 'tbl_2');
  assert.equal(tableSessions.length, 1);
  assert.equal(ops.unsentLines(s.sessions[a.id])[0].qty, 4);
  assert.equal(ops.activeSessionForTable(s, 'tbl_2')?.id, a.id);
});

test('order counter: one number per session, no skipped numbers, rollback of empty draft', () => {
  let s = seedState();
  const nos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const o = createOrder(s, 'takeaway');
    s = o.state;
    nos.push(s.sessions[o.id].orderNo);
  }
  assert.deepEqual(nos, [1, 2, 3, 4]);
  const d = createOrder(s, 'takeaway');
  s = d.state;
  assert.equal(s.sessions[d.id].orderNo, 5);
  s = ops.closeSession(s, d.id, T0);
  const e = createOrder(s, 'takeaway');
  assert.equal(e.state.sessions[e.id].orderNo, 5);
});

test('tap guard blocks double-fire but allows later taps', () => {
  const g = makeTapGuard(150);
  assert.equal(g('a', 1000), true);
  assert.equal(g('a', 1005), false);
  assert.equal(g('b', 1006), true);
  assert.equal(g('a', 1300), true);
});

test('E.3 closing an unpaid tab really closes it and frees the table', () => {
  let s = seedState();
  const a = createOrder(s, 'dine-in', 'tbl_3');
  s = a.state;
  s = ops.addLine(s, a.id, item(s, 'H01'), 2);
  s = ops.sendCookBill(s, a.id, T0).state;
  assert.equal(ops.tableStatus(s, 'tbl_3'), 'cooking');
  s = ops.closeSession(s, a.id, T0);
  assert.equal(s.sessions[a.id].status, 'closed');
  assert.equal(ops.openSessions(s).length, 0);
  assert.equal(ops.tableStatus(s, 'tbl_3'), 'available');
  assert.equal(Object.values(s.tickets).length, 0);
  const b = ops.createSession(s, 'dine-in', T0, 'tbl_3');
  assert.equal(b.redirected, false);
});

test('payment: unsent items block, then pays, freezes totals, unmerges', () => {
  let s = seedState();
  const m = ops.mergeTablesDraft(s.tables, ['tbl_1', 'tbl_2', 'tbl_3'], ops.lockedTableIds(s));
  assert.equal(m.tables[m.mergedId!].label, 'T-1M3');
  s = ops.applyTables(s, m.tables);
  assert.equal(ops.visibleTables(s)[0].label, 'T-1M3');
  assert.ok(!ops.visibleTables(s).some((t) => t.id === 'tbl_2'));
  s = { ...s, settings: { main: { ...s.settings.main, gst: { enabled: true, percent: '5', number: 'G1' } } } };

  const o = ops.createSession(s, 'dine-in', T0, 'tbl_2'); // member resolves to merged table
  s = o.state;
  assert.equal(s.sessions[o.sessionId].tableId, m.mergedId);
  s = ops.addLine(s, o.sessionId, item(s, 'B01'), 2);
  assert.equal(ops.payAndClose(s, o.sessionId, 'cash', T0).error, 'unsent-items');
  s = ops.sendCookBill(s, o.sessionId, T0).state;
  const paid = ops.payAndClose(s, o.sessionId, 'upi', T0 + 10, { name: 'Asha', phone: '9999900000' });
  assert.equal(paid.error, undefined);
  s = paid.state;
  const ses = s.sessions[o.sessionId];
  assert.equal(ses.status, 'paid');
  assert.equal(ses.final!.subtotal, 180);
  assert.equal(ses.final!.gstAmount, 9);
  assert.equal(ses.final!.total, 189);
  assert.ok(!s.tables[m.mergedId!], 'merged table auto-unmerged');
  assert.equal(s.tables.tbl_2.mergedInto, undefined);
  assert.equal(ops.tableStatus(s, 'tbl_1'), 'available');
  assert.equal(s.customers['9999900000'].name, 'Asha');
});

test('merge guards: locked tables cannot merge/remove; unmerge works', () => {
  let s = seedState();
  const a = createOrder(s, 'dine-in', 'tbl_1');
  s = a.state;
  const locked = ops.lockedTableIds(s);
  assert.ok(locked.has('tbl_1'));
  assert.ok(ops.mergeTablesDraft(s.tables, ['tbl_1', 'tbl_2'], locked).error);
  assert.equal(ops.removeTableDraft(s.tables, 'tbl_1', locked), s.tables);
  assert.ok(ops.mergeTablesDraft(s.tables, ['tbl_2'], locked).error);
  const m = ops.mergeTablesDraft(s.tables, ['tbl_2', 'tbl_3'], locked);
  const um = ops.unmergeTableDraft(m.tables, m.mergedId!, locked);
  assert.equal(Object.keys(um.tables).length, 8);
  assert.equal(ops.validateTables(s, ops.removeTableDraft(s.tables, 'tbl_4', locked)), null);
  const bad = { ...s.tables };
  delete bad.tbl_1;
  assert.ok(ops.validateTables(s, bad));
  const added = ops.addTableDraft(s.tables, 10, 10);
  const newId = Object.keys(added).find((k) => !s.tables[k])!;
  assert.equal(added[newId].label, 'T-9');
  assert.deepEqual([added[newId].x, added[newId].y], [10, 10]);
});

test('kitchen: start, ready, and drag-reorder pending priority', () => {
  let s = seedState();
  const ids: string[] = [];
  for (const [t, code] of [['tbl_1', 'H01'], ['tbl_2', 'H02'], ['tbl_3', 'H03']] as const) {
    const o = createOrder(s, 'dine-in', t);
    s = ops.addLine(o.state, o.id, item(o.state, code), 1);
    const r = ops.sendCookBill(s, o.id, T0);
    s = r.state;
    ids.push(r.ticketId!);
  }
  assert.deepEqual(ops.pendingTickets(s).map((t) => t.id), ids);
  s = ops.reorderPending(s, ids[2], 0);
  assert.deepEqual(ops.pendingTickets(s).map((t) => t.id), [ids[2], ids[0], ids[1]]);
  s = ops.startTicket(s, ids[2], T0 + 100);
  assert.equal(s.tickets[ids[2]].status, 'cooking');
  s = ops.markReady(s, ids[2], T0 + 200);
  assert.equal(s.tickets[ids[2]].status, 'ready');
  assert.deepEqual(ops.pendingTickets(s).map((t) => t.id), [ids[0], ids[1]]);
  const o = createOrder(s, 'takeaway');
  s = ops.addLine(o.state, o.id, item(o.state, 'S01'), 1);
  const r = ops.sendCookBill(s, o.id, T0 + 300);
  s = r.state;
  assert.equal(ops.pendingTickets(s).pop()!.id, r.ticketId);
});

test('dashboard derives everything from paid sessions', () => {
  let s = seedState();
  s = { ...s, settings: { main: { ...s.settings.main, gst: { enabled: false, percent: '5', number: '' } } } };
  const mk = (type: 'dine-in' | 'takeaway', code: string, qty: number, method: 'cash' | 'upi', phone: string) => {
    const o = type === 'dine-in' ? createOrder(s, type, 'tbl_1') : createOrder(s, type);
    s = ops.addLine(o.state, o.id, item(o.state, code), qty);
    s = ops.sendCookBill(s, o.id, T0).state;
    s = ops.payAndClose(s, o.id, method, T0 + 5000, { name: '', phone }).state;
  };
  mk('dine-in', 'B01', 2, 'cash', '111');
  mk('takeaway', 'H03', 1, 'upi', '111');
  mk('takeaway', 'B01', 1, 'upi', '');
  const d = buildDashboard(s, 'today', T0 + 60000);
  assert.equal(d.orders, 3);
  assert.equal(d.sales, 180 + 120 + 90);
  assert.equal(d.avgOrder, 130);
  assert.equal(d.typeSplit.takeaway.orders, 2);
  assert.equal(d.paySplit.upi.sales, 210);
  assert.equal(d.bestSelling[0].name, 'Masala Dosa');
  assert.equal(d.bestSelling[0].qty, 3);
  assert.equal(d.peakHours[12], 3);
  assert.equal(d.customers.identified, 1);
  assert.equal(d.customers.returning, 1);
  assert.equal(d.customers.top[0].visits, 2);
  assert.equal(tierFor(1, 100), 'Regular');
  assert.equal(tierFor(5, 100), 'Silver');
  assert.equal(tierFor(1, 6000), 'Gold');
  const empty = buildDashboard(seedState(), 'today', T0);
  assert.equal(empty.orders, 0);
  assert.equal(empty.sales, 0);
  assert.equal(empty.avgOrder, 0);
});

test('backup: no PIN leak, preview, restore; menu import is additive-only', () => {
  let s = seedState();
  const o = createOrder(s, 'takeaway');
  s = ops.addLine(o.state, o.id, item(o.state, 'H01'), 1);
  const text = JSON.stringify(buildBackup(s, T0));
  assert.ok(!text.includes(s.settings.main.pinHash));
  assert.ok(!text.includes(s.settings.main.pinSalt));
  const parsed = parseBackup(text);
  assert.ok(parsed.backup);
  const prev = previewBackup(parsed.backup!, s);
  assert.equal(prev.items, 15);
  assert.equal(prev.openSessionsLost, 1);
  assert.ok(parseBackup('nope').error);
  assert.ok(parseBackup('{"app":"x"}').error);
  const empty = seedState();
  const restored = applyBackup(empty, parsed.backup!);
  assert.equal(Object.keys(restored.sessions).length, 1);
  assert.equal(restored.settings.main.pinHash, empty.settings.main.pinHash);

  const menu = JSON.stringify({
    app: 'oneorder-menu',
    version: 1,
    categories: [{ id: 'cat_new', name: 'Specials', sort: 9 }],
    items: [
      { id: 'itm_h01', name: 'Masala Chai Deluxe', categoryId: 'cat_hot', price: 25 },
      { id: 'itm_new', name: 'Pizza', categoryId: 'cat_new', price: 200 },
      { id: 'bad', name: '', categoryId: 'cat_new', price: 1 },
    ],
  });
  const imp = importMenu(s, menu);
  assert.equal(imp.error, undefined);
  assert.equal(imp.addedItems, 1);
  assert.equal(imp.updatedItems, 1);
  assert.equal(imp.skipped, 1);
  assert.equal(Object.keys(imp.state.items).length, 16);
  assert.equal(imp.state.items.itm_h01.price, 25);
  assert.equal(imp.state.items.itm_h02.name, 'Filter Coffee');
  assert.ok(importMenu(s, '{}').error);
  assert.equal(JSON.parse(JSON.stringify(buildMenuExport(s))).items.length, 15);
});

test('print layout: fits width, consolidated, GST line only when on, test marked', () => {
  const s = seedState();
  const bill = s.settings.main.bill;
  for (const t of TEMPLATES) {
    for (const gstOn of [false, true]) {
      const gst = { enabled: gstOn, percent: '5', number: 'GSTIN123' };
      const data = sampleBillData(bill, gst, T0);
      const lines = textOnly(layoutCustomerBill(t, data));
      for (const l of lines) {
        const width = l.size === 2 ? t.columns / 2 : t.columns;
        assert.ok(l.text.length <= width, `${t.id} line too long (${l.text.length}>${width}): "${l.text}"`);
      }
      const text = lines.map((l) => l.text).join('\n');
      assert.ok(text.includes('TEST - no customer order placed'));
      assert.equal(/GST \(/.test(text), gstOn, `${t.id} gst line`);
      assert.equal(text.includes('GSTIN123'), gstOn);
    }
    const cook = textOnly(layoutCookBill(t, sampleCookData(bill, T0)));
    const ctext = cook.map((l) => l.text).join('\n');
    assert.ok(!/Rs/.test(ctext), 'cook bill has no prices');
    assert.ok(ctext.includes('less spicy'));
    for (const l of cook) {
      const width = l.size === 2 ? t.columns / 2 : t.columns;
      assert.ok(l.text.length <= width, `${t.id} cook line too long: "${l.text}"`);
    }
  }
  const bytes = encodeEscPos(layoutCookBill(TEMPLATES[0], sampleCookData(bill, T0)));
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);
  assert.equal(toBase64(Uint8Array.from([72, 105])), 'SGk=');
  assert.equal(toBase64(Uint8Array.from([1, 2, 3])), 'AQID');
});
