// Zdjęcie grafiku z aparatu w przeglądarce telefonu (S23KC2S1P2-44).
// capture="environment" otwiera od razu tylny aparat; na komputerze przeglądarka pokaże zwykły wybór pliku.
import type { PickedPdf } from './readPickedTimetable';

export function takePhoto(): Promise<PickedPdf | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png';
    input.setAttribute('capture', 'environment');
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (!file.size || file.size > 5 * 1024 * 1024) { reject(new Error('Zdjęcie przekracza 5 MB. Zrób zdjęcie w niższej rozdzielczości.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać zdjęcia.'));
      reader.onload = () => resolve({ name: file.name, size: file.size, base64: String(reader.result).split(',')[1] ?? '' });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
