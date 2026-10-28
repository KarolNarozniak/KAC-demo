// Reguły kontroli importu (historyjka S23KC2S1P2-32: kontrola rozpoznanych danych przed zapisem)
// oraz reguły zmian pracy (historyjka S23KC2S1P2-44: zmiany nocne i duplikaty).
// Czyste funkcje: bez bazy danych i bez HTTP, dzięki czemu łatwo je testować.

export const DEFAULT_TIME_ZONE = 'Europe/Warsaw';

export type ImportCategory = 'Class' | 'Work' | 'Personal';

/** Kategorie aplikacji odpowiadające rekordom tabeli t_kategorie. */
export const CATEGORY_IDS: Record<ImportCategory, string> = { Class: 'CAT01', Work: 'CAT02', Personal: 'CAT03' };

/** Wiersz odczytany z pliku i ewentualnie poprawiony przez użytkownika w podglądzie. */
export interface ImportRow {
  id: string;
  title: string;
  /** Data rozpoczęcia w formacie RRRR-MM-DD. */
  date: string;
  /** Godzina rozpoczęcia w formacie GG:MM. */
  startTime: string;
  /** Godzina zakończenia w formacie GG:MM. */
  endTime: string;
  /** Data zakończenia, jeśli plik ją podaje. Bez niej koniec przypada tego samego dnia. */
  endDate?: string;
  category?: ImportCategory;
  /** Miejsce wydarzenia odczytane z pliku (opcjonalne). */
  location?: string;
  /** Poziom pewności odczytu od 0 do 1 (np. 1 dla pliku ICS, mniej dla zdjęcia). */
  confidence?: number;
  /** Pracownik, którego dotyczy zmiana (grafik może obejmować wiele osób). */
  employee?: string;
  /** Użytkownik potwierdził, że zmiana nocna kończy się następnego dnia. */
  overnightConfirmed?: boolean;
  /** Decyzja użytkownika dla duplikatu. */
  duplicateDecision?: DuplicateDecision;
  replacementId?: string;
}

/** „Pomiń” – nie dodawaj; „Zastąp” – nadpisz istniejące wydarzenie; „Zachowaj oba” – dodaj jako osobne. */
export type DuplicateDecision = 'skip' | 'replace' | 'keepBoth';

/** Wydarzenie, które już jest w kalendarzu. */
export interface ExistingEvent {
  id: string;
  title: string;
  start: Date;
}

export type RowIssue = 'missing-title' | 'invalid-date' | 'invalid-time' | 'end-not-after-start';

export type ResolvedRow =
  | { ok: true; id: string; title: string; start: Date; end: Date; overnight: boolean; needsConfirmation: boolean }
  | { ok: false; id: string; issues: RowIssue[] };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseDate(value: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

function parseTime(value: string): { h: number; min: number } | null {
  const match = TIME_RE.exec(value.trim());
  if (!match) return null;
  return { h: Number(match[1]), min: Number(match[2]) };
}

/** Różnica między czasem lokalnym w strefie a UTC (w milisekundach) dla danej chwili. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/** Zamienia lokalną datę i godzinę (czas polski) na punkt na wspólnej osi czasu (UTC). */
export function toInstant(date: string, time: string, timeZone = DEFAULT_TIME_ZONE): Date | null {
  const d = parseDate(date);
  const t = parseTime(time);
  if (!d || !t) return null;
  const naive = Date.UTC(d.y, d.m - 1, d.d, t.h, t.min);
  let utc = naive - zoneOffsetMs(new Date(naive), timeZone);
  const corrected = zoneOffsetMs(new Date(utc), timeZone);
  if (naive - corrected !== utc) utc = naive - corrected; // zmiana czasu letni/zimowy
  return new Date(utc);
}

function nextDay(date: string): string {
  const d = parseDate(date);
  if (!d) return date;
  return new Date(Date.UTC(d.y, d.m - 1, d.d + 1)).toISOString().slice(0, 10);
}

/**
 * Sprawdza wiersz przed zapisem: tytuł, poprawna data i godziny oraz koniec po początku (s < e).
 * Jeśli plik nie podaje daty końca, koniec przypada tego samego dnia co początek.
 * Wyjątek dla zmian pracy (S23KC2S1P2-44): gdy godzina końca nie jest późniejsza od początku,
 * to zmiana nocna – koniec przypada następnego dnia, a taki termin wymaga potwierdzenia użytkownika.
 */
export function resolveRow(row: ImportRow, timeZone = DEFAULT_TIME_ZONE): ResolvedRow {
  const issues: RowIssue[] = [];
  const title = row.title.trim();
  if (!title) issues.push('missing-title');
  if (!parseDate(row.date) || (row.endDate !== undefined && !parseDate(row.endDate))) issues.push('invalid-date');
  if (!parseTime(row.startTime) || !parseTime(row.endTime)) issues.push('invalid-time');
  if (issues.length > 0) return { ok: false, id: row.id, issues };

  const start = toInstant(row.date, row.startTime, timeZone);
  let end = toInstant(row.endDate ?? row.date, row.endTime, timeZone);
  let overnight = false;
  if (start && end && row.category === 'Work' && row.endDate === undefined && end.getTime() <= start.getTime()) {
    end = toInstant(nextDay(row.date), row.endTime, timeZone);
    overnight = true;
  }
  if (!start || !end) return { ok: false, id: row.id, issues: ['invalid-date'] };
  if (start.getTime() >= end.getTime()) return { ok: false, id: row.id, issues: ['end-not-after-start'] };
  return { ok: true, id: row.id, title, start, end, overnight, needsConfirmation: overnight };
}

/** Tytuły porównujemy bez względu na wielkość liter i nadmiarowe spacje. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pl');
}

/** duplikat(A, B) ⇔ (t_A = t_B) ∧ (s_A = s_B) – ten sam tytuł i ta sama data i godzina rozpoczęcia. */
export function isDuplicate(a: { title: string; start: Date }, b: { title: string; start: Date }): boolean {
  return normalizeTitle(a.title) === normalizeTitle(b.title) && a.start.getTime() === b.start.getTime();
}

export interface DuplicateInfo {
  rowId: string;
  /** Wydarzenia z kalendarza, których ten wiersz jest duplikatem. */
  existingIds: string[];
  /** Wcześniejsze wiersze tego samego importu, których ten wiersz jest duplikatem. */
  batchRowIds: string[];
}

/** Szuka duplikatów w kalendarzu i wśród wierszy tego samego importu (zwraca tylko wiersze z duplikatem). */
export function findDuplicates(rows: { id: string; title: string; start: Date }[], existing: ExistingEvent[]): DuplicateInfo[] {
  const result: DuplicateInfo[] = [];
  rows.forEach((row, index) => {
    const existingIds = existing.filter((event) => isDuplicate(row, event)).map((event) => event.id);
    const batchRowIds = rows.slice(0, index).filter((other) => isDuplicate(row, other)).map((other) => other.id);
    if (existingIds.length > 0 || batchRowIds.length > 0) result.push({ rowId: row.id, existingIds, batchRowIds });
  });
  return result;
}
