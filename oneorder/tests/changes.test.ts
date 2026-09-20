import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { DRILLDOWN_DAYS, hourLabel, recentOrders } from '../src/domain/analytics';
import { consolidateTicketItems } from '../src/domain/bill';
import { formatMoney } from '../src/domain/money';
import * as ops from '../src/domain/ops';
import { seedState } from '../src/domain/seed';
import type { State } from '../src/domain/types';
import { filterUsers, usersToRows } from '../src/domain/users';
import { layoutCookBill, sampleBillData, layoutCustomerBill } from '../src/printing/layout';
import { TEMPLATES } from '../src/printing/templates';
import { buildXlsx } from '../src/util/xlsx';

const T0 = new Date(2026, 8, 16, 12, 0, 0).getTime();
const DAY = 86400000;
const item = (s: State, code: string) => Object.values(s.items).find((i) => i.code === code)!;

function paidOrder(s: State, at: number, code: string, qty: number, phone = ''): State {
  const o = ops.createSession(s, 'takeaway', at);
  let st = ops.addLine(o.state, o.sessionId, item(o.state, code), qty);
  st = ops.sendCookBill(st, o.sessionId, at).state;
  return ops.payAndClose(st, o.sessionId, 'cash', at + 60000, { name: '', phone }).state;
}

test('payment clears leftover kitchen tickets for that order', () => {
  let s = seedState();
  const o = ops.createSession(s, 'takeaway', T0);
  s = ops.addLine(o.state, o.sessionId, item(o.state, 'H01'), 2);
  s = ops.sendCookBill(s, o.sessionId, T0).state;
  assert.equal(Object.keys(s.tickets).length, 1);
  s = ops.payAndClose(s, o.sessionId, 'cash', T0 + 1000).state;
  assert.equal(Object.keys(s.tickets).length, 0, 'pending ticket of a paid order is removed from the kitchen view');
  assert.equal(s.sessions[o.sessionId].status, 'paid');
});

test('users: add, edit (phone change moves the record), duplicate phone rejected, delete, event kept on payment', () => {
  let s = seedState();
  let r = ops.saveCustomer(s, { name: 'Asha', phone: '9000000001', event: 'Birthday' }, T0);
  assert.equal(r.error, undefined);
  s = r.state;
  assert.equal(s.customers['9000000001'].event, 'Birthday');
  assert.ok(ops.saveCustomer(s, { name: '', phone: '', event: '' }, T0).error, 'needs a name or phone');
  r = ops.saveCustomer(s, { name: 'Ravi', phone: '9000000002', event: 'Other' }, T0 + 1);
  s = r.state;
  assert.ok(ops.saveCustomer(s, { name: 'X', phone: '9000000001', event: '' }, T0).error, 'duplicate phone');
  r = ops.saveCustomer(s, { oldId: '9000000002', name: 'Ravi K', phone: '9000000009', event: 'Anniversary' }, T0);
  s = r.state;
  assert.equal(s.customers['9000000002'], undefined);
  assert.equal(s.customers['9000000009'].name, 'Ravi K');
  assert.equal(s.customers['9000000009'].createdAt, T0 + 1, 'serial order is kept when editing');
  // a later payment with the same phone must not wipe the event
  s = paidOrder(s, T0 + 5000, 'H01', 1, '9000000001');
  assert.equal(s.customers['9000000001'].event, 'Birthday');
  // no-phone user
  s = ops.saveCustomer(s, { name: 'Walk-in', phone: '', event: '' }, T0 + 9).state;
  assert.equal(Object.values(s.customers).length, 3);
  // filter + export rows
  const all = filterUsers(s.customers, '', 'all');
  assert.deepEqual(all.map((u) => u.name), ['Asha', 'Ravi K', 'Walk-in']);
  assert.deepEqual(filterUsers(s.customers, '', 'Birthday').map((u) => u.name), ['Asha']);
  assert.deepEqual(filterUsers(s.customers, '', 'none').map((u) => u.name), ['Walk-in']);
  assert.deepEqual(filterUsers(s.customers, '00009', 'all').map((u) => u.name), ['Ravi K']);
  const { headers, rows } = usersToRows(all);
  assert.deepEqual(headers, ['Sr. No.', 'Name', 'Phone', 'Event']);
  assert.deepEqual(rows[0], [1, 'Asha', '9000000001', 'Birthday']);
  assert.deepEqual(rows[2], [3, 'Walk-in', '', '']);
  s = ops.deleteCustomer(s, '9000000001');
  assert.equal(s.customers['9000000001'], undefined);
});

test('xlsx: valid zip package, headers/rows, numbers vs text, escaping', () => {
  const bytes = buildXlsx('Users', ['Sr. No.', 'Name', 'Phone', 'Event'], [
    [1, 'Tom & <Jerry> "Q"', '09000000001', 'Birthday'],
    [2, 'Ünï Ćode', '', ''],
  ]);
  const files = unzipSync(bytes);
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(files[f], `missing ${f}`);
  }
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.ok(sheet.includes('<c r="A2"><v>1</v></c>'), 'numbers are numeric cells');
  assert.ok(sheet.includes('Tom &amp; &lt;Jerry&gt; &quot;Q&quot;'), 'XML escaped');
  assert.ok(sheet.includes('09000000001'), 'phone kept as text with its leading zero');
  assert.ok(sheet.includes('<c r="B3" t="inlineStr"><is><t xml:space="preserve">Ünï Ćode</t></is></c>'));
  assert.ok(sheet.includes('<dimension ref="A1:D3"/>'));
  for (const name of Object.keys(files)) {
    const xml = strFromU8(files[name]);
    const stack: string[] = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
      if (m[3] === '/') continue;
      if (m[1] === '/') assert.equal(stack.pop(), m[2], `${name}: mismatched </${m[2]}>`);
      else stack.push(m[2]);
    }
    assert.equal(stack.length, 0, `${name}: unclosed tags`);
  }
  // 30 columns exercises AA-style names
  const wide = strFromU8(unzipSync(buildXlsx('W', Array.from({ length: 30 }, (_, i) => `H${i}`), []))['xl/worksheets/sheet1.xml']);
  assert.ok(wide.includes('r="AD1"'));
});

test('table layout rollback swaps back to the previous saved layout and is blocked when unsafe', () => {
  let s = seedState();
  assert.ok(ops.rollbackTables(s).error, 'nothing to roll back to yet');
  const moved = ops.moveTableDraft(s.tables, 'tbl_1', 500, 300);
  s = ops.applyTables(s, moved); // save #1
  assert.equal(s.tables.tbl_1.x, 500);
  const added = ops.addTableDraft(s.tables, 700, 400);
  s = ops.applyTables(s, added); // save #2 (adds a table)
  assert.equal(Object.keys(s.tables).length, 9);
  const back = ops.rollbackTables(s);
  assert.equal(back.error, undefined);
  s = back.state;
  assert.equal(Object.keys(s.tables).length, 8, 'the accidental extra table is gone');
  assert.equal(s.tables.tbl_1.x, 500, 'earlier save is kept');
  // rolling back again redoes (swap)
  s = ops.rollbackTables(s).state;
  assert.equal(Object.keys(s.tables).length, 9);
  // unsafe: an open order sits on a table that the previous layout does not have
  const seeded = seedState().tables;
  const newId = Object.keys(s.tables).find((k) => !(k in seeded))!;
  assert.ok(newId, 'the added table exists');
  const o = ops.createSession(s, 'dine-in', T0, newId);
  assert.equal(o.state.sessions[o.sessionId].tableId, newId);
  const blocked = ops.rollbackTables(o.state);
  assert.ok(blocked.error, 'cannot remove a table that has an active order');
});

test('recent orders: 7-day window, newest first, today-only option; hour labels', () => {
  let s = seedState();
  s = paidOrder(s, T0 - 8 * DAY, 'H01', 1);
  s = paidOrder(s, T0 - 6 * DAY, 'H02', 1);
  s = paidOrder(s, T0 - 1 * DAY, 'H03', 1);
  s = paidOrder(s, T0, 'B01', 2);
  const week = recentOrders(s, T0 + 3600000);
  assert.equal(week.length, 3, 'the 8-day-old order is outside the drill-down window');
  assert.deepEqual(week.map((r) => r.total), [180, 120, 40]);
  assert.ok(week[0].paidAt > week[1].paidAt, 'newest first');
  assert.equal(recentOrders(s, T0 + 3600000, true).length, 1);
  assert.equal(Object.values(s.sessions).filter((x) => x.status === 'paid').length, 4, 'older orders are NOT deleted');
  assert.equal(DRILLDOWN_DAYS, 7);
  assert.equal(hourLabel(0, true), '12a');
  assert.equal(hourLabel(12, true), '12p');
  assert.equal(hourLabel(13, true), '1p');
  assert.equal(hourLabel(23, true), '11p');
  assert.equal(hourLabel(13, false), '13');
});

test('cook bill: round-specific vs whole-bill layouts; sample bill amount is Rs 100', () => {
  let s = seedState();
  const o = ops.createSession(s, 'takeaway', T0);
  s = ops.addLine(o.state, o.sessionId, item(o.state, 'B01'), 3);
  s = ops.sendCookBill(s, o.sessionId, T0).state;
  s = ops.addLine(s, o.sessionId, item(s, 'B01'), 2);
  s = ops.addLine(s, o.sessionId, item(s, 'H01'), 5);
  s = ops.sendCookBill(s, o.sessionId, T0 + 1).state;
  const ses = s.sessions[o.sessionId];
  const bill = s.settings.main.bill;
  const t = TEMPLATES[0];
  const round2 = layoutCookBill(t, {
    bill, label: 'Takeaway #1', orderNo: 1, typeLabel: 'Takeaway', round: 2, when: T0,
    items: consolidateTicketItems(ses.lines.filter((l) => l.round === 2)),
  }).map((l) => l.text).join('\n');
  assert.ok(round2.includes('Round 2'));
  assert.ok(round2.includes('2 x Masala Dosa') && !round2.includes('3 x'), 'only that round');
  const whole = layoutCookBill(t, {
    bill, label: 'Takeaway #1', orderNo: 1, typeLabel: 'Takeaway', round: null, when: T0,
    items: consolidateTicketItems(ses.lines.filter((l) => l.round !== null)),
  }).map((l) => l.text).join('\n');
  assert.ok(whole.includes('ALL ROUNDS'));
  assert.ok(whole.includes('5 x Masala Dosa'), '3 + 2 combined into one line');
  assert.ok(whole.includes('5 x Masala Chai'));

  const off = sampleBillData(bill, { enabled: false, percent: '5', number: '' }, T0);
  assert.equal(off.total, 100);
  const on = sampleBillData(bill, { enabled: true, percent: '5', number: 'G' }, T0);
  assert.equal(on.total, 105);
  for (const tpl of TEMPLATES) {
    const text = layoutCustomerBill(tpl, off).map((l) => l.text).join('\n');
    assert.ok(text.includes(formatMoney(100)), `${tpl.id} shows Rs 100`);
    assert.ok(!text.includes('390'));
  }
});
