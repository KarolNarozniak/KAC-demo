// Schematy JSON profilu pracy (S23KC2S1P2-15, S23KC2S1P2-39; dokumentacja celu godzin: S23KC2S1P2-158).
// Fastify waliduje nimi żądania i odpowiedzi, a @fastify/swagger buduje z nich kontrakt OpenAPI.
import { FIELD_ERRORS } from '../../../profile/types.js';
import { PROFILE_LIMITS } from '../../../profile/rules.js';

const time = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Czas lokalny HH:MM.' } as const;
const id = { type: 'string', minLength: 1, maxLength: 100 } as const;
const day = { type: 'integer', minimum: 1, maximum: 7, description: '1 = poniedziałek … 7 = niedziela.' } as const;

const availability = {
  type: 'array', maxItems: 70, description: 'Dni i godziny, w których student może pracować.',
  items: { type: 'object', required: ['id', 'dayOfWeek', 'startTime', 'endTime'], additionalProperties: false,
    properties: { id, dayOfWeek: day, startTime: time, endTime: time } },
} as const;
const preferredWorkWindows = {
  type: 'array', maxItems: 70, description: 'Preferowane okna pracy z wagą 0–100.',
  items: { type: 'object', required: ['id', 'dayOfWeek', 'startTime', 'endTime', 'weight'], additionalProperties: false,
    properties: { id, dayOfWeek: day, startTime: time, endTime: time, weight: { type: 'number', minimum: 0, maximum: 100 } } },
} as const;
const blockedPeriods = {
  type: 'array', maxItems: 100, description: 'Okresy bez pracy, np. sesja albo urlop.',
  items: { type: 'object', required: ['id', 'type', 'start', 'end'], additionalProperties: false,
    properties: { id, type: { type: 'string', minLength: 1, maxLength: 80 }, start: { type: 'string', format: 'date-time' },
      end: { type: 'string', format: 'date-time' }, reason: { type: 'string', maxLength: 200 } } },
} as const;
const shiftTemplates = {
  type: 'array', maxItems: 12, description: 'Szablony zmian dla trybu zmianowego.',
  items: { type: 'object', required: ['id', 'name', 'startTime', 'endTime', 'endsNextDay', 'daysOfWeek', 'active'], additionalProperties: false,
    properties: { id, name: { type: 'string', minLength: 1, maxLength: 80 }, startTime: time, endTime: time, endsNextDay: { type: 'boolean' },
      daysOfWeek: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: day }, active: { type: 'boolean' } } },
} as const;

const mode = { type: 'string', enum: ['elastyczny', 'zmianowy'], description: 'Tryb pracy: elastyczny (dowolne okna) albo zmianowy (szablony zmian).' } as const;
const targetPeriod = { type: 'string', enum: ['week', 'month'], description: 'Okres celu godzin: week = tydzień, month = miesiąc.' } as const;
const number = (description: string) => ({ type: ['number', 'null'], description }) as const;

const inputNumbers = {
  minimumHours: number(`Minimalna liczba godzin pracy w tygodniu (0–${PROFILE_LIMITS.weekHours}).`),
  targetHours: number(`Docelowa liczba godzin w wybranym okresie, większa od zera (do ${PROFILE_LIMITS.weekHours} h na tydzień albo ${PROFILE_LIMITS.monthHours} h na miesiąc). Po przeliczeniu na tydzień musi mieścić się między minimum a maksimum.`),
  maximumHours: number(`Maksymalna liczba godzin pracy w tygodniu (większa od zera, do ${PROFILE_LIMITS.weekHours}).`),
  commuteBufferMinutes: number(`Czas dojazdu w minutach (0–${PROFILE_LIMITS.commuteMinutes}).`),
  minimumRestMinutes: number(`Minimalny odpoczynek między zajęciami a pracą w minutach (0–${PROFILE_LIMITS.restMinutes}).`),
  minimumShiftMinutes: number(`Minimalna długość zmiany w minutach (${PROFILE_LIMITS.shiftMinutesMin}–${PROFILE_LIMITS.shiftMinutesMax}).`),
  maximumSlotMinutes: number(`Maksymalna długość zmiany w minutach (${PROFILE_LIMITS.shiftMinutesMin}–${PROFILE_LIMITS.shiftMinutesMax}), nie mniejsza niż minimalna.`),
  maxHoursPerDay: number(`Maksymalna liczba godzin pracy w jednym dniu (większa od zera, do ${PROFILE_LIMITS.dayHours}).`),
};

/** Treść PUT /api/v1/work-profile. */
export const workProfileInputSchema = {
  type: 'object',
  description: 'Pełne ustawienia profilu pracy i wersja profilu, na której pracował formularz.',
  required: ['profileVersion', 'mode', ...Object.keys(inputNumbers), 'availability', 'preferredWorkWindows', 'blockedPeriods', 'shiftTemplates'],
  additionalProperties: false,
  properties: {
    profileVersion: { type: 'string', minLength: 1, description: 'Wersja z ostatniego odczytu profilu (optimistic locking).' },
    mode, targetPeriod, ...inputNumbers, availability, preferredWorkWindows, blockedPeriods, shiftTemplates,
  },
} as const;

const numberOut = (description: string) => ({ type: 'number', description }) as const;
/** Profil w odpowiedzi API. */
export const workProfileSchema = {
  type: 'object',
  description: 'Aktywny profil pracy użytkownika.',
  required: ['profileId', 'profileVersion', 'timeZone', 'mode', 'minimumHours', 'targetHours', 'targetPeriod', 'targetMinutes', 'maximumHours',
    'weeklyTargetHours', 'weeklyTargetMinutes', 'commuteBufferMinutes', 'minimumRestMinutes', 'minimumShiftMinutes', 'maximumSlotMinutes',
    'maxHoursPerDay', 'availability', 'preferredWorkWindows', 'blockedPeriods', 'shiftTemplates'],
  properties: {
    profileId: { type: 'string' },
    profileVersion: { type: 'string', description: 'Wersja profilu; trzeba ją odesłać przy zapisie.' },
    timeZone: { type: 'string', description: 'Strefa czasowa użytkownika (IANA).' },
    mode,
    minimumHours: numberOut('Minimalna liczba godzin w tygodniu.'),
    targetHours: numberOut('Cel godzin w wybranym okresie.'),
    targetPeriod,
    targetMinutes: { type: 'integer', description: 'Cel w wybranym okresie w pełnych minutach.' },
    maximumHours: numberOut('Maksymalna liczba godzin w tygodniu.'),
    weeklyTargetHours: numberOut('Cel przeliczony na tydzień (miesiąc = 52/12 tygodnia); z niego korzysta generator grafiku.'),
    weeklyTargetMinutes: { type: 'integer', description: 'Cel tygodniowy w pełnych minutach.' },
    commuteBufferMinutes: { type: 'integer' }, minimumRestMinutes: { type: 'integer' },
    minimumShiftMinutes: { type: 'integer' }, maximumSlotMinutes: { type: 'integer' }, maxHoursPerDay: { type: 'number' },
    availability, preferredWorkWindows, blockedPeriods, shiftTemplates,
  },
} as const;

const error = (codes: string[], description: string) => ({
  type: 'object', description, required: ['error'], properties: { error: { type: 'string', enum: codes } },
}) as const;

export const invalidProfileSchema = {
  type: 'object',
  description: 'Profil nie został zapisany, bo dane wymagają poprawy. Zapisany profil pozostaje bez zmian.',
  required: ['error', 'fields'],
  properties: {
    error: { type: 'string', enum: ['invalid_work_profile'] },
    fields: {
      type: 'object',
      description: [
        'Błędy przy polach. Klucz to nazwa pola albo pozycja listy, np. "availability.0".',
        'Kody: required – puste pole; negative – wartość ujemna; must_be_positive – zero;',
        'out_of_range – poza dopuszczalnym zakresem; not_whole_number – minuty muszą być liczbą całkowitą;',
        'min_greater_than_max – minimum większe niż maksimum; target_below_min / target_above_max – cel (po przeliczeniu na tydzień) poza limitami;',
        'shorter_than_minimum – maksymalna długość zmiany krótsza niż minimalna; end_before_start – koniec nie jest po początku; duplicate_id – powtórzony identyfikator.',
      ].join(' '),
      additionalProperties: { type: 'string', enum: FIELD_ERRORS },
    },
  },
} as const;

export const profileConflictSchema = {
  type: 'object',
  description: 'Profil zmieniono w międzyczasie (np. w innym oknie). Zwracamy aktualny profil; formularz może go wczytać albo zapisać zmiany ponownie z nową wersją.',
  required: ['error', 'profile'],
  properties: { error: { type: 'string', enum: ['profile_version_conflict'] }, profile: workProfileSchema },
} as const;

const notFound = error(['work_profile_not_found'], 'Użytkownik nie ma aktywnego profilu pracy.');
const unavailable = error(['work_profile_not_configured', 'work_profile_unavailable'], 'Baza danych nie jest dostępna.');

export const getWorkProfileRoute = {
  tags: ['Work profile'],
  summary: 'Read the work profile',
  description: 'Returns hour limits, the hour target with its period (week or month), commute time, availability, preferences, blocked periods, shift templates and the profile version used for optimistic locking. The user is resolved on the server.',
  operationId: 'getWorkProfile',
  response: { 200: workProfileSchema, 404: notFound, 503: unavailable },
} as const;

export const updateWorkProfileRoute = {
  tags: ['Work profile'],
  summary: 'Update the work profile',
  description: 'Validates and atomically saves the whole work profile. Field errors are returned as 422 without changing stored data; a stale profileVersion returns 409 with the current profile. Changes affect future schedule generation only – approved schedules stay unchanged.',
  operationId: 'updateWorkProfile',
  body: workProfileInputSchema,
  response: { 200: workProfileSchema, 404: notFound, 409: profileConflictSchema, 422: invalidProfileSchema, 503: unavailable },
} as const;
