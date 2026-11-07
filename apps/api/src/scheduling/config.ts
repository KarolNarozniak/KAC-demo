import type { PenaltyConfig } from './types.js';

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export const DEFAULT_SCHEDULER_PENALTIES: PenaltyConfig = {
  optionalLecturePenalty: nonNegativeInteger(process.env.SCHEDULER_OPTIONAL_LECTURE_PENALTY, 10),
  extraWorkdayPenalty: nonNegativeInteger(process.env.SCHEDULER_EXTRA_WORKDAY_PENALTY, 2),
  candidateStepMinutes: 30,
};
