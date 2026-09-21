import { isPrintImage, type PrintBlock } from './layout';

export function toPrinterAscii(text: string): string {
  let s = text.replace(/₹/g, 'Rs ');
  if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 32 && c <= 126 ? ch : '?';
  }
  return out;
}

function pushText(bytes: number[], text: string) {
  const ascii = toPrinterAscii(text);
  for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i));
}

function pushAlign(bytes: number[], align: 'left' | 'center' | 'right' | undefined, current: number): number {
  const a = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  if (a !== current) bytes.push(0x1b, 0x61, a);
  return a;
}

// GS v 0: raster bit image. xL/xH = bytes per row (little-endian), yL/yH = row count.
function pushImage(bytes: number[], width: number, height: number, bits: Uint8Array) {
  const bytesPerRow = Math.ceil(width / 8);
  bytes.push(0x1d, 0x76, 0x30, 0x00);
  bytes.push(bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff);
  bytes.push(height & 0xff, (height >> 8) & 0xff);
  for (let i = 0; i < bytesPerRow * height; i++) bytes.push(bits[i] ?? 0);
}

export function encodeEscPos(blocks: PrintBlock[], opts: { cut?: boolean; feed?: number } = {}): Uint8Array {
  const bytes: number[] = [];
  bytes.push(0x1b, 0x40);
  let align = 0;
  let bold = false;
  let mode = 0;
  for (const b of blocks) {
    if (isPrintImage(b)) {
      align = pushAlign(bytes, b.align, align);
      pushImage(bytes, b.width, b.height, b.bits);
      continue;
    }
    align = pushAlign(bytes, b.align, align);
    const bd = !!b.bold;
    if (bd !== bold) {
      bytes.push(0x1b, 0x45, bd ? 1 : 0);
      bold = bd;
    }
    const m = b.size === 2 ? 0x11 : b.tall ? 0x01 : 0x00;
    if (m !== mode) {
      bytes.push(0x1d, 0x21, m);
      mode = m;
    }
    pushText(bytes, b.text);
    bytes.push(0x0a);
  }
  bytes.push(0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0);
  for (let i = 0; i < (opts.feed ?? 3); i++) bytes.push(0x0a);
  if (opts.cut !== false) bytes.push(0x1d, 0x56, 0x42, 0x03);
  return Uint8Array.from(bytes);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
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
