// Profil pracy (S23KC2S1P2-15) i cel godzin (S23KC2S1P2-39): formularz, walidacja i licznik celu.
import assert from 'node:assert/strict';
import test from 'node:test';
import { draftFromProfile, errorMessage, formatMinutes, inputFromDraft, isDirty, parseNumber, targetProgress, validateDraft, type ProfileDraft } from '../src/domain/workProfile.ts';
import type { WorkProfile } from '../src/services/workProfileApi.ts';

const profile: WorkProfile = {
  profileId: 'P001', profileVersion: 'v1', timeZone: 'Europe/Warsaw', mode: 'elastyczny',
  minimumHours: 10, targetHours: 20, targetPeriod: 'week', maximumHours: 30, targetMinutes: 1200, weeklyTargetHours: 20, weeklyTargetMinutes: 1200,
  commuteBufferMinutes: 45, minimumRestMinutes: 60, minimumShiftMinutes: 120, maximumSlotMinutes: 360, maxHoursPerDay: 8,
  availability: [{ id: 'A1', dayOfWeek: 1, startTime: '08:00', endTime: '16:00' }], preferredWorkWindows: [], blockedPeriods: [], shiftTemplates: [],
};
const withNumbers = (numbers: Partial<ProfileDraft['numbers']>, extra: Partial<ProfileDraft> = {}): ProfileDraft => {
  const draft = draftFromProfile(profile);
  return { ...draft, ...extra, numbers: { ...draft.numbers, ...numbers } };
};

test('formularz: zapisany profil jest poprawny i niezmieniony; przecinek działa jak kropka', () => {
  const draft = draftFromProfile(profile);
  assert.deepEqual(validateDraft(draft), {});
  assert.equal(isDirty(draft, profile), false);
  assert.equal(isDirty(withNumbers({ targetHours: '20,0' }), profile), false);
  assert.equal(isDirty(withNumbers({ targetHours: '21' }), profile), true);
  assert.equal(parseNumber('20,5'), 20.5);
  assert.equal(inputFromDraft(withNumbers({ targetHours: '20,5' })).targetHours, 20.5);
  assert.equal(inputFromDraft(withNumbers({ targetHours: '' })).targetHours, null);
});

test('S23KC2S1P2-15, 4a: puste pole, minimum większe niż maksimum, tekst zamiast liczby', () => {
  assert.equal(validateDraft(withNumbers({ minimumHours: '' })).minimumHours, 'required');
  assert.equal(validateDraft(withNumbers({ minimumHours: '35', targetHours: '32' })).minimumHours, 'min_greater_than_max');
  assert.equal(validateDraft(withNumbers({ commuteBufferMinutes: 'pół godziny' })).commuteBufferMinutes, 'not_a_number');
  assert.equal(validateDraft(withNumbers({ commuteBufferMinutes: '12,5' })).commuteBufferMinutes, 'not_whole_number');
  assert.equal(validateDraft(withNumbers({ minimumShiftMinutes: '240', maximumSlotMinutes: '180' })).maximumSlotMinutes, 'shorter_than_minimum');
  assert.equal(validateDraft({ ...draftFromProfile(profile), availability: [{ id: 'A1', dayOfWeek: 1, startTime: '8:00', endTime: '16:00' }] })['availability.0'], 'invalid_time');
  assert.equal(validateDraft({ ...draftFromProfile(profile), availability: [{ id: 'A1', dayOfWeek: 1, startTime: '16:00', endTime: '08:00' }] })['availability.0'], undefined);
});

test('S23KC2S1P2-39: cel – brak, zero, ujemny, zakres i cel miesięczny względem limitów tygodniowych', () => {
  const target = (text: string, period: 'week' | 'month' = 'week') => validateDraft(withNumbers({ targetHours: text }, { targetPeriod: period })).targetHours;
  assert.equal(target(''), 'required');
  assert.equal(target('0'), 'must_be_positive');
  assert.equal(target('-3'), 'negative');
  assert.equal(target('9'), 'target_below_min');
  assert.equal(target('31'), 'target_above_max');
  assert.equal(target('130', 'month'), undefined); // 130 h / mies. = 30 h / tydz.
  assert.equal(target('160', 'month'), 'target_above_max');
  assert.equal(target('400', 'month'), 'out_of_range');
  const draft = withNumbers({ targetHours: '160' }, { targetPeriod: 'month' });
  assert.equal(errorMessage('targetHours', 'target_above_max', draft), 'Cel (ok. 36,92 h tygodniowo) jest wyższy niż maksimum godzin.');
  assert.equal(errorMessage('targetHours', 'out_of_range', draft), 'Dopuszczalny zakres: do 346 h na miesiąc.');
});

test('S23KC2S1P2-156: licznik zaplanowanych minut względem celu', () => {
  assert.deepEqual(targetProgress(750, 1200), { percent: 63, status: 'below', difference: 450 });
  assert.deepEqual(targetProgress(1200, 1200), { percent: 100, status: 'reached', difference: 0 });
  assert.equal(targetProgress(1500, 1200).status, 'above');
  assert.equal(formatMinutes(750), '12 h 30 min');
  assert.equal(formatMinutes(45), '45 min');
});

test('hourly rate and copied overnight availability share the monthly profile save',()=>{
 const draft={...draftFromProfile({...profile,targetPeriod:'month',targetHours:100,hourlyRatePln:30,rateKind:'gross'}),hourlyRateText:'30,50',availability:[{id:'night',dayOfWeek:7,startTime:'22:00',endTime:'02:00'}]};
 assert.deepEqual(validateDraft(draft),{});const input=inputFromDraft(draft);assert.equal(input.hourlyRatePln,30.5);assert.equal(input.targetPeriod,'month');assert.equal(input.targetHours,100);assert.deepEqual(input.availability.map(({dayOfWeek,startTime,endTime})=>({dayOfWeek,startTime,endTime})),[{dayOfWeek:1,startTime:'00:00',endTime:'02:00'},{dayOfWeek:7,startTime:'22:00',endTime:'24:00'}]);
 assert.equal(validateDraft({...draft,hourlyRateText:'1,001'}).hourlyRatePln,'invalid_hourly_rate');
});
