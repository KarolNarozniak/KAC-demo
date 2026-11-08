import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { readPickedTimetable, type PickedPdf } from './readPickedTimetable';

export type { PickedPdf } from './readPickedTimetable';
// text/calendar i pokrewne – plik ICS z planem zajęć (historyjka S23KC2S1P2-8).
const MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/calendar', 'application/ics', 'text/x-vcalendar'];

export async function pickPdf(): Promise<PickedPdf | null> {
  if (Platform.OS === 'android') {
    // FileSystem's picker retains the provider URI permission. DocumentPicker's
    // cache copy can be outside the current experience's sandbox in Expo Go.
    const selection = await File.pickFileAsync({ mimeTypes: MIME_TYPES, multipleFiles: false });
    if (selection.canceled) return null;
    const file = selection.result;
    // This is the user's original document: do not delete it after reading.
    return readPickedTimetable(file);
  }

  const result = await DocumentPicker.getDocumentAsync({
    type: MIME_TYPES, multiple: false, copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  return readPickedTimetable({
    name: asset.name, get size() { return file.size; }, base64: () => file.base64(),
  }, async () => { if (file.exists) await file.delete(); });
}
