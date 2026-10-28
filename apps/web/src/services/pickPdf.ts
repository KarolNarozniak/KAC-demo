import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export type PickedPdf = { name: string; base64: string; size: number };
const MAX_BYTES = 5 * 1024 * 1024;

/** Native picker copies cloud documents into readable app cache; remove that copy after reading. */
export async function pickPdf(): Promise<PickedPdf | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    const size = asset.size ?? file.size;
    if (!size || size > MAX_BYTES) throw new Error('Wybierz niepusty PDF do 5 MB.');
    return { name: asset.name, size, base64: await file.base64() };
  } finally { if (file.exists) file.delete(); }
}
