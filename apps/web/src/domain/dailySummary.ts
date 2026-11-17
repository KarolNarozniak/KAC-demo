import type { CalendarEvent } from './model.ts';
import { addCalendarDays, localDateKey, occurrencesForRange } from './calendar.ts';

export function dayGreeting(now: Date): string {
  return now.getHours() >= 18 || now.getHours() < 5 ? 'Dobry wieczór!' : 'Dzień dobry!';
}

export function dailySummaryContext(events: CalendarEvent[], now: Date) {
  const date = localDateKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const occurrences = occurrencesForRange(events, { start, end: addCalendarDays(start, 1) });
  const snapshot = occurrences.map(({ id, title, category, location, mandatory, repeatWeekly, occurrenceStart, occurrenceEnd }) =>
    [id, title, category, location ?? '', mandatory, repeatWeekly, occurrenceStart.getTime(), occurrenceEnd.getTime()]);
  snapshot.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { date, key: JSON.stringify([date, snapshot]), empty: occurrences.length === 0 };
}
