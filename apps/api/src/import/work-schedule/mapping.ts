// Zamiana odczytanego grafiku na wiersze importu (S23KC2S1P2-44, SUB-04 i SUB-05).
// Każda zmiana staje się wierszem kategorii „Praca”. Wiersze innych pracowników są rozpoznawane,
// żeby ekran mógł domyślnie zaznaczyć tylko zmiany użytkownika.

import { normalizeTitle, type ImportRow } from '../rules.js';
import type { RawShift } from './reader.js';

export type ReadStatus = 'all' | 'partial' | 'none';

/** Etykiety wyniku odczytu z historyjki. */
export const READ_STATUS_LABELS: Record<ReadStatus, string> = {
  all: 'Odczytano wszystkie zmiany',
  partial: 'Odczytano część zmian',
  none: 'Nie odczytano zmian',
};

export type ScheduleRow = ImportRow & { isOwn: boolean; incomplete: boolean };

const isComplete = (shift: RawShift) => Boolean(shift.date && shift.startTime && shift.endTime);

/** Imiona i nazwiska porównujemy bez względu na wielkość liter, spacje i kolejność (np. „Nowak Anna”). */
export function sameEmployee(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const words = (value: string) => normalizeTitle(value).split(' ').sort().join(' ');
  return words(a) === words(b);
}

export function mapShiftsToRows(shifts: RawShift[], userName: string): { readStatus: ReadStatus; rows: ScheduleRow[] } {
  const rows = shifts.map((shift, index): ScheduleRow => ({
    id: `z${index + 1}`,
    title: shift.title?.trim() || 'Praca',
    date: shift.date ?? '',
    startTime: shift.startTime ?? '',
    endTime: shift.endTime ?? '',
    category: 'Work',
    location: shift.location,
    confidence: shift.confidence,
    employee: shift.employee,
    // Gdy grafik nie podaje pracownika, zakładamy, że to zmiana użytkownika.
    isOwn: shift.employee ? sameEmployee(shift.employee, userName) : true,
    incomplete: !isComplete(shift),
  }));
  const readStatus: ReadStatus = rows.length === 0 ? 'none' : rows.some((row) => row.incomplete) ? 'partial' : 'all';
  return { readStatus, rows };
}
