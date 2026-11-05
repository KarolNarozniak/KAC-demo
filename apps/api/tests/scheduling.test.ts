import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSchedule, validateSchedule } from '../src/scheduling/generator.js';
import type { PlanningContext } from '../src/scheduling/types.js';

const context = (overrides: Partial<PlanningContext> = {}): PlanningContext => ({
  profile: {
    id: 'P1', userId: 'U1', calendarId: 'K1', timeZone: 'Europe/Warsaw', minimumHours: 8,
    targetHours: 12, maximumHours: 20, hourlyRatePln: 30, commuteBufferMinutes: 15,
    minimumRestMinutes: 30, mode: 'elastyczny', minimumShiftMinutes: 120, maximumSlotMinutes: 360,
  },
  availability: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ id: `a${dayOfWeek}`, dayOfWeek, startTime: '08:00', endTime: '22:00' })),
  preferredWorkWindows: [], blockedPeriods: [], events: [], shiftTemplates: [],
  ...overrides,
});

test('weekly generation reaches target without exceeding maximum', () => {
  const result = generateSchedule(context(), '2026-11-02');
  assert.equal(result.solutionStatus, 'target_met');
  assert.ok(result.totalMinutes >= result.targetMinutes);
  assert.ok(result.totalMinutes <= result.maximumMinutes);
  assert.equal(result.shortfallMinutes, 0);
  assert.ok(result.shifts.every((shift) => shift.durationMinutes >= 120));
});

test('workaholic option fills the maximum feasible weekly capacity', () => {
  const result = generateSchedule(context({ availability: [
    { id: 'mon', dayOfWeek: 1, startTime: '08:00', endTime: '18:00' },
    { id: 'tue', dayOfWeek: 2, startTime: '08:00', endTime: '18:00' },
  ] }), '2026-11-02', { workaholic: true });
  assert.equal(result.targetMinutes, result.maximumCapacityMinutes);
  assert.equal(result.totalMinutes, result.maximumCapacityMinutes);
  assert.equal(result.parameters.workaholic, true);
});

test('existing work counts toward the weekly target', () => {
  const result = generateSchedule(context({ events: [{
    id: 'work-1', title: 'Existing shift', start: '2026-11-03T09:00', end: '2026-11-03T13:00',
    category: 'Work', mandatory: false, repeatWeekly: false,
  }] }), '2026-11-02');
  assert.equal(result.existingWorkMinutes, 240);
  assert.equal(result.totalMinutes, result.existingWorkMinutes + result.proposedMinutes);
  assert.equal(result.solutionStatus, 'target_met');
});

test('optional lectures are soft conflicts and reported when target needs them', () => {
  const events = [
    { id: 'mandatory', title: 'Required class', start: '2026-11-02T08:00', end: '2026-11-02T12:00', category: 'Class' as const, mandatory: true, repeatWeekly: false },
    { id: 'optional', title: 'Optional class', start: '2026-11-03T08:00', end: '2026-11-03T12:00', category: 'Class' as const, mandatory: false, repeatWeekly: false },
  ];
  const result = generateSchedule(context({
    profile: { ...context().profile, minimumHours: 4, targetHours: 7, maximumHours: 8 },
    availability: [
      { id: 'mon', dayOfWeek: 1, startTime: '12:00', endTime: '16:00' },
      { id: 'tue', dayOfWeek: 2, startTime: '08:00', endTime: '12:00' },
    ],
    events,
  }), '2026-11-02');
  assert.ok(result.optionalLecturesSkipped.includes('optional'));
  assert.ok(result.violations.some((violation) => violation.code === 'optional_lectures_skipped'));
});

test('shift mode chooses templates and manual edits retain hard constraints', () => {
  const input = context({
    profile: { ...context().profile, mode: 'zmianowy', minimumHours: 8, targetHours: 8, maximumHours: 8 },
    shiftTemplates: [{ id: 'am', name: 'Morning', startTime: '08:00', endTime: '16:00', endsNextDay: false, daysOfWeek: [1, 2, 3, 4, 5], active: true }],
  });
  const result = generateSchedule(input, '2026-11-02');
  assert.equal(result.shifts.length, 1);
  assert.equal(result.shifts[0]?.templateId, 'am');
  const validation = validateSchedule(input, '2026-11-02', [{ id: 'manual', startLocal: '2026-11-02T07:00', endLocal: '2026-11-02T15:00' }]);
  assert.ok(validation.errors.some((error) => error.code === 'outside_availability'));
});

test('greedy failure is not reported as a proof of infeasibility', () => {
  const result = generateSchedule(context({
    profile: { ...context().profile, minimumHours: 8, targetHours: 16, maximumHours: 20 },
    availability: [{ id: 'short', dayOfWeek: 1, startTime: '08:00', endTime: '13:00' }],
  }), '2026-11-02');
  assert.equal(result.solutionStatus, 'not_found');
  assert.ok(result.shortfallMinutes > 0);
});
