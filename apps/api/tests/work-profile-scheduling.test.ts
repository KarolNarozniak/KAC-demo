import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommuteGaps, validateAvailability, type TimedItem } from '../src/scheduling/constraints.js';
const item = (id: string, start: string, end: string, category: TimedItem['category'] = 'Work'): TimedItem => ({ id, start: '2026-11-02T' + start + ':00Z', end: '2026-11-02T' + end + ':00Z', category });
test('zero, exact gap, missing minute, max rest and empty location', () => {
    const work = item('w', '10:00', '11:00'), cls = item('c', '11:30', '12:00', 'Class');
    assert.deepEqual(validateCommuteGaps([cls, work], 30, 120), []);
    assert.equal(validateCommuteGaps([work, { ...cls, start: '2026-11-02T11:29:00Z' }], 30, 0)[0]?.actualMinutes, 29);
    assert.deepEqual(validateCommuteGaps([work, item('p', '11:00', '12:00', 'Personal')], 0, 0), []);
    assert.deepEqual(validateCommuteGaps([work, item('w2', '12:00', '13:00')], 30, 60), []);
    assert.equal(validateCommuteGaps([work, item('w2', '11:59', '13:00')], 30, 60)[0]?.requiredMinutes, 60);
});
test('night shifts and neighbor outside planned week use real instants', () => {
    const work = { id: 'w', start: '2026-11-02T00:00:00Z', end: '2026-11-02T02:00:00Z', category: 'Work' as const };
    const previous = { id: 'c', start: '2026-11-01T22:00:00Z', end: '2026-11-01T23:45:00Z', category: 'Class' as const };
    assert.equal(validateCommuteGaps([work, previous], 30, 0)[0]?.actualMinutes, 15);

});
