// Walidacja profilu pracy (S23KC2S1P2-15) i celu godzin (S23KC2S1P2-39, S23KC2S1P2-155).
// Funkcje są czyste (bez bazy), więc da się je testować jednostkowo. Formularz w aplikacji ma te same reguły.
import type { PlanningContext } from '../scheduling/types.js';
import type { FieldErrors, NumberField, TargetPeriod, ValidWorkProfile, WorkProfile, WorkProfileInput } from './types.js';

/** Dopuszczalne zakresy. Limity tygodniowe są takie jak w generatorze grafiku. */
export const PROFILE_LIMITS = {
  weekHours: 80,
  monthHours: 346, // 80 h tygodniowo × 52/12 tygodnia, zaokrąglone w dół
  commuteMinutes: 720,
  restMinutes: 1440,
  shiftMinutesMin: 120,
  shiftMinutesMax: 720,
  dayHours: 24,
} as const;

/** Średnio w miesiącu jest 52/12 ≈ 4,33 tygodnia. */
export const WEEKS_PER_MONTH = 52 / 12;

export const roundHours = (hours: number) => Math.round(hours * 100) / 100;
export const hoursToMinutes = (hours: number) => Math.round(hours * 60);
export const weeklyHours = (target: number, period: TargetPeriod) => period === 'week' ? roundHours(target) : roundHours(target / WEEKS_PER_MONTH);

const EPSILON = 0.005;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function validateWorkProfile(input: WorkProfileInput): { ok: true; value: ValidWorkProfile } | { ok: false; fields: FieldErrors } {
  const fields: FieldErrors = {};
  const period: TargetPeriod = input.targetPeriod ?? 'week';
  const value = (field: NumberField) => input[field];

  // Liczba godzin: wymagana, nie ujemna, w zakresie.
  const hours = (field: NumberField, max: number, positive = false) => {
    const current = value(field);
    if (current === null) fields[field] = 'required';
    else if (current < 0) fields[field] = 'negative';
    else if (positive && roundHours(current) === 0) fields[field] = 'must_be_positive';
    else if (current > max) fields[field] = 'out_of_range';
  };
  // Minuty: wymagane, całkowite, w zakresie.
  const minutes = (field: NumberField, min: number, max: number) => {
    const current = value(field);
    if (current === null) fields[field] = 'required';
    else if (!Number.isInteger(current)) fields[field] = 'not_whole_number';
    else if (current < 0) fields[field] = 'negative';
    else if (current < min || current > max) fields[field] = 'out_of_range';
  };

  // S23KC2S1P2-15, 4a: puste pole albo minimum większe niż maksimum.
  hours('minimumHours', PROFILE_LIMITS.weekHours);
  hours('maximumHours', PROFILE_LIMITS.weekHours, true);
  const min = input.minimumHours, max = input.maximumHours;
  const limitsValid = !fields.minimumHours && !fields.maximumHours && min !== null && max !== null;
  if (limitsValid && min > max) fields.minimumHours = 'min_greater_than_max';

  // S23KC2S1P2-39, 4a: cel ujemny albo niepodany. Zero też nie jest celem.
  hours('targetHours', period === 'week' ? PROFILE_LIMITS.weekHours : PROFILE_LIMITS.monthHours, true);
  if (!fields.targetHours && limitsValid && !fields.minimumHours) {
    // Cel musi mieścić się w limitach tygodniowych; cel miesięczny porównujemy po przeliczeniu na tydzień.
    const weekly = weeklyHours(input.targetHours!, period);
    if (weekly < min - EPSILON) fields.targetHours = 'target_below_min';
    else if (weekly > max + EPSILON) fields.targetHours = 'target_above_max';
  }

  minutes('commuteBufferMinutes', 0, PROFILE_LIMITS.commuteMinutes);
  minutes('minimumRestMinutes', 0, PROFILE_LIMITS.restMinutes);
  minutes('minimumShiftMinutes', PROFILE_LIMITS.shiftMinutesMin, PROFILE_LIMITS.shiftMinutesMax);
  minutes('maximumSlotMinutes', PROFILE_LIMITS.shiftMinutesMin, PROFILE_LIMITS.shiftMinutesMax);
  if (!fields.minimumShiftMinutes && !fields.maximumSlotMinutes && input.maximumSlotMinutes! < input.minimumShiftMinutes!) {
    fields.maximumSlotMinutes = 'shorter_than_minimum';
  }
  hours('maxHoursPerDay', PROFILE_LIMITS.dayHours, true);

  // Dostępne dni i godziny, preferencje, blokady i szablony zmian: koniec po początku, bez powtórzonych identyfikatorów.
  const windows = (name: 'availability' | 'preferredWorkWindows', list: { id: string; startTime: string; endTime: string }[]) => {
    const seen = new Set<string>();
    list.forEach((window, index) => {
      if (seen.has(window.id)) fields[`${name}.${index}`] = 'duplicate_id';
      else if (toMinutes(window.endTime) <= toMinutes(window.startTime)) fields[`${name}.${index}`] = 'end_before_start';
      seen.add(window.id);
    });
  };
  windows('availability', input.availability);
  windows('preferredWorkWindows', input.preferredWorkWindows);
  input.blockedPeriods.forEach((period, index) => {
    if (new Date(period.end).getTime() <= new Date(period.start).getTime()) fields[`blockedPeriods.${index}`] = 'end_before_start';
  });
  input.shiftTemplates.forEach((template, index) => {
    const start = toMinutes(template.startTime), end = toMinutes(template.endTime);
    if (template.endsNextDay ? end >= start : end <= start) fields[`shiftTemplates.${index}`] = 'end_before_start';
  });

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  const numbers = Object.fromEntries((['minimumHours', 'targetHours', 'maximumHours', 'maxHoursPerDay'] as const)
    .map((field) => [field, roundHours(input[field]!)])) as Record<'minimumHours' | 'targetHours' | 'maximumHours' | 'maxHoursPerDay', number>;
  return {
    ok: true,
    value: {
      ...input,
      ...numbers,
      commuteBufferMinutes: input.commuteBufferMinutes!,
      minimumRestMinutes: input.minimumRestMinutes!,
      minimumShiftMinutes: input.minimumShiftMinutes!,
      maximumSlotMinutes: input.maximumSlotMinutes!,
      targetPeriod: period,
      weeklyTargetHours: weeklyHours(numbers.targetHours, period),
    },
  };
}

/**
 * S23KC2S1P2-154: profil z kontekstu planowania (t_profile_pracy) → odpowiedź API.
 * targetHours to cel w wybranym okresie (tydzień: cel_godzin_tydzien, miesiąc: cel_godzin_miesiac),
 * targetMinutes to ten sam cel w pełnych minutach, a weeklyTargetMinutes – cel tygodniowy dla generatora.
 */
export function profileFromContext(context: PlanningContext): WorkProfile {
  const { profile } = context;
  const targetPeriod: TargetPeriod = profile.targetPeriod ?? 'week';
  const targetHours = targetPeriod === 'month' ? profile.periodTargetHours ?? roundHours(profile.targetHours * WEEKS_PER_MONTH) : profile.targetHours;
  return {
    profileId: profile.id,
    profileVersion: profile.profileVersion,
    timeZone: profile.timeZone,
    mode: profile.mode,
    minimumHours: profile.minimumHours,
    targetHours,
    targetPeriod,
    targetMinutes: hoursToMinutes(targetHours),
    maximumHours: profile.maximumHours,
    weeklyTargetHours: profile.targetHours,
    weeklyTargetMinutes: hoursToMinutes(profile.targetHours),
    commuteBufferMinutes: profile.commuteBufferMinutes,
    minimumRestMinutes: profile.minimumRestMinutes,
    minimumShiftMinutes: profile.minimumShiftMinutes,
    maximumSlotMinutes: profile.maximumSlotMinutes,
    maxHoursPerDay: profile.maxHoursPerDay,
    availability: context.availability,
    preferredWorkWindows: context.preferredWorkWindows,
    blockedPeriods: context.blockedPeriods,
    shiftTemplates: context.shiftTemplates,
  };
}
