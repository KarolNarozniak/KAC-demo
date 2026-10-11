import type { CalendarEvent, PlannerPreferences, Shift } from './model';
import { addCalendarDays, localDateKey, occurrencesForRange } from './calendar.ts';
import { findCollisions, overlaps, validateEventInput } from './calendar.ts';
export type PlanResult = { shifts: Shift[]; possibleHours: number; missingHours: number; warning: string | null };
const minutes = (value: string) => { const m = /^(\d{2}):(\d{2})$/.exec(value); return !m || Number(m[1]) > 23 || Number(m[2]) > 59 ? null : Number(m[1]) * 60 + Number(m[2]); };
export function validatePlannerPreferences(value: PlannerPreferences): string | null {
  if (!Number.isFinite(value.weeklyGoal) || value.weeklyGoal < 0) return 'Tygodniowy cel pracy nie może być ujemny.';
  if (!Number.isFinite(value.maxHoursPerWeek) || value.maxHoursPerWeek <= 0 || value.maxHoursPerWeek > 80) return 'Tygodniowy limit musi wynosić od 1 do 80 godzin.';
  if (!Number.isFinite(value.hourlyRate) || value.hourlyRate < 0) return 'Stawka godzinowa nie może być ujemna.';
  if (!Number.isFinite(value.commuteMinutes) || value.commuteMinutes < 0 || value.commuteMinutes > 240) return 'Bufor na dojazd musi wynosić od 0 do 240 minut.';
  if (!Number.isFinite(value.breakMinutes) || value.breakMinutes < 0 || value.breakMinutes > 180) return 'Przerwa musi wynosić od 0 do 180 minut.';
  const from = minutes(value.availableFrom); const to = minutes(value.availableTo);
  if (from === null || to === null || from >= to) return 'Godzina początku dostępności musi poprzedzać godzinę końca.';
  if (!value.availableDays.length) return 'Wybierz co najmniej jeden dzień dostępności.'; return null;
}
export function generatePlan(p: PlannerPreferences, events: CalendarEvent[], monday: Date): PlanResult {
  const error = validatePlannerPreferences(p); if (error) return { shifts: [], possibleHours: 0, missingHours: p.weeklyGoal, warning: error };
  const begin = addCalendarDays(monday, 0); const finish = addCalendarDays(begin, 7);
  const busy = occurrencesForRange(events, { start: begin, end: finish });
  const from = minutes(p.availableFrom)! + p.commuteMinutes; const to = minutes(p.availableTo)! - p.commuteMinutes;
  const preferred = minutes(p.preferredFrom) ?? from;
  const slots: { day: number; date: Date; start: number; end: number }[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = addCalendarDays(begin, offset); const weekday = date.getDay();
    if (!p.availableDays.includes(weekday) || p.unavailableDays.includes(weekday) || to <= from) continue;
    const conflicts = busy.filter((item) => localDateKey(item.occurrenceStart) === localDateKey(date)).map((item) => ({ start: item.occurrenceStart.getHours() * 60 + item.occurrenceStart.getMinutes(), end: item.occurrenceEnd.getHours() * 60 + item.occurrenceEnd.getMinutes() })).sort((a, b) => a.start - b.start);
    let cursor = from; const pushSlot = (start: number, end: number) => { if (end - start >= 60) slots.push({ day: weekday, date, start, end }); };
    for (const conflict of conflicts) {
      const conflictStart = Math.max(from, conflict.start); const conflictEnd = Math.min(to, conflict.end);
      if (conflictStart > cursor) pushSlot(cursor, conflictStart);
      cursor = Math.max(cursor, conflictEnd);
    }
    if (cursor < to) pushSlot(cursor, to);
  }
  slots.sort((a, b) => (a.date.getTime() - b.date.getTime()) || Math.abs(a.start - preferred) - Math.abs(b.start - preferred));
  const capacityHours = slots.reduce((sum, slot) => sum + (slot.end - slot.start) / 60, 0);
  const possibleHours = Math.min(p.maxHoursPerWeek, Math.floor(capacityHours));
  const target = Math.min(p.weeklyGoal, possibleHours); if (target < p.weeklyGoal) return { shifts: [], possibleHours, missingHours: p.weeklyGoal - target, warning: `Przy dostępności i wydarzeniach można zaplanować maksymalnie ${possibleHours} godz.` };
  let remaining = target; const shifts: Shift[] = []; const lastWorkEnd = new Map<string, number>();
  for (const slot of slots) {
    if (remaining <= 0) break;
    const dateKey = localDateKey(slot.date); const preferredStart = slot.start < preferred && preferred < slot.end ? preferred : slot.start; const startMinute = Math.max(preferredStart, lastWorkEnd.has(dateKey) ? lastWorkEnd.get(dateKey)! + p.breakMinutes : slot.start);
    const hours = Math.min(4, remaining, (slot.end - startMinute) / 60); if (hours <= 0) continue;
    const start = new Date(slot.date.getFullYear(), slot.date.getMonth(), slot.date.getDate(), Math.floor(startMinute / 60), startMinute % 60);
    const end = new Date(start.getTime() + hours * 3600000);
    const time = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    shifts.push({ id: `shift-${slot.day}-${shifts.length}`, title: 'Zmiana w studiu kampusowym', start: `${localDateKey(start)}T${time(start)}`, end: `${localDateKey(end)}T${time(end)}`, status: 'proposed' }); lastWorkEnd.set(dateKey, startMinute + hours * 60); remaining -= hours;
  }
  return { shifts, possibleHours, missingHours: Math.max(0, remaining), warning: remaining ? 'W wybrane dni nie można zrealizować całego celu.' : null };
}
export function validateProposedShifts(shifts: Shift[], events: CalendarEvent[]): string | null {
  const normalized: CalendarEvent[] = [];
  for (const shift of shifts) {
    const candidate: CalendarEvent = { ...shift, category: 'Work', mandatory: false, repeatWeekly: false };
    const issue = validateEventInput(candidate);
    if (issue) return `${shift.title}: ${issue}`;
    const conflict = findCollisions(candidate, events);
    if (conflict.length) return `Zmiana „${shift.title}” koliduje z wydarzeniami: ${conflict.map((item) => item.title).join(', ')}.`;
    if (normalized.some((other) => overlaps(new Date(candidate.start), new Date(candidate.end), new Date(other.start), new Date(other.end)))) return 'Proponowane zmiany nakładają się na siebie.';
    normalized.push(candidate);
  }
  return null;
}
