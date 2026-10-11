import assert from 'node:assert/strict';
import test from 'node:test';
process.env.TZ = 'Europe/Warsaw';
import { addCalendarDays, findCollisions, occurrencesForRange, overlaps, setEventTime, validateEventInput } from '../src/domain/calendar.ts';
import { generatePlan, validatePlannerPreferences } from '../src/domain/planner.ts';
import { isNotificationAllowed, validateNotificationPreferences } from '../src/domain/notifications.ts';
import type { CalendarEvent } from '../src/domain/model.ts';
import { initialEvents, initialNotifications, initialPreferences } from '../src/data/fixtures.ts';
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
  assert.match(validateEventInput({ title: '', start: '2026-10-12T09:00', end: '2026-10-12T10:00' }) || '', /title/i);
  assert.match(validateEventInput({ title: 'Bad date', start: '2026-02-30T09:00', end: '2026-02-30T10:00' }) || '', /valid/i);
  assert.match(validateEventInput({ title: 'Bad range', start: '2026-10-12T10:00', end: '2026-10-12T10:00' }) || '', /after/i);
});
test('recurring collision detection is not limited to adjacent weeks', () => {
  const weekly: CalendarEvent = { id: 'weekly', title: 'Weekly class', start: '2026-10-12T09:00', end: '2026-10-12T10:00', category: 'Class', mandatory: true, repeatWeekly: true };
  const candidate: CalendarEvent = { id: 'new', title: 'Work', start: '2027-01-18T09:30', end: '2027-01-18T10:30', category: 'Work', mandatory: false, repeatWeekly: false };
  assert.deepEqual(findCollisions(candidate, [weekly]).map((item) => item.id), ['weekly']);
});
test('series edit uses source anchor rather than viewed occurrence date', () => {
  const result = setEventTime(initialEvents[0], new Date(2026, 10, 2), '09:00', '10:00', true);
  assert.equal(result?.start, '2026-10-12T09:00'); assert.equal(result?.end, '2026-10-12T10:00');
});
test('planner reports invalid preferences and infeasible goals', () => {
  assert.match(validatePlannerPreferences({ ...initialPreferences, availableDays: [] }) || '', /available day/i);
  const result = generatePlan({ ...initialPreferences, weeklyGoal: 40, maxHoursPerWeek: 40, availableDays: [1], availableFrom: '09:00', availableTo: '12:00' }, initialEvents, new Date(2026, 9, 12));
  assert.equal(result.shifts.length, 0); assert.ok(result.missingHours > 0); assert.ok(result.warning);
});
test('quiet-hours can span midnight and reject equal endpoints', () => {
  assert.equal(isNotificationAllowed(initialNotifications, '23:00'), false); assert.equal(isNotificationAllowed(initialNotifications, '07:00'), true); assert.equal(isNotificationAllowed(initialNotifications, '12:00'), true);
  assert.notEqual(validateNotificationPreferences({ ...initialNotifications, quietFrom: '22:00', quietTo: '22:00' }), null);
});

test('weekly candidate checks distant one-off event dates', () => {
  const weekly: CalendarEvent = { id: 'candidate', title: 'New recurring class', start: '2026-10-12T09:00', end: '2026-10-12T10:00', category: 'Class', mandatory: false, repeatWeekly: true };
  const later: CalendarEvent = { id: 'later', title: 'Future appointment', start: '2027-01-18T09:30', end: '2027-01-18T10:30', category: 'Personal', mandatory: false, repeatWeekly: false };
  assert.deepEqual(findCollisions(weekly, [later]).map((event) => event.id), ['later']);
});