export type WorkMode = 'elastyczny' | 'zmianowy';
export type SolutionStatus = 'target_met' | 'proven_infeasible' | 'not_found';
export type ScheduleCategory = 'Class' | 'Work' | 'Personal';

export interface PlanningProfile {
  id: string;
  userId: string;
  calendarId: string;
  timeZone: string;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
  hourlyRatePln: number;
  commuteBufferMinutes: number;
  minimumRestMinutes: number;
  mode: WorkMode;
  minimumShiftMinutes: number;
  maximumSlotMinutes: number;
}

export interface AvailabilityWindow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface PreferredWorkWindow {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  weight: number;
}

export interface BlockedPeriod {
  id: string;
  type: string;
  start: string;
  end: string;
  reason?: string;
}

export interface PlanningEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  category: ScheduleCategory;
  mandatory: boolean;
  repeatWeekly: boolean;
  seriesEndDate?: string | null;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  endsNextDay: boolean;
  daysOfWeek: number[];
  active: boolean;
}

export interface PlanningContext {
  profile: PlanningProfile;
  availability: AvailabilityWindow[];
  preferredWorkWindows: PreferredWorkWindow[];
  blockedPeriods: BlockedPeriod[];
  events: PlanningEvent[];
  shiftTemplates: ShiftTemplate[];
}

export interface PlannerOverrides {
  mode?: WorkMode;
  minimumHours?: number;
  targetHours?: number;
  maximumHours?: number;
  commuteBufferMinutes?: number;
  minimumRestMinutes?: number;
  minimumShiftMinutes?: number;
  maximumSlotMinutes?: number;
  shiftTemplates?: ShiftTemplate[];
  workaholic?: boolean;
}

export interface CandidateShift {
  candidateId: string;
  title: string;
  start: string;
  end: string;
  startLocal: string;
  endLocal: string;
  durationMinutes: number;
  workDate: string;
  mode: WorkMode;
  templateId?: string;
  calendarEventId?: string;
  optionalLectureIds: string[];
  softPenalty: number;
}

export interface ScheduleViolation {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  candidateIds: string[];
  eventIds: string[];
  details: Record<string, unknown>;
}

export interface ScheduleGenerationResult {
  scheduleId?: string;
  version?: number;
  isApproved: boolean;
  approvedAt?: string;
  maximumCapacityMinutes: number;
  weekStart: string;
  timeZone: string;
  mode: WorkMode;
  solutionStatus: SolutionStatus;
  minimumMinutes: number;
  targetMinutes: number;
  maximumMinutes: number;
  existingWorkMinutes: number;
  proposedMinutes: number;
  totalMinutes: number;
  shortfallMinutes: number;
  minimumShortfallMinutes: number;
  upperBoundMinutes: number;
  optionalLecturesSkipped: string[];
  workdaysUsed: number;
  shifts: CandidateShift[];
  violations: ScheduleViolation[];
  generatedAt: string;
  generatorVersion: 'greedy-v1';
  parameters: PlannerOverrides;
}

export interface PenaltyConfig {
  optionalLecturePenalty: number;
  extraWorkdayPenalty: number;
  candidateStepMinutes: number;
}

export interface ManualShiftInput {
  id: string;
  startLocal: string;
  endLocal: string;
}

export interface ValidationResult {
  errors: ScheduleViolation[];
  warnings: ScheduleViolation[];
  minimumMinutes: number;
  targetMinutes: number;
  maximumMinutes: number;
  existingWorkMinutes: number;
  proposedMinutes: number;
  totalMinutes: number;
  shortfallMinutes: number;
  minimumShortfallMinutes: number;
}
