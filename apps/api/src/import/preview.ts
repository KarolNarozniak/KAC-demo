// Podgląd importu (historyjka S23KC2S1P2-32).
// Zamienia wiersze odczytane z pliku na odpowiedź dla ekranu: co jest poprawne, a co wymaga poprawy.
// Niczego nie zapisuje.

import { DEFAULT_TIME_ZONE, resolveRow, type ImportRow, type RowIssue } from './rules.js';

export type PreviewRow = {
  id: string;
  status: 'ok' | 'error';
  issues: RowIssue[];
  start: string | null;
  end: string | null;
  location: string | null;
  confidence: number | null;
};

export function buildImportPreview(rows: ImportRow[], timeZone = DEFAULT_TIME_ZONE): PreviewRow[] {
  return rows.map((row) => {
    const resolved = resolveRow(row, timeZone);
    const location = row.location?.trim() || null;
    const confidence = row.confidence ?? null;
    if (!resolved.ok) return { id: row.id, status: 'error', issues: resolved.issues, start: null, end: null, location, confidence };
    return { id: row.id, status: 'ok', issues: [], start: resolved.start.toISOString(), end: resolved.end.toISOString(), location, confidence };
  });
}
