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

/** Builds a minimal, valid, non-interlaced 8-bit PNG. colorType: 0 gray, 2 RGB, 6 RGBA. */
export function buildPng(width: number, height: number, colorType: 0 | 2 | 6, pixels: number[][]): Uint8Array {
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType];
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = width * channels;
  const raw = new Uint8Array(height * (1 + rowBytes));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + rowBytes)] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const px = pixels[y * width + x];
      for (let c = 0; c < channels; c++) raw[y * (1 + rowBytes) + 1 + x * channels + c] = px[c];
    }
  }
  const idatData = zlibSync(raw);

  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  return concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', new Uint8Array(0))]);
}
