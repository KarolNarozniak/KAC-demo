// Zajęcia w podglądzie grafiku (S23KC2S1P2-40, S23KC2S1P2-195): lista zajęć tygodnia i wskazanie zajęć kolidujących ze zmianą.
// Te same zasady co w API: przecięcie przedziałów [początek, koniec), zajęcia z buforem dojazdu przed i po.
import type { BlockingEvent } from '../services/scheduleApi';

const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Lokalny czas „YYYY-MM-DDTHH:MM” → minuty na wspólnej osi (wystarcza do porównań w obrębie tygodnia). */
export function localMinutes(value: string): number | null {
  return LOCAL.test(value) ? Date.parse(`${value}:00Z`) / 60_000 : null;
}

/** Zetknięcie granic nie jest kolizją. */
export const intersects = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/**
 * Zajęcia z tygodnia, posortowane po początku. API zwraca też poniedziałek po tygodniu (na zmiany nocne z niedzieli);
 * podając weekStart, dostajemy tylko zajęcia z wybranego tygodnia – do wyświetlenia na liście.
 */
export function weekClasses(events: BlockingEvent[] = [], weekStart?: string): BlockingEvent[] {
  const end = weekStart ? new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10) : null;
  return events.filter((event) => event.category === 'Class' && (!end || event.startLocal.slice(0, 10) < end))
    .sort((a, b) => a.startLocal.localeCompare(b.startLocal));
}

/** 1 przedział, 2–4 przedziały, 5 przedziałów (12–14 też „przedziałów”). */
export function windowsLabel(count: number): string {
  if (count === 1) return '1 przedział';
  const lastTwo = count % 100, last = count % 10;
  return `${count} ${last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'przedziały' : 'przedziałów'}`;
}

export type ClassConflict = { event: BlockingEvent; blocking: boolean };

/**
 * Zajęcia kolidujące ze zmianą o podanych godzinach lokalnych.
 * blocking = true dla zajęć obowiązkowych (takiej zmiany nie da się zatwierdzić), false dla nieobowiązkowych (ostrzeżenie).
 */
export function shiftClassConflicts(shift: { startLocal: string; endLocal: string }, events: BlockingEvent[] = []): ClassConflict[] {
  const start = localMinutes(shift.startLocal), end = localMinutes(shift.endLocal);
  if (start === null || end === null || end <= start) return [];
  return weekClasses(events).flatMap((event) => {
    const classStart = localMinutes(event.startLocal), classEnd = localMinutes(event.endLocal);
    if (classStart === null || classEnd === null) return [];
    return intersects(start, end, classStart - event.bufferMinutes, classEnd + event.bufferMinutes)
      ? [{ event, blocking: event.effect === 'hard' }] : [];
  });
}

/** „wt 3.11, 10:00–11:30”. */
export function classTimeLabel(event: { startLocal: string; endLocal: string }): string {
  const date = new Date(`${event.startLocal.slice(0, 10)}T00:00:00Z`);
  const day = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${day}, ${event.startLocal.slice(11)}–${event.endLocal.slice(11)}`;
}

/** Komunikat pod zmianą: które zajęcia koliduje i z jakim buforem. */
export function conflictMessage(conflicts: ClassConflict[]): { blocking: string; optional: string } {
  const describe = (items: ClassConflict[]) => items.map(({ event }) =>
    `${event.title} (${classTimeLabel(event)}${event.bufferMinutes ? `, z dojazdem ${event.bufferMinutes} min` : ''})`).join('; ');
  const blocking = conflicts.filter((item) => item.blocking), optional = conflicts.filter((item) => !item.blocking);
  return {
    blocking: blocking.length ? `Koliduje z zajęciami obowiązkowymi: ${describe(blocking)}.` : '',
    optional: optional.length ? `Pomija zajęcia nieobowiązkowe: ${describe(optional)}.` : '',
  };
}
