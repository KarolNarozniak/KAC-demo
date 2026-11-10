// Przykłady profilu pracy w Swagger UI (S23KC2S1P2-183). Te same dane opisują grafik z api/v1/scheduling/examples.ts.
import type { NamedExamples } from '../../examples.js';

const availability = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ id: `A${dayOfWeek}`, dayOfWeek, startTime: '12:00', endTime: '20:00' }));

const input = {
  profileVersion: 'pv-7',
  hourlyRatePln: 32.5,
  rateKind: 'gross',
  mode: 'elastyczny',
  targetPeriod: 'week',
  minimumHours: 8,
  targetHours: 16,
  maximumHours: 20,
  commuteBufferMinutes: 30,
  minimumRestMinutes: 0,
  minimumShiftMinutes: 240,
  maximumSlotMinutes: 480,
  maxHoursPerDay: 8,
  availability,
  preferredWorkWindows: [{ id: 'P1', dayOfWeek: 3, startTime: '14:00', endTime: '20:00', weight: 70 }],
  blockedPeriods: [{ id: 'B1', type: 'exam_session', start: '2027-01-25T00:00:00+01:00', end: '2027-02-07T23:59:00+01:00', reason: 'Sesja zimowa' }],
  shiftTemplates: [],
};

export const workProfileExample = {
  profileId: 'c0a8f1d2-6b3e-4a51-9e2f-7d4c1b0a9e11',
  ...input,
  profileVersion: 'pv-8',
  timeZone: 'Europe/Warsaw',
  commuteConfigured: true,
  targetMinutes: 960,
  weeklyTargetHours: 16,
  weeklyTargetMinutes: 960,
};

export const workProfileInputExamples: NamedExamples = {
  weekly: { summary: 'Cel tygodniowy, praca elastyczna', description: 'Formularz odsyła profileVersion z ostatniego odczytu.', value: input },
  monthly: {
    summary: 'Cel miesięczny bez stawki',
    description: 'Cel 64 h na miesiąc to ok. 14,77 h tygodniowo (miesiąc = 52/12 tygodnia). Stawka null oznacza brak konfiguracji.',
    value: { ...input, targetPeriod: 'month', targetHours: 64, hourlyRatePln: null, rateKind: null, preferredWorkWindows: [], blockedPeriods: [] },
  },
};

export const workProfileExamples: NamedExamples = {
  profile: { summary: 'Aktywny profil pracy', value: workProfileExample },
};

export const profileConflictExamples: NamedExamples = {
  stale: {
    summary: 'Nieaktualna wersja profilu',
    description: 'Profil zmieniono w innym oknie. Odpowiedź zawiera aktualny profil z nową wersją.',
    value: { error: 'profile_version_conflict', profile: { ...workProfileExample, profileVersion: 'pv-9', targetHours: 18, weeklyTargetHours: 18, targetMinutes: 1080, weeklyTargetMinutes: 1080 } },
  },
};

export const invalidProfileExamples: NamedExamples = {
  limits: {
    summary: 'Minimum większe od maksimum',
    value: { error: 'invalid_work_profile', fields: { minimumHours: 'min_greater_than_max' } },
  },
  fields: {
    summary: 'Kilka błędnych pól',
    value: { error: 'invalid_work_profile', fields: { commuteBufferMinutes: 'not_whole_number', 'availability.0': 'end_before_start', maxHoursPerDay: 'must_be_positive' } },
  },
};
