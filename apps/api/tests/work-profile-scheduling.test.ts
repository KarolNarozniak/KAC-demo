import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommuteGaps, validateAvailability, generateShifts, type TimedItem } from '../src/scheduling/constraints.js';
import { availabilityWindows } from '../src/scheduling/context.js';
const item = (id: string, start: string, end: string, category: TimedItem['category'] = 'Work'): TimedItem => ({ id, start: '2026-11-02T' + start + ':00Z', end: '2026-11-02T' + end + ':00Z', category });
test('zero, exact gap, missing minute, max rest and empty location', () => {
    const work = item('w', '10:00', '11:00'), cls = item('c', '11:30', '12:00', 'Class');
    assert.deepEqual(validateCommuteGaps([cls, work], 30, 120), []);
    assert.equal(validateCommuteGaps([work, { ...cls, start: '2026-11-02T11:29:00Z' }], 30, 0)[0]?.actualMinutes, 29);
    assert.deepEqual(validateCommuteGaps([work, item('p', '11:00', '12:00', 'Personal')], 0, 0), []);
    assert.deepEqual(validateCommuteGaps([work, item('w2', '12:00', '13:00')], 30, 60), []);
    assert.equal(validateCommuteGaps([work, item('w2', '11:59', '13:00')], 30, 60)[0]?.requiredMinutes, 60);
});
test('buffer must fit availability and generator subtracts occupied intervals once', () => {
    const windows = [{ start: '2026-11-02T08:00:00Z', end: '2026-11-02T16:00:00Z' }];
    assert.equal(validateAvailability([item('w', '08:00', '10:00')], windows, 30).length, 1);
    assert.equal(validateAvailability([item('w', '08:30', '15:30')], windows, 30).length, 0);
    const events = [item('c', '10:00', '11:00', 'Class')];
    const shifts = generateShifts(windows, events, 180, 30, 0);
    assert.equal(shifts[0]?.start, '2026-11-02T08:30:00.000Z');
    assert.equal(shifts[0]?.end, '2026-11-02T09:30:00.000Z');
    assert.equal(shifts[1]?.start, '2026-11-02T11:30:00.000Z');
    assert.deepEqual(validateCommuteGaps([...events, ...shifts], 30, 0), []);
});
test('night shifts and neighbor outside planned week use real instants', () => {
    const work = { id: 'w', start: '2026-11-02T00:00:00Z', end: '2026-11-02T02:00:00Z', category: 'Work' as const };
    const previous = { id: 'c', start: '2026-11-01T22:00:00Z', end: '2026-11-01T23:45:00Z', category: 'Class' as const };
    assert.equal(validateCommuteGaps([work, previous], 30, 0)[0]?.actualMinutes, 15);
    const windows = availabilityWindows('2026-10-19', [{ dayOfWeek: 7, startTime: '00:00', endTime: '04:00' }], 'Europe/Warsaw');
    assert.equal((Date.parse(windows[0]!.end) - Date.parse(windows[0]!.start)) / 60000, 300);
});
test('touching intervals join across midnight and week edges only supply buffer', () => {
    const windows = availabilityWindows('2026-11-02', [{ dayOfWeek: 1, startTime: '00:00', endTime: '02:00' }, { dayOfWeek: 1, startTime: '22:00', endTime: '24:00' }, { dayOfWeek: 2, startTime: '00:00', endTime: '02:00' }, { dayOfWeek: 7, startTime: '22:00', endTime: '24:00' }], 'Europe/Warsaw');
    const shifts = generateShifts(windows, [], 300, 30, 0, { start: '2026-11-01T23:00:00Z', end: '2026-11-08T23:00:00Z' });
    assert.equal(shifts[0]?.start, '2026-11-01T23:00:00.000Z');
    assert.ok(shifts.some(s => Date.parse(s.end) - Date.parse(s.start) === 180 * 60000));
    assert.deepEqual(validateAvailability(shifts, windows, 30), []);
});
