import qrcode from 'qrcode-generator';
import { base64ToBytes, bytesToBase64, createMono, getPixel, setPixel, type Mono } from './bits';
import type { PrintImage } from './layout';
import type { DecodedImage } from './png';
import type { RasterAsset } from '../domain/types';

export function monoToRasterAsset(m: Mono): RasterAsset {
  return { width: m.width, height: m.height, bitsB64: bytesToBase64(m.bits) };
}

export function rasterAssetToPrintImage(asset: RasterAsset | null | undefined): PrintImage | undefined {
  if (!asset) return undefined;
  return { kind: 'image', width: asset.width, height: asset.height, bits: base64ToBytes(asset.bitsB64) };
}

export function rasterAssetToBmpDataUri(asset: RasterAsset): string {
  const bytesPerRow = Math.ceil(asset.width / 8);
  const bits = base64ToBytes(asset.bitsB64);
  return monoToBmpDataUri({ width: asset.width, height: asset.height, bytesPerRow, bits });
}

export function printImageToBmpDataUri(img: { width: number; height: number; bits: Uint8Array }): string {
  const bytesPerRow = Math.ceil(img.width / 8);
  return monoToBmpDataUri({ width: img.width, height: img.height, bytesPerRow, bits: img.bits });
}

// Resize with box averaging when shrinking (keeps logo edges clean instead of aliasing) and
// nearest-neighbour when growing (rare - upscaling a logo further would look blurry either way).
function resizeToGray(img: DecodedImage, targetW: number, targetH: number): Float32Array {
  const out = new Float32Array(targetW * targetH);
  const sx = img.width / targetW;
  const sy = img.height / targetH;
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const alpha = img.rgba[i + 3] / 255;
          // Composite onto white so a transparent background prints as blank, not black.
          const gray = (0.299 * img.rgba[i] + 0.587 * img.rgba[i + 1] + 0.114 * img.rgba[i + 2]) * alpha + 255 * (1 - alpha);
          sum += gray;
          n += 1;
        }
      }
      out[ty * targetW + tx] = n > 0 ? sum / n : 255;
    }
  }
  return out;
}

export function ditherToMono(img: DecodedImage, targetW: number, targetH: number): Mono {
  const gray = resizeToGray(img, targetW, targetH);
  const mono = createMono(targetW, targetH);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const i = y * targetW + x;
      const old = gray[i];
      const black = old < 128;
      setPixel(mono, x, y, black);
      const err = old - (black ? 0 : 255);
      if (x + 1 < targetW) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < targetH) {
        if (x - 1 >= 0) gray[i - 1 + targetW] += (err * 3) / 16;
        gray[i + targetW] += (err * 5) / 16;
        if (x + 1 < targetW) gray[i + 1 + targetW] += (err * 1) / 16;
      }
    }
  }
  return mono;
}

export function fitLogo(img: DecodedImage, maxWidth: number, maxHeight: number): Mono {
  const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  return ditherToMono(img, w, h);
}

const QUIET_ZONE_MODULES = 4;
const MIN_DOTS_PER_MODULE = 6;

// Renders text as a QR with a module size chosen so the whole code lands near targetWidth dots
// (falling back to the minimum scannable module size for very dense codes), plus the quiet-zone
// border the QR spec requires for reliable scanning.
export function renderQr(text: string, targetWidth: number): Mono {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const totalModules = modules + QUIET_ZONE_MODULES * 2;
  const dotsPerModule = Math.max(MIN_DOTS_PER_MODULE, Math.round(targetWidth / totalModules));
  const size = totalModules * dotsPerModule;
  const mono = createMono(size, size);
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (!qr.isDark(r, c)) continue;
      const px = (c + QUIET_ZONE_MODULES) * dotsPerModule;
      const py = (r + QUIET_ZONE_MODULES) * dotsPerModule;
      for (let dy = 0; dy < dotsPerModule; dy++) {
        for (let dx = 0; dx < dotsPerModule; dx++) setPixel(mono, px + dx, py + dy, true);
      }
    }
  }
  return mono;
}

// A tiny, uncompressed 24-bit BMP encoder - just enough to hand a Mono bitmap to <Image> as a
// data URI for the on-screen preview, using the exact same bits that will go to the printer.
// Uses plain 24bpp BGR rather than a 1bpp indexed BMP: native image decoders reliably support
// this everywhere, whereas 1bpp/indexed BMP support varies by platform.
export function monoToBmpDataUri(m: Mono): string {
  const rowBytes = Math.ceil((m.width * 3) / 4) * 4;
  const pixelDataSize = rowBytes * m.height;
  const headerSize = 14 + 40;
  const fileSize = headerSize + pixelDataSize;
  const buf = new Uint8Array(fileSize);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, 0x42);
  dv.setUint8(1, 0x4d); // "BM"
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, headerSize, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, m.width, true);
  dv.setInt32(22, -m.height, true); // negative = top-down rows, matches our row order
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true); // 24 bits per pixel, BI_RGB (no compression)
  dv.setUint32(34, pixelDataSize, true);

  for (let y = 0; y < m.height; y++) {
    const rowStart = headerSize + y * rowBytes;
    for (let x = 0; x < m.width; x++) {
      const v = getPixel(m, x, y) ? 0x00 : 0xff;
      const i = rowStart + x * 3;
      buf[i] = v; // B
      buf[i + 1] = v; // G
      buf[i + 2] = v; // R
    }
  }

  return `data:image/bmp;base64,${bytesToBase64(buf)}`;
}
