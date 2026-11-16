import { localDateKey, occurrencesForRange } from './calendar.ts';
import type { CalendarEvent, Occurrence } from './model.ts';

export type NotificationCalendarTarget = { eventId: string; eventStart: string };
export type NotificationResolution = { kind: 'open'; occurrence: Occurrence } | { kind: 'navigate'; date: string } | { kind: 'missing'; eventExists: boolean };

export function resolveNotificationTarget(events: CalendarEvent[], target: NotificationCalendarTarget,
  range: { start: Date; end: Date }): NotificationResolution {
  const event = events.find((item) => item.id === target.eventId);
  const occurrence = occurrencesForRange(events, range).find((item) => item.id === target.eventId
    && (event?.repeatWeekly ? localDateKey(item.occurrenceStart) === target.eventStart.slice(0, 10) : true));
  if (occurrence) return { kind: 'open', occurrence };
  if (event && !event.repeatWeekly) return { kind: 'navigate', date: event.start.slice(0, 10) };
  return { kind: 'missing', eventExists: Boolean(event) };
}

// S23KC2S1P2-299 (N07): szczegóły różnicy po kliknięciu powiadomienia o zmianie planu.
export const PLAN_CHANGE_TYPE = 'Zmiana planu';
type ChangeState = { start: string; end: string; location: string | null };
type ChangeDetails = { kind: 'changed' | 'unknown_previous'; fields: string[]; before: ChangeState | null; after: ChangeState };

const termLabel = (state: ChangeState) => state.start.slice(0, 10) === state.end.slice(0, 10)
  ? `${state.start.slice(0, 10)} ${state.start.slice(11, 16)}–${state.end.slice(11, 16)}`
  : `${state.start.replace('T', ' ')} – ${state.end.replace('T', ' ')}`;

/** Linie do pokazania przy otwartym wydarzeniu: było → jest; bez stanu „przed” nie zgadujemy różnicy. */
export function planChangeLines(change: ChangeDetails | null | undefined): string[] {
  if (!change) return [];
  if (change.kind === 'unknown_previous' || !change.before) return ['Poprzedni termin nie jest znany – poniżej aktualny stan wydarzenia.', `Termin teraz: ${termLabel(change.after)}`];
  const lines: string[] = [];
  if (change.fields.includes('date') || change.fields.includes('time')) lines.push(`Termin: ${termLabel(change.before)} → ${termLabel(change.after)}`);
  if (change.fields.includes('location')) lines.push(`Miejsce: ${change.before.location ?? 'nie podano'} → ${change.after.location ?? 'nie podano'}`);
  return lines;
}

/** Zapisany w powiadomieniu termin różni się od aktualnego – wydarzenie zmieniło się jeszcze raz po wysłaniu powiadomienia. */
export function planChangeOutdated(change: ChangeDetails | null | undefined, current: { start: string; end: string } | null): boolean {
  return !!change && !!current && (current.start.slice(0, 16) !== change.after.start || current.end.slice(0, 16) !== change.after.end);
}
