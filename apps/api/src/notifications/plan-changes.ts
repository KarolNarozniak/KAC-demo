// Wykrywanie zmian planu i powiadomienie o nowym terminie (S23KC2S1P2-299, N07).
// Konsument zdarzeń W02 (t_event_outbox → worker): jedno miejsce dla lokalnego CRUD, korekty serii, importu z zamianą
// i zatwierdzonej korekty grafiku. Logika jest czysta (bez bazy), żeby dało się ją testować bez PostgreSQL.
import { localDateTimeString } from '../scheduling/time.js';
import { parseEventTime } from './schedule.js';

export const PLAN_CHANGE_TYPE = 'Zmiana planu';

/** Stan wydarzenia w zdarzeniu outboxa (before/after). start/end: lokalnie „YYYY-MM-DDTHH:MM” albo ISO z „Z”. */
export type EventSnapshot = { title?: string; start?: string; end?: string; category?: string; location?: string | null; version?: number };
export type PlanChangeField = 'date' | 'time' | 'location';

export type PlanChange = {
  kind: 'changed';
  fields: PlanChangeField[];
  title: string;
  before: { start: string; end: string; location: string | null };
  after: { start: string; end: string; location: string | null };
  eventStart: Date;
  message: string;
} | {
  /** Brak stanu „przed” – nie zgadujemy różnicy, tylko prosimy o sprawdzenie aktualnego terminu. */
  kind: 'unknown_previous';
  title: string;
  after: { start: string; end: string; location: string | null };
  eventStart: Date;
  message: string;
};

/** Źródła, których zmiany nie są „nowym terminem” dla użytkownika (echo naszej własnej publikacji do Google). */
const IGNORED_ORIGINS = new Set(['google_publication_echo']);

function instant(value: string | undefined, timeZone: string): Date | null {
  if (!value) return null;
  try {
    const parsed = parseEventTime(value, timeZone);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  } catch { return null; }
}

const local = (value: Date, timeZone: string) => localDateTimeString(value, timeZone).slice(0, 16);
const normalizeLocation = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
};

function rangeLabel(start: string, end: string) {
  return start.slice(0, 10) === end.slice(0, 10)
    ? `${start.slice(0, 10)} ${start.slice(11, 16)}–${end.slice(11, 16)}`
    : `${start.replace('T', ' ')} – ${end.replace('T', ' ')}`;
}

/**
 * Rozstrzyga, czy zdarzenie „calendar_event.updated” oznacza realną zmianę terminu albo miejsca.
 * Zwraca null, gdy: to nie aktualizacja, dane się nie zmieniły (ponowny odczyt / ten sam import), wydarzenie już się zaczęło,
 * źródło to echo publikacji albo stan „po” jest nieczytelny.
 */
export function detectPlanChange(eventType: string, payload: Record<string, unknown>, now: Date): PlanChange | null {
  if (eventType !== 'calendar_event.updated') return null;
  if (typeof payload.origin === 'string' && IGNORED_ORIGINS.has(payload.origin)) return null;
  const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone : 'Europe/Warsaw';
  const after = payload.after as EventSnapshot | undefined;
  const afterStart = instant(after?.start, timeZone), afterEnd = instant(after?.end, timeZone);
  if (!after || !afterStart || !afterEnd || afterEnd <= afterStart) return null;
  if (afterStart <= now) return null;
  const title = String(after.title ?? 'Wydarzenie').slice(0, 180);
  const afterView = { start: local(afterStart, timeZone), end: local(afterEnd, timeZone), location: normalizeLocation(after.location) };

  const before = payload.before as EventSnapshot | null | undefined;
  const beforeStart = instant(before?.start, timeZone), beforeEnd = instant(before?.end, timeZone);
  if (!before || !beforeStart || !beforeEnd) {
    return { kind: 'unknown_previous', title, after: afterView, eventStart: afterStart,
      message: `Zmiana planu: „${title}” zostało zmienione. Aktualny termin: ${rangeLabel(afterView.start, afterView.end)} – otwórz kalendarz, aby sprawdzić szczegóły.` };
  }
  const beforeView = { start: local(beforeStart, timeZone), end: local(beforeEnd, timeZone), location: normalizeLocation(before.location) };
  const fields: PlanChangeField[] = [];
  if (beforeView.start.slice(0, 10) !== afterView.start.slice(0, 10) || beforeView.end.slice(0, 10) !== afterView.end.slice(0, 10)) fields.push('date');
  if (beforeView.start.slice(11) !== afterView.start.slice(11) || beforeView.end.slice(11) !== afterView.end.slice(11)) fields.push('time');
  // Stare zdarzenia nie zapisywały miejsca w „before” – brak pola to „nie wiadomo”, a nie zmiana.
  if (before.location !== undefined && beforeView.location !== afterView.location) fields.push('location');
  if (!fields.length) return null;
  const parts = [`nowy termin ${rangeLabel(afterView.start, afterView.end)} (było ${rangeLabel(beforeView.start, beforeView.end)})`];
  if (fields.includes('location')) parts.push(`miejsce: ${afterView.location ?? 'nie podano'} (było ${beforeView.location ?? 'nie podano'})`);
  if (!fields.includes('date') && !fields.includes('time')) parts[0] = `termin bez zmian: ${rangeLabel(afterView.start, afterView.end)}`;
  return { kind: 'changed', fields, title, before: beforeView, after: afterView, eventStart: afterStart, message: `Zmiana planu: „${title}” – ${parts.join('; ')}.` };
}

/**
 * Łączy nową zmianę z jeszcze niedostarczonym powiadomieniem o tym samym wydarzeniu: „było” pochodzi z najstarszego stanu,
 * więc dwie szybkie edycje dają jedno powiadomienie z pełną różnicą, a powrót do pierwotnego terminu nie daje żadnego.
 */
export type PlanChangeState = { start: string; end: string; location: string | null };

export function mergePendingBefore(payload: Record<string, unknown>, pendingBefore: PlanChangeState | null): Record<string, unknown> {
  if (!pendingBefore) return payload;
  return { ...payload, before: { start: pendingBefore.start, end: pendingBefore.end, location: pendingBefore.location ?? '' } };
}

export function planChangeIdempotencyKey(aggregateId: string, version: number) {
  return `plan-change:${aggregateId}:${version}`;
}
