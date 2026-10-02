import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function shareJson(filename: string, payload: unknown): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(JSON.stringify(payload, null, 2));
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: filename });
}

export async function shareBinary(filename: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(bytes);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
}

export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const text = await new File(asset.uri).text();
  return { name: asset.name, text };
}

export async function pickLogo(): Promise<string | null> {
  // Restricted to PNG specifically (not 'image/*') - the app's logo decoder only reads PNG, so
  // letting the OS picker offer JPEG/HEIC/WebP files here just set people up to pick a file that
  // would then fail with a decode error. Most "Save Image"/export flows offer a PNG option even
  // when the source was a photo, so this isn't a dead end - see the hint text next to the upload
  // button in Dev Mode for exactly what's expected.
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/png', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  const ext = (asset.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const dest = new File(new Directory(Paths.document), `logo-${Date.now()}.${ext || 'png'}`);
  new File(asset.uri).copy(dest);
  return dest.uri;
}
