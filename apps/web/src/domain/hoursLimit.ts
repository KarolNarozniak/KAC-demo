// Ostrzeżenie o przekroczeniu maksimum godzin (S23KC2S1P2-301, N09).
// Te same reguły co w API (apps/api/src/scheduling/limits.ts): okres = tydzień od poniedziałku, zmiana należy do tygodnia,
// w którym się zaczyna; suma równa limitowi jest dozwolona, dopiero większa daje ostrzeżenie.
// To ostrzeżenie nie jest tym samym co przekroczenie celu w TargetProgress – cel można przekroczyć, maksimum nie.
import type { ScheduleShift, ScheduleViolation } from '../services/scheduleApi';

export type DailyExcess = { date: string; totalMinutes: number; maximumMinutes: number; exceededByMinutes: number };
export type HoursLimitStatus = {
  weekStart: string;
  maximumMinutes: number; existingWorkMinutes: number; proposedMinutes: number; totalMinutes: number; exceededByMinutes: number;
  existingWorkExceeds: boolean; daily: DailyExcess[];
  /** Wynik zawiera niezapisane poprawki – dzienne sumy pochodzą z ostatniego sprawdzenia na serwerze. */
  unsaved: boolean;
  exceeded: boolean;
  /** Klucz potwierdzenia: każda zmiana sum unieważnia wcześniejsze „Rozumiem”. */
  acknowledgementKey: string;
};

type ScheduleLike = { weekStart: string; maximumMinutes: number; existingWorkMinutes: number; shifts: ScheduleShift[]; violations: ScheduleViolation[] };

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

export function hoursLimitStatus(schedule: ScheduleLike, unsaved = false): HoursLimitStatus {
  const proposedMinutes = schedule.shifts.reduce((sum, shift) => sum + Math.max(0, shift.durationMinutes), 0);
  const totalMinutes = schedule.existingWorkMinutes + proposedMinutes;
  const exceededByMinutes = Math.max(0, totalMinutes - schedule.maximumMinutes);
  const daily = schedule.violations.filter((violation) => violation.code === 'daily_maximum_hours').map((violation) => {
    const details = violation.details ?? {};
    const total = num(details.totalMinutes), maximum = num(details.maximumMinutes);
    return { date: String(details.date ?? ''), totalMinutes: total, maximumMinutes: maximum, exceededByMinutes: num(details.exceededByMinutes) || Math.max(0, total - maximum) };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const existingWorkExceeds = schedule.existingWorkMinutes > schedule.maximumMinutes;
  const exceeded = exceededByMinutes > 0 || existingWorkExceeds || daily.length > 0;
  return { weekStart: schedule.weekStart, maximumMinutes: schedule.maximumMinutes, existingWorkMinutes: schedule.existingWorkMinutes, proposedMinutes, totalMinutes,
    exceededByMinutes, existingWorkExceeds, daily, unsaved, exceeded,
    acknowledgementKey: [schedule.weekStart, schedule.maximumMinutes, totalMinutes, ...daily.map((day) => `${day.date}:${day.totalMinutes}`)].join('|') };
}

export const limitMinutesLabel = (minutes: number) => {
  const hours = Math.floor(minutes / 60), rest = Math.round(minutes % 60);
  return !hours ? `${rest} min` : rest ? `${hours} h ${rest} min` : `${hours} h`;
};

/** Zdania do panelu ostrzeżenia; pusta lista, gdy limit nie jest przekroczony. */
export function hoursLimitLines(status: HoursLimitStatus): string[] {
  if (!status.exceeded) return [];
  const lines: string[] = [];
  if (status.exceededByMinutes > 0) lines.push(`Tydzień od ${status.weekStart}: ${limitMinutesLabel(status.totalMinutes)} pracy przy limicie ${limitMinutesLabel(status.maximumMinutes)} – nadwyżka ${limitMinutesLabel(status.exceededByMinutes)}.`);
  if (status.existingWorkExceeds) lines.push(`Już zapisane zmiany (${limitMinutesLabel(status.existingWorkMinutes)}) same przekraczają limit – usuń albo skróć część pracy w kalendarzu.`);
  for (const day of status.daily) lines.push(`Dzień ${day.date}: ${limitMinutesLabel(day.totalMinutes)} przy limicie dziennym ${limitMinutesLabel(day.maximumMinutes)} – nadwyżka ${limitMinutesLabel(day.exceededByMinutes)}.`);
  if (status.unsaved) lines.push('Masz niezapisane poprawki – sumy tygodniowe są przeliczone, a dzienne odświeżą się po „Sprawdź i zapisz zmiany”.');
  return lines;
}
