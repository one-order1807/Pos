import qrcode from 'qrcode-generator';

// Same quiet-zone convention as printing/raster.ts's renderQr (the spec requires it for reliable
// scanning) - this version renders to a crisp, resolution-independent SVG instead of a packed
// monochrome bitmap, since the thermal-printer raster pipeline there is deliberately low-res for
// fast BLE printing, the wrong fit for an on-screen preview or a print-quality PDF.
const QUIET_ZONE_MODULES = 4;

/** An SVG string for `text` - safe to feed to react-native-svg's SvgXml (sized via its own
 * width/height props) or embed directly in HTML for expo-print (sized via CSS). Vector, so it
 * stays crisp at any size the caller scales it to. */
export function qrSvgMarkup(text: string, pixelsPerModule = 8): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const modules = qr.getModuleCount();
  const size = (modules + QUIET_ZONE_MODULES * 2) * pixelsPerModule;

  let rects = '';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + QUIET_ZONE_MODULES) * pixelsPerModule;
      const y = (row + QUIET_ZONE_MODULES) * pixelsPerModule;
      rects += `<rect x="${x}" y="${y}" width="${pixelsPerModule}" height="${pixelsPerModule}"/>`;
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/><g fill="#000000">${rects}</g></svg>`
  );
}
