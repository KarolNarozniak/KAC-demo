import { localDateTime, eventOccurrences } from '../collisions.js';
import { toInstant } from '../import/rules.js';
import type { PlanningContext, PlanningEvent } from './types.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function addLocalDays(dateKey: string, amount: number): string {
  const match = DATE_RE.exec(dateKey);
  if (!match) throw new Error(`Niepoprawna data: ${dateKey}`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

export function weekday(dateKey: string): number {
  const match = DATE_RE.exec(dateKey);
  if (!match) return 0;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return 0;
  const value = date.getUTCDay();
  return value === 0 ? 7 : value;
}

export function minutesOfDay(value: string): number | null {
  if(value === '24:00')return 1440;
  const match = TIME_RE.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function timeOfDay(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function localInstant(dateKey: string, time: string, timeZone: string): Date | null {
  return time === '24:00' ? toInstant(addLocalDays(dateKey,1),'00:00',timeZone) : toInstant(dateKey, time, timeZone);
}

export function localDateKey(value: Date, timeZone: string): string {
  return localDateTime(value, timeZone).slice(0, 10);
}

export function localDateTimeString(value: Date, timeZone: string): string {
  return localDateTime(value, timeZone);
}

export function validWeekStart(weekStart: string): boolean {
  return DATE_RE.test(weekStart) && weekday(weekStart) === 1;
}

export function weekBounds(weekStart: string, timeZone: string) {
  const start = localInstant(weekStart, '00:00', timeZone);
  const end = localInstant(addLocalDays(weekStart, 7), '00:00', timeZone);
  if (!start || !end) throw new Error('Nie można wyznaczyć granic tygodnia w strefie czasowej.');
  return { start, end };
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  return minutesBetween(new Date(Math.max(aStart.getTime(), bStart.getTime())), new Date(Math.min(aEnd.getTime(), bEnd.getTime())));
}

export interface ExpandedPlanningEvent extends PlanningEvent {
  occurrenceStart: Date;
  occurrenceEnd: Date;
}

export function expandEventsForWeek(context: PlanningContext, weekStart: string): ExpandedPlanningEvent[] {
  const from = localInstant(addLocalDays(weekStart,-8), '00:00', context.profile.timeZone);
  // Include Monday after the selected week so Sunday night shifts are checked against Monday classes.
  const until = localInstant(addLocalDays(weekStart, 8), '00:00', context.profile.timeZone);
  if (!from || !until) return [];
  return context.events.flatMap((event) => eventOccurrences(event, from, until, context.profile.timeZone)
    .filter((occurrence) => !event.seriesEndDate || localDateKey(occurrence.start, context.profile.timeZone) <= event.seriesEndDate)
    .map((occurrence) => ({ ...event, occurrenceStart: occurrence.start, occurrenceEnd: occurrence.end })));
}
