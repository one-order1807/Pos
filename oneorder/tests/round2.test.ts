import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMono, setPixel } from '../src/printing/bits';
import { occasionLine } from '../src/domain/occasion';
import { encodeEscPos } from '../src/printing/escpos';
import { isPrintImage, layoutCustomerBill, textOnly, type BillData } from '../src/printing/layout';
import { monoToRasterAsset } from '../src/printing/raster';
import { TEMPLATES, templateById } from '../src/printing/templates';
import * as ops from '../src/domain/ops';
import { seedState } from '../src/domain/seed';

const T0 = new Date(2026, 8, 16, 12, 0, 0).getTime();

function baseBillData(s: ReturnType<typeof seedState>): BillData {
  return {
    bill: s.settings.main.bill,
    gst: s.settings.main.gst,
    label: 'T-1',
    tableLabel: 'T-1',
    orderNo: 5,
    typeLabel: 'Dine-in',
    lines: [
      { key: 'a', name: 'Espresso', qty: 5, unitPrice: 90, amount: 450 },
      { key: 'b', name: 'Hot Chocolate', qty: 2, unitPrice: 140, amount: 280 },
    ],
    subtotal: 730,
    gstPercent: 0,
    gstAmount: 0,
    total: 730,
    when: T0,
  };
}

test('customer bill: sectioned structure with Bill #, table, and a rule between every section', () => {
  const s = seedState();
  const data = baseBillData(s);
  for (const t of TEMPLATES) {
    const lines = textOnly(layoutCustomerBill(t, data));
    const text = lines.map((l) => l.text);
    assert.ok(text.some((l) => l.includes(`Bill #${data.orderNo}`) && l.includes('Table T-1')));
    const rules = text.filter((l) => /^[-=]+$/.test(l));
    assert.ok(rules.length >= 4, `expected several section separators, got ${rules.length}`);
    for (const l of lines) {
      const width = l.size === 2 ? t.columns / 2 : t.columns;
      assert.ok(l.text.length <= width, `${t.id} "${l.text}" overflows ${width} cols`);
    }
  }
});

test('occasion greeting: Birthday prints with name, Anniversary without, off by default, Other/no-event silent', () => {
  const birthday = { event: 'Birthday' as const, name: 'Rahul' };
  assert.equal(occasionLine(birthday, '', false), undefined, 'off by default');
  assert.equal(occasionLine(birthday, '', true), 'Happy Birthday, Rahul!');
  assert.equal(occasionLine(birthday, 'Session Name', true), 'Happy Birthday, Session Name!', 'session name wins over stored name');
  assert.equal(occasionLine({ event: 'Anniversary', name: 'Rahul' }, '', true), 'Happy Anniversary!', 'never includes a name');
  assert.equal(occasionLine({ event: 'Other', name: 'Rahul' }, '', true), undefined);
  assert.equal(occasionLine({ event: '', name: 'Rahul' }, '', true), undefined);
  assert.equal(occasionLine(undefined, '', true), undefined);
});

test('logo and QR appear as real image blocks on the bill, and the brand footer is always present', () => {
  const s = seedState();
  const logoMono = createMono(8, 4);
  setPixel(logoMono, 0, 0, true);
  const qrMono = createMono(16, 16);
  setPixel(qrMono, 1, 1, true);
  const withAssets: BillData = {
    ...baseBillData(s),
    bill: { ...s.settings.main.bill, logoRaster: monoToRasterAsset(logoMono), qrRaster: monoToRasterAsset(qrMono) },
  };
  const blocks = layoutCustomerBill(templateById('t2'), withAssets);
  const images = blocks.filter(isPrintImage);
  assert.equal(images.length, 2, 'logo and QR both present');
  assert.equal(images[0].width, 8);
  assert.equal(images[0].height, 4);
  assert.equal(images[1].width, 16);
  const brandLines = textOnly(blocks).filter((l) => l.brand);
  assert.equal(brandLines.length, 1);
  assert.equal(brandLines[0].text, 'ONE ORDER x Cloud Build');

  const noAssets = layoutCustomerBill(templateById('t2'), baseBillData(s));
  assert.equal(noAssets.filter(isPrintImage).length, 0, 'no image blocks when nothing is configured');
  assert.equal(textOnly(noAssets).filter((l) => l.brand).length, 1, 'brand footer still present with no logo/QR');
});

test('ESC/POS: an image block encodes a real GS v 0 raster command with the right byte length', () => {
  const mono = createMono(10, 3); // bytesPerRow = ceil(10/8) = 2
  setPixel(mono, 0, 0, true);
  setPixel(mono, 9, 2, true);
  const bytes = encodeEscPos([{ kind: 'image', width: 10, height: 3, bits: mono.bits }]);
  const gsIdx = Array.from(bytes).findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
  assert.ok(gsIdx >= 0, 'GS v 0 command present');
  assert.equal(bytes[gsIdx + 3], 0x00);
  assert.equal(bytes[gsIdx + 4], 2, 'xL = bytesPerRow low byte');
  assert.equal(bytes[gsIdx + 5], 0, 'xH');
  assert.equal(bytes[gsIdx + 6], 3, 'yL = height low byte');
  assert.equal(bytes[gsIdx + 7], 0, 'yH');
  const payload = bytes.slice(gsIdx + 8, gsIdx + 8 + 2 * 3);
  assert.deepEqual([...payload], [...mono.bits]);
});

test('Table Mode off: a dine-in order sends its Cook Bill with no table ever required', () => {
  let s = seedState();
  s = { ...s, settings: { main: { ...s.settings.main, tableMode: false } } };
  const o = ops.createSession(s, 'dine-in', T0, null);
  const item = Object.values(o.state.items).find((i) => i.code === 'H01')!;
  s = ops.addLine(o.state, o.sessionId, item, 1);
  const r = ops.sendCookBill(s, o.sessionId, T0);
  assert.equal(r.error, undefined, 'table mode off never blocks on a missing table');
  assert.ok(r.ticketId);
});
