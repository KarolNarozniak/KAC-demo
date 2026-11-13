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
