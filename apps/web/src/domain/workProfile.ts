import { mergeAvailability } from './availability.ts';
// Profil pracy (S23KC2S1P2-15) i cel godzin (S23KC2S1P2-39): formularz, walidacja i licznik celu.
// Reguły są takie same jak w API (apps/api/src/profile/rules.ts) – serwer i tak sprawdza dane jeszcze raz.
import type { NumberField, TargetPeriod, WorkProfile, WorkProfileInput } from '../services/workProfileApi';

export const LIMITS = { weekHours: 80, monthHours: 346, commuteMinutes: 720, restMinutes: 1440, shiftMin: 120, shiftMax: 720, dayHours: 24 } as const;
export const WEEKS_PER_MONTH = 52 / 12;
export const PERIOD_LABEL: Record<TargetPeriod, string> = { week: 'tydzień', month: 'miesiąc' };

/** Formularz: pola liczbowe jako tekst, żeby puste pole było puste, a nie zerem. */
export type ProfileDraft = Omit<WorkProfileInput, NumberField | 'hourlyRatePln'> & { baseHourlyRate?:number|null; hourlyRateText?:string; numbers: Record<NumberField, string> };
export type FieldMessages = Record<string, string>;

const roundHours = (hours: number) => Math.round(hours * 100) / 100;
export const weeklyHours = (target: number, period: TargetPeriod) => period === 'week' ? roundHours(target) : roundHours(target / WEEKS_PER_MONTH);
export const formatNumber = (value: number) => String(roundHours(value)).replace('.', ',');

/** „20”, „20,5” i „20.5” → liczba; puste pole → null; inny tekst → NaN. */
export function parseNumber(text: string): number | null {
  const value = text.trim().replace(',', '.');
  if (!value) return null;
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
}

/** 750 → „12 h 30 min”. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60), rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function draftFromProfile(profile: WorkProfile): ProfileDraft {
  const { minimumHours, targetHours, maximumHours, commuteBufferMinutes, minimumRestMinutes, minimumShiftMinutes, maximumSlotMinutes, maxHoursPerDay } = profile;
  const values = { minimumHours, targetHours, maximumHours, commuteBufferMinutes, minimumRestMinutes, minimumShiftMinutes, maximumSlotMinutes, maxHoursPerDay };
  return {
    baseHourlyRate:profile.hourlyRatePln??null,
    hourlyRateText:profile.hourlyRatePln==null?'':formatNumber(profile.hourlyRatePln),
    rateKind:profile.rateKind??null,
    profileVersion: profile.profileVersion,
    mode: profile.mode,
    targetPeriod: profile.targetPeriod,
    availability: profile.availability,
    preferredWorkWindows: profile.preferredWorkWindows,
    blockedPeriods: profile.blockedPeriods,
    shiftTemplates: profile.shiftTemplates,
    numbers: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key==='commuteBufferMinutes'&&profile.commuteConfigured===false?'':formatNumber(value)])) as Record<NumberField, string>,
  };
}

export function inputFromDraft(draft: ProfileDraft): WorkProfileInput {
  const { numbers, hourlyRateText, baseHourlyRate:_baseRate, ...rest } = draft;
  const parsed = Object.fromEntries(Object.entries(numbers).map(([key, text]) => {
    const value = parseNumber(text);
    return [key, value === null || Number.isNaN(value) ? null : value];
  })) as Record<NumberField, number | null>;
  const availability=mergeAvailability(rest.availability).map((window,index)=>({...window,id:rest.availability.find(old=>old.dayOfWeek===window.dayOfWeek&&old.startTime===window.startTime&&old.endTime===window.endTime)?.id??`normalized-${window.dayOfWeek}-${index}`}));
  return { ...rest,...(hourlyRateText===undefined?{}:{hourlyRatePln:parseNumber(hourlyRateText)}),availability, ...parsed };
}

/** Czy formularz różni się od zapisanego profilu (S23KC2S1P2-15, 3a: pytanie przy wyjściu bez zapisu). */
export function isDirty(draft: ProfileDraft | null, saved: WorkProfile | null): boolean {
  if (!draft || !saved) return false;
  const normalize = (value: ProfileDraft) => JSON.stringify({ ...value, profileVersion: '', numbers: Object.fromEntries(Object.entries(value.numbers).map(([key, text]) => [key, parseNumber(text)])) });
  return normalize(draft) !== normalize(draftFromProfile(saved));
}

const RANGE: Record<NumberField, (period: TargetPeriod) => string> = {
  minimumHours: () => `0–${LIMITS.weekHours} h`,
  maximumHours: () => `do ${LIMITS.weekHours} h`,
  targetHours: (period) => `do ${period === 'week' ? LIMITS.weekHours : LIMITS.monthHours} h na ${PERIOD_LABEL[period]}`,
  commuteBufferMinutes: () => `0–${LIMITS.commuteMinutes} min`,
  minimumRestMinutes: () => `0–${LIMITS.restMinutes} min`,
  minimumShiftMinutes: () => `${LIMITS.shiftMin}–${LIMITS.shiftMax} min`,
  maximumSlotMinutes: () => `${LIMITS.shiftMin}–${LIMITS.shiftMax} min`,
  maxHoursPerDay: () => `do ${LIMITS.dayHours} h`,
};

/** Komunikat dla kodu błędu z formularza albo z API (422). */
export function errorMessage(field: string, code: string, draft: ProfileDraft): string {
  const numberField = field as NumberField;
  const target = parseNumber(draft.numbers.targetHours);
  const weekly = target === null || Number.isNaN(target) ? '' : ` (ok. ${formatNumber(weeklyHours(target, draft.targetPeriod))} h tygodniowo)`;
  switch (code) {
    case 'required': return 'Uzupełnij to pole.';
    case 'not_a_number': return 'Wpisz liczbę, np. 20 albo 20,5.';
    case 'negative': return 'Wartość nie może być ujemna.';
    case 'must_be_positive': return 'Wartość musi być większa od zera.';
    case 'out_of_range': return RANGE[numberField] ? `Dopuszczalny zakres: ${RANGE[numberField](draft.targetPeriod)}.` : 'Wartość jest poza dopuszczalnym zakresem.';
    case 'not_whole_number': return 'Podaj pełne minuty.';
    case 'min_greater_than_max': return 'Minimum nie może być większe niż maksimum.';
    case 'target_below_min': return `Cel${weekly} jest niższy niż minimum godzin.`;
    case 'target_above_max': return `Cel${weekly} jest wyższy niż maksimum godzin.`;
    case 'shorter_than_minimum': return 'Maksymalna długość zmiany nie może być krótsza niż minimalna.';
    case 'end_before_start': return field.startsWith('availability')?'Początek i koniec nie mogą być jednakowe.':'Koniec musi być później niż początek.';
    case 'invalid_hourly_rate':return 'Stawka PLN musi być nieujemna, mieć najwyżej dwa miejsca po przecinku i wynosić do 9 999 999 999,99.';
    case 'rate_kind_required':return 'Wybierz brutto albo netto.';
    case 'overlap':return 'Przedziały dostępności nakładają się.';
    case 'duplicate_id': return 'Ten wpis się powtarza.';
    case 'invalid_time': return 'Wpisz godzinę w formacie GG:MM, np. 08:00.';
    default: return 'Popraw to pole.';
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Walidacja formularza: zwraca kody błędów przy polach (te same co w API) i 'not_a_number' / 'invalid_time' dla tekstu. */
export function validateDraft(draft: ProfileDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if(draft.hourlyRateText!==undefined){const rate=parseNumber(draft.hourlyRateText);if(rate!==null){if(!Number.isFinite(rate)||rate<0||rate>9999999999.99||Number(rate.toFixed(2))!==rate)errors.hourlyRatePln='invalid_hourly_rate';if(!draft.rateKind && rate!==draft.baseHourlyRate)errors.rateKind='rate_kind_required';}}
  const value = (field: NumberField) => parseNumber(draft.numbers[field]);
  const check = (field: NumberField, kind: 'hours' | 'minutes', min: number, max: number, positive = false) => {
    const current = value(field);
    if (current === null) errors[field] = 'required';
    else if (Number.isNaN(current)) errors[field] = 'not_a_number';
    else if (kind === 'minutes' && !Number.isInteger(current)) errors[field] = 'not_whole_number';
    else if (current < 0) errors[field] = 'negative';
    else if (positive && roundHours(current) === 0) errors[field] = 'must_be_positive';
    else if (current < min || current > max) errors[field] = 'out_of_range';
  };
  check('minimumHours', 'hours', 0, LIMITS.weekHours);
  check('maximumHours', 'hours', 0, LIMITS.weekHours, true);
  const min = value('minimumHours'), max = value('maximumHours');
  const limitsValid = !errors.minimumHours && !errors.maximumHours;
  if (limitsValid && min! > max!) errors.minimumHours = 'min_greater_than_max';
  check('targetHours', 'hours', 0, draft.targetPeriod === 'week' ? LIMITS.weekHours : LIMITS.monthHours, true);
  if (!errors.targetHours && limitsValid && !errors.minimumHours) {
    const weekly = weeklyHours(value('targetHours')!, draft.targetPeriod);
    if (weekly < min! - 0.005) errors.targetHours = 'target_below_min';
    else if (weekly > max! + 0.005) errors.targetHours = 'target_above_max';
  }
  check('commuteBufferMinutes', 'minutes', 0, LIMITS.commuteMinutes);
  check('minimumRestMinutes', 'minutes', 0, LIMITS.restMinutes);
  check('minimumShiftMinutes', 'minutes', LIMITS.shiftMin, LIMITS.shiftMax);
  check('maximumSlotMinutes', 'minutes', LIMITS.shiftMin, LIMITS.shiftMax);
  if (!errors.minimumShiftMinutes && !errors.maximumSlotMinutes && value('maximumSlotMinutes')! < value('minimumShiftMinutes')!) errors.maximumSlotMinutes = 'shorter_than_minimum';
  check('maxHoursPerDay', 'hours', 0, LIMITS.dayHours, true);

  draft.availability.forEach((window, index) => {
    const key = `availability.${index}`;
    if (!TIME.test(window.startTime) || (!TIME.test(window.endTime) && window.endTime !== '24:00')) errors[key] = 'invalid_time';
    else if (window.endTime === window.startTime) errors[key] = 'end_before_start';
  });
  draft.shiftTemplates.forEach((template, index) => {
    const key = `shiftTemplates.${index}`;
    if (!TIME.test(template.startTime) || !TIME.test(template.endTime)) errors[key] = 'invalid_time';
    else {
      const start = minutesOf(template.startTime), end = minutesOf(template.endTime);
      if (template.endsNextDay ? end >= start : end <= start) errors[key] = 'end_before_start';
    }
  });
  return errors;
}

export type TargetProgressState = { percent: number; status: 'below' | 'reached' | 'above'; difference: number };

/** Licznik zaplanowanych minut względem celu (S23KC2S1P2-156). */
export function targetProgress(plannedMinutes: number, targetMinutes: number): TargetProgressState {
  const percent = targetMinutes > 0 ? Math.round((plannedMinutes / targetMinutes) * 100) : 0;
  const difference = plannedMinutes - targetMinutes;
  return { percent, status: difference < 0 ? 'below' : difference === 0 ? 'reached' : 'above', difference: Math.abs(difference) };
}
