// Ostrzeżenie o przekroczeniu maksimum godzin (S23KC2S1P2-301, N09).
import assert from 'node:assert/strict';
import test from 'node:test';
import { hoursLimitLines, hoursLimitStatus } from '../src/domain/hoursLimit.ts';
import type { ScheduleShift, ScheduleViolation } from '../src/services/scheduleApi.ts';

const shift = (id: string, durationMinutes: number): ScheduleShift => ({ candidateId: id, title: 'Praca', start: '', end: '', startLocal: '2026-11-03T08:00', endLocal: '2026-11-03T12:00',
  durationMinutes, workDate: '2026-11-03', mode: 'elastyczny', optionalLectureIds: [], softPenalty: 0 });
const base = { weekStart: '2026-11-02', maximumMinutes: 600, existingWorkMinutes: 360, violations: [] as ScheduleViolation[] };

test('N09: total equal to the limit gives no warning, above the limit shows limit, total and excess', () => {
  const exact = hoursLimitStatus({ ...base, shifts: [shift('a', 240)] });
  assert.equal(exact.exceeded, false);
  assert.deepEqual(hoursLimitLines(exact), []);
  const over = hoursLimitStatus({ ...base, shifts: [shift('a', 270)] });
  assert.equal(over.exceeded, true);
  assert.equal(over.totalMinutes, 630);
  assert.equal(over.exceededByMinutes, 30);
  assert.equal(hoursLimitLines(over)[0], 'Tydzień od 2026-11-02: 10 h 30 min pracy przy limicie 10 h – nadwyżka 30 min.');
});

test('N09: daily excess comes from server validation and changes the acknowledgement key', () => {
  const daily: ScheduleViolation = { code: 'daily_maximum_hours', severity: 'error', message: '', details: { date: '2026-11-03', totalMinutes: 300, maximumMinutes: 240, exceededByMinutes: 60 } };
  const status = hoursLimitStatus({ ...base, existingWorkMinutes: 0, violations: [daily], shifts: [shift('a', 300)] });
  assert.equal(status.exceeded, true);
  assert.deepEqual(status.daily, [{ date: '2026-11-03', totalMinutes: 300, maximumMinutes: 240, exceededByMinutes: 60 }]);
  assert.match(hoursLimitLines(status).join('\n'), /Dzień 2026-11-03: 5 h przy limicie dziennym 4 h – nadwyżka 1 h/);
  const corrected = hoursLimitStatus({ ...base, existingWorkMinutes: 0, violations: [daily], shifts: [shift('a', 280)] });
  assert.notEqual(corrected.acknowledgementKey, status.acknowledgementKey);
});

test('N09: existing work above the limit and unsaved edits are explained', () => {
  const status = hoursLimitStatus({ ...base, existingWorkMinutes: 660, shifts: [] }, true);
  const lines = hoursLimitLines(status);
  assert.equal(status.existingWorkExceeds, true);
  assert.ok(lines.some((line) => line.startsWith('Już zapisane zmiany (11 h)')));
  assert.ok(lines.some((line) => line.startsWith('Masz niezapisane poprawki')));
});
