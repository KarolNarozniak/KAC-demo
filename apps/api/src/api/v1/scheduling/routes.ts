import type { FastifyInstance } from 'fastify';
import { generateSchedule, validateSchedule } from '../../../scheduling/generator.js';
import { freeWindows, listBlockingOccurrences } from '../../../scheduling/constraints.js';
import { expandEventsForWeek, localInstant, validWeekStart } from '../../../scheduling/time.js';
import { invalidScheduleSchema, scheduleResponseSchema } from './schemas.js';
import { ScheduleAlreadyApprovedError, ScheduleVersionConflictError, type ScheduleRepository } from '../../../scheduling/repository.js';
import type { CandidateShift, ManualShiftInput, PlannerOverrides, PlanningContext, ScheduleGenerationResult } from '../../../scheduling/types.js';

const schedulerOverridesSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['elastyczny', 'zmianowy'] },
    minimumHours: { type: 'number', minimum: 0, maximum: 80 }, targetHours: { type: 'number', minimum: 0, maximum: 80 }, maximumHours: { type: 'number', minimum: 0, maximum: 80 },
    commuteBufferMinutes: { type: 'integer', minimum: 0, maximum: 720 }, minimumRestMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
    minimumShiftMinutes: { type: 'integer', minimum: 120, maximum: 720 }, maximumSlotMinutes: { type: 'integer', minimum: 120, maximum: 720 },
    maxHoursPerDay: { type: 'number', exclusiveMinimum: 0, maximum: 24 }, workaholic: { type: 'boolean' },
    shiftTemplates: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'name', 'startTime', 'endTime', 'endsNextDay', 'daysOfWeek', 'active'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, name: { type: 'string', minLength: 1, maxLength: 80 },
        startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, endTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        endsNextDay: { type: 'boolean' }, daysOfWeek: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 7 } }, active: { type: 'boolean' } } } },
  },
} as const;
const weekStartSchema = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const idSchema = { type: 'string', minLength: 1, maxLength: 100 } as const;
const objectResponse = { type: 'object', additionalProperties: true } as const;
const generateSchema = { body: { type: 'object', required: ['weekStart', 'profileVersion'], additionalProperties: false,
  properties: { weekStart: weekStartSchema, profileVersion: { type: 'string', minLength: 1 }, confirmNoClasses: { type: 'boolean' }, overrides: schedulerOverridesSchema } } } as const;
const updateSchema = {
  params: { type: 'object', required: ['weekStart'], additionalProperties: false, properties: { weekStart: weekStartSchema } },
  body: { type: 'object', required: ['shifts', 'expectedVersion'], additionalProperties: false, properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    shifts: { type: 'array', maxItems: 14, items: { type: 'object', required: ['id', 'startLocal', 'endLocal'], additionalProperties: false,
      properties: { id: idSchema, startLocal: { type: 'string', maxLength: 16 }, endLocal: { type: 'string', maxLength: 16 }, templateId: idSchema } } },
  } },
} as const;
const versionSchema = { params: { type: 'object', required: ['weekStart'], properties: { weekStart: weekStartSchema } },
  body: { type: 'object', required: ['expectedVersion'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 } } } } as const;
const listSchema = { querystring: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: {
  from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 },
} } } as const;
export async function schedulingRoutes(app: FastifyInstance, options: { repository?: ScheduleRepository }) {
  const scheduleRepository = options.repository;
  const planningContextFor = async (weekStart: string): Promise<PlanningContext | null> => {
    const context = await scheduleRepository?.getPlanningContext();
    if (!context) return null;
    const publishedIds = await scheduleRepository!.getApprovedShiftEventIds(weekStart, context.profile.calendarId);
    if (!publishedIds.length) return context;
    const ids = new Set(publishedIds);
    return { ...context, events: context.events.filter((event) => !ids.has(event.id)) };
  };

  /**
   * S23KC2S1P2-40: do każdego grafiku dołączamy zajęcia i wydarzenia tygodnia (blockingEvents) oraz wolne przedziały,
   * wyliczone z bieżącego kalendarza. Dzięki temu ekran pokaże też zajęcia dodane po wygenerowaniu propozycji.
   */
  const withClassContext = (schedule: ScheduleGenerationResult, context: PlanningContext): ScheduleGenerationResult => {
    const parameters = schedule.parameters as PlannerOverrides & { commuteBufferMinutes?: number; minimumRestMinutes?: number; minimumShiftMinutes?: number };
    const occurrences = listBlockingOccurrences(context, schedule.weekStart, {
      commuteBufferMinutes: Number(parameters.commuteBufferMinutes ?? context.profile.commuteBufferMinutes),
      minimumRestMinutes: Number(parameters.minimumRestMinutes ?? context.profile.minimumRestMinutes),
    });
    const free = freeWindows(context, schedule.weekStart, occurrences, Number(parameters.minimumShiftMinutes ?? context.profile.minimumShiftMinutes));
    return { ...schedule, blockingEvents: occurrences, freeWindows: free.windows, freeMinutes: free.freeMinutes };
  };

  // Ustawienia profilu (limity, cel, dostępność, szablony) obsługuje moduł profilu pracy: GET/PUT /api/v1/work-profile.

  app.post<{ Body: { weekStart: string; profileVersion: string; confirmNoClasses?: boolean; overrides?: PlannerOverrides } }>('/schedules/generate', { schema: {
    ...generateSchema, tags: ['Scheduling'], summary: 'Generate a weekly schedule', description: 'Creates a deterministic draft. Weekly class series are expanded into the selected week; work is planned only in availability minus mandatory classes and commute buffers. If no classes occur in the week, confirmation is required. If free time cannot cover the target, the result contains insufficient_free_time. Published planner shifts are excluded from the planning baseline so a replacement can reduce the previous hours.',
    operationId: 'generateSchedule', response: { 201: scheduleResponseSchema, 400: objectResponse, 404: objectResponse, 409: objectResponse, 503: objectResponse },
  } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.body.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const context = await planningContextFor(request.body.weekStart);
      if (!context) return reply.code(404).send({ error: 'work_profile_not_found' });
      if (request.body.profileVersion !== context.profile.profileVersion) return reply.code(409).send({ error: 'profile_version_conflict', profileVersion: context.profile.profileVersion });
      const missing = [context.availability.length ? null : 'availability', context.profile.targetHours > 0 ? null : 'target'].filter(Boolean);
      if (missing.length) return reply.code(409).send({ error: 'profile_setup_required', missing });
      const classes = expandEventsForWeek(context, request.body.weekStart).filter((event) => event.category === 'Class');
      if (!classes.length && !request.body.confirmNoClasses) return reply.code(409).send({ error: 'no_classes_for_week', requiresConfirmation: true });
      const generated = generateSchedule(context, request.body.weekStart, request.body.overrides ?? {});
      generated.parameters.profileVersion = context.profile.profileVersion;
      return reply.code(201).send(withClassContext(await scheduleRepository.saveSchedule(context, generated), context));
    } catch (error) {
      if (error instanceof Error && error.message.includes('Ustawienia')) return reply.code(400).send({ error: 'invalid_scheduler_settings', message: error.message });
      request.log.error({ err: error }, 'Schedule generation failed');
      return reply.code(503).send({ error: 'schedule_generation_failed' });
    }
  });

  app.post<{ Params: { weekStart: string }; Body: { expectedVersion: number } }>('/schedules/:weekStart/approve', { schema: { ...versionSchema,
    tags: ['Scheduling'], summary: 'Validate and approve a schedule', description: 'Revalidates the draft against current profile/calendar constraints, then atomically publishes the shifts as calendar events. Previous planner-generated events are replaced only after validation. A shift overlapping a mandatory class (including commute buffer) returns 422 with class_collision.', operationId: 'approveSchedule',
    response: { 200: scheduleResponseSchema, 422: invalidScheduleSchema },
  } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const [context, latest] = await Promise.all([planningContextFor(request.params.weekStart), scheduleRepository.getLatestSchedule(request.params.weekStart)]);
      if (!context) return reply.code(404).send({ error: 'work_profile_not_found' });
      if (!latest) return reply.code(404).send({ error: 'schedule_not_found' });
      if (latest.version !== request.body.expectedVersion) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: latest.version });
      if (latest.parameters.profileVersion !== context.profile.profileVersion) return reply.code(409).send({ error: 'profile_version_conflict', profileVersion: context.profile.profileVersion });
      const validation = validateSchedule(context, request.params.weekStart, latest.shifts.map((shift) => ({ id: shift.candidateId,
        startLocal: shift.startLocal, endLocal: shift.endLocal, templateId: shift.templateId })), {
        mode: latest.mode, minimumHours: latest.minimumMinutes / 60, targetHours: latest.targetMinutes / 60,
        maximumHours: latest.maximumMinutes / 60, maxHoursPerDay: Number(latest.parameters.maxHoursPerDay ?? context.profile.maxHoursPerDay),
      });
      if (validation.errors.length) return reply.code(422).send({ error: 'invalid_schedule', errors: validation.errors, warnings: validation.warnings });
      const schedule = await scheduleRepository.approveSchedule(request.params.weekStart, request.body.expectedVersion);
      return schedule ? withClassContext(schedule, context) : reply.code(404).send({ error: 'schedule_not_found' });
    } catch (error) {
      if (error instanceof ScheduleAlreadyApprovedError) return reply.code(409).send({ error: 'schedule_already_approved' });
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      request.log.error({ err: error }, 'Schedule approval failed');
      return reply.code(503).send({ error: 'schedule_approval_failed' });
    }
  });

  app.post<{ Params: { weekStart: string }; Body: { expectedVersion: number } }>('/schedules/:weekStart/reject', { schema: { ...versionSchema,
    tags: ['Scheduling'], summary: 'Reject pending proposals', description: 'Marks all unapproved proposals for the week as rejected. Previously accepted calendar events remain unchanged.', operationId: 'rejectSchedule',
  } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try { return { rejected: true, schedule: await scheduleRepository.rejectSchedule(request.params.weekStart, request.body.expectedVersion) }; }
    catch (error) {
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      if (error instanceof ScheduleAlreadyApprovedError) return reply.code(409).send({ error: 'schedule_already_approved' });
      request.log.error({ err: error }, 'Schedule rejection failed');
      return reply.code(503).send({ error: 'schedule_rejection_failed' });
    }
  });

  app.get<{ Querystring: { from: string; to: string; limit?: number; offset?: number } }>('/schedules', { schema: {
    ...listSchema, tags: ['Scheduling'], summary: 'List schedules by date range', description: 'Returns paginated schedule versions, including lifecycle and feasibility status.', operationId: 'listSchedules', response: { 200: objectResponse, 400: objectResponse, 503: objectResponse },
  } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (request.query.from > request.query.to) return reply.code(400).send({ error: 'invalid_date_range' });
    try { return await scheduleRepository.listSchedules({ from: request.query.from, to: request.query.to, limit: request.query.limit ?? 20, offset: request.query.offset ?? 0 }); }
    catch (error) { request.log.error({ err: error }, 'Schedule list failed'); return reply.code(503).send({ error: 'schedule_list_failed' }); }
  });

  app.get<{ Params: { id: string } }>('/schedules/id/:id', { schema: { tags: ['Scheduling'], summary: 'Get a schedule version by ID', operationId: 'getScheduleById', params: { type: 'object', required: ['id'], properties: { id: idSchema } }, response: { 200: scheduleResponseSchema, 404: objectResponse, 503: objectResponse } } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    try {
      const schedule = await scheduleRepository.getScheduleById(request.params.id);
      if (!schedule) return reply.code(404).send({ error: 'schedule_not_found' });
      const context = await planningContextFor(schedule.weekStart);
      return context ? withClassContext(schedule, context) : schedule;
    } catch (error) { request.log.error({ err: error }, 'Schedule lookup failed'); return reply.code(503).send({ error: 'schedule_lookup_failed' }); }
  });

  app.get<{ Params: { weekStart: string } }>('/schedules/:weekStart', { schema: { tags: ['Scheduling'], summary: 'Get latest schedule for a week', description: 'Returns the latest non-rejected version whose week starts on the supplied Monday.', operationId: 'getLatestSchedule', params: { type: 'object', required: ['weekStart'], properties: { weekStart: weekStartSchema } }, response: { 200: scheduleResponseSchema, 400: objectResponse, 404: objectResponse, 503: objectResponse } } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const [schedule, context] = await Promise.all([scheduleRepository.getLatestSchedule(request.params.weekStart), planningContextFor(request.params.weekStart)]);
      if (!schedule) return reply.code(404).send({ error: 'schedule_not_found' });
      return context ? withClassContext(schedule, context) : schedule;
    } catch (error) {
      request.log.error({ err: error }, 'Schedule lookup failed');
      return reply.code(503).send({ error: 'schedule_lookup_failed' });
    }
  });

  app.put<{ Params: { weekStart: string }; Body: { shifts: ManualShiftInput[]; expectedVersion: number } }>('/schedules/:weekStart', { schema: { ...updateSchema,
    tags: ['Scheduling'], summary: 'Validate and save manual schedule edits', description: 'Validates edits against availability, calendar events, shift templates, weekly and daily limits. A shift overlapping a mandatory class (including commute buffer) is rejected with class_collision. Uses expectedVersion to detect concurrent changes.', operationId: 'updateSchedule', response: { 200: scheduleResponseSchema, 400: objectResponse, 404: objectResponse, 409: objectResponse, 422: invalidScheduleSchema, 503: objectResponse },
  } }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    const { weekStart } = request.params;
    if (!validWeekStart(weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const [context, latest] = await Promise.all([planningContextFor(weekStart), scheduleRepository.getLatestSchedule(weekStart)]);
      if (!context) return reply.code(404).send({ error: 'work_profile_not_found' });
      if (!latest) return reply.code(404).send({ error: 'schedule_not_found' });
      if (latest.parameters.profileVersion !== context.profile.profileVersion) return reply.code(409).send({ error: 'profile_version_conflict', profileVersion: context.profile.profileVersion });
      const validation = validateSchedule(context, weekStart, request.body.shifts, { mode: latest.mode,
        minimumHours: latest.minimumMinutes / 60, targetHours: latest.targetMinutes / 60, maximumHours: latest.maximumMinutes / 60,
        maxHoursPerDay: Number(latest.parameters.maxHoursPerDay ?? context.profile.maxHoursPerDay) });
      if (validation.errors.length) return reply.code(422).send({ error: 'invalid_schedule', errors: validation.errors, warnings: validation.warnings });
      const shifts: CandidateShift[] = request.body.shifts.flatMap((input) => {
        const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.startLocal);
        const endMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(input.endLocal);
        if (!startMatch || !endMatch) return [];
        const start = localInstant(startMatch[1]!, startMatch[2]!, context.profile.timeZone);
        const end = localInstant(endMatch[1]!, endMatch[2]!, context.profile.timeZone);
        if (!start || !end) return [];
        const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);
        const optionalViolation = validation.warnings.find((warning) => warning.code === 'optional_lecture_conflict' && warning.candidateIds.includes(input.id));
        const optionalLectureIds = optionalViolation?.eventIds ?? [];
        return [{ candidateId: input.id, title: 'Praca', start: start.toISOString(), end: end.toISOString(), startLocal: input.startLocal,
          endLocal: input.endLocal, durationMinutes, workDate: input.startLocal.slice(0, 10), mode: latest.mode, templateId: input.templateId, optionalLectureIds,
          softPenalty: typeof optionalViolation?.details.penalty === 'number' ? optionalViolation.details.penalty : 0 }];
      });
      const solutionStatus = validation.totalMinutes >= validation.targetMinutes ? 'target_met' : 'not_found';
      const edited: ScheduleGenerationResult = { ...latest, version: undefined, shifts, solutionStatus,
        existingWorkMinutes: validation.existingWorkMinutes, proposedMinutes: validation.proposedMinutes, totalMinutes: validation.totalMinutes,
        shortfallMinutes: validation.shortfallMinutes, minimumShortfallMinutes: validation.minimumShortfallMinutes,
        parameters: { ...latest.parameters, profileVersion: context.profile.profileVersion },
        optionalLecturesSkipped: [...new Set(shifts.flatMap((shift) => shift.optionalLectureIds))].sort(),
        workdaysUsed: new Set(shifts.map((shift) => shift.workDate)).size,
        violations: validation.warnings, generatedAt: new Date().toISOString() };
      delete edited.scheduleId;
      delete edited.version;
      return withClassContext(await scheduleRepository.saveSchedule(context, edited, request.body.expectedVersion), context);
    } catch (error) {
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      request.log.error({ err: error }, 'Schedule update failed');
      return reply.code(503).send({ error: 'schedule_update_failed' });
    }
  });
}
