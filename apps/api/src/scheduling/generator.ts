import { DEFAULT_SCHEDULER_PENALTIES } from './config.js';
import { addLocalDays, expandEventsForWeek, localDateKey, localDateTimeString, localInstant, minutesOfDay, overlap, overlapMinutes, timeOfDay, validWeekStart, weekBounds } from './time.js';
import type {
  AvailabilityWindow, BlockedPeriod, CandidateShift, ManualShiftInput, PlanningContext, PlannerOverrides,
  PreferredWorkWindow, ScheduleGenerationResult, ScheduleViolation, SolutionStatus, ValidationResult, WorkMode,
} from './types.js';

type Interval = { id: string; title: string; start: Date; end: Date };
type EffectiveProfile = {
  mode: WorkMode;
  minimumMinutes: number;
  targetMinutes: number;
  maximumMinutes: number;
  commuteBufferMinutes: number;
  minimumRestMinutes: number;
  minimumShiftMinutes: number;
  maximumSlotMinutes: number;
  templates: PlanningContext['shiftTemplates'];
};

function hoursToMinutes(value: number): number {
  return Math.round(value * 60);
}

function profileFor(context: PlanningContext, overrides: PlannerOverrides): EffectiveProfile {
  const p = context.profile;
  const result: EffectiveProfile = {
    mode: overrides.mode ?? p.mode,
    minimumMinutes: hoursToMinutes(overrides.minimumHours ?? p.minimumHours),
    targetMinutes: hoursToMinutes(overrides.targetHours ?? p.targetHours),
    maximumMinutes: hoursToMinutes(overrides.maximumHours ?? p.maximumHours),
    commuteBufferMinutes: overrides.commuteBufferMinutes ?? p.commuteBufferMinutes,
    minimumRestMinutes: overrides.minimumRestMinutes ?? p.minimumRestMinutes,
    minimumShiftMinutes: overrides.minimumShiftMinutes ?? p.minimumShiftMinutes,
    maximumSlotMinutes: overrides.maximumSlotMinutes ?? p.maximumSlotMinutes,
    templates: overrides.shiftTemplates ?? context.shiftTemplates,
  };
  if (result.minimumMinutes < 0 || result.targetMinutes < result.minimumMinutes || result.maximumMinutes < result.targetMinutes) {
    throw new Error('Ustawienia muszą spełniać: 0 ≤ minimum ≤ cel ≤ maksimum w tygodniu.');
  }
  if (result.commuteBufferMinutes < 0 || result.minimumRestMinutes < 0 || result.minimumShiftMinutes < 120 || result.maximumSlotMinutes < result.minimumShiftMinutes) {
    throw new Error('Niepoprawne ustawienia bufora, odpoczynku lub długości slotu.');
  }
  return result;
}

function asIntervals(periods: BlockedPeriod[]): Interval[] {
  return periods.flatMap((period) => {
    const start = new Date(period.start), end = new Date(period.end);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start
      ? [{ id: period.id, title: period.reason ?? period.type, start, end }]
      : [];
  });
}

function padInterval(interval: Interval, minutes: number): Interval {
  const pad = minutes * 60_000;
  return { ...interval, start: new Date(interval.start.getTime() - pad), end: new Date(interval.end.getTime() + pad) };
}

function availabilityRanges(windows: AvailabilityWindow[], weekStart: string, timeZone: string): Interval[] {
  const result: Interval[] = [];
  // Extra Monday covers an overnight shift beginning on Sunday.
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const date = new Date(Date.UTC(Number(weekStart.slice(0, 4)), Number(weekStart.slice(5, 7)) - 1, Number(weekStart.slice(8, 10)) + dayOffset));
    const dateKey = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay() || 7;
    for (const window of windows.filter((item) => item.dayOfWeek === weekday)) {
      const start = localInstant(dateKey, window.startTime, timeZone);
      let end = localInstant(dateKey, window.endTime, timeZone);
      if (start && end && end <= start) {
        const next = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
        end = localInstant(next, window.endTime, timeZone);
      }
      if (start && end && end > start) result.push({ id: window.id, title: 'Dostępność', start, end });
    }
  }
  return result;
}

function intervalCovered(start: Date, end: Date, ranges: Interval[]): boolean {
  let cursor = start.getTime();
  const sorted = ranges.filter((range) => range.end > start && range.start < end).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const range of sorted) {
    if (range.start.getTime() > cursor) return false;
    cursor = Math.max(cursor, range.end.getTime());
    if (cursor >= end.getTime()) return true;
  }
  return false;
}

function toCandidate(args: {
  id: string; start: Date; end: Date; startLocal: string; endLocal: string;
  durationMinutes: number; workDate: string; mode: WorkMode; templateId?: string; softConflicts: string[];
}): CandidateShift {
  return {
    candidateId: args.id,
    title: 'Praca',
    start: args.start.toISOString(),
    end: args.end.toISOString(),
    startLocal: args.startLocal,
    endLocal: args.endLocal,
    durationMinutes: args.durationMinutes,
    workDate: args.workDate,
    mode: args.mode,
    templateId: args.templateId,
    optionalLectureIds: [...new Set(args.softConflicts)].sort(),
    softPenalty: 0,
  };
}

function dayPreferredPenalty(candidate: CandidateShift, preferences: PreferredWorkWindow[]): number {
  const day = new Date(`${candidate.workDate}T00:00:00Z`).getUTCDay() || 7;
  const windows = preferences.filter((item) => item.dayOfWeek === day);
  if (!windows.length) return 0;
  const start = minutesOfDay(candidate.startLocal.slice(11));
  const endDate = candidate.endLocal.slice(0, 10);
  const end = minutesOfDay(candidate.endLocal.slice(11));
  const sameDay = endDate === candidate.workDate;
  const matches = windows.filter((window) => {
    const from = minutesOfDay(window.startTime), to = minutesOfDay(window.endTime);
    return sameDay && start !== null && end !== null && from !== null && to !== null && start >= from && end <= to;
  });
  const highest = Math.max(...windows.map((item) => item.weight));
  return matches.length ? highest - Math.max(...matches.map((item) => item.weight)) : highest;
}

function buildCandidates(context: PlanningContext, weekStart: string, profile: EffectiveProfile, includeCandidates = true) {
  const expandedEvents = expandEventsForWeek(context, weekStart);
  const availability = availabilityRanges(context.availability, weekStart, context.profile.timeZone);
  const hardBlocks = asIntervals(context.blockedPeriods);
  const optionalLectures: Interval[] = [];
  const existingWork: Interval[] = [];

  for (const event of expandedEvents) {
    const interval = { id: event.id, title: event.title, start: event.occurrenceStart, end: event.occurrenceEnd };
    if (event.category === 'Class' && !event.mandatory) {
      // Optional lectures are not a hard blocker; overlapping them costs points in the second pass.
      optionalLectures.push(padInterval(interval, profile.commuteBufferMinutes));
    } else if (event.category === 'Work') {
      existingWork.push(interval);
      hardBlocks.push(padInterval(interval, profile.commuteBufferMinutes + profile.minimumRestMinutes));
    } else {
      hardBlocks.push(padInterval(interval, profile.commuteBufferMinutes));
    }
  }

  const candidates: CandidateShift[] = [];
  const timeZone = context.profile.timeZone;
  const weekEnd = new Date(Date.UTC(Number(weekStart.slice(0, 4)), Number(weekStart.slice(5, 7)) - 1, Number(weekStart.slice(8, 10)) + 7));

  const pushCandidate = (candidate: CandidateShift) => {
    if (candidate.start < weekBounds(weekStart, timeZone).start.toISOString() || new Date(candidate.end) <= new Date(candidate.start)) return;
    if (new Date(candidate.start) >= weekEnd) return;
    if (!intervalCovered(new Date(candidate.start), new Date(candidate.end), availability)) return;
    if (hardBlocks.some((block) => overlap(new Date(candidate.start), new Date(candidate.end), block.start, block.end))) return;
    candidate.optionalLectureIds = optionalLectures
      .filter((event) => overlap(new Date(candidate.start), new Date(candidate.end), event.start, event.end))
      .map((event) => event.id);
    candidate.softPenalty = candidate.optionalLectureIds.length * DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty;
    candidates.push(candidate);
  };

  if (!includeCandidates) {
    // Manual validation uses the same blocks and availability, without enumerating every possible slot.
  } else if (profile.mode === 'elastyczny') {
    const step = DEFAULT_SCHEDULER_PENALTIES.candidateStepMinutes;
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dayDate = new Date(Date.UTC(Number(weekStart.slice(0, 4)), Number(weekStart.slice(5, 7)) - 1, Number(weekStart.slice(8, 10)) + dayOffset));
      const dateKey = dayDate.toISOString().slice(0, 10);
      const day = dayDate.getUTCDay() || 7;
      for (const window of context.availability.filter((item) => item.dayOfWeek === day)) {
        const from = minutesOfDay(window.startTime), to = minutesOfDay(window.endTime);
        if (from === null || to === null || to <= from) continue;
        for (let startMinute = from; startMinute + profile.minimumShiftMinutes <= to; startMinute += step) {
          const startTime = `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`;
          const start = localInstant(dateKey, startTime, timeZone);
          if (!start) continue;
          for (let duration = profile.minimumShiftMinutes; duration <= Math.min(profile.maximumSlotMinutes, to - startMinute); duration += step) {
            const endMinute = startMinute + duration;
            if (endMinute >= 1440) continue;
            const endTime = `${String(Math.floor(endMinute / 60)).padStart(2, '0')}:${String(endMinute % 60).padStart(2, '0')}`;
            const end = localInstant(dateKey, endTime, timeZone);
            if (!end || end <= start) continue;
            pushCandidate(toCandidate({
              id: `flex-${dateKey}-${startTime.replace(':', '')}-${duration}`,
              start,
              end,
              startLocal: `${dateKey}T${startTime}`,
              endLocal: `${dateKey}T${endTime}`,
              durationMinutes: duration,
              workDate: dateKey,
              mode: 'elastyczny',
              softConflicts: [],
            }));
          }
        }
      }
    }
  } else {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dayDate = new Date(Date.UTC(Number(weekStart.slice(0, 4)), Number(weekStart.slice(5, 7)) - 1, Number(weekStart.slice(8, 10)) + dayOffset));
      const dateKey = dayDate.toISOString().slice(0, 10);
      const day = dayDate.getUTCDay() || 7;
      for (const template of profile.templates.filter((item) => item.active && item.daysOfWeek.includes(day))) {
        const startMinute = minutesOfDay(template.startTime), endMinute = minutesOfDay(template.endTime);
        if (startMinute === null || endMinute === null) continue;
        const duration = endMinute - startMinute + (template.endsNextDay ? 1440 : 0);
        if (duration < profile.minimumShiftMinutes || (!template.endsNextDay && endMinute <= startMinute) || (template.endsNextDay && endMinute >= startMinute)) continue;
        const endDate = template.endsNextDay ? addLocalDays(dateKey, 1) : dateKey;
        const start = localInstant(dateKey, template.startTime, timeZone);
        const end = localInstant(endDate, template.endTime, timeZone);
        if (!start || !end || end <= start) continue;
        pushCandidate(toCandidate({
          id: `shift-${template.id}-${dateKey}`,
          start,
          end,
          startLocal: `${dateKey}T${template.startTime}`,
          endLocal: `${endDate}T${template.endTime}`,
          durationMinutes: duration,
          workDate: dateKey,
          mode: 'zmianowy',
          templateId: template.id,
          softConflicts: [],
        }));
      }
    }
  }

  const { start: weekStartInstant, end: weekEndInstant } = weekBounds(weekStart, timeZone);
  const existingWorkMinutes = existingWork.reduce((sum, interval) =>
    sum + overlapMinutes(interval.start, interval.end, weekStartInstant, weekEndInstant), 0);
  const existingDays = new Set(existingWork
    .filter((interval) => interval.end > weekStartInstant && interval.start < weekEndInstant)
    .map((interval) => localDateTimeString(interval.start, timeZone).slice(0, 10)));

  return { candidates, hardBlocks, optionalLectures, existingWork, existingWorkMinutes, existingDays, weekStartInstant, weekEndInstant };
}

function canAdd(candidate: CandidateShift, selected: CandidateShift[], hardBlocks: Interval[], profile: EffectiveProfile) {
  const start = new Date(candidate.start), end = new Date(candidate.end);
  if (hardBlocks.some((block) => overlap(start, end, block.start, block.end))) return false;
  const requiredGap = (profile.minimumRestMinutes + profile.commuteBufferMinutes) * 60_000;
  return selected.every((item) => {
    const itemStart = new Date(item.start), itemEnd = new Date(item.end);
    return end.getTime() + requiredGap <= itemStart.getTime() || itemEnd.getTime() + requiredGap <= start.getTime();
  });
}

function selectCandidates(candidates: CandidateShift[], context: PlanningContext, profile: EffectiveProfile,
  existingDays: Set<string>, hardBlocks: Interval[], totalBefore: number): CandidateShift[] {
  const selected: CandidateShift[] = [];
  const days = new Set(existingDays);
  let total = totalBefore;
  const choose = (allowOptional: boolean) => {
    while (total < profile.targetMinutes && total < profile.maximumMinutes) {
      const viable = candidates.filter((candidate) => !selected.some((chosen) => chosen.candidateId === candidate.candidateId))
        .filter((candidate) => allowOptional || candidate.optionalLectureIds.length === 0)
        .filter((candidate) => total + candidate.durationMinutes <= profile.maximumMinutes)
        .filter((candidate) => canAdd(candidate, selected, hardBlocks, profile))
        .map((candidate) => {
          const optionalPenalty = candidate.optionalLectureIds.length * DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty;
          const dayPenalty = profile.mode === 'elastyczny' && !days.has(candidate.workDate)
            ? DEFAULT_SCHEDULER_PENALTIES.extraWorkdayPenalty : 0;
          const preferred = dayPreferredPenalty(candidate, context.preferredWorkWindows);
          const overshoot = Math.max(0, total + candidate.durationMinutes - profile.targetMinutes);
          return { candidate, cost: optionalPenalty + dayPenalty + preferred, overshoot };
        })
        .sort((a, b) => a.cost - b.cost || a.overshoot - b.overshoot || b.candidate.durationMinutes - a.candidate.durationMinutes ||
          a.candidate.start.localeCompare(b.candidate.start) || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
      if (!viable.length) return;
      const chosen = viable[0]?.candidate;
      if (!chosen) return;
      selected.push(chosen);
      days.add(chosen.workDate);
      total += chosen.durationMinutes;
    }
  };
  choose(false);
  if (total < profile.targetMinutes) choose(true);
  return selected.sort((a, b) => a.start.localeCompare(b.start) || a.candidateId.localeCompare(b.candidateId));
}

export function generateSchedule(context: PlanningContext, weekStart: string, overrides: PlannerOverrides = {}): ScheduleGenerationResult {
  if (!validWeekStart(weekStart)) throw new Error('weekStart musi być poniedziałkiem w lokalnym formacie YYYY-MM-DD.');
  const profile = profileFor(context, overrides);
  const generated = buildCandidates(context, weekStart, profile);
  const existingWorkMinutes = generated.existingWorkMinutes;
  const candidates = generated.candidates;
  const selected = existingWorkMinutes > profile.maximumMinutes
    ? []
    : selectCandidates(candidates, context, profile, generated.existingDays, generated.hardBlocks, existingWorkMinutes);
  const proposedMinutes = selected.reduce((sum, shift) => sum + shift.durationMinutes, 0);
  const totalMinutes = existingWorkMinutes + proposedMinutes;
  const shortfallMinutes = Math.max(0, profile.targetMinutes - totalMinutes);
  const minimumShortfallMinutes = Math.max(0, profile.minimumMinutes - totalMinutes);
  // Summing all individually legal candidates is an overestimate (it ignores mutual overlap), so it is a safe upper bound.
  const upperBoundMinutes = Math.min(profile.maximumMinutes, existingWorkMinutes + candidates.reduce((sum, item) => sum + item.durationMinutes, 0));
  const solutionStatus: SolutionStatus = existingWorkMinutes > profile.maximumMinutes
    ? 'proven_infeasible'
    : totalMinutes >= profile.targetMinutes
      ? 'target_met'
      : upperBoundMinutes < profile.targetMinutes ? 'proven_infeasible' : 'not_found';
  const optionalLecturesSkipped = [...new Set(selected.flatMap((shift) => shift.optionalLectureIds))].sort();
  const violations: ScheduleViolation[] = [];
  if (optionalLecturesSkipped.length) violations.push({
    code: 'optional_lectures_skipped', severity: 'warning',
    message: 'Aby zbliżyć się do celu, propozycja pomija część nieobowiązkowych zajęć.',
    candidateIds: selected.filter((shift) => shift.optionalLectureIds.length).map((shift) => shift.candidateId),
    eventIds: optionalLecturesSkipped,
    details: { penaltyPerLecture: DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty, totalPenalty: optionalLecturesSkipped.length * DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty },
  });
  if (minimumShortfallMinutes > 0) violations.push({
    code: 'minimum_hours_shortfall', severity: 'warning',
    message: `Do minimalnego wymiaru brakuje ${minimumShortfallMinutes} minut.`,
    candidateIds: [], eventIds: [], details: { minimumMinutes: profile.minimumMinutes, totalMinutes, minimumShortfallMinutes },
  });
  if (shortfallMinutes > 0) violations.push({
    code: solutionStatus === 'proven_infeasible' ? 'upper_bound_below_target' : 'target_shortfall',
    severity: 'warning',
    message: solutionStatus === 'proven_infeasible'
      ? 'Górna granica dostępnych godzin jest niższa od celu.'
      : 'Heurystyka nie znalazła pełnego grafiku; cel może być osiągalny po zmianie ustawień.',
    candidateIds: [], eventIds: [],
    details: { targetMinutes: profile.targetMinutes, totalMinutes, upperBoundMinutes },
  });
  if (existingWorkMinutes > profile.maximumMinutes) violations.push({
    code: 'existing_work_exceeds_maximum', severity: 'error',
    message: 'Już zapisane zmiany przekraczają maksymalny tygodniowy limit.',
    candidateIds: [], eventIds: generated.existingWork.map((event) => event.id),
    details: { maximumMinutes: profile.maximumMinutes, existingWorkMinutes },
  });

  const inputSnapshot = {
    mode: profile.mode,
    minimumMinutes: profile.minimumMinutes,
    targetMinutes: profile.targetMinutes,
    maximumMinutes: profile.maximumMinutes,
    commuteBufferMinutes: profile.commuteBufferMinutes,
    minimumRestMinutes: profile.minimumRestMinutes,
    minimumShiftMinutes: profile.minimumShiftMinutes,
    maximumSlotMinutes: profile.maximumSlotMinutes,
    shiftTemplateIds: profile.templates.map((template) => template.id),
    optionalLecturePenalty: DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty,
    extraWorkdayPenalty: DEFAULT_SCHEDULER_PENALTIES.extraWorkdayPenalty,
  };
  return {
    weekStart,
    timeZone: context.profile.timeZone,
    mode: profile.mode,
    solutionStatus,
    minimumMinutes: profile.minimumMinutes,
    targetMinutes: profile.targetMinutes,
    maximumMinutes: profile.maximumMinutes,
    existingWorkMinutes,
    proposedMinutes,
    totalMinutes,
    shortfallMinutes,
    minimumShortfallMinutes,
    upperBoundMinutes,
    optionalLecturesSkipped,
    workdaysUsed: new Set([...generated.existingDays, ...selected.map((shift) => shift.workDate)]).size,
    shifts: selected,
    violations,
    generatedAt: new Date().toISOString(),
    generatorVersion: 'greedy-v1',
    parameters: inputSnapshot,
  };
}

export function validateSchedule(context: PlanningContext, weekStart: string, shifts: ManualShiftInput[], overrides: PlannerOverrides = {}): ValidationResult {
  const profile = profileFor(context, overrides);
  if (!validWeekStart(weekStart)) throw new Error('weekStart musi być poniedziałkiem w lokalnym formacie YYYY-MM-DD.');
  const generated = buildCandidates(context, weekStart, profile, false);
  const { start: weekStartInstant, end: weekEndInstant } = weekBounds(weekStart, context.profile.timeZone);
  const weekEndForNightShift = localInstant(addLocalDays(weekStart, 8), '00:00', context.profile.timeZone) ?? weekEndInstant;
  const errors: ScheduleViolation[] = [];
  const warnings: ScheduleViolation[] = [];
  const normalized: CandidateShift[] = [];

  for (const input of shifts) {
    const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.startLocal);
    const endMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.endLocal);
    if (!startMatch || !endMatch) {
      errors.push({ code: 'invalid_time', severity: 'error', message: 'Podaj lokalną datę i godzinę początku oraz końca zmiany.', candidateIds: [input.id], eventIds: [], details: {} });
      continue;
    }
    const startDate = startMatch[1]!, startTime = startMatch[2]!;
    const endDate = endMatch[1]!, endTime = endMatch[2]!;
    const start = localInstant(startDate, startTime, context.profile.timeZone);
    const end = localInstant(endDate, endTime, context.profile.timeZone);
    const startMinute = minutesOfDay(startTime) ?? 0;
    const endMinute = minutesOfDay(endTime) ?? 0;
    const dayOffset = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
    const wallMinutes = dayOffset * 1440 + endMinute - startMinute;
    if (!start || !end || end <= start || wallMinutes <= 0) {
      errors.push({ code: 'invalid_time', severity: 'error', message: 'Koniec zmiany musi następować po jej początku.', candidateIds: [input.id], eventIds: [], details: {} });
      continue;
    }
    if (start < weekStartInstant || start >= weekEndInstant || end > weekEndForNightShift) {
      errors.push({ code: 'outside_week', severity: 'error', message: 'Zmiana musi zaczynać się w wybranym tygodniu; może kończyć się najwyżej następnego dnia.', candidateIds: [input.id], eventIds: [], details: {} });
      continue;
    }
    if (wallMinutes < profile.minimumShiftMinutes) {
      errors.push({ code: 'below_minimum_slot', severity: 'error', message: `Minimalna długość zmiany to ${profile.minimumShiftMinutes} minut.`, candidateIds: [input.id], eventIds: [], details: { wallMinutes } });
    }
    if (profile.mode === 'elastyczny' && wallMinutes > profile.maximumSlotMinutes) {
      errors.push({ code: 'above_maximum_slot', severity: 'error', message: `Maksymalna długość zmiany to ${profile.maximumSlotMinutes} minut.`, candidateIds: [input.id], eventIds: [], details: { wallMinutes } });
    }
    if (!intervalCovered(start, end, availabilityRanges(context.availability, weekStart, context.profile.timeZone))) {
      errors.push({ code: 'outside_availability', severity: 'error', message: 'Zmiana wykracza poza dostępność studenta.', candidateIds: [input.id], eventIds: [], details: {} });
    }
    const hardConflict = generated.hardBlocks.find((block) => overlap(start, end, block.start, block.end));
    if (hardConflict) errors.push({ code: 'hard_conflict', severity: 'error', message: `Zmiana koliduje z blokadą: ${hardConflict.title}.`, candidateIds: [input.id], eventIds: [hardConflict.id], details: {} });
    const optionalIds = generated.optionalLectures.filter((event) => overlap(start, end, event.start, event.end)).map((event) => event.id).sort();
    if (optionalIds.length) warnings.push({
      code: 'optional_lecture_conflict', severity: 'warning',
      message: `Zmiana pomija ${optionalIds.length} nieobowiązkowe zajęcia.`,
      candidateIds: [input.id], eventIds: optionalIds,
      details: { penalty: optionalIds.length * DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty },
    });
    normalized.push({ candidateId: input.id, title: input.id, start: start.toISOString(), end: end.toISOString(), startLocal: input.startLocal, endLocal: input.endLocal, durationMinutes: wallMinutes, workDate: startDate, mode: profile.mode, optionalLectureIds: optionalIds, softPenalty: optionalIds.length * DEFAULT_SCHEDULER_PENALTIES.optionalLecturePenalty });
  }

  const gapMs = (profile.minimumRestMinutes + profile.commuteBufferMinutes) * 60_000;
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i], b = normalized[j];
      if (!a || !b) continue;
      const aStart = new Date(a.start), aEnd = new Date(a.end), bStart = new Date(b.start), bEnd = new Date(b.end);
      if (overlap(aStart, aEnd, bStart, bEnd) || (aEnd <= bStart && bStart.getTime() - aEnd.getTime() < gapMs) || (bEnd <= aStart && aStart.getTime() - bEnd.getTime() < gapMs)) {
        errors.push({ code: 'shift_overlap_or_rest', severity: 'error', message: 'Zmiany nakładają się lub nie zachowują bufora i odpoczynku.', candidateIds: [a.candidateId, b.candidateId], eventIds: [], details: {} });
      }
    }
  }

  const bounds = weekBounds(weekStart, context.profile.timeZone);
  const existingWorkMinutes = generated.existingWork.reduce((sum, event) => sum + overlapMinutes(event.start, event.end, bounds.start, bounds.end), 0);
  const proposedMinutes = normalized.reduce((sum, shift) => sum + shift.durationMinutes, 0);
  const totalMinutes = existingWorkMinutes + proposedMinutes;
  if (totalMinutes > profile.maximumMinutes) errors.push({ code: 'maximum_hours', severity: 'error', message: 'Łączny czas pracy przekracza maksymalny limit tygodniowy.', candidateIds: normalized.map((shift) => shift.candidateId), eventIds: [], details: { maximumMinutes: profile.maximumMinutes, totalMinutes } });
  if (totalMinutes < profile.minimumMinutes) warnings.push({ code: 'minimum_shortfall', severity: 'warning', message: 'Nie osiągnięto minimalnego tygodniowego wymiaru pracy.', candidateIds: normalized.map((shift) => shift.candidateId), eventIds: [], details: { minimumMinutes: profile.minimumMinutes, totalMinutes } });
  if (totalMinutes < profile.targetMinutes) warnings.push({ code: 'target_shortfall', severity: 'warning', message: 'Propozycja jest poniżej celu godzinowego.', candidateIds: normalized.map((shift) => shift.candidateId), eventIds: [], details: { targetMinutes: profile.targetMinutes, totalMinutes } });
  return { errors, warnings, minimumMinutes: profile.minimumMinutes, targetMinutes: profile.targetMinutes, maximumMinutes: profile.maximumMinutes, existingWorkMinutes, proposedMinutes, totalMinutes, shortfallMinutes: Math.max(0, profile.targetMinutes - totalMinutes), minimumShortfallMinutes: Math.max(0, profile.minimumMinutes - totalMinutes) };
}
