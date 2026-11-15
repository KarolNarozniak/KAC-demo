// Podgląd wydarzenia z czatu (S23KC2S1P2-252, S23KC2S1P2-262): wspólna walidacja i kolizje z kalendarza.
// Korzysta z tych samych funkcji co ręczne dodawanie (validateTimedEvent, findEventCollisions), więc czat nie ma osobnych reguł.
import { EventValidationError, findEventCollisions, localDateTime, validateTimedEvent } from '../collisions.js';
import { normalizeCategory, type FactCategory } from './calendar-facts.js';
import type { AiPendingAction } from './repository.js';

export type PreviewCollision = { id: string; title: string; category: FactCategory; startLocal: string; endLocal: string };
type CalendarEvent = { id: string; title: string; start: string; end: string; category: string; repeatWeekly?: boolean };
type ProposedEvent = { title: string; start: string; end: string; category: string; repeatWeekly: boolean };

/** Kolidujące wydarzenia dla proponowanego terminu (godziny lokalne w strefie kalendarza). Rzuca EventValidationError dla nieistniejącego czasu. */
export function previewCollisions(event: ProposedEvent, events: CalendarEvent[], zone: string, excludeId?: string): PreviewCollision[] {
  validateTimedEvent({ ...event }, zone);
  return findEventCollisions({ ...event }, events.map((item) => ({ ...item, repeatWeekly: Boolean(item.repeatWeekly) })), zone, excludeId)
    .slice(0, 10).map((item) => ({ id: item.id, title: item.title, category: normalizeCategory(item.category),
      startLocal: localDateTime(new Date(item.start), zone), endLocal: localDateTime(new Date(item.end), zone) }));
}

export type EnrichedPendingAction = AiPendingAction & { collisions?: PreviewCollision[]; validationError?: string };

/** Dokleja do oczekujących akcji aktualne kolizje – liczone przy każdym odczycie, więc zmiana kalendarza jest od razu widoczna. */
export function withPreviewCollisions(actions: AiPendingAction[], events: CalendarEvent[] | undefined, zone: string): EnrichedPendingAction[] {
  if (!events) return actions;
  return actions.map((action) => {
    const event = action.payload.event as ProposedEvent | undefined;
    if (!event || (action.kind !== 'calendar_event_create' && action.kind !== 'calendar_event_update')) return action;
    try {
      return { ...action, collisions: previewCollisions(event, events, zone, action.kind === 'calendar_event_update' ? String(action.payload.id ?? '') : undefined) };
    } catch (error) {
      return { ...action, collisions: [], validationError: error instanceof EventValidationError ? error.message : 'invalid_event' };
    }
  });
}
