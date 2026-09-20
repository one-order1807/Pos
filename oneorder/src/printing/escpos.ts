import type { PrintLine } from './layout';

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

export function encodeEscPos(lines: PrintLine[], opts: { cut?: boolean; feed?: number } = {}): Uint8Array {
  const bytes: number[] = [];
  bytes.push(0x1b, 0x40);
  let align = 0;
  let bold = false;
  let mode = 0;
  for (const l of lines) {
    const a = l.align === 'center' ? 1 : l.align === 'right' ? 2 : 0;
    if (a !== align) {
      bytes.push(0x1b, 0x61, a);
      align = a;
    }
    const b = !!l.bold;
    if (b !== bold) {
      bytes.push(0x1b, 0x45, b ? 1 : 0);
      bold = b;
    }
    const m = l.size === 2 ? 0x11 : l.tall ? 0x01 : 0x00;
    if (m !== mode) {
      bytes.push(0x1d, 0x21, m);
      mode = m;
    }
    pushText(bytes, l.text);
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
