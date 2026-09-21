import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64ToBytes, bytesToBase64, getPixel } from '../src/printing/bits';
import { decodePng } from '../src/printing/png';
import { buildPng } from './pngBuilder';
import { ditherToMono, fitLogo, monoToBmpDataUri, renderQr } from '../src/printing/raster';

test('PNG decode: RGBA round-trips exact pixel values', () => {
  const pixels = [
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 255, 0],
    [10, 20, 30, 255],
  ];
  const png = buildPng(2, 2, 6, pixels);
  const img = decodePng(png);
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  for (let i = 0; i < 4; i++) {
    assert.deepEqual([img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2], img.rgba[i * 4 + 3]], pixels[i]);
  }
});

test('PNG decode: RGB (no alpha channel) defaults alpha to 255', () => {
  const png = buildPng(1, 1, 2, [[9, 8, 7]]);
  const img = decodePng(png);
  assert.deepEqual([...img.rgba], [9, 8, 7, 255]);
});

test('PNG decode: grayscale', () => {
  const png = buildPng(2, 1, 0, [[0], [255]]);
  const img = decodePng(png);
  assert.deepEqual([...img.rgba.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...img.rgba.subarray(4, 8)], [255, 255, 255, 255]);
});

test('PNG decode: rejects non-PNG data', () => {
  assert.throws(() => decodePng(Uint8Array.of(1, 2, 3, 4)), /Not a PNG/);
});

test('dithering: uniform black/white images dither cleanly with no drift', () => {
  const black = decodePng(buildPng(4, 4, 0, Array.from({ length: 16 }, () => [0])));
  const white = decodePng(buildPng(4, 4, 0, Array.from({ length: 16 }, () => [255])));
  const blackMono = ditherToMono(black, 4, 4);
  const whiteMono = ditherToMono(white, 4, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      assert.equal(getPixel(blackMono, x, y), true, `black(${x},${y})`);
      assert.equal(getPixel(whiteMono, x, y), false, `white(${x},${y})`);
    }
  }
});

test('dithering: transparent pixels composite to white, not black', () => {
  const img = decodePng(buildPng(2, 2, 6, [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]));
  const mono = ditherToMono(img, 2, 2);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) assert.equal(getPixel(mono, x, y), false);
});

test('fitLogo: scales down preserving aspect ratio, never upscales', () => {
  const wide = decodePng(buildPng(40, 20, 0, Array.from({ length: 800 }, () => [0])));
  const m = fitLogo(wide, 10, 10);
  assert.equal(m.width, 10, 'constrained by the wider dimension');
  assert.equal(m.height, 5, 'aspect ratio (2:1) preserved');
  const small = decodePng(buildPng(2, 2, 0, Array.from({ length: 4 }, () => [0])));
  const m2 = fitLogo(small, 100, 100);
  assert.equal(m2.width, 2, 'a smaller-than-target image is not upscaled');
  assert.equal(m2.height, 2);
});

test('QR: has a quiet zone border, contains dark modules, and differs by content', () => {
  const a = renderQr('https://example.com/review-a', 200);
  const b = renderQr('https://example.com/review-b', 200);
  assert.ok(a.width >= 190 && a.width <= 260, `width ${a.width} near target`);
  const quiet = Math.round((a.width / 37) * 4); // ~4-module border for a typical module count
  let anyDark = false;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (getPixel(a, x, y)) anyDark = true;
    }
  }
  assert.ok(anyDark, 'QR has at least one dark module');
  // top-left corner well inside the quiet zone must be blank
  for (let y = 0; y < Math.max(1, quiet - 2); y++) {
    for (let x = 0; x < Math.max(1, quiet - 2); x++) {
      assert.equal(getPixel(a, x, y), false, `quiet zone (${x},${y})`);
    }
  }
  let differs = false;
  const minW = Math.min(a.width, b.width);
  const minH = Math.min(a.height, b.height);
  for (let y = 0; y < minH && !differs; y++) {
    for (let x = 0; x < minW; x++) {
      if (getPixel(a, x, y) !== getPixel(b, x, y)) {
        differs = true;
        break;
      }
    }
  }
  assert.ok(differs, 'different text produces a different QR bitmap');
});

test('QR: very dense content still respects the minimum scannable module size', () => {
  const long = renderQr('https://example.com/'.padEnd(400, 'x'), 150);
  assert.ok(long.width > 150, 'falls back to a larger physical size rather than shrinking modules below the minimum');
});

test('BMP encoding: valid header, correct dimensions, and pixels round-trip', () => {
  const img = decodePng(buildPng(2, 2, 0, [[0], [255], [255], [0]]));
  const mono = ditherToMono(img, 2, 2);
  const uri = monoToBmpDataUri(mono);
  assert.match(uri, /^data:image\/bmp;base64,/);
  const bytes = base64ToBytes(uri.split(',')[1]);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'BM');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getInt32(18, true), 2, 'width');
  assert.equal(dv.getInt32(22, true), -2, 'height stored negative (top-down)');
  assert.equal(dv.getUint16(28, true), 24, 'bits per pixel');
  const pixelStart = dv.getUint32(10, true);
  const rowBytes = Math.ceil((2 * 3) / 4) * 4;
  // (0,0) was black -> BGR 0,0,0 ; (1,0) was white -> BGR 255,255,255
  assert.deepEqual([...bytes.subarray(pixelStart, pixelStart + 3)], [0, 0, 0]);
  assert.deepEqual([...bytes.subarray(pixelStart + 3, pixelStart + 6)], [255, 255, 255]);
  void rowBytes;
});

test('base64 helpers round-trip byte arrays of every padding length', () => {
  for (let len = 0; len <= 9; len++) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 5) % 256);
    const roundTripped = base64ToBytes(bytesToBase64(bytes));
    assert.deepEqual([...roundTripped], [...bytes], `len=${len}`);
  }
});
