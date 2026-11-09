// Profil pracy (S23KC2S1P2-15) i cel godzin (S23KC2S1P2-39): model danych API.
import type { AvailabilityWindow, BlockedPeriod, PreferredWorkWindow, ShiftTemplate, WorkMode } from '../scheduling/types.js';

export type TargetPeriod = 'week' | 'month';

/** Pola liczbowe profilu. W treści żądania mogą być null – wtedy walidacja zwraca błąd „required” przy polu. */
export const NUMBER_FIELDS = [
  'minimumHours', 'targetHours', 'maximumHours', 'commuteBufferMinutes', 'minimumRestMinutes',
  'minimumShiftMinutes', 'maximumSlotMinutes', 'maxHoursPerDay',
] as const;
export type NumberField = typeof NUMBER_FIELDS[number];

/** Treść PUT /api/v1/work-profile: całe ustawienia profilu i wersja, na której pracował formularz. */
export type WorkProfileInput = Record<NumberField, number | null> & {
  profileVersion: string;
  mode: WorkMode;
  /** Okres, którego dotyczy targetHours (S23KC2S1P2-39). Domyślnie tydzień. */
  targetPeriod?: TargetPeriod;
  availability: AvailabilityWindow[];
  preferredWorkWindows: PreferredWorkWindow[];
  blockedPeriods: BlockedPeriod[];
  shiftTemplates: ShiftTemplate[];
};

/** Ustawienia po walidacji, gotowe do zapisu. */
export type ValidWorkProfile = Omit<WorkProfileInput, NumberField | 'targetPeriod'> & Record<NumberField, number> & {
  targetPeriod: TargetPeriod;
  /** Odpowiednik tygodniowy celu – trafia do cel_godzin_tydzien i jest używany przez generator grafiku. */
  weeklyTargetHours: number;
};

/** Odpowiedź GET/PUT /api/v1/work-profile. */
export type WorkProfile = Omit<ValidWorkProfile, 'weeklyTargetHours'> & {
  profileId: string;
  timeZone: string;
  /** Cel w wybranym okresie w pełnych minutach (S23KC2S1P2-154). */
  targetMinutes: number;
  weeklyTargetHours: number;
  weeklyTargetMinutes: number;
};

/** Kody błędów pól. Klucz to nazwa pola albo pole listy z indeksem, np. „availability.0”. */
export type FieldError =
  | 'required'
  | 'negative'
  | 'must_be_positive'
  | 'out_of_range'
  | 'not_whole_number'
  | 'min_greater_than_max'
  | 'target_below_min'
  | 'target_above_max'
  | 'shorter_than_minimum'
  | 'end_before_start'
  | 'duplicate_id'
  | 'overlap';

export const FIELD_ERRORS: readonly FieldError[] = [
  'required', 'negative', 'must_be_positive', 'out_of_range', 'not_whole_number', 'min_greater_than_max',
  'target_below_min', 'target_above_max', 'shorter_than_minimum', 'end_before_start', 'duplicate_id', 'overlap',
];

export type FieldErrors = Record<string, FieldError>;
