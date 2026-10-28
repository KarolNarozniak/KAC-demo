export type PickedPdf = { name: string; base64: string; size: number };
export type ReadableTimetable = { name: string; size: number; base64: () => Promise<string> };
const MAX_BYTES = 5 * 1024 * 1024;

/** Cleanup is supplied only for an app-owned temporary copy, never a provider document. */
export async function readPickedTimetable(file: ReadableTimetable, cleanup?: () => void | Promise<void>): Promise<PickedPdf> {
  try {
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES) {
      throw new Error('Wybierz niepusty PDF, PNG lub JPG do 5 MB.');
    }
    const base64 = await file.base64();
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const size = base64.length / 4 * 3 - padding;
    if (!base64.length || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || size > MAX_BYTES) {
      throw new Error('Nie można odczytać pliku lub plik przekracza 5 MB.');
    }
    return { name: file.name, size, base64 };
  } finally {
    // A cleanup failure must not hide a read error or discard a successful read.
    try { await cleanup?.(); } catch { /* The OS can reclaim the temporary cache file. */ }
  }
}
