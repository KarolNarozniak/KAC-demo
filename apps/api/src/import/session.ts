// Sesja importu (historyjka S23KC2S1P2-32).
// Sesja to rekord w t_importy ze statusem „Podgląd” i jego pozycje w t_pozycje_importu.
// Dopóki użytkownik nie zatwierdzi importu, nic nie trafia do t_wydarzenia.

import type { PreviewRow } from './preview.js';
import type { ImportCategory, ImportRow } from './rules.js';

/** Sesja wygasa po 15 minutach bez żadnej akcji użytkownika. */
export const IMPORT_SESSION_TTL_MINUTES = 15;

export type ImportSource = 'classes' | 'work';
export type ImportFormat = 'PDF' | 'Zdjęcie' | 'ICS/CSV';

export const SOURCE_LABELS: Record<ImportSource, string> = { classes: 'Plan zajęć', work: 'Grafik pracy' };

/** Wiersz zaakceptowany przez użytkownika i sprawdzony regułami tuż przed zapisem. */
export type AcceptedRow = { id: string; title: string; start: Date; end: Date; category: ImportCategory; location: string | null };

export type SavedEvent = { id: string; rowId: string; title: string; start: string; end: string; category: ImportCategory; location: string | null };

export type ConfirmResult =
  | { kind: 'ok'; saved: SavedEvent[]; rejected: number }
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'closed' }
  | { kind: 'unknown-rows'; rowIds: string[] };

export type CreateSessionInput = { source: ImportSource; format: ImportFormat; rows: ImportRow[]; preview: PreviewRow[] };

/** Identyfikator pozycji importu powstaje z identyfikatora sesji i wiersza, więc nie trzeba zmieniać tabel. */
export const positionId = (sessionId: string, rowId: string) => `${sessionId}:${rowId}`;

/** Model danych nie ma kolumny na miejsce wydarzenia, dlatego zapisujemy je w opisie. */
export const eventDescription = (sessionId: string, location: string | null) =>
  [location ? `Miejsce: ${location}` : null, `Zatwierdzone w imporcie ${sessionId}`].filter(Boolean).join(' · ');
