// Minimalny odpoczynek między zmianami Praca (user story: czas na odpoczynek).
import { toInstant } from '../import/rules.js';
import { eventOccurrences, type TimedEvent } from '../collisions.js';

const DAY_MS = 86400000;
const NEIGHBOR_WINDOW_DAYS = 14; // "najbliższe zmiany przed i po tygodniu" — praktyczne, udokumentowane okno

export type ProposedShift = { id: string; start: string; end: string; linkedEventId?: string };
export type RestViolation = { code: 'rest_too_short'; requiredMinutes: number; actualMinutes: number; previousId: string; nextId: string };

type Point = { id: string; start: Date; end: Date };

function toInstantPair(shift: { start: string; end: string }, zone: string): { start: Date; end: Date } | null {
  const start = toInstant(shift.start.slice(0, 10), shift.start.slice(11, 16), zone);
  const end = toInstant(shift.end.slice(0, 10), shift.end.slice(11, 16), zone);
  return start && end && end > start ? { start, end } : null;
}

/**
 * Sortuje proponowane i istniejące zmiany po początku i sprawdza next.start - previous.end. `existingWork`
 * powinno pochodzić z okna co najmniej ±14 dni wokół tygodnia (CalendarRepository.getWorkShiftsNear) — tylko
 * tak można złapać najbliższą zmianę tuż przed/po granicy tygodnia, nie tylko te wewnątrz niego; serie
 * cotygodniowe są tu rozwijane przez eventOccurrences. Zmiana powiązana przez `linkedEventId` liczona jest
 * raz, z wersji zaproponowanej (bez duplikatu). Zwraca `rest_too_short` tylko dla par dotykających co
 * najmniej jednego z `proposals` — to te kandydatury generator ma odrzucić.
 */
export function checkMinimumRest(
  proposals: ProposedShift[],
  existingWork: TimedEvent[],
  minRestMinutes: number,
  zone: string,
  weekStart: Date,
  weekEnd: Date,
): RestViolation[] {
  if (minRestMinutes <= 0) return [];
  const linkedIds = new Set(proposals.map((p) => p.linkedEventId).filter((id): id is string => !!id));
  const proposalIds = new Set(proposals.map((p) => p.id));
  const windowStart = new Date(weekStart.getTime() - NEIGHBOR_WINDOW_DAYS * DAY_MS);
  const windowEnd = new Date(weekEnd.getTime() + NEIGHBOR_WINDOW_DAYS * DAY_MS);

  const points: Point[] = [];
  for (const event of existingWork) {
    if (event.id && linkedIds.has(event.id)) continue;
    for (const occurrence of eventOccurrences(event, windowStart, windowEnd, zone)) {
      points.push({ id: event.id ?? '', start: occurrence.start, end: occurrence.end });
    }
  }
  for (const proposal of proposals) {
    const pair = toInstantPair(proposal, zone);
    if (pair) points.push({ id: proposal.id, ...pair });
  }
  points.sort((a, b) => a.start.getTime() - b.start.getTime());

  const violations: RestViolation[] = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const next = points[i];
    if (!proposalIds.has(previous.id) && !proposalIds.has(next.id)) continue;
    const actualMinutes = (next.start.getTime() - previous.end.getTime()) / 60000;
    if (actualMinutes < minRestMinutes) {
      violations.push({ code: 'rest_too_short', requiredMinutes: minRestMinutes, actualMinutes, previousId: previous.id, nextId: next.id });
    }
  }
  return violations;
}