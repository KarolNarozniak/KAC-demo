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
  weekly: {
    summary: 'Student chce pracować 16 h tygodniowo',
    description: 'Pełny zapis profilu: od 8 do 20 h tygodniowo (cel 16 h), maks. 8 h dziennie, zmiany po 4–8 h, 30 min dojazdu przed i po zajęciach, stawka 32,50 zł brutto. Dostępność: pn–pt 12:00–20:00, w środę woli popołudnie (waga 70 ze 100), a na czas sesji zimowej praca jest zablokowana. profileVersion to wersja z ostatniego odczytu profilu (GET) – chroni przed nadpisaniem zmian zrobionych w innym oknie.',
    value: input,
  },
  monthly: {
    summary: 'Cel miesięczny, bez podanej stawki',
    description: 'Ten sam profil, ale cel liczony na miesiąc: 64 h miesięcznie. Generator grafiku przelicza go na tydzień (64 h ÷ 52/12 tygodnia ≈ 14,77 h). Stawka null znaczy „jeszcze nie podano” – wtedy grafik nie pokaże szacowanego wynagrodzenia (0 zł byłoby poprawną stawką, a null to jej brak).',
    value: { ...input, targetPeriod: 'month', targetHours: 64, hourlyRatePln: null, rateKind: null, preferredWorkWindows: [], blockedPeriods: [] },
  },
};

export const workProfileExamples: NamedExamples = {
  profile: {
    summary: 'Zapisany profil pracy',
    description: 'Profil po zapisie. Oprócz wysłanych pól serwer dolicza: weeklyTargetHours / weeklyTargetMinutes (cel przeliczony na tydzień – z niego korzysta generator), targetMinutes (cel w minutach) i timeZone (strefa czasowa użytkownika). profileVersion zmienił się z pv-7 na pv-8 – przy kolejnym zapisie trzeba wysłać pv-8.',
    value: workProfileExample,
  },
};

export const profileConflictExamples: NamedExamples = {
  stale: {
    summary: 'Ktoś zmienił profil w międzyczasie',
    description: 'Wysłany profileVersion jest nieaktualny – profil zmieniono np. w drugiej karcie (tu ktoś podniósł cel do 18 h). Nic nie zostało nadpisane. W polu profile serwer od razu zwraca aktualny profil: formularz może go pokazać albo nanieść swoje zmiany i wysłać je z nowym profileVersion (pv-9).',
    value: { error: 'profile_version_conflict', profile: { ...workProfileExample, profileVersion: 'pv-9', targetHours: 18, weeklyTargetHours: 18, targetMinutes: 1080, weeklyTargetMinutes: 1080 } },
  },
};

export const invalidProfileExamples: NamedExamples = {
  limits: {
    summary: 'Minimum godzin większe od maksimum',
    description: 'Np. minimum 25 h, a maksimum 20 h tygodniowo. W polu fields klucz to nazwa błędnego pola, a wartość to kod błędu – formularz może wyświetlić komunikat przy tym polu. Zapisany profil się nie zmienił.',
    value: { error: 'invalid_work_profile', fields: { minimumHours: 'min_greater_than_max' } },
  },
  fields: {
    summary: 'Kilka błędów naraz',
    description: 'Serwer zwraca wszystkie błędy jednocześnie: czas dojazdu nie jest pełną liczbą minut (np. 12,5), pierwszy przedział dostępności (availability.0 – numeracja od zera) kończy się przed początkiem, a dzienny limit godzin wynosi 0. Zapisany profil się nie zmienił.',
    value: { error: 'invalid_work_profile', fields: { commuteBufferMinutes: 'not_whole_number', 'availability.0': 'end_before_start', maxHoursPerDay: 'must_be_positive' } },
  },
};
