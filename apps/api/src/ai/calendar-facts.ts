// Fakty o kalendarzu dla asystenta i podsumowania dnia (S23KC2S1P2-254, S23KC2S1P2-270).
// Wszystkie sumy i wolne okna liczy backend na rzeczywistych chwilach czasu (Date), a nie model.
// Serie cotygodniowe są rozwijane istniejącą funkcją eventOccurrences, więc zmiana czasu i zdarzenia przez północ działają tak jak w kalendarzu.
import { createHash } from 'node:crypto';
import { eventOccurrences, localDateTime } from '../collisions.js';
import { toInstant } from '../import/rules.js';

export type FactCategory = 'Class' | 'Work' | 'Personal';
export type SourceEvent = {
  id: string; title: string; start: string; end: string; category: string;
  location?: string; mandatory?: boolean; repeatWeekly?: boolean;
};
export type Occurrence = {
  id: string; title: string; category: FactCategory; location: string; mandatory: boolean; repeatWeekly: boolean;
  start: Date; end: Date; startLocal: string; endLocal: string;
};
export type FreeWindow = { date: string; startLocal: string; endLocal: string; minutes: number; label: string };
export type CategoryTotals = { classMinutes: number; workMinutes: number; personalMinutes: number; busyMinutes: number };
export type DayFacts = {
  date: string; timeZone: string;
  events: Array<Omit<Occurrence, 'start' | 'end'> & { startsBeforeDay: boolean; endsAfterDay: boolean }>;
  gaps: FreeWindow[];
  totals: CategoryTotals;
  fingerprint: string;
};

const DAY = 86_400_000;
const MINUTE = 60_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Kalendarz zwraca polskie nazwy kategorii, narzędzia i API – angielskie kody. */
export function normalizeCategory(category: string): FactCategory {
  if (category === 'Class' || category === 'Zajęcia') return 'Class';
  if (category === 'Work' || category === 'Praca') return 'Work';
  return 'Personal';
}

export const isValidDate = (value: string) => DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const minutesBetween = (start: Date, end: Date) => Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE));

/** Lokalna północ podanej daty jako chwila czasu. Północ zawsze istnieje w strefach europejskich (zmiana czasu jest w nocy). */
export function localMidnight(date: string, zone: string): Date {
  const instant = toInstant(date, '00:00', zone);
  if (!instant) throw new Error('invalid_date');
  return instant;
}

function localTimeInstant(date: string, time: string, zone: string): Date | null {
  return time === '24:00' ? localMidnight(addDays(date, 1), zone) : toInstant(date, time, zone);
}

/** Wystąpienia wydarzeń przecinające przedział [from, until), posortowane po początku. */
export function occurrencesInRange(events: SourceEvent[], from: Date, until: Date, zone: string): Occurrence[] {
  return events.flatMap((event) => eventOccurrences({ title: event.title, start: event.start, end: event.end, category: event.category,
    repeatWeekly: Boolean(event.repeatWeekly) }, from, until, zone).map((occurrence) => ({
    id: event.id, title: event.title, category: normalizeCategory(event.category), location: event.location ?? '',
    mandatory: Boolean(event.mandatory), repeatWeekly: Boolean(event.repeatWeekly),
    start: occurrence.start, end: occurrence.end,
    startLocal: localDateTime(occurrence.start, zone), endLocal: localDateTime(occurrence.end, zone),
  }))).sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime() || a.title.localeCompare(b.title));
}

/** Scala nakładające się zajęte przedziały przycięte do [from, until). */
function busyIntervals(occurrences: Occurrence[], from: Date, until: Date): Array<{ start: Date; end: Date }> {
  const clipped = occurrences
    .map((item) => ({ start: new Date(Math.max(item.start.getTime(), from.getTime())), end: new Date(Math.min(item.end.getTime(), until.getTime())) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const item of clipped) {
    const last = merged[merged.length - 1];
    if (last && item.start <= last.end) { if (item.end > last.end) last.end = item.end; }
    else merged.push({ ...item });
  }
  return merged;
}

/** Luki w [from, until), które nie przecinają żadnego wydarzenia i trwają co najmniej minMinutes. */
export function freeGaps(occurrences: Occurrence[], from: Date, until: Date, minMinutes: number, zone: string): FreeWindow[] {
  const result: FreeWindow[] = [];
  let cursor = from;
  const push = (start: Date, end: Date) => {
    const minutes = minutesBetween(start, end);
    if (minutes >= minMinutes && minutes > 0) {
      const startLocal = localDateTime(start, zone);
      result.push({ date: startLocal.slice(0, 10), startLocal, endLocal: localDateTime(end, zone), minutes, label: formatDuration(minutes) });
    }
  };
  for (const busy of busyIntervals(occurrences, from, until)) {
    if (busy.start > cursor) push(cursor, busy.start);
    if (busy.end > cursor) cursor = busy.end;
  }
  if (until > cursor) push(cursor, until);
  return result;
}

/** Suma minut w kategoriach (części wydarzeń poza zakresem są obcinane) i łączny zajęty czas bez podwójnego liczenia nakładek. */
export function categoryTotals(occurrences: Occurrence[], from: Date, until: Date): CategoryTotals {
  const totals: CategoryTotals = { classMinutes: 0, workMinutes: 0, personalMinutes: 0, busyMinutes: 0 };
  for (const item of occurrences) {
    const start = new Date(Math.max(item.start.getTime(), from.getTime())), end = new Date(Math.min(item.end.getTime(), until.getTime()));
    const minutes = minutesBetween(start, end);
    if (item.category === 'Class') totals.classMinutes += minutes;
    else if (item.category === 'Work') totals.workMinutes += minutes;
    else totals.personalMinutes += minutes;
  }
  totals.busyMinutes = busyIntervals(occurrences, from, until).reduce((sum, item) => sum + minutesBetween(item.start, item.end), 0);
  return totals;
}

/** Fakty jednego dnia: wydarzenia (także przechodzące przez północ), przerwy między nimi i sumy. */
export function computeDayFacts(events: SourceEvent[], date: string, zone: string, minGapMinutes = 15): DayFacts {
  const from = localMidnight(date, zone), until = localMidnight(addDays(date, 1), zone);
  const occurrences = occurrencesInRange(events, from, until, zone);
  const busy = busyIntervals(occurrences, from, until);
  // Przerwy liczymy między pierwszym a ostatnim wydarzeniem dnia – czas przed pierwszym i po ostatnim to nie „przerwa”.
  const first = busy[0], last = busy[busy.length - 1];
  const gaps = first && last ? freeGaps(occurrences, first.start, last.end, minGapMinutes, zone) : [];
  const fingerprint = createHash('sha256').update(JSON.stringify([date, zone, occurrences.map((item) =>
    [item.id, item.title, item.category, item.location, item.mandatory, item.start.toISOString(), item.end.toISOString()])])).digest('hex').slice(0, 24);
  return {
    date, timeZone: zone,
    events: occurrences.map(({ start, end, ...item }) => ({ ...item, startsBeforeDay: start < from, endsAfterDay: end > until })),
    gaps, totals: categoryTotals(occurrences, from, until), fingerprint,
  };
}

/** Wolne okna w ramach godzin dayStart–dayEnd każdego dnia zakresu (włącznie). Wolny czas to luka w kalendarzu, nie dostępność do pracy. */
export function freeWindowsInRange(events: SourceEvent[], fromDate: string, toDate: string, dayStart: string, dayEnd: string, minMinutes: number, zone: string): FreeWindow[] {
  const result: FreeWindow[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const from = localTimeInstant(date, dayStart, zone), until = localTimeInstant(date, dayEnd, zone);
    if (!from || !until || until <= from) continue;
    result.push(...freeGaps(occurrencesInRange(events, from, until, zone), from, until, minMinutes, zone));
  }
  return result;
}

/** Sumy czasu w kategoriach dla dni fromDate..toDate (włącznie), liczone na rzeczywistych chwilach czasu. */
export function totalsInRange(events: SourceEvent[], fromDate: string, toDate: string, zone: string) {
  const from = localMidnight(fromDate, zone), until = localMidnight(addDays(toDate, 1), zone);
  const occurrences = occurrencesInRange(events, from, until, zone);
  const totals = categoryTotals(occurrences, from, until);
  // Gotowe etykiety po polsku: model ma je przepisać, a nie przeliczać minut ani pokazywać nazw pól.
  return { from: fromDate, to: toDate, timeZone: zone, occurrenceCount: occurrences.length, ...totals,
    labels: { classes: formatDuration(totals.classMinutes), work: formatDuration(totals.workMinutes),
      personal: formatDuration(totals.personalMinutes), busy: formatDuration(totals.busyMinutes) } };
}

export const isValidTime = (value: string) => TIME.test(value);

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours && rest ? `${hours} h ${rest} min` : hours ? `${hours} h` : `${rest} min`;
}

const CATEGORY_LABEL: Record<FactCategory, string> = { Class: 'zajęcia', Work: 'praca', Personal: 'prywatne' };
const eventWord = (count: number) => count === 1 ? 'wydarzenie' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'wydarzenia' : 'wydarzeń';

/** Podsumowanie bez AI: używane dla pustego dnia i gdy model jest niedostępny (scenariusz 3a, 3b). */
export function localDaySummary(facts: DayFacts): string {
  if (!facts.events.length) return 'Na dziś nie masz żadnych wydarzeń w kalendarzu.';
  const time = (item: DayFacts['events'][number]) =>
    `${item.startsBeforeDay ? 'od wczoraj' : item.startLocal.slice(11)}–${item.endsAfterDay ? 'po północy' : item.endLocal.slice(11)}`;
  const list = facts.events.slice(0, 6).map((item) => `${time(item)} ${item.title} (${CATEGORY_LABEL[item.category]})`).join(', ');
  const more = facts.events.length > 6 ? ` i ${facts.events.length - 6} więcej` : '';
  const parts = [`Masz dziś ${facts.events.length} ${eventWord(facts.events.length)}: ${list}${more}.`];
  const longest = [...facts.gaps].sort((a, b) => b.minutes - a.minutes)[0];
  if (longest) parts.push(`Najdłuższa przerwa: ${longest.startLocal.slice(11)}–${longest.endLocal.slice(11)} (${formatDuration(longest.minutes)}).`);
  if (facts.totals.workMinutes) parts.push(`Praca łącznie: ${formatDuration(facts.totals.workMinutes)}.`);
  return parts.join(' ');
}
