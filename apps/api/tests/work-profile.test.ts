// Profil pracy (S23KC2S1P2-15, testy: S23KC2S1P2-182) i cel godzin (S23KC2S1P2-39, testy: S23KC2S1P2-157) bez bazy danych.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { UserScope } from '../src/api/scope.js';
import type { SaveProfileResult, WorkProfileRepository } from '../src/profile/repository.js';
import { profileFromContext, validateWorkProfile, weeklyHours } from '../src/profile/rules.js';
import type { ValidWorkProfile, WorkProfile, WorkProfileInput } from '../src/profile/types.js';
import type { PlanningContext } from '../src/scheduling/types.js';

const input = (overrides: Partial<WorkProfileInput> = {}): WorkProfileInput => ({
  profileVersion: 'v1', mode: 'elastyczny', minimumHours: 10, targetHours: 20, targetPeriod: 'week', maximumHours: 30,
  commuteBufferMinutes: 30, minimumRestMinutes: 30, minimumShiftMinutes: 120, maximumSlotMinutes: 360, maxHoursPerDay: 8,
  availability: [{ id: 'A1', dayOfWeek: 1, startTime: '08:00', endTime: '16:00' }],
  preferredWorkWindows: [], blockedPeriods: [], shiftTemplates: [], ...overrides,
});
const errors = (overrides: Partial<WorkProfileInput>) => {
  const result = validateWorkProfile(input(overrides));
  return result.ok ? {} : result.fields;
};

test('profil: poprawne dane przechodzą, a cel jest zaokrąglany do 0,01 h', () => {
  const result = validateWorkProfile(input({ targetHours: 20.004 }));
  assert.ok(result.ok);
  assert.equal(result.value.targetHours, 20);
  assert.equal(result.value.weeklyTargetHours, 20);
});

test('S23KC2S1P2-15, 4a: puste pola i minimum większe niż maksimum', () => {
  assert.deepEqual(errors({ minimumHours: null, maximumHours: null, commuteBufferMinutes: null }),
    { minimumHours: 'required', maximumHours: 'required', commuteBufferMinutes: 'required' });
  assert.deepEqual(errors({ minimumHours: 25, maximumHours: 20, targetHours: 22 }), { minimumHours: 'min_greater_than_max' });
  assert.deepEqual(errors({ minimumHours: -1 }), { minimumHours: 'negative' });
  assert.deepEqual(errors({ maximumHours: 0 }), { maximumHours: 'must_be_positive' });
  assert.deepEqual(errors({ maximumHours: 81 }), { maximumHours: 'out_of_range' });
  assert.deepEqual(errors({ commuteBufferMinutes: 12.5 }), { commuteBufferMinutes: 'not_whole_number' });
  assert.deepEqual(errors({ commuteBufferMinutes: 721 }), { commuteBufferMinutes: 'out_of_range' });
  assert.deepEqual(errors({ minimumShiftMinutes: 240, maximumSlotMinutes: 180 }), { maximumSlotMinutes: 'shorter_than_minimum' });
  assert.deepEqual(errors({ maxHoursPerDay: 0 }), { maxHoursPerDay: 'must_be_positive' });
});

test('S23KC2S1P2-15: dostępne dni i godziny, blokady i szablony – koniec po początku', () => {
  assert.deepEqual(errors({ availability: [{ id: 'A1', dayOfWeek: 1, startTime: '16:00', endTime: '08:00' }] }), { 'availability.0': 'end_before_start' });
  assert.deepEqual(errors({ availability: [{ id: 'A1', dayOfWeek: 1, startTime: '08:00', endTime: '10:00' }, { id: 'A1', dayOfWeek: 2, startTime: '08:00', endTime: '10:00' }] }),
    { 'availability.1': 'duplicate_id' });
  assert.deepEqual(errors({ blockedPeriods: [{ id: 'B1', type: 'Sesja', start: '2026-02-01T00:00:00Z', end: '2026-01-25T00:00:00Z' }] }), { 'blockedPeriods.0': 'end_before_start' });
  const night = { id: 'N', name: 'Noc', startTime: '22:00', endTime: '06:00', daysOfWeek: [5], active: true };
  assert.deepEqual(errors({ shiftTemplates: [{ ...night, endsNextDay: true }] }), {});
  assert.deepEqual(errors({ shiftTemplates: [{ ...night, endsNextDay: false }] }), { 'shiftTemplates.0': 'end_before_start' });
});

test('S23KC2S1P2-157: cel – null, zero, wartość ujemna, zakres i relacja do limitów', () => {
  assert.deepEqual(errors({ targetHours: null }), { targetHours: 'required' });
  assert.deepEqual(errors({ targetHours: 0 }), { targetHours: 'must_be_positive' });
  assert.deepEqual(errors({ targetHours: -5 }), { targetHours: 'negative' });
  assert.deepEqual(errors({ targetHours: 81, maximumHours: 80 }), { targetHours: 'out_of_range' });
  assert.deepEqual(errors({ targetHours: 9 }), { targetHours: 'target_below_min' });
  assert.deepEqual(errors({ targetHours: 31 }), { targetHours: 'target_above_max' });
  // Cel miesięczny: 130 h / mies. = 30 h / tydz. (na granicy), 160 h / mies. ≈ 36,92 h / tydz. (za dużo).
  assert.equal(weeklyHours(130, 'month'), 30);
  assert.deepEqual(errors({ targetHours: 130, targetPeriod: 'month' }), {});
  assert.deepEqual(errors({ targetHours: 160, targetPeriod: 'month' }), { targetHours: 'target_above_max' });
  assert.deepEqual(errors({ targetHours: 347, targetPeriod: 'month', maximumHours: 80 }), { targetHours: 'out_of_range' });
  // Gdy limity są błędne, cel nie dostaje dodatkowego, mylącego błędu relacji.
  assert.deepEqual(errors({ minimumHours: 40, maximumHours: 30, targetHours: 35 }), { minimumHours: 'min_greater_than_max' });
});

const context = (overrides: Partial<PlanningContext['profile']> = {}): PlanningContext => ({
  profile: { id: 'P1', userId: 'U1', calendarId: 'K1', timeZone: 'Europe/Warsaw', minimumHours: 10, targetHours: 23.08, maximumHours: 30,
    hourlyRatePln: 30, commuteBufferMinutes: 30, minimumRestMinutes: 30, mode: 'elastyczny', minimumShiftMinutes: 120,
    maximumSlotMinutes: 360, maxHoursPerDay: 8, profileVersion: 'v1', targetPeriod: 'month', periodTargetHours: 100, ...overrides },
  availability: [], preferredWorkWindows: [], blockedPeriods: [], events: [], shiftTemplates: [],
});

test('S23KC2S1P2-154: cel_godzin_tydzien / cel_godzin_miesiac → targetHours i minuty', () => {
  const monthly = profileFromContext(context());
  assert.deepEqual([monthly.targetHours, monthly.targetPeriod, monthly.targetMinutes, monthly.weeklyTargetHours, monthly.weeklyTargetMinutes],
    [100, 'month', 6000, 23.08, 1385]);
  const weekly = profileFromContext(context({ targetHours: 20.5, targetPeriod: 'week', periodTargetHours: 20.5 }));
  assert.deepEqual([weekly.targetHours, weekly.targetPeriod, weekly.targetMinutes, weekly.weeklyTargetMinutes], [20.5, 'week', 1230, 1230]);
});

/** Repozytorium w pamięci z optimistic locking; zapamiętuje zakres użytkownika z każdego wywołania. */
function memoryRepository() {
  let version = 1;
  let profile: WorkProfile = { ...profileFromContext(context({ targetPeriod: 'week', targetHours: 20, periodTargetHours: 20 })), profileVersion: 'v1' };
  const scopes: UserScope[] = [];
  const repository: WorkProfileRepository = {
    async getProfile(scope) { scopes.push(scope); return scope.userId === 'U001' ? profile : null; },
    async saveProfile(scope, expectedVersion, value: ValidWorkProfile): Promise<SaveProfileResult> {
      scopes.push(scope);
      if (scope.userId !== 'U001') return { kind: 'not-found' };
      if (expectedVersion !== profile.profileVersion) return { kind: 'conflict', current: profile };
      version += 1;
      profile = { ...profile, ...value, profileVersion: `v${version}`, targetMinutes: Math.round(value.targetHours * 60),
        weeklyTargetHours: value.weeklyTargetHours, weeklyTargetMinutes: Math.round(value.weeklyTargetHours * 60) };
      return { kind: 'saved', profile };
    },
  };
  return { repository, scopes };
}

test('GET/PUT /api/v1/work-profile: zapis, błędy pól (422), konflikt wersji (409) i użytkownik z serwera', async () => {
  const { repository, scopes } = memoryRepository();
  const app = buildApi(null, [], { workProfileRepository: repository, userScope: () => ({ userId: 'U001', calendarId: 'K001' }) });
  try {
    const current = await app.inject({ method: 'GET', url: '/api/v1/work-profile' });
    assert.equal(current.statusCode, 200);
    assert.equal(current.json().profileVersion, 'v1');

    const body = { ...input(), targetHours: 100, targetPeriod: 'month' };
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: body });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual([saved.json().targetHours, saved.json().targetPeriod, saved.json().targetMinutes, saved.json().weeklyTargetHours], [100, 'month', 6000, 23.08]);

    // Stara wersja: 409 z aktualnym profilem, nic się nie zmienia.
    const stale = await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: { ...body, targetHours: 90 } });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, 'profile_version_conflict');
    assert.equal(stale.json().profile.targetHours, 100);

    // Błędy pól: 422 z kodami przy polach.
    const invalid = await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: { ...input(), profileVersion: 'v2', minimumHours: null, targetHours: -1 } });
    assert.equal(invalid.statusCode, 422);
    assert.deepEqual(invalid.json(), { error: 'invalid_work_profile', fields: { minimumHours: 'required', targetHours: 'negative' } });

    // Schemat: tekst zamiast liczby albo nieznany okres → 400; próba podania użytkownika w treści jest ignorowana.
    assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: { ...input(), targetHours: 'dużo' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: { ...input(), targetPeriod: 'year' } })).statusCode, 400);
    const foreign = await app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: { ...input(), profileVersion: 'v2', userId: 'U999' } });
    assert.equal(foreign.statusCode, 200, foreign.body);
    assert.ok(scopes.length > 0 && scopes.every((scope) => scope.userId === 'U001'));
  } finally {
    await app.close();
  }
});

test('GET/PUT /api/v1/work-profile: brak bazy i brak profilu', async () => {
  const withoutDatabase = buildApi(null);
  const otherUser = buildApi(null, [], { workProfileRepository: memoryRepository().repository, userScope: () => ({ userId: 'U404', calendarId: 'K0' }) });
  try {
    assert.equal((await withoutDatabase.inject({ method: 'GET', url: '/api/v1/work-profile' })).statusCode, 503);
    assert.equal((await otherUser.inject({ method: 'GET', url: '/api/v1/work-profile' })).statusCode, 404);
    assert.equal((await otherUser.inject({ method: 'PUT', url: '/api/v1/work-profile', payload: input() })).statusCode, 404);
  } finally {
    await withoutDatabase.close();
    await otherUser.close();
  }
});
