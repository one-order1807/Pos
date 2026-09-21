// Shared helpers for 1-bit-per-pixel monochrome bitmaps (1 = black/printed).
// Rows are packed MSB-first, each row padded to a whole number of bytes -
// the layout ESC/POS's GS v 0 raster command and BMP both require.

export interface Mono {
  width: number;
  height: number;
  bytesPerRow: number;
  bits: Uint8Array;
}

export function createMono(width: number, height: number): Mono {
  const bytesPerRow = Math.ceil(width / 8);
  return { width, height, bytesPerRow, bits: new Uint8Array(bytesPerRow * height) };
}

export function setPixel(m: Mono, x: number, y: number, black: boolean) {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
  const idx = y * m.bytesPerRow + (x >> 3);
  const bit = 0x80 >> (x & 7);
  if (black) m.bits[idx] |= bit;
  else m.bits[idx] &= ~bit & 0xff;
}

export function getPixel(m: Mono, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
  const idx = y * m.bytesPerRow + (x >> 3);
  return (m.bits[idx] & (0x80 >> (x & 7))) !== 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const e0 = B64_INDEX[clean[i]] ?? 0;
    const e1 = B64_INDEX[clean[i + 1]] ?? 0;
    const e2 = clean[i + 2] !== undefined ? B64_INDEX[clean[i + 2]] : undefined;
    const e3 = clean[i + 3] !== undefined ? B64_INDEX[clean[i + 3]] : undefined;
    out[p++] = (e0 << 2) | (e1 >> 4);
    if (e2 !== undefined) out[p++] = ((e1 & 15) << 4) | (e2 >> 2);
    if (e3 !== undefined) out[p++] = ((e2! & 3) << 6) | e3;
  }
  return out.subarray(0, p);
}
