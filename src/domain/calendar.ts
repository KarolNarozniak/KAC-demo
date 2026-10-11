import type { CalendarEvent, Occurrence, TimeRange } from './model';
const DAY_MS = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
const civilDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
export function localDateKey(date: Date): string { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result;
}
export function addCalendarDays(date: Date, amount: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate()); result.setDate(result.getDate() + amount); return result;
}
export function parseLocalDateTime(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date); const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const year = Number(dm[1]); const month = Number(dm[2]) - 1; const day = Number(dm[3]); const hour = Number(tm[1]); const minute = Number(tm[2]);
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const result = new Date(year, month, day, hour, minute);
  return result.getFullYear() === year && result.getMonth() === month && result.getDate() === day ? result : null;
}
export function validateEventInput(input: Pick<CalendarEvent, 'title' | 'start' | 'end'>): string | null {
  if (!input.title.trim()) return 'Add an event title.';
  const parse = (value: string) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value); return m ? parseLocalDateTime(m[1], m[2]) : null; };
  const start = parse(input.start); const end = parse(input.end);
  if (!start || !end) return 'Enter a valid date and time.';
  return end <= start ? 'End time must be after the start time.' : null;
}
function eventAtDate(event: CalendarEvent, day: Date): Occurrence | null {
  const base = new Date(event.start); const baseEnd = new Date(event.end);
  if (!Number.isFinite(base.getTime()) || !Number.isFinite(baseEnd.getTime())) return null;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), base.getHours(), base.getMinutes());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), baseEnd.getHours(), baseEnd.getMinutes());
  if (baseEnd.getDate() !== base.getDate() || baseEnd.getMonth() !== base.getMonth()) end.setDate(end.getDate() + Math.round((baseEnd.getTime() - base.getTime()) / DAY_MS));
  return { ...event, occurrenceStart: start, occurrenceEnd: end };
}
export function occurrencesForRange(events: CalendarEvent[], range: TimeRange): Occurrence[] {
  if (!Number.isFinite(range.start.getTime()) || !Number.isFinite(range.end.getTime()) || range.end <= range.start) return [];
  const output: Occurrence[] = [];
  for (const event of events) {
    const base = new Date(event.start); const baseEnd = new Date(event.end);
    if (!Number.isFinite(base.getTime()) || !Number.isFinite(baseEnd.getTime()) || baseEnd <= base) continue;
    if (!event.repeatWeekly) { if (base < range.end && baseEnd > range.start) output.push({ ...event, occurrenceStart: base, occurrenceEnd: baseEnd }); continue; }
    const durationDays = Math.ceil((baseEnd.getTime() - base.getTime()) / DAY_MS);
    const firstDay = addCalendarDays(range.start, -durationDays);
    let week = Math.max(0, Math.floor((civilDay(startOfWeek(firstDay)) - civilDay(startOfWeek(base))) / 7) - 1);
    let item = eventAtDate(event, addCalendarDays(base, week * 7));
    while (item && item.occurrenceStart < range.end) { if (item.occurrenceEnd > range.start) output.push(item); week++; item = eventAtDate(event, addCalendarDays(base, week * 7)); }
  }
  return output.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
}
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean { return aStart < bEnd && bStart < aEnd; }
export function findCollisions(candidate: CalendarEvent, events: CalendarEvent[], excludeId?: string): CalendarEvent[] {
  const start = new Date(candidate.start); const end = new Date(candidate.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
  const collisions = new Map<string, CalendarEvent>();
  for (const event of events.filter((item) => item.id !== (excludeId ?? candidate.id))) {
    const eventStart = new Date(event.start); const eventEnd = new Date(event.end);
    if (!Number.isFinite(eventStart.getTime()) || !Number.isFinite(eventEnd.getTime()) || eventEnd <= eventStart) continue;
    const anchor = candidate.repeatWeekly ? event.repeatWeekly ? (eventStart > start ? eventStart : start) : eventStart : start;
    const range = { start: addCalendarDays(anchor, -8), end: addCalendarDays(anchor, 8) };
    const candidateItems = candidate.repeatWeekly ? occurrencesForRange([candidate], range) : [{ occurrenceStart: start, occurrenceEnd: end }];
    const eventItems = event.repeatWeekly ? occurrencesForRange([event], range) : [{ occurrenceStart: eventStart, occurrenceEnd: eventEnd }];
    if (candidateItems.some((left) => eventItems.some((right) => overlaps(left.occurrenceStart, left.occurrenceEnd, right.occurrenceStart, right.occurrenceEnd)))) {
      collisions.set(event.id, event);
    }
  }
  return [...collisions.values()];
}export function setEventTime(event: CalendarEvent, occurrenceDate: Date, startTime: string, endTime: string, series: boolean): CalendarEvent | null {
  const date = localDateKey(series ? new Date(event.start) : occurrenceDate);
  const start = parseLocalDateTime(date, startTime); const end = parseLocalDateTime(date, endTime);
  if (!start || !end || end <= start) return null;
  return { ...event, start: `${date}T${startTime}`, end: `${date}T${endTime}` };
}
