import { toInstant } from '../import/rules.js';
import { eventOccurrences, localDateTime, type TimedEvent } from '../collisions.js';

const DAY = 86400000;

/** Zmiana zaproponowana przez generator (lub ręcznie edytowana). Czas lokalny "RRRR-MM-DDTGG:MM". */
export type ProposedShift = {
  id: string;
  start: string;
  end: string;
  /** Jeśli to edycja istniejącego wydarzenia Praca, jego id_wydarzenia — żeby nie liczyć go podwójnie. */
  linkedEventId?: string;
};

export type WeeklyLimitCheck = {
  weekStart: string; // ISO instant, poniedziałek 00:00 w strefie konta
  weekEnd: string;    // ISO instant, kolejny poniedziałek 00:00
  existingMinutes: number;
  proposedMinutes: number;
  totalMinutes: number;
  maxMinutes: number;
  withinLimit: boolean;
  overByMinutes: number;
};

/** Poniedziałek 00:00 w strefie konta do kolejnego poniedziałku 00:00, licząc od `reference`. */
export function mondayWeekBounds(reference: Date, zone: string): { weekStart: Date; weekEnd: Date } {
  const localDate = localDateTime(reference, zone).slice(0, 10);
  const civilDay = Date.parse(`${localDate}T00:00:00Z`) / DAY;
  const isoWeekday = new Date(civilDay * DAY).getUTCDay() || 7; // 1 = poniedziałek ... 7 = niedziela
  const mondayDay = civilDay - (isoWeekday - 1);
  const dateAt = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
  const weekStart = toInstant(dateAt(mondayDay), '00:00', zone)!;
  const weekEnd = toInstant(dateAt(mondayDay + 7), '00:00', zone)!;
  return { weekStart, weekEnd };
}

/** Przycina interwał do granic tygodnia i zwraca liczbę minut (0, jeśli poza tygodniem). */
function clippedMinutes(start: Date, end: Date, weekStart: Date, weekEnd: Date): number {
  const from = start < weekStart ? weekStart : start;
  const to = end > weekEnd ? weekEnd : end;
  return to > from ? (to.getTime() - from.getTime()) / 60000 : 0;
}

/**
 * Sprawdza, czy propozycje zmian razem z istniejącym obciążeniem "Praca" mieszczą się w tygodniowym
 * limicie. Generator dodaje godziny do istniejącego obciążenia — nie zastępuje go — z wyjątkiem zmian
 * powiązanych przez `linkedEventId` (edycja istniejącego wydarzenia): te liczone są tylko raz, z wersji
 * zaproponowanej.
 */
export function checkWeeklyWorkLimit(
  proposals: ProposedShift[],
  existingWork: TimedEvent[],
  maxMinutes: number,
  zone: string,
  reference: Date = new Date(),
): WeeklyLimitCheck {
  const { weekStart, weekEnd } = mondayWeekBounds(reference, zone);
  const linkedIds = new Set(proposals.map((p) => p.linkedEventId).filter((id): id is string => !!id));

  let existingMinutes = 0;
  for (const event of existingWork) {
    if (event.id && linkedIds.has(event.id)) continue; // edycja: liczona raz, z wersji zaproponowanej
    for (const occurrence of eventOccurrences(event, weekStart, weekEnd, zone)) {
      existingMinutes += clippedMinutes(occurrence.start, occurrence.end, weekStart, weekEnd);
    }
  }

  let proposedMinutes = 0;
  for (const proposal of proposals) {
    const start = toInstant(proposal.start.slice(0, 10), proposal.start.slice(11, 16), zone);
    const end = toInstant(proposal.end.slice(0, 10), proposal.end.slice(11, 16), zone);
    if (!start || !end || end <= start) continue;
    proposedMinutes += clippedMinutes(start, end, weekStart, weekEnd);
  }

  const totalMinutes = existingMinutes + proposedMinutes;
  return {
    weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString(),
    existingMinutes, proposedMinutes, totalMinutes, maxMinutes,
    withinLimit: totalMinutes <= maxMinutes,
    overByMinutes: Math.max(0, totalMinutes - maxMinutes),
  };
}