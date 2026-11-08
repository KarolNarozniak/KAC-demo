// Podgląd importu (historyjka S23KC2S1P2-32).
// Zamienia wiersze odczytane z pliku na odpowiedź dla ekranu: co jest poprawne, a co wymaga poprawy.
// Dla zmian pracy (S23KC2S1P2-44) pokazuje też zmiany nocne i duplikaty. Niczego nie zapisuje.

import { DEFAULT_TIME_ZONE, findDuplicates, resolveRow, type ExistingEvent, type ImportRow, type RowIssue } from './rules.js';

export type PreviewRow = {
  id: string;
  status: 'ok' | 'error';
  issues: RowIssue[];
  start: string | null;
  end: string | null;
  location: string | null;
  confidence: number | null;
  /** Zmiana nocna: koniec przypada następnego dnia i wymaga potwierdzenia. */
  overnight: boolean;
  /** Duplikaty w kalendarzu. */
  duplicateOfEvents: { id: string; title: string; start: string; repeatWeekly?: boolean }[];
  /** Wcześniejsze wiersze tego importu z tym samym tytułem i początkiem. */
  duplicateOfRows: string[];
};

export function buildImportPreview(rows: ImportRow[], existing: ExistingEvent[] = [], timeZone = DEFAULT_TIME_ZONE): PreviewRow[] {
  const resolved = rows.map((row) => ({ row, result: resolveRow(row, timeZone) }));
  const validRows = resolved.flatMap(({ row, result }) => (result.ok ? [{ id: row.id, title: result.title, start: result.start }] : []));
  const duplicates = new Map(findDuplicates(validRows, existing, new Set(rows.filter(row => row.duplicateDecision === 'skip').map(row => row.id))).map((info) => [info.rowId, info]));
  const existingById = new Map(existing.map((event) => [event.id, event]));

  return resolved.map(({ row, result }) => {
    const location = row.location?.trim() || null;
    const confidence = row.confidence ?? null;
    if (!result.ok) {
      return { id: row.id, status: 'error', issues: result.issues, start: null, end: null, location, confidence, overnight: false, duplicateOfEvents: [], duplicateOfRows: [] };
    }
    const info = duplicates.get(row.id);
    return {
      id: row.id,
      status: 'ok',
      issues: [],
      start: result.start.toISOString(),
      end: result.end.toISOString(),
      location,
      confidence,
      overnight: result.overnight,
      duplicateOfEvents: (info?.existingIds ?? []).flatMap((id) => {
        const event = existingById.get(id);
        return event ? [{ id, title: event.title, start: result.start.toISOString(), ...(event.repeatWeekly ? { repeatWeekly: true } : {}) }] : [];
      }),
      duplicateOfRows: info?.batchRowIds ?? [],
    };
  });
}
