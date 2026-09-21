import { File } from 'expo-file-system';
import type { RasterAsset } from '../domain/types';
import { decodePng } from './png';
import { fitLogo, monoToRasterAsset, renderQr } from './raster';

// Fixed target sizes rather than per-template variants: both keep the raster small enough to
// store cheaply in Settings (and sync to Firestore) while looking right centered on any of the
// print templates, so nothing needs re-rasterizing per template at print time.
const LOGO_MAX_WIDTH = 220;
const LOGO_MAX_HEIGHT = 160;
const QR_TARGET_WIDTH = 220;

export async function rasterizeLogo(uri: string): Promise<RasterAsset> {
  let bytes: Uint8Array;
  try {
    bytes = await new File(uri).bytes();
  } catch (e: any) {
    throw new Error(`Could not read that file: ${e?.message ?? e}`);
  }
  const img = decodePng(bytes);
  const mono = fitLogo(img, LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT);
  return monoToRasterAsset(mono);
}

export function rasterizeQr(text: string): RasterAsset {
  const mono = renderQr(text, QR_TARGET_WIDTH);
  return monoToRasterAsset(mono);
}
