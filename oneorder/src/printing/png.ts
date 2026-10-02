import { unzlibSync } from 'fflate';

// A minimal PNG decoder covering what exported logos actually use: 8-bit or 16-bit depth,
// colour types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA), both non-interlaced and
// Adam7-interlaced. No CRC verification (decode-only, not corruption detection). JPEG/HEIC/WebP
// are a different file format entirely, not a PNG variant - those still aren't supported here
// (see util/files.ts's pickLogo, which now restricts the picker to PNG specifically so a
// different-format file can't be selected in the first place).

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array; // width*height*4, row-major
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ADAM7_PASSES = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 },
];

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

interface Header {
  bitDepth: number;
  colorType: number;
  channels: number;
  samplesPerPixel: number; // channels (bitDepth handled separately)
  palette: Uint8Array | null;
  trns: Uint8Array | null;
}

/** Un-filters and converts one pass's worth of raw scanlines into 8-bit RGBA for a `w`x`h` block.
 * Shared by the non-interlaced path (one "pass" covering the whole image) and each of Adam7's 7
 * passes (each a smaller sub-image using the exact same per-row filtering algorithm). */
function decodeBlock(inflated: Uint8Array, srcOffset: number, w: number, h: number, hdr: Header): { rgba: Uint8Array; bytesRead: number } {
  const { bitDepth, colorType, channels, palette, trns } = hdr;
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = channels * bytesPerSample; // bytes per whole pixel, for the filter's "left" reference
  const rowBytes = w * bpp;
  const rgba = new Uint8Array(w * h * 4);
  const prevRow = new Uint8Array(rowBytes);
  const curRow = new Uint8Array(rowBytes);
  let srcOff = srcOffset;

  for (let y = 0; y < h; y++) {
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

    // For 16-bit samples, PNG stores big-endian; the high (first) byte alone is a perfectly good
    // 8-bit downsample for a thermal-printer logo, so the low byte is simply skipped here.
    const sampleStride = bytesPerSample;
    for (let x = 0; x < w; x++) {
      const si = x * channels * sampleStride;
      const di = (y * w + x) * 4;
      if (colorType === 0) {
        const g = curRow[si];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = 255;
      } else if (colorType === 2) {
        rgba[di] = curRow[si];
        rgba[di + 1] = curRow[si + sampleStride];
        rgba[di + 2] = curRow[si + 2 * sampleStride];
        rgba[di + 3] = 255;
      } else if (colorType === 3) {
        const idx = curRow[si]; // palette indices are always 8-bit regardless of bitDepth here
        rgba[di] = palette![idx * 3];
        rgba[di + 1] = palette![idx * 3 + 1];
        rgba[di + 2] = palette![idx * 3 + 2];
        rgba[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 4) {
        const g = curRow[si];
        rgba[di] = g;
        rgba[di + 1] = g;
        rgba[di + 2] = g;
        rgba[di + 3] = curRow[si + sampleStride];
      } else {
        rgba[di] = curRow[si];
        rgba[di + 1] = curRow[si + sampleStride];
        rgba[di + 2] = curRow[si + 2 * sampleStride];
        rgba[di + 3] = curRow[si + 3 * sampleStride];
      }
    }

    prevRow.set(curRow);
  }

  return { rgba, bytesRead: srcOff - srcOffset };
}

export function decodePng(data: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) {
    if (data[i] !== SIG[i]) throw new Error('That file is not a PNG. Export/save the logo as a PNG (not JPEG/HEIC/WebP) and try again.');
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

  if (!width || !height) throw new Error('This PNG looks corrupted (no image header found). Try re-exporting it.');
  if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`Unsupported PNG bit depth (${bitDepth}-bit). Re-export as a standard 8-bit PNG.`);
  if (colorType !== 0 && colorType !== 2 && colorType !== 3 && colorType !== 4 && colorType !== 6) {
    throw new Error('Unsupported PNG color type. Re-export as a standard RGB or RGBA PNG.');
  }
  if (colorType === 3 && !palette) throw new Error('This palette PNG is missing its color table (PLTE chunk) - it may be corrupted.');

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
  const hdr: Header = { bitDepth, colorType, channels, samplesPerPixel: channels, palette, trns };

  if (interlace === 0) {
    return { width, height, rgba: decodeBlock(inflated, 0, width, height, hdr).rgba };
  }
  if (interlace !== 1) throw new Error('Unsupported PNG interlacing method. Re-export without interlacing (or as a standard PNG).');

  // Adam7: decode each of the 7 passes as its own small image, then scatter those pixels into
  // the final full-size image at the positions that pass covers.
  const rgba = new Uint8Array(width * height * 4);
  let srcOff = 0;
  for (const pass of ADAM7_PASSES) {
    const pw = Math.max(0, Math.ceil((width - pass.xStart) / pass.xStep));
    const ph = Math.max(0, Math.ceil((height - pass.yStart) / pass.yStep));
    if (pw === 0 || ph === 0) continue;
    const { rgba: block, bytesRead } = decodeBlock(inflated, srcOff, pw, ph, hdr);
    srcOff += bytesRead;
    for (let y = 0; y < ph; y++) {
      const destY = pass.yStart + y * pass.yStep;
      for (let x = 0; x < pw; x++) {
        const destX = pass.xStart + x * pass.xStep;
        const si = (y * pw + x) * 4;
        const di = (destY * width + destX) * 4;
        rgba[di] = block[si];
        rgba[di + 1] = block[si + 1];
        rgba[di + 2] = block[si + 2];
        rgba[di + 3] = block[si + 3];
      }
    }
  }
  return { width, height, rgba };
}
