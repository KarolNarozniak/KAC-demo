// Zdjęcie grafiku prosto z aparatu (S23KC2S1P2-44: „Użytkownik wskazuje zdjęcie lub plik”).
// Wersja dla Androida/iOS (także Expo Go). Wersja przeglądarkowa jest w takePhoto.web.ts.
import * as ImagePicker from 'expo-image-picker';
import { readPickedTimetable, type PickedPdf } from './readPickedTimetable';

export async function takePhoto(): Promise<PickedPdf | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Brak dostępu do aparatu. Zezwól na aparat w ustawieniach telefonu albo wybierz zdjęcie z galerii.');
  // Jakość 0.7 wystarcza do OCR, a zdjęcie z telefonu mieści się wtedy w limicie 5 MB.
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, base64: true, exif: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset?.base64) throw new Error('Nie udało się odczytać zdjęcia. Spróbuj ponownie.');
  const base64 = asset.base64;
  const size = Math.floor((base64.length * 3) / 4);
  return readPickedTimetable({ name: asset.fileName ?? 'zdjecie-grafiku.jpg', size, base64: async () => base64 });
}
