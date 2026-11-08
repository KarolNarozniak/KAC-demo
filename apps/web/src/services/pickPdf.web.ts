import type { PickedPdf } from './pickPdf';

export function pickPdf(): Promise<PickedPdf | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,image/png,image/jpeg,text/calendar,.pdf,.png,.jpg,.jpeg,.ics';
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      if (!file.size || file.size > 5 * 1024 * 1024) { reject(new Error('Wybierz niepusty plik (PDF, PNG, JPG lub ICS) do 5 MB.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
      reader.onload = () => resolve({ name: file.name, size: file.size, base64: String(reader.result).split(',')[1] ?? '' });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
