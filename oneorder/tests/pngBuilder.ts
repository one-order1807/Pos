import { zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type.split('').map((c) => c.charCodeAt(0)));
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const ADAM7_PASSES = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 },
];

function encodeBlock(w: number, h: number, channels: number, bytesPerSample: number, pixelAt: (x: number, y: number) => number[]): Uint8Array {
  const rowBytes = w * channels * bytesPerSample;
  const raw = new Uint8Array(h * (1 + rowBytes));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + rowBytes);
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < w; x++) {
      const px = pixelAt(x, y);
      for (let c = 0; c < channels; c++) {
        const v = px[c];
        const o = rowStart + 1 + (x * channels + c) * bytesPerSample;
        if (bytesPerSample === 2) {
          raw[o] = (v >> 8) & 255; // big-endian, matching the PNG spec
          raw[o + 1] = v & 255;
        } else {
          raw[o] = v & 255;
        }
      }
    }
  }
  return raw;
}

/**
 * Builds a minimal, valid PNG. colorType: 0 gray, 2 RGB, 6 RGBA. `pixels` is always given in plain
 * row-major (y*width+x) order with full-range sample values (0-255 for bitDepth 8, 0-65535 for
 * bitDepth 16) regardless of interlace - this function handles reordering into Adam7 pass order
 * internally, so tests can describe images the simple way either way.
 */
export function buildPng(
  width: number,
  height: number,
  colorType: 0 | 2 | 6,
  pixels: number[][],
  opts: { bitDepth?: 8 | 16; interlace?: 0 | 1 } = {},
): Uint8Array {
  const bitDepth = opts.bitDepth ?? 8;
  const interlace = opts.interlace ?? 0;
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType];
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace;

  const pixelAtFull = (x: number, y: number) => pixels[y * width + x];

  let raw: Uint8Array;
  if (interlace === 0) {
    raw = encodeBlock(width, height, channels, bytesPerSample, pixelAtFull);
  } else {
    const blocks: Uint8Array[] = [];
    for (const pass of ADAM7_PASSES) {
      const pw = Math.max(0, Math.ceil((width - pass.xStart) / pass.xStep));
      const ph = Math.max(0, Math.ceil((height - pass.yStart) / pass.yStep));
      if (pw === 0 || ph === 0) continue;
      blocks.push(
        encodeBlock(pw, ph, channels, bytesPerSample, (x, y) => pixelAtFull(pass.xStart + x * pass.xStep, pass.yStart + y * pass.yStep)),
      );
    }
    raw = concat(blocks);
  }
  const idatData = zlibSync(raw);

  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', new Uint8Array(0))]);
}
