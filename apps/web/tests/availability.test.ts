import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAvailability, subtractMandatory, mandatoryWeeklyIntervals } from '../src/domain/availability.ts';
test('editor merges overlap, splits Sunday night and clips mandatory classes without changing draft', () => {
    const draft = [{ dayOfWeek: 7, startTime: '22:00', endTime: '02:00' }, { dayOfWeek: 1, startTime: '01:00', endTime: '04:00' }];
    const before = structuredClone(draft);
    const merged = mergeAvailability(draft);
    assert.deepEqual(draft, before);
    assert.deepEqual(merged, [{ dayOfWeek: 1, startTime: '00:00', endTime: '04:00' }, { dayOfWeek: 7, startTime: '22:00', endTime: '24:00' }]);
    assert.deepEqual(subtractMandatory(merged, [{ dayOfWeek: 1, startTime: '01:00', endTime: '02:00' }]), [{ dayOfWeek: 1, startTime: '00:00', endTime: '01:00' }, { dayOfWeek: 1, startTime: '02:00', endTime: '04:00' }, { dayOfWeek: 7, startTime: '22:00', endTime: '24:00' }]);
    assert.equal(merged[0]?.endTime, '04:00');
    assert.throws(() => mergeAvailability([{ dayOfWeek: 1, startTime: '12:00', endTime: '12:00' }]));
});
test('only recurring mandatory classes alter weekly availability; one-offs remain calendar constraints', () => {
    const e = { category: 'Class', mandatory: true, repeatWeekly: true, start: '2026-11-08T23:00', end: '2026-11-09T01:00' };
    assert.deepEqual(mandatoryWeeklyIntervals([e]), [{ dayOfWeek: 7, startTime: '23:00', endTime: '24:00' }, { dayOfWeek: 1, startTime: '00:00', endTime: '01:00' }]);
    assert.deepEqual(mandatoryWeeklyIntervals([{ ...e, repeatWeekly: false }, { ...e, mandatory: false }]), []);
});
