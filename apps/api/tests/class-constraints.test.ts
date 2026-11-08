// Uwzględnianie zajęć przy planowaniu grafiku (S23KC2S1P2-40, testy: S23KC2S1P2-196).
import assert from 'node:assert/strict';
import test from 'node:test';
import { constraints, freeWindows, intersects, listBlockingOccurrences, subtractIntervals } from '../src/scheduling/constraints.js';
import { generateSchedule, validateSchedule } from '../src/scheduling/generator.js';
import type { PlanningContext, PlanningEvent } from '../src/scheduling/types.js';

const WEEK = '2026-11-02'; // poniedziałek, już po zmianie czasu na zimowy
const lecture = (overrides: Partial<PlanningEvent> = {}): PlanningEvent => ({
  id: 'C1', title: 'Analiza', start: '2026-09-29T10:00', end: '2026-09-29T11:30', // wtorek, jeszcze w czasie letnim
  category: 'Class', mandatory: true, repeatWeekly: true, ...overrides,
});
const context = (events: PlanningEvent[], overrides: Partial<PlanningContext['profile']> = {}): PlanningContext => ({
  profile: { id: 'P1', userId: 'U1', calendarId: 'K1', timeZone: 'Europe/Warsaw', minimumHours: 0, targetHours: 6, maximumHours: 20,
    hourlyRatePln: 30, commuteBufferMinutes: 15, minimumRestMinutes: 30, mode: 'elastyczny', minimumShiftMinutes: 120,
    maximumSlotMinutes: 360, maxHoursPerDay: 8, profileVersion: 'v1', ...overrides },
  availability: [{ id: 'tue', dayOfWeek: 2, startTime: '08:00', endTime: '16:00' }],
  preferredWorkWindows: [], blockedPeriods: [], events, shiftTemplates: [],
});
const buffers = { commuteBufferMinutes: 15, minimumRestMinutes: 30 };
const at = (value: string) => new Date(value);

test('S23KC2S1P2-193: seria zajęć jest rozwijana na planowany tydzień z lokalną godziną po zmianie czasu', () => {
  const [occurrence, ...rest] = listBlockingOccurrences(context([lecture()]), WEEK, buffers);
  assert.equal(rest.length, 0);
  assert.equal(occurrence?.startLocal, '2026-11-03T10:00');
  assert.equal(occurrence?.endLocal, '2026-11-03T11:30');
  assert.equal(occurrence?.start, '2026-11-03T09:00:00.000Z'); // 10:00 czasu zimowego = 09:00 UTC
  assert.deepEqual([occurrence?.effect, occurrence?.bufferMinutes, occurrence?.repeatWeekly], ['hard', 15, true]);
});

test('S23KC2S1P2-193: koniec serii, zajęcia nieobowiązkowe, praca i poniedziałek po tygodniu', () => {
  assert.equal(listBlockingOccurrences(context([lecture({ seriesEndDate: '2026-10-31' })]), WEEK, buffers).length, 0);
  const optional = listBlockingOccurrences(context([lecture({ mandatory: false })]), WEEK, buffers);
  assert.equal(optional[0]?.effect, 'soft');
  const work = listBlockingOccurrences(context([{ id: 'W1', title: 'Kawiarnia', start: '2026-11-04T16:00', end: '2026-11-04T20:00', category: 'Work', mandatory: false, repeatWeekly: false }]), WEEK, buffers);
  assert.equal(work[0]?.bufferMinutes, 45); // dojazd + odpoczynek
  // Zajęcia w poniedziałek po tygodniu też są brane pod uwagę (zmiana nocna z niedzieli).
  const nextMonday = listBlockingOccurrences(context([lecture({ id: 'M', start: '2026-11-09T08:00', end: '2026-11-09T09:30', repeatWeekly: false })]), WEEK, buffers);
  assert.equal(nextMonday.length, 1);
});

test('S23KC2S1P2-196: warunek przecięcia przedziałów – zetknięcie granic nie jest kolizją', () => {
  assert.equal(intersects(at('2026-11-03T08:00Z'), at('2026-11-03T10:00Z'), at('2026-11-03T10:00Z'), at('2026-11-03T12:00Z')), false);
  assert.equal(intersects(at('2026-11-03T08:00Z'), at('2026-11-03T10:01Z'), at('2026-11-03T10:00Z'), at('2026-11-03T12:00Z')), true);
  assert.equal(intersects(at('2026-11-03T10:30Z'), at('2026-11-03T11:00Z'), at('2026-11-03T10:00Z'), at('2026-11-03T12:00Z')), true);
  assert.equal(intersects(at('2026-11-03T12:00Z'), at('2026-11-03T14:00Z'), at('2026-11-03T10:00Z'), at('2026-11-03T12:00Z')), false);
});

test('S23KC2S1P2-194: constraints.classCollision liczy bufor dojazdu i pomija zajęcia nieobowiązkowe', () => {
  const occurrences = listBlockingOccurrences(context([lecture()]), WEEK, buffers);
  // Zajęcia 10:00–11:30 lokalnie, bufor 15 min → zajęty przedział 09:45–11:45 (08:45–10:45 UTC).
  const touching = constraints.classCollision({ id: 'S1', start: at('2026-11-03T06:45Z'), end: at('2026-11-03T08:45Z') }, occurrences, 'Europe/Warsaw');
  assert.deepEqual(touching, []);
  const [collision] = constraints.classCollision({ id: 'S2', start: at('2026-11-03T07:00Z'), end: at('2026-11-03T09:00Z') }, occurrences, 'Europe/Warsaw');
  assert.equal(collision?.code, 'class_collision');
  assert.deepEqual(collision?.candidateIds, ['S2']);
  assert.deepEqual(collision?.eventIds, ['C1']);
  assert.deepEqual(collision?.details, { eventId: 'C1', title: 'Analiza', mandatory: true, classStartLocal: '2026-11-03T10:00', classEndLocal: '2026-11-03T11:30',
    overlapStartLocal: '2026-11-03T09:45', overlapEndLocal: '2026-11-03T10:00', bufferMinutes: 15 });
  const optional = listBlockingOccurrences(context([lecture({ mandatory: false })]), WEEK, buffers);
  assert.deepEqual(constraints.classCollision({ id: 'S3', start: at('2026-11-03T08:00Z'), end: at('2026-11-03T10:00Z') }, optional, 'Europe/Warsaw'), []);
});

test('S23KC2S1P2-194: wolny czas = dostępność minus zajęcia z buforem; krótkie kawałki nie są liczone', () => {
  const parts = subtractIntervals(
    [{ id: 'a', title: 'A', start: at('2026-11-03T07:00Z'), end: at('2026-11-03T15:00Z') }],
    [{ id: 'b', title: 'B', start: at('2026-11-03T08:45Z'), end: at('2026-11-03T10:45Z') }]);
  assert.deepEqual(parts.map((part) => [part.start.toISOString(), part.end.toISOString()]),
    [['2026-11-03T07:00:00.000Z', '2026-11-03T08:45:00.000Z'], ['2026-11-03T10:45:00.000Z', '2026-11-03T15:00:00.000Z']]);
  const input = context([lecture()]);
  const free = freeWindows(input, WEEK, listBlockingOccurrences(input, WEEK, buffers), 120);
  // 08:00–09:45 (105 min) jest krótsze niż minimalna zmiana, zostaje 11:45–16:00.
  assert.deepEqual(free.windows.map((window) => [window.startLocal, window.endLocal, window.minutes]), [['2026-11-03T11:45', '2026-11-03T16:00', 255]]);
  assert.equal(free.freeMinutes, 255);
});

test('generator: praca nie nachodzi na zajęcia z serii, a odpowiedź zawiera blockingEvents i wolne przedziały', () => {
  const result = generateSchedule(context([lecture()], { targetHours: 4, commuteBufferMinutes: 15 }), WEEK);
  assert.ok(result.shifts.length > 0);
  for (const shift of result.shifts) assert.ok(new Date(shift.start) >= new Date('2026-11-03T10:45:00Z'), `${shift.startLocal} nachodzi na zajęcia`);
  assert.equal(result.blockingEvents?.[0]?.eventId, 'C1');
  assert.equal(result.freeMinutes, 255);
  assert.ok(!result.violations.some((violation) => violation.code === 'insufficient_free_time'));
});

test('generator, 5a: gdy wolnego czasu jest za mało na cel, wynik zawiera insufficient_free_time', () => {
  const result = generateSchedule(context([lecture()], { targetHours: 6 }), WEEK);
  const warning = result.violations.find((violation) => violation.code === 'insufficient_free_time');
  assert.ok(warning);
  assert.deepEqual(warning.eventIds, ['C1']);
  assert.equal(warning.details.missingMinutes, 360 - 255);
});

test('ręczna zmiana: kolizja z zajęciami obowiązkowymi to class_collision, z innym wydarzeniem – hard_conflict', () => {
  const personal: PlanningEvent = { id: 'P1', title: 'Dentysta', start: '2026-11-03T12:00', end: '2026-11-03T13:00', category: 'Personal', mandatory: false, repeatWeekly: false };
  const input = context([lecture(), personal]);
  const collision = validateSchedule(input, WEEK, [{ id: 'S1', startLocal: '2026-11-03T08:00', endLocal: '2026-11-03T10:00' }]);
  assert.deepEqual(collision.errors.map((error) => error.code), ['class_collision']);
  const other = validateSchedule(input, WEEK, [{ id: 'S2', startLocal: '2026-11-03T12:00', endLocal: '2026-11-03T14:00' }]);
  assert.deepEqual(other.errors.map((error) => error.code), ['hard_conflict']);
  const fine = validateSchedule(input, WEEK, [{ id: 'S3', startLocal: '2026-11-03T13:15', endLocal: '2026-11-03T16:00' }]);
  assert.deepEqual(fine.errors, []);
});
