// Walidacja pliku z grafikiem (S23KC2S1P2-44, SUB-02).
// Typ pliku rozpoznajemy po jego zawartości (tzw. sygnaturze), a nie po rozszerzeniu ani po typie podanym
// przez przeglądarkę – obie te informacje łatwo podrobić. Sprawdzamy też, czy plik nie jest ucięty.

export const MAX_SCHEDULE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ScheduleFileType = 'JPG' | 'PNG' | 'PDF';

export type FileCheckResult =
  | { ok: true; type: ScheduleFileType; bytes: Buffer }
  | { ok: false; reason: 'empty-file' | 'file-too-large' | 'unsupported-format' | 'corrupted-file' };

/** Formaty pokazywane użytkownikowi w formularzu. */
export const SUPPORTED_FORMATS_LABEL = 'JPG/JPEG, PNG lub PDF, maks. 5 MB';

const startsWith = (bytes: Buffer, signature: number[]) => signature.every((value, index) => bytes[index] === value);

function detectType(bytes: Buffer): ScheduleFileType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'JPG';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'PNG';
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
  return null;
}

/** Każdy z formatów ma znany „znacznik końca”. Jego brak oznacza zwykle plik ucięty przy wysyłaniu lub uszkodzony. */
function looksComplete(type: ScheduleFileType, bytes: Buffer): boolean {
  if (type === 'JPG') return bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  // Poprawny PNG zawsze kończy się tym samym 12-bajtowym blokiem IEND (długość 0, nazwa, suma kontrolna).
  if (type === 'PNG') return bytes.subarray(bytes.length - 12).equals(PNG_END);
  return bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from('%%EOF', 'latin1'));
}

const PNG_END = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Sprawdza plik przesłany jako tekst base64 (tak wysyła go ekran importu). */
export function checkScheduleFile(dataBase64: string): FileCheckResult {
  const compact = dataBase64.replace(/\s+/g, '');
  if (compact.length === 0) return { ok: false, reason: 'empty-file' };
  if (!BASE64_RE.test(compact)) return { ok: false, reason: 'corrupted-file' };
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length === 0) return { ok: false, reason: 'empty-file' };
  if (bytes.length > MAX_SCHEDULE_FILE_BYTES) return { ok: false, reason: 'file-too-large' };
  const type = detectType(bytes);
  if (!type) return { ok: false, reason: 'unsupported-format' };
  if (!looksComplete(type, bytes)) return { ok: false, reason: 'corrupted-file' };
  return { ok: true, type, bytes };
}
