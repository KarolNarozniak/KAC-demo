import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAvailability } from '../src/profile/availability.js';
import { calculatePay, rateGrosz } from '../src/scheduling/pay.js';
test('availability splits Sunday night without losing midnight; touching allowed', () => {
    assert.deepEqual(normalizeAvailability([{ dayOfWeek: 7, startTime: '22:00', endTime: '02:00' }]), [{ dayOfWeek: 1, startTime: '00:00', endTime: '02:00' }, { dayOfWeek: 7, startTime: '22:00', endTime: '24:00' }]);
    assert.equal(normalizeAvailability([{ dayOfWeek: 1, startTime: '08:00', endTime: '09:00' }, { dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]).length, 2);
    assert.deepEqual(normalizeAvailability([]), []);
});
test('overlap rejected at repository boundary, editor may merge', () => {
    const rows = [{ dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }, { dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }];
    assert.throws(() => normalizeAvailability(rows), /availability_overlap/);
    assert.equal(normalizeAvailability(rows, true)[0]?.endTime, '11:00');
    for (const startTime of ['24:00', '25:00', '08:60', '8:00'])
        assert.throws(() => normalizeAvailability([{ dayOfWeek: 1, startTime, endTime: '12:00' }]));
});
test('pay integer half-up, partial hours, zero, null, precision and DST', () => {
    const pay = (rate: number | null, minutes: number) => calculatePay(rate, '2026-01-01T00:00:00Z', new Date(Date.parse('2026-01-01T00:00:00Z') + minutes * 60000).toISOString()).payGrosz;
    assert.equal(pay(30, 1200), 60000);
    assert.equal(pay(30, 30), 1500);
    assert.equal(pay(30, 45), 2250);
    assert.equal(pay(30, 61), 3050);
    assert.equal(pay(.01, 30), 1);
    assert.equal(pay(.01, 30) * 2, 2);
    assert.equal(pay(0, 61), 0);
    assert.throws(() => rateGrosz(0.0000001));
    assert.throws(() => rateGrosz(1.001), /invalid_hourly_rate/);
    assert.throws(() => rateGrosz(-1));
    assert.throws(() => rateGrosz(10000000000));
    assert.throws(() => pay(null, 30), /profile_incomplete/);
    assert.equal(calculatePay(30, '2026-03-29T01:00:00+01:00', '2026-03-29T04:00:00+02:00').durationMinutes, 120);
    assert.equal(calculatePay(30, '2026-10-25T01:00:00+02:00', '2026-10-25T04:00:00+01:00').durationMinutes, 240);
});

import {validateWorkProfile} from '../src/profile/rules.js';
const profile={profileVersion:'v1',mode:'elastyczny' as const,minimumHours:0,targetHours:20,maximumHours:30,commuteBufferMinutes:0,minimumRestMinutes:0,minimumShiftMinutes:120,maximumSlotMinutes:360,maxHoursPerDay:8,availability:[],preferredWorkWindows:[],blockedPeriods:[],shiftTemplates:[]};
test('financial fields extend the canonical profile without breaking old clients',()=>{
 assert.equal(validateWorkProfile(profile).ok,true);
 assert.equal(validateWorkProfile({...profile,hourlyRatePln:0,rateKind:'gross'}).ok,true);
 assert.equal(validateWorkProfile({...profile,hourlyRatePln:null,rateKind:null}).ok,true);
 for(const hourlyRatePln of [-1,1.001,10000000000]){const result=validateWorkProfile({...profile,hourlyRatePln,rateKind:'net'});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.fields.hourlyRatePln,'invalid_hourly_rate');}
 const missing=validateWorkProfile({...profile,hourlyRatePln:30,rateKind:null});assert.equal(missing.ok,false);if(!missing.ok)assert.equal(missing.fields.rateKind,'rate_kind_required');
});
