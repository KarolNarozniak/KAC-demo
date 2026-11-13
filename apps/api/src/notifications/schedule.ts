import { addLocalDays, localDateTimeString, localInstant } from '../scheduling/time.js';

export function parseEventTime(value: string, timeZone: string): Date {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  const [date, time] = value.split('T');
  const parsed = localInstant(date!, time!, timeZone);
  if (!parsed) throw new Error('invalid_outbox_event_time');
  return parsed;
}

export function reminderTime(start: Date, minutesBefore: number, timeZone: string, now: Date,
  quietStart?: string | null, quietEnd?: string | null): Date | null {
  if (start <= now) return null;
  let sendAt = new Date(start.getTime() - Math.min(24 * 60, Math.max(0, minutesBefore)) * 60_000);
  if (quietStart && quietEnd) {
    const local = localDateTimeString(sendAt, timeZone);
    const date = local.slice(0, 10), time = local.slice(11, 16);
    const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const currentMinute = toMinute(time), startMinute = toMinute(quietStart), endMinute = toMinute(quietEnd);
    const quiet = startMinute < endMinute ? currentMinute >= startMinute && currentMinute < endMinute
      : currentMinute >= startMinute || currentMinute < endMinute;
    if (quiet) {
      const endDate = startMinute > endMinute && currentMinute >= startMinute ? addLocalDays(date, 1) : date;
      const quietEndInstant = localInstant(endDate, quietEnd.slice(0, 5), timeZone);
      sendAt = quietEndInstant && quietEndInstant < start ? quietEndInstant : start;
    }
  }
  return sendAt <= now ? now : sendAt;
}

export function reminderText(title: string, start: Date, end: Date, timeZone: string): string {
  const format = (date: Date) => localDateTimeString(date, timeZone).slice(0, 16).replace('T', ' ');
  return `Przypomnienie: ${title.slice(0, 180)}, ${format(start)}–${format(end)}`;
}
