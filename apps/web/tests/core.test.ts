import assert from 'node:assert/strict';
import test from 'node:test';
process.env.TZ = 'Europe/Warsaw';
import { addCalendarDays, findCollisions, occurrencesForRange, overlaps, validateEventInput } from '../src/domain/calendar.ts';
import type { CalendarEvent } from '../src/domain/model.ts';
test('weekly repeat retains local time after spring DST', () => {
  const event: CalendarEvent = { id: 'dst', title: 'DST lecture', start: '2026-03-23T09:15', end: '2026-03-23T10:00', category: 'Class', mandatory: true, repeatWeekly: true };
  const monday = new Date(2026, 3, 6); const result = occurrencesForRange([event], { start: monday, end: addCalendarDays(monday, 7) });
  assert.equal(result.length, 1); assert.equal(result[0].occurrenceStart.getHours(), 9); assert.equal(result[0].occurrenceStart.getMinutes(), 15); assert.equal(result[0].occurrenceStart.getDate(), 6);
});
test('weekly repeat remains anchored after fall DST and after many weeks', () => {
  const event: CalendarEvent = { id: 'weekly', title: 'Weekly', start: '2026-10-19T08:30', end: '2026-10-19T09:30', category: 'Class', mandatory: false, repeatWeekly: true };
  const monday = addCalendarDays(new Date(2026, 9, 19), 98); const result = occurrencesForRange([event], { start: monday, end: addCalendarDays(monday, 7) });
  assert.equal(result.length, 1); assert.equal(result[0].occurrenceStart.getHours(), 8); assert.equal(result[0].occurrenceStart.getDay(), 1);
});
test('overlap uses half-open intervals and invalid inputs are rejected', () => {
  const start = new Date(2026, 9, 12, 9); const end = new Date(2026, 9, 12, 10); const after = new Date(2026, 9, 12, 11);
  assert.equal(overlaps(start, end, end, after), false); assert.equal(overlaps(start, after, end, new Date(2026, 9, 12, 12)), true);
  assert.match(validateEventInput({ title: '', start: '2026-10-12T09:00', end: '2026-10-12T10:00' }) || '', /tytuł/i);
  assert.match(validateEventInput({ title: 'Bad date', start: '2026-02-30T09:00', end: '2026-02-30T10:00' }) || '', /poprawną/i);
  assert.match(validateEventInput({ title: 'Bad range', start: '2026-10-12T10:00', end: '2026-10-12T10:00' }) || '', /późniejsza/i);
});
test('recurring collision detection is not limited to adjacent weeks', () => {
  const weekly: CalendarEvent = { id: 'weekly', title: 'Weekly class', start: '2026-10-12T09:00', end: '2026-10-12T10:00', category: 'Class', mandatory: true, repeatWeekly: true };
  const candidate: CalendarEvent = { id: 'new', title: 'Work', start: '2027-01-18T09:30', end: '2027-01-18T10:30', category: 'Work', mandatory: false, repeatWeekly: false };
  assert.deepEqual(findCollisions(candidate, [weekly]).map((item) => item.id), ['weekly']);
});
