import { createHash } from 'node:crypto';
import { toInstant } from './import/rules.js';

export type TimedEvent = { id?: string; title: string; start: string; end: string; category: string; repeatWeekly: boolean; mandatory?: boolean };
/**
 * Kolizja z jednym istniejącym wydarzeniem (S23KC2S1P2-302, N10).
 * start/end i overlap* opisują pierwsze kolidujące wystąpienie; recurring = obie strony są seriami cotygodniowymi,
 * więc ta sama kolizja powtarza się w każdym kolejnym tygodniu.
 */
export type Collision = { id: string; title: string; category: string; start: string; end: string; overlapStart: string; overlapEnd: string;
  mandatory: boolean; repeatWeekly: boolean; recurring: boolean };
export type CollisionCheck = { conflicts: Collision[]; collisionToken: string | null };
export class EventValidationError extends Error {}
export class EventNotFoundError extends Error {}
export class CollisionError extends Error {
  constructor(public conflicts: Collision[], public collisionToken: string) { super('event_collision'); }
}
const DAY = 86400000;
const civil = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
const dateAt = (day: number) => new Date(day).toISOString().slice(0,10);
const instant = (value: string, zone: string) => toInstant(value.slice(0,10), value.slice(11,16), zone);
export function localDateTime(value: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const get = (key: string) => parts.find(part => part.type === key)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function validateTimedEvent(event: TimedEvent, zone: string) {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!pattern.test(event.start) || !pattern.test(event.end) || !event.title.trim()) throw new EventValidationError('invalid_event');
  const start = instant(event.start, zone), end = instant(event.end, zone);
  if (!start || !end || end <= start || localDateTime(start, zone) !== event.start || localDateTime(end, zone) !== event.end)
    throw new EventValidationError('invalid_event');
  const wallDuration = Date.parse(`${event.end}:00Z`) - Date.parse(`${event.start}:00Z`);
  if (wallDuration > (event.repeatWeekly ? 7 : 366) * DAY) throw new EventValidationError('event_too_long');
  return { start, end };
}

/** Enumerate only occurrences intersecting the requested interval, retaining local wall time. */
export function eventOccurrences(event: TimedEvent, from: Date, until: Date, zone: string): { start: Date; end: Date }[] {
  const baseStart = instant(event.start, zone), baseEnd = instant(event.end, zone);
  if (!baseStart || !baseEnd) return [];
  if (!event.repeatWeekly) return baseStart < until && baseEnd > from ? [{ start: baseStart, end: baseEnd }] : [];
  const startDay = civil(event.start), endDay = civil(event.end);
  const durationDays = (endDay - startDay) / DAY;
  const firstWeek = Math.max(0, Math.floor((civil(localDateTime(from, zone)) - startDay) / (7 * DAY)) - Math.ceil(durationDays / 7) - 1);
  const lastDay = civil(localDateTime(until, zone));
  const result: { start: Date; end: Date }[] = [];
  for (let week = firstWeek; startDay + week * 7 * DAY <= lastDay; week++) {
    const start = toInstant(dateAt(startDay + week * 7 * DAY), event.start.slice(11), zone);
    const end = toInstant(dateAt(endDay + week * 7 * DAY), event.end.slice(11), zone);
    // A nonexistent local time during the spring clock change has no occurrence.
    if (start && end && start < until && end > from && end > start) result.push({ start, end });
  }
  return result;
}

export function findEventCollisions(candidate: TimedEvent, events: TimedEvent[], zone: string, excludeId?: string): Collision[] {
  const proposed = validateTimedEvent(candidate, zone);
  const result: Collision[] = [];
  for (const event of events) {
    if (event.id === excludeId) continue;
    const existingStart = instant(event.start, zone), existingEnd = instant(event.end, zone);
    if (!existingStart || !existingEnd) continue;
    let from = proposed.start, until = proposed.end;
    if (candidate.repeatWeekly) {
      if (!event.repeatWeekly) { from = existingStart; until = existingEnd; }
      else {
        // Both series use the account timezone: a weekly wall-time pattern repeats.
        // Three weeks cover the first shared week and a possible skipped DST occurrence.
        from = new Date(Math.max(proposed.start.getTime(), existingStart.getTime()));
        until = new Date(from.getTime() + 21 * DAY + Math.max(proposed.end.getTime() - proposed.start.getTime(), existingEnd.getTime() - existingStart.getTime()));
      }
    }
    const candidates = eventOccurrences(candidate, from, until, zone);
    const others = eventOccurrences(event, from, until, zone);
    let found = false;
    for (const a of candidates) {
      for (const b of others) {
        if (a.start < b.end && b.start < a.end) {
          result.push({ id: event.id!, title: event.title, category: event.category, start: b.start.toISOString(), end: b.end.toISOString(),
            overlapStart: new Date(Math.max(a.start.getTime(), b.start.getTime())).toISOString(),
            overlapEnd: new Date(Math.min(a.end.getTime(), b.end.getTime())).toISOString(),
            mandatory: event.mandatory === true, repeatWeekly: event.repeatWeekly, recurring: candidate.repeatWeekly && event.repeatWeekly });
          found = true; break;
        }
      }
      if (found) break;
    }
  }
  return result.sort((a,b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

type CollisionCandidate = TimedEvent & { location?: string; mandatory?: boolean; collisionToken?: string };

/** Token wiąże świadomą decyzję z tym szkicem i dokładnie tą listą kolizji – każda zmiana danych albo listy go unieważnia. */
function collisionTokenFor(candidate: CollisionCandidate, conflicts: Collision[], excludeId?: string) {
  return createHash('sha256').update(JSON.stringify({ excludeId, title: candidate.title, start: candidate.start, end: candidate.end,
    category: candidate.category, repeatWeekly: candidate.repeatWeekly, location: candidate.location, mandatory: candidate.mandatory, conflicts })).digest('hex');
}

/** Ponowne sprawdzenie bez zapisu (S23KC2S1P2-302): pełna lista kolizji i token potrzebny do świadomego zapisu. */
export function checkEventCollisions(candidate: CollisionCandidate, events: TimedEvent[], zone: string, excludeId?: string): CollisionCheck {
  const conflicts = findEventCollisions(candidate, events, zone, excludeId);
  return { conflicts, collisionToken: conflicts.length ? collisionTokenFor(candidate, conflicts, excludeId) : null };
}

/** Bind explicit override to this draft and the conflicts actually shown to the user. */
export function requireCollisionDecision(candidate: CollisionCandidate, events: TimedEvent[], zone: string, excludeId?: string) {
  const { conflicts, collisionToken } = checkEventCollisions(candidate, events, zone, excludeId);
  if (!conflicts.length || !collisionToken) return;
  if (candidate.collisionToken !== collisionToken) throw new CollisionError(conflicts, collisionToken);
}
