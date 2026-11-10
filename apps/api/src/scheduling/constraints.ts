// Uwzględnianie zajęć przy planowaniu grafiku (S23KC2S1P2-40).
// - listBlockingOccurrences (S23KC2S1P2-193): wystąpienia wydarzeń tygodnia, także z serii cotygodniowych (eventOccurrences),
// - constraints.classCollision i freeWindows (S23KC2S1P2-194): kolizja zmiany z zajęciami oraz wolny czas = dostępność minus zajęcia.
import { addLocalDays, expandEventsForWeek, localDateTimeString, localInstant, weekBounds } from './time.js';
import type { AvailabilityWindow, BlockedPeriod, BlockingOccurrence, FreeWindow, PlanningContext, ScheduleViolation } from './types.js';

export type Interval = { id: string; title: string; start: Date; end: Date };
export type BufferSettings = { commuteBufferMinutes: number; minimumRestMinutes: number };

/** Warunek przecięcia przedziałów półotwartych [start, end): samo zetknięcie końca z początkiem nie jest kolizją. */
export function intersects(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Wystąpienia wydarzeń, które wpływają na planowanie w tygodniu (od poniedziałku do poniedziałku po tygodniu włącznie,
 * żeby zmiana nocna z niedzieli była sprawdzona względem poniedziałkowych zajęć). Serie cotygodniowe są rozwijane
 * przez eventOccurrences z zachowaniem lokalnej godziny (także po zmianie czasu) i z datą końca serii.
 *
 * effect: hard – pracy nie wolno zaplanować w tym czasie (zajęcia obowiązkowe, inne wydarzenia, zapisana praca),
 *         soft – zajęcia nieobowiązkowe: generator omija je, dopóki może, a pominięcie zgłasza ostrzeżeniem.
 * bufferMinutes: czas dojazdu (a przy pracy także odpoczynek), który musi zostać przed i po wydarzeniu.
 */
export function listBlockingOccurrences(context: PlanningContext, weekStart: string, buffers: BufferSettings): BlockingOccurrence[] {
  const timeZone = context.profile.timeZone;
  const from=weekBounds(weekStart,timeZone).start.getTime();
  const until=localInstant(addLocalDays(weekStart,8),'00:00',timeZone)!.getTime();
  return expandEventsForWeek(context, weekStart)
    .map((event): BlockingOccurrence => {
      const optionalClass = event.category === 'Class' && !event.mandatory;
      const bufferMinutes = event.category === 'Work' ? Math.max(buffers.commuteBufferMinutes, buffers.minimumRestMinutes) : buffers.commuteBufferMinutes;
      return {
        eventId: event.id,
        title: event.title,
        category: event.category,
        mandatory: event.mandatory,
        repeatWeekly: event.repeatWeekly,
        start: event.occurrenceStart.toISOString(),
        end: event.occurrenceEnd.toISOString(),
        startLocal: localDateTimeString(event.occurrenceStart, timeZone),
        endLocal: localDateTimeString(event.occurrenceEnd, timeZone),
        effect: optionalClass ? 'soft' : 'hard',
        bufferMinutes,
      };
    })
    .filter(event=>Date.parse(event.end)+event.bufferMinutes*60000>from && Date.parse(event.start)-event.bufferMinutes*60000<until)
    .sort((a, b) => a.start.localeCompare(b.start) || a.eventId.localeCompare(b.eventId));
}

/** Przedział zajęty przez wystąpienie razem z buforem przed i po. */
export function paddedInterval(occurrence: BlockingOccurrence): Interval {
  const pad = occurrence.bufferMinutes * 60_000;
  return { id: occurrence.eventId, title: occurrence.title,
    start: new Date(new Date(occurrence.start).getTime() - pad), end: new Date(new Date(occurrence.end).getTime() + pad) };
}

export function blockedPeriodIntervals(periods: BlockedPeriod[]): Interval[] {
  return periods.flatMap((period) => {
    const start = new Date(period.start), end = new Date(period.end);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start
      ? [{ id: period.id, title: period.reason ?? period.type, start, end }]
      : [];
  });
}

/** Okna dostępności w konkretnych datach tygodnia (plus poniedziałek po tygodniu – na zmiany nocne z niedzieli). */
export function availabilityRanges(windows: AvailabilityWindow[], weekStart: string, timeZone: string): Interval[] {
  const result: Interval[] = [];
  for (let dayOffset = -1; dayOffset <= 7; dayOffset++) {
    const dateKey = addLocalDays(weekStart, dayOffset);
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay() || 7;
    for (const window of windows.filter((item) => item.dayOfWeek === weekday)) {
      const start = localInstant(dateKey, window.startTime, timeZone);
      let end = localInstant(dateKey, window.endTime, timeZone);
      if (start && end && end <= start) end = localInstant(addLocalDays(dateKey, 1), window.endTime, timeZone);
      if (start && end && end > start) result.push({ id: window.id, title: 'Dostępność', start, end });
    }
  }
  return result;
}

/** Odejmuje zajęte przedziały od wolnych. Wynik jest posortowany i nie zawiera pustych kawałków. */
export function subtractIntervals(ranges: Interval[], blocks: Interval[]): Interval[] {
  const sortedBlocks = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: Interval[] = [];
  for (const range of [...ranges].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    let cursor = range.start;
    for (const block of sortedBlocks) {
      if (!intersects(cursor, range.end, block.start, block.end)) continue;
      if (block.start > cursor) result.push({ ...range, start: cursor, end: block.start });
      if (block.end > cursor) cursor = block.end;
      if (cursor >= range.end) break;
    }
    if (cursor < range.end) result.push({ ...range, start: cursor, end: range.end });
  }
  return result;
}

/**
 * S23KC2S1P2-194, krok 5 scenariusza: przedziały, w których można zaplanować pracę.
 * Dostępność w tygodniu minus zajęcia obowiązkowe i inne wydarzenia (z buforem dojazdu) oraz blokady z profilu.
 * Zajęcia nieobowiązkowe nie są odejmowane – generator może je pominąć, ale tylko w ostateczności.
 * Kawałki krótsze niż minimalna zmiana nie nadają się na pracę, więc nie są liczone.
 */
export function freeWindows(context: PlanningContext, weekStart: string, occurrences: BlockingOccurrence[], minimumShiftMinutes: number): { windows: FreeWindow[]; freeMinutes: number } {
  const timeZone = context.profile.timeZone;
  const { start: weekStartInstant, end: weekEndInstant } = weekBounds(weekStart, timeZone);
  const hard = [...occurrences.filter((occurrence) => occurrence.effect === 'hard').map(paddedInterval), ...blockedPeriodIntervals(context.blockedPeriods)];
  const windows = subtractIntervals(availabilityRanges(context.availability, weekStart, timeZone), hard)
    .filter((window) => window.start < weekEndInstant && window.end > weekStartInstant)
    .map((window) => ({ start: window.start, end: window.end, minutes: Math.round((window.end.getTime() - window.start.getTime()) / 60_000) }))
    .filter((window) => window.minutes >= minimumShiftMinutes)
    .map((window): FreeWindow => ({ start: window.start.toISOString(), end: window.end.toISOString(),
      startLocal: localDateTimeString(window.start, timeZone), endLocal: localDateTimeString(window.end, timeZone), minutes: window.minutes }));
  return { windows, freeMinutes: windows.reduce((sum, window) => sum + window.minutes, 0) };
}

/** Zmiana do sprawdzenia: identyfikator i przedział w czasie bezwzględnym. */
export type ShiftInterval = { id: string; start: Date; end: Date };

const clipLocal = (value: Date, timeZone: string) => localDateTimeString(value, timeZone);

export const constraints = {
  /**
   * S23KC2S1P2-194: zmiana nie może nachodzić na zajęcia obowiązkowe ani na czas dojazdu przed i po nich.
   * Zwraca błąd ClassCollisionViolation (code: class_collision) dla każdego kolidującego wystąpienia zajęć.
   */
  classCollision(shift: ShiftInterval, occurrences: BlockingOccurrence[], timeZone: string): ScheduleViolation[] {
    return occurrences
      .filter((occurrence) => occurrence.category === 'Class' && occurrence.effect === 'hard')
      .flatMap((occurrence) => {
        const blocked = paddedInterval(occurrence);
        if (!intersects(shift.start, shift.end, blocked.start, blocked.end)) return [];
        const overlapStart = new Date(Math.max(shift.start.getTime(), blocked.start.getTime()));
        const overlapEnd = new Date(Math.min(shift.end.getTime(), blocked.end.getTime()));
        const day = occurrence.startLocal.slice(0, 10);
        return [{
          code: 'class_collision',
          severity: 'error' as const,
          message: `Zmiana koliduje z zajęciami obowiązkowymi „${occurrence.title}” (${day} ${occurrence.startLocal.slice(11)}–${occurrence.endLocal.slice(11)}${occurrence.bufferMinutes ? `, z dojazdem ${occurrence.bufferMinutes} min` : ''}).`,
          candidateIds: [shift.id],
          eventIds: [occurrence.eventId],
          details: {
            eventId: occurrence.eventId,
            title: occurrence.title,
            mandatory: true,
            classStartLocal: occurrence.startLocal,
            classEndLocal: occurrence.endLocal,
            overlapStartLocal: clipLocal(overlapStart, timeZone),
            overlapEndLocal: clipLocal(overlapEnd, timeZone),
            bufferMinutes: occurrence.bufferMinutes,
          },
        }];
      });
  },
};
export type TimedItem = {
    id: string;
    start: string;
    end: string;
    category: 'Work' | 'Class' | 'Personal';
    title?: string;
};
export type Window = {
    start: string;
    end: string;
};
export type CommuteViolation = {
    error: 'commute_gap_too_short';
    requiredMinutes: number;
    actualMinutes: number;
    leftId: string;
    rightId: string;
    leftTitle?: string;
    rightTitle?: string;
};
export function validateCommuteGaps(events: TimedItem[], commuteMinutes: number, minRestMinutes: number): CommuteViolation[] {
    const ordered = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const errors: CommuteViolation[] = [];
    // Check each relevant pair: a nested personal event must not hide a Work overlap.
    for (let i = 0; i < ordered.length; i++)
        for (let j = i + 1; j < ordered.length; j++) {
            const a = ordered[i]!, b = ordered[j]!;
            if (a.category !== 'Work' && b.category !== 'Work')
                continue;
            const requiredMinutes = a.category === 'Work' && b.category === 'Work' ? Math.max(commuteMinutes, minRestMinutes) : commuteMinutes;
            const actualMinutes = (Date.parse(b.start) - Date.parse(a.end)) / 60000;
            if (actualMinutes < requiredMinutes)
                errors.push({ error: 'commute_gap_too_short', requiredMinutes, actualMinutes, leftId: a.id, rightId: b.id, leftTitle: a.title, rightTitle: b.title });
        }
    return errors;
}
export function validateAvailability(shifts: TimedItem[], windows: Window[], commuteMinutes: number) {
    return shifts.filter(s => !windows.some(w => Date.parse(s.start) - commuteMinutes * 60000 >= Date.parse(w.start) && Date.parse(s.end) + commuteMinutes * 60000 <= Date.parse(w.end)))
        .map(s => ({ error: 'commute_outside_availability', shiftId: s.id, requiredMinutes: commuteMinutes }));
}
