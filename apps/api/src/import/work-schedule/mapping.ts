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

/** Litery bez polskich znaków i wielkości liter: „Użytkownik Łęcki” → „uzytkownik lecki”. */
function plainWords(value: string): string[] {
  return normalizeTitle(value)
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Czy nazwisko z grafiku to użytkownik. Porównanie bez wielkości liter, polskich znaków, spacji i kolejności
 * („Nowak Anna”), odporne na typowe błędy OCR: sklejone słowa („Użytkowniklokalny”), dodatkowe znaki
 * z sąsiedniej kolumny („SZ Użytkownik Lokalny”) i pojedyncze pomylone litery.
 */
export function sameEmployee(a: string | undefined, b: string): boolean {
  if (!a || !b.trim()) return false;
  const wordsA = plainWords(a), wordsB = plainWords(b);
  if (!wordsA.length || !wordsB.length) return false;
  const sorted = (words: string[]) => [...words].sort().join('');
  if (sorted(wordsA) === sorted(wordsB)) return true;
  const joinedA = wordsA.join(''), joinedB = wordsB.join('');
  const reversedB = [...wordsB].reverse().join('');
  // Nazwisko użytkownika zawarte w odczycie (z doklejonym śmieciem), o ile jest wystarczająco długie.
  if (joinedB.length >= 6 && (joinedA.includes(joinedB) || joinedA.includes(reversedB))) return true;
  const tolerance = Math.max(1, Math.floor(joinedB.length * 0.15));
  return editDistance(joinedA, joinedB) <= tolerance || editDistance(joinedA, reversedB) <= tolerance;
}

export function mapShiftsToRows(shifts: RawShift[], userName: string): { readStatus: ReadStatus; rows: ScheduleRow[] } {
  // Grafik jednej osoby (bez nazwisk) to grafik użytkownika. Jeśli jednak w grafiku są nazwiska, wiersz bez
  // odczytanego nazwiska nie jest zaznaczany domyślnie – lepiej zaznaczyć go ręcznie niż dodać cudzą zmianę.
  const hasEmployees = shifts.some((shift) => shift.employee);
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
    isOwn: shift.employee ? sameEmployee(shift.employee, userName) : !hasEmployees,
    incomplete: !isComplete(shift),
  }));
  const readStatus: ReadStatus = rows.length === 0 ? 'none' : rows.some((row) => row.incomplete) ? 'partial' : 'all';
  return { readStatus, rows };
}
