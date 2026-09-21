import { unzlibSync } from 'fflate';

// A minimal PNG decoder covering what exported logos actually use: 8-bit depth,
// non-interlaced, colour types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA).
// No CRC verification (decode-only, not corruption detection) and no 16-bit/Adam7 support -
// both are rare for a small uploaded logo and would roughly double the code for no real gain here.

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array; // width*height*4, row-major
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(data: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== SIG[i]) throw new Error('Not a PNG file.');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];

  let off = 8;
  while (off < data.length) {
    const len = readU32(data, off);
    const type = String.fromCharCode(data[off + 4], data[off + 5], data[off + 6], data[off + 7]);
    const bodyStart = off + 8;
    const body = data.subarray(bodyStart, bodyStart + len);
    if (type === 'IHDR') {
      width = readU32(body, 0);
      height = readU32(body, 4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'tRNS') {
      trns = body;
    } else if (type === 'IDAT') {
      idatParts.push(body);
    } else if (type === 'IEND') {
      break;
    }
    off = bodyStart + len + 4; // skip CRC
  }

  if (!width || !height) throw new Error('Invalid PNG: missing IHDR.');
  if (bitDepth !== 8) throw new Error('Only 8-bit PNGs are supported for printing.');
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported for printing.');
  if (colorType !== 0 && colorType !== 2 && colorType !== 3 && colorType !== 4 && colorType !== 6) {
    throw new Error('Unsupported PNG color type.');
  }
  if (colorType === 3 && !palette) throw new Error('Palette PNG is missing its PLTE chunk.');

  const compressed = new Uint8Array(idatParts.reduce((n, p) => n + p.length, 0));
  {
    let p = 0;
    for (const part of idatParts) {
      compressed.set(part, p);
      p += part.length;
    }
  }
  const inflated = unzlibSync(compressed);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]!;
  const bpp = channels; // bytes per pixel at 8-bit depth
  const rowBytes = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);
  let srcOff = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[srcOff];
    srcOff += 1;
    const raw = inflated.subarray(srcOff, srcOff + rowBytes);
    srcOff += rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let v = raw[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      curRow[x] = v;
    }

    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      if (colorType === 0) {
        const g = curRow[si];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = 255;
      } else if (colorType === 2) {
        rgba[di] = curRow[si];
        rgba[di + 1] = curRow[si + 1];
        rgba[di + 2] = curRow[si + 2];
        rgba[di + 3] = 255;
      } else if (colorType === 3) {
        const idx = curRow[si];
        rgba[di] = palette![idx * 3];
        rgba[di + 1] = palette![idx * 3 + 1];
        rgba[di + 2] = palette![idx * 3 + 2];
        rgba[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 4) {
        const g = curRow[si];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = curRow[si + 1];
      } else {
        rgba[di] = curRow[si];
        rgba[di + 1] = curRow[si + 1];
        rgba[di + 2] = curRow[si + 2];
        rgba[di + 3] = curRow[si + 3];
      }
    }

    prevRow.set(curRow);
  }

  return { width, height, rgba };
}
