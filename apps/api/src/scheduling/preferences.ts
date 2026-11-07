// Punktowanie preferowanych godzin (user story: określenie preferowanych godzin).
// Uruchamiać DOPIERO po odrzuceniu kandydatów łamiących twarde ograniczenia
// (np. checkWeeklyWorkLimit z ./constraints.ts, kolizje z obowiązkowymi zajęciami) — ta funkcja nie zna ograniczeń twardych.

export type PreferenceWeight = { dayOfWeek: number; startTime: string; endTime: string; weight: number };
export type ShiftCandidate = { dayOfWeek: number; startTime: string; endTime: string; start: Date };

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function overlapMinutes(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = Math.max(toMinutes(aStart), toMinutes(bStart));
  const end = Math.min(toMinutes(aEnd), toMinutes(bEnd));
  return Math.max(0, end - start);
}

/** Suma długości przecięcia (w minutach) z każdą preferencją tego dnia, pomnożona przez jej wagę. Deterministyczne. */
export function scoreShiftPreferences(candidate: { dayOfWeek: number; startTime: string; endTime: string }, preferences: PreferenceWeight[]): number {
  let score = 0;
  for (const preference of preferences) {
    if (preference.dayOfWeek !== candidate.dayOfWeek) continue;
    score += overlapMinutes(candidate.startTime, candidate.endTime, preference.startTime, preference.endTime) * preference.weight;
  }
  return score;
}

/** Sortuje po wyniku malejąco; remisy rozstrzyga wcześniejszy termin — deterministyczne, bez losowości. */
export function rankShiftCandidates<T extends ShiftCandidate>(candidates: T[], preferences: PreferenceWeight[]): Array<T & { score: number }> {
  return candidates
    .map((candidate) => ({ ...candidate, score: scoreShiftPreferences(candidate, preferences) }))
    .sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
}