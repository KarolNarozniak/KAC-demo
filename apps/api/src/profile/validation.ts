// Reguły limitu godzin pracy w profilu (t_profile_pracy) — lustrzane odbicie checków z
// database/migrations/001_initial_model.sql i 003_work_profile_target_range.sql.

export type WeeklyHourLimits = {
  minGodzinTydzien: number | null;
  celGodzinTydzien: number | null;
  maxGodzinTydzien: number | null;
};

export class ProfileValidationError extends Error {
  constructor(message: string, public field?: string) { super(message); }
}

export class ProfileVersionConflictError extends Error {
  constructor() { super('profile_version_conflict'); }
}

export function validateMinRestMinutes(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ProfileValidationError('invalid_min_rest_minutes', 'minRestMinutes');
  }
}

export function validateWeeklyHourLimits(input: WeeklyHourLimits): void {
  const { minGodzinTydzien: min, celGodzinTydzien: cel, maxGodzinTydzien: max } = input;
  for (const [field, value] of [
    ['minGodzinTydzien', min], ['celGodzinTydzien', cel], ['maxGodzinTydzien', max],
  ] as const) {
    if (value !== null && !Number.isFinite(value)) throw new ProfileValidationError('invalid_weekly_hours', field);
  }
  if (max !== null && max <= 0) throw new ProfileValidationError('max_hours_must_be_positive', 'maxGodzinTydzien');
  if (min !== null && min < 0) throw new ProfileValidationError('invalid_weekly_hours', 'minGodzinTydzien');
  if (min !== null && max !== null && min > max) throw new ProfileValidationError('min_above_max', 'minGodzinTydzien');
  if (cel !== null) {
    if (cel < 0) throw new ProfileValidationError('invalid_weekly_hours', 'celGodzinTydzien');
    if (min !== null && cel < min) throw new ProfileValidationError('target_below_min', 'celGodzinTydzien');
    if (max !== null && cel > max) throw new ProfileValidationError('target_above_max', 'celGodzinTydzien');
  }
}