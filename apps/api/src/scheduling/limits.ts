// Ostrzeżenie o przekroczeniu maksimum godzin i kontrakt okresu rozliczeniowego (S23KC2S1P2-301, N09).
//
// Okres rozliczeniowy limitu tygodniowego: tydzień od poniedziałku 00:00 do następnego poniedziałku 00:00 w strefie profilu.
// Reguła przypisania minut na granicy okresu: zmiana (nowa i już zapisana) należy w całości do tygodnia, w którym się zaczyna.
// Dzięki temu nocna zmiana z niedzieli na poniedziałek nie jest liczona dwa razy (raz jako nowa, raz jako „istniejąca” praca
// w następnym tygodniu). Limit dzienny liczy minuty osobno dla każdego dnia kalendarzowego (zmiana nocna dzieli się o północy).
// Porównanie jest ostre: suma równa limitowi nie daje ostrzeżenia, dopiero suma większa od limitu.
import { addLocalDays } from './time.js';

export const WEEKLY_PERIOD_RULE = 'shift_start' as const;

type TimedInterval = { start: Date; end: Date };

/** Minuty pracy przypisane do tygodnia wg reguły „początek zmiany”. */
export function weeklyWorkMinutes(intervals: TimedInterval[], weekStart: Date, weekEnd: Date): number {
  return intervals.filter((interval) => interval.start >= weekStart && interval.start < weekEnd)
    .reduce((sum, interval) => sum + Math.max(0, Math.round((interval.end.getTime() - interval.start.getTime()) / 60_000)), 0);
}

export type WeeklyLimitDetails = {
  period: 'week'; periodRule: typeof WEEKLY_PERIOD_RULE; periodStartLocal: string; periodEndLocal: string;
  maximumMinutes: number; totalMinutes: number; existingWorkMinutes: number; proposedMinutes: number; exceededByMinutes: number;
};

export function weeklyLimitDetails(weekStart: string, maximumMinutes: number, existingWorkMinutes: number, proposedMinutes: number): WeeklyLimitDetails {
  const totalMinutes = existingWorkMinutes + proposedMinutes;
  return { period: 'week', periodRule: WEEKLY_PERIOD_RULE, periodStartLocal: `${weekStart}T00:00`, periodEndLocal: `${addLocalDays(weekStart, 7)}T00:00`,
    maximumMinutes, totalMinutes, existingWorkMinutes, proposedMinutes, exceededByMinutes: Math.max(0, totalMinutes - maximumMinutes) };
}

/** „41 h 30 min” – czytelny zapis minut w komunikatach. */
export function hoursLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return !hours ? `${rest} min` : rest ? `${hours} h ${rest} min` : `${hours} h`;
}
