import { CollisionError, EventNotFoundError, EventValidationError } from './collisions.js';
import { readClassImage } from './import/classes/image-reader.js';
import { readClassPdf, PdfReadError } from './import/classes/reader.js';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { CalendarOverview, EventInput } from './database.js';
import { importCollisions } from './import/collisions-preview.js';
import { registerGoogleImport, type GoogleImportOptions } from './import/google/routes.js';
import { decodeIcsFile, IcsError, looksLikeIcs, parseIcs } from './import/ics/parse.js';
import { buildImportPreview } from './import/preview.js';
import { resolveRow, type ExistingEvent, type ImportRow } from './import/rules.js';
import { checkScheduleFile, MAX_SCHEDULE_FILE_BYTES } from './import/work-schedule/file-check.js';
import { mapShiftsToRows, READ_STATUS_LABELS } from './import/work-schedule/mapping.js';
import { ScheduleReadError } from './import/work-schedule/local-reader.js';
import { DemoScheduleReader, type ScheduleReader } from './import/work-schedule/reader.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput, ImportFormat, ImportSource } from './import/session.js';
import { generateSchedule, validateSchedule } from './scheduling/generator.js';
import { expandEventsForWeek, validWeekStart, localInstant } from './scheduling/time.js';
import { ProfileVersionConflictError, ScheduleAlreadyApprovedError, ScheduleVersionConflictError, type ScheduleRepository } from './scheduling/repository.js';
import type { CandidateShift, ManualShiftInput, PlannerOverrides, PlanningContext, ScheduleGenerationResult, ScheduleProfileSettings, ShiftTemplate } from './scheduling/types.js';

export type CalendarRepository = {
  deleteEvent?: (eventId: string) => Promise<string[] | null>;
  updateEvent?: (id: string, input: EventInput) => Promise<EventInput & { id: string }>;
  createEvent?: (input: EventInput) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<CalendarOverview | null>;
  // Import (S23KC2S1P2-32): sesja, przedłużanie, zatwierdzenie i anulowanie.
  createImportSession?: (input: CreateSessionInput) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[]) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string) => Promise<boolean>;
  // Import grafiku pracy (S23KC2S1P2-44): duplikaty w kalendarzu i rozpoznawanie własnych zmian.
  listEventsForImport?: () => Promise<ExistingEvent[]>;
  getImportUserName?: () => Promise<string>;
};

export type ApiOptions = {
  /**
   * Mechanizm odczytu grafiku (S23KC2S1P2-44). Serwer (server.ts) podaje LocalScheduleReader (PDF + OCR).
   * Bez tej opcji działa czytnik demonstracyjny – używają go testy, żeby nie uruchamiać OCR.
   */
  scheduleReader?: ScheduleReader;
  /** Import z Google Calendar (S23KC2S1P2-27): klient OAuth; bez niego działa konto demonstracyjne. */
  google?: GoogleImportOptions;
  scheduleRepository?: ScheduleRepository;
};

// Ograniczenia danych wejściowych importu: chronią API przed zbyt dużymi lub dziwnymi żądaniami.
const importRowSchema = {
  type: 'object',
  required: ['id', 'title', 'date', 'startTime', 'endTime'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    title: { type: 'string', maxLength: 200 },
    date: { type: 'string', maxLength: 10 },
    startTime: { type: 'string', maxLength: 5 },
    endTime: { type: 'string', maxLength: 5 },
    endDate: { type: 'string', maxLength: 10 },
    category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
    location: { type: 'string', maxLength: 200 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    employee: { type: 'string', maxLength: 200 },
    overnightConfirmed: { type: 'boolean' },
    duplicateDecision: { type: 'string', enum: ['skip', 'replace', 'keepBoth'] },
    replacementId: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

const rowsProperty = { type: 'array', maxItems: 1000, items: importRowSchema } as const;
const sessionIdSchema = { type: 'string', minLength: 1, maxLength: 64 } as const;

const importPreviewSchema = {
  body: {
    type: 'object',
    required: ['rows'],
    additionalProperties: false,
    properties: { rows: rowsProperty, importSessionId: sessionIdSchema },
  },
} as const;

const createSessionSchema = {
  body: {
    type: 'object',
    required: ['source', 'format', 'rows'],
    additionalProperties: false,
    properties: {
      source: { type: 'string', enum: ['classes', 'work'] },
      format: { type: 'string', enum: ['PDF', 'Zdjęcie', 'ICS/CSV'] },
      rows: { ...rowsProperty, minItems: 1 },
    },
  },
} as const;

const confirmSchema = {
  params: { type: 'object', required: ['id'], properties: { id: sessionIdSchema } },
  body: { type: 'object', required: ['rows'], additionalProperties: false, properties: { rows: rowsProperty } },
} as const;

// Plik wysyłany jest jako tekst base64. Limit żądania jest nieco większy niż limit pliku, bo base64 zwiększa rozmiar o ok. 1/3.
const READ_BODY_LIMIT = Math.ceil(MAX_SCHEDULE_FILE_BYTES * 1.4) + 4096;

const readScheduleSchema = {
  body: {
    type: 'object',
    required: ['fileName', 'dataBase64'],
    additionalProperties: false,
    properties: {
      fileName: { type: 'string', minLength: 1, maxLength: 255 },
      dataBase64: { type: 'string', maxLength: READ_BODY_LIMIT },
    },
  },
} as const;

const cancelSchema = { params: { type: 'object', required: ['id'], properties: { id: sessionIdSchema } } } as const;

const schedulerOverridesSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['elastyczny', 'zmianowy'] },
    minimumHours: { type: 'number', minimum: 0, maximum: 80 },
    targetHours: { type: 'number', minimum: 0, maximum: 80 },
    maximumHours: { type: 'number', minimum: 0, maximum: 80 },
    commuteBufferMinutes: { type: 'integer', minimum: 0, maximum: 720 },
    minimumRestMinutes: { type: 'integer', minimum: 0, maximum: 1440 },
    minimumShiftMinutes: { type: 'integer', minimum: 120, maximum: 720 },
    maximumSlotMinutes: { type: 'integer', minimum: 120, maximum: 720 },
    maxHoursPerDay: { type: 'number', exclusiveMinimum: 0, maximum: 24 },
    workaholic: { type: 'boolean' },
    shiftTemplates: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'name', 'startTime', 'endTime', 'endsNextDay', 'daysOfWeek', 'active'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, name: { type: 'string', minLength: 1, maxLength: 80 },
        startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, endTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        endsNextDay: { type: 'boolean' }, daysOfWeek: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 7 } }, active: { type: 'boolean' } } } },
  },
} as const;
const generateScheduleSchema = { body: { type: 'object', required: ['weekStart', 'profileVersion'], additionalProperties: false,
  properties: { weekStart: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, profileVersion: { type: 'string', minLength: 1 }, confirmNoClasses: { type: 'boolean' }, overrides: schedulerOverridesSchema } } } as const;
const updateScheduleSchema = { params: { type: 'object', required: ['weekStart'], additionalProperties: false,
  properties: { weekStart: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
  body: { type: 'object', required: ['shifts', 'expectedVersion'], additionalProperties: false, properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
     shifts: { type: 'array', maxItems: 14, items: { type: 'object', required: ['id', 'startLocal', 'endLocal'], additionalProperties: false,
       properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, startLocal: { type: 'string', maxLength: 16 }, endLocal: { type: 'string', maxLength: 16 }, templateId: { type: 'string', maxLength: 100 } } } },
  } } } as const;
const settingsSchema = { body: { type: 'object', required: ['mode', 'minimumHours', 'targetHours', 'maximumHours', 'commuteBufferMinutes', 'minimumRestMinutes', 'minimumShiftMinutes', 'maximumSlotMinutes', 'maxHoursPerDay', 'profileVersion', 'availability', 'preferredWorkWindows', 'blockedPeriods', 'shiftTemplates'], additionalProperties: false,
  properties: { ...schedulerOverridesSchema.properties,
    profileVersion: { type: 'string', minLength: 1 },
    availability: { type: 'array', maxItems: 70, items: { type: 'object', required: ['id', 'dayOfWeek', 'startTime', 'endTime'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, endTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' } } } },
    preferredWorkWindows: { type: 'array', maxItems: 70, items: { type: 'object', required: ['id', 'dayOfWeek', 'startTime', 'endTime', 'weight'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 }, startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, endTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, weight: { type: 'number', minimum: 0, maximum: 100 } } } },
    blockedPeriods: { type: 'array', maxItems: 100, items: { type: 'object', required: ['id', 'type', 'start', 'end'], additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1, maxLength: 100 }, type: { type: 'string', minLength: 1, maxLength: 80 }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' }, reason: { type: 'string', maxLength: 200 } } } },
  } } } as const;
const approveScheduleSchema = { params: { type: 'object', required: ['weekStart'], properties: { weekStart: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } },
  body: { type: 'object', required: ['expectedVersion'], additionalProperties: false, properties: { expectedVersion: { type: 'integer', minimum: 1 } } } } as const;
const listSchedulesSchema = { querystring: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: {
  from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, default: 0 },
} } } as const;

const profileSettingsFromContext = (context: PlanningContext): ScheduleProfileSettings => ({
  mode: context.profile.mode, minimumHours: context.profile.minimumHours, targetHours: context.profile.targetHours,
  maximumHours: context.profile.maximumHours, commuteBufferMinutes: context.profile.commuteBufferMinutes,
  minimumRestMinutes: context.profile.minimumRestMinutes, minimumShiftMinutes: context.profile.minimumShiftMinutes,
  maximumSlotMinutes: context.profile.maximumSlotMinutes, maxHoursPerDay: context.profile.maxHoursPerDay,
  profileVersion: context.profile.profileVersion,
  availability: context.availability, preferredWorkWindows: context.preferredWorkWindows, blockedPeriods: context.blockedPeriods,
  shiftTemplates: context.shiftTemplates,
});

export function buildApi(repository: CalendarRepository | null, allowedOrigins: string[] = [], options: ApiOptions = {}) {
  const app: FastifyInstance = Fastify({ logger: true });
  const scheduleReader: ScheduleReader = options.scheduleReader ?? new DemoScheduleReader();
  // Wydarzenia z kalendarza do wykrywania duplikatów zmian pracy. Bez bazy porównanie jest pomijane.
  const existingEventsFor = async (rows: ImportRow[]): Promise<ExistingEvent[]> => {
    if (!repository?.listEventsForImport) return [];
    return repository.listEventsForImport();
  };
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || origins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by KAC API CORS policy'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.get('/api/health/live', async () => ({ api: 'ok' }));

  const scheduleRepository = options.scheduleRepository;
  const planningContextFor = async (weekStart: string): Promise<PlanningContext | null> => {
    const context = await scheduleRepository?.getPlanningContext();
    if (!context) return null;
    const generatedShiftIds = await scheduleRepository!.getApprovedShiftEventIds(weekStart, context.profile.calendarId);
    if (!generatedShiftIds.length) return context;
    const ids = new Set(generatedShiftIds);
    return { ...context, events: context.events.filter((event) => !ids.has(event.id)) };
  };
  app.get('/api/scheduling/settings', async (_request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    try {
      const context = await scheduleRepository.getPlanningContext();
      return context ? profileSettingsFromContext(context) : reply.code(404).send({ error: 'work_profile_not_found' });
    } catch (error) {
      app.log.error({ err: error }, 'Schedule settings lookup failed');
      return reply.code(503).send({ error: 'schedule_settings_lookup_failed' });
    }
  });

  app.put<{ Body: ScheduleProfileSettings }>('/api/scheduling/settings', { schema: settingsSchema }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    const settings = request.body;
    if (settings.minimumHours === undefined || settings.targetHours === undefined || settings.maximumHours === undefined ||
      settings.minimumHours > settings.targetHours || settings.targetHours > settings.maximumHours ||
      settings.minimumShiftMinutes === undefined || settings.maximumSlotMinutes === undefined || settings.maximumSlotMinutes < settings.minimumShiftMinutes ||
      !settings.availability.every((window) => window.endTime > window.startTime) ||
      !settings.preferredWorkWindows.every((window) => window.endTime > window.startTime) ||
      !settings.blockedPeriods.every((period) => new Date(period.end).getTime() > new Date(period.start).getTime())) {
      return reply.code(400).send({ error: 'invalid_scheduler_settings' });
    }
    try {
      const context = await scheduleRepository.getPlanningContext();
      if (!context) return reply.code(404).send({ error: 'work_profile_not_found' });
      if (settings.profileVersion !== context.profile.profileVersion) return reply.code(409).send({ error: 'profile_version_conflict', profileVersion: context.profile.profileVersion });
      await scheduleRepository.saveSettings(context, settings);
      const updated = await scheduleRepository.getPlanningContext();
      return updated ? profileSettingsFromContext(updated) : reply.code(404).send({ error: 'work_profile_not_found' });
    } catch (error) {
      if (error instanceof ProfileVersionConflictError) return reply.code(409).send({ error: 'profile_version_conflict' });
      request.log.error({ err: error }, 'Schedule settings update failed');
      return reply.code(400).send({ error: 'schedule_settings_update_failed' });
    }
  });

  app.post<{ Body: { weekStart: string; profileVersion: string; confirmNoClasses?: boolean; overrides?: PlannerOverrides } }>('/api/schedules/generate', { schema: generateScheduleSchema }, async (request, reply) => {
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
      return reply.code(201).send(await scheduleRepository.saveSchedule(context, generated));
    } catch (error) {
      if (error instanceof Error && error.message.includes('Ustawienia')) return reply.code(400).send({ error: 'invalid_scheduler_settings', message: error.message });
      request.log.error({ err: error }, 'Schedule generation failed');
      return reply.code(503).send({ error: 'schedule_generation_failed' });
    }
  });

  app.post<{ Params: { weekStart: string }; Body: { expectedVersion: number } }>('/api/schedules/:weekStart/approve', { schema: approveScheduleSchema }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const [context, latest] = await Promise.all([planningContextFor(request.params.weekStart), scheduleRepository.getLatestSchedule(request.params.weekStart)]);
      if (!context) return reply.code(404).send({ error: 'work_profile_not_found' });
      if (!latest) return reply.code(404).send({ error: 'schedule_not_found' });
      if (latest.version !== request.body.expectedVersion) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: latest.version });
      if (latest.parameters.profileVersion !== context.profile.profileVersion) return reply.code(409).send({ error: 'profile_version_conflict', profileVersion: context.profile.profileVersion });
      const validation = validateSchedule(context, request.params.weekStart, latest.shifts.map((shift) => ({ id: shift.candidateId, startLocal: shift.startLocal, endLocal: shift.endLocal, templateId: shift.templateId })), {
        mode: latest.mode, minimumHours: latest.minimumMinutes / 60, targetHours: latest.targetMinutes / 60,
        maximumHours: latest.maximumMinutes / 60, maxHoursPerDay: Number(latest.parameters.maxHoursPerDay ?? context.profile.maxHoursPerDay),
      });
      if (validation.errors.length) return reply.code(422).send({ error: 'invalid_schedule', errors: validation.errors, warnings: validation.warnings });
      const schedule = await scheduleRepository.approveSchedule(request.params.weekStart, request.body.expectedVersion);
      return schedule ? schedule : reply.code(404).send({ error: 'schedule_not_found' });
    } catch (error) {
      if (error instanceof ScheduleAlreadyApprovedError) return reply.code(409).send({ error: 'schedule_already_approved' });
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      request.log.error({ err: error }, 'Schedule approval failed');
      return reply.code(503).send({ error: 'schedule_approval_failed' });
    }
  });

  app.post<{ Params: { weekStart: string }; Body: { expectedVersion: number } }>('/api/schedules/:weekStart/reject', { schema: approveScheduleSchema }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const result = await scheduleRepository.rejectSchedule(request.params.weekStart, request.body.expectedVersion);
      return { rejected: true, schedule: result };
    } catch (error) {
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      if (error instanceof ScheduleAlreadyApprovedError) return reply.code(409).send({ error: 'schedule_already_approved' });
      request.log.error({ err: error }, 'Schedule rejection failed');
      return reply.code(503).send({ error: 'schedule_rejection_failed' });
    }
  });

  app.get<{ Querystring: { from: string; to: string; limit?: number; offset?: number } }>('/api/schedules', { schema: listSchedulesSchema }, async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (request.query.from > request.query.to) return reply.code(400).send({ error: 'invalid_date_range' });
    try { return await scheduleRepository.listSchedules({ from: request.query.from, to: request.query.to, limit: request.query.limit ?? 20, offset: request.query.offset ?? 0 }); }
    catch (error) { request.log.error({ err: error }, 'Schedule list failed'); return reply.code(503).send({ error: 'schedule_list_failed' }); }
  });

  app.get<{ Params: { id: string } }>('/api/schedules/id/:id', async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    try {
      const schedule = await scheduleRepository.getScheduleById(request.params.id);
      return schedule ? schedule : reply.code(404).send({ error: 'schedule_not_found' });
    } catch (error) { request.log.error({ err: error }, 'Schedule lookup failed'); return reply.code(503).send({ error: 'schedule_lookup_failed' }); }
  });

  app.get<{ Params: { weekStart: string } }>('/api/schedules/:weekStart', async (request, reply) => {
    if (!scheduleRepository) return reply.code(503).send({ error: 'scheduling_not_configured' });
    if (!validWeekStart(request.params.weekStart)) return reply.code(400).send({ error: 'invalid_week_start' });
    try {
      const schedule = await scheduleRepository.getLatestSchedule(request.params.weekStart);
      return schedule ? schedule : reply.code(404).send({ error: 'schedule_not_found' });
    } catch (error) {
      request.log.error({ err: error }, 'Schedule lookup failed');
      return reply.code(503).send({ error: 'schedule_lookup_failed' });
    }
  });

  app.put<{ Params: { weekStart: string }; Body: { shifts: ManualShiftInput[]; expectedVersion: number } }>('/api/schedules/:weekStart', { schema: updateScheduleSchema }, async (request, reply) => {
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
      return await scheduleRepository.saveSchedule(context, edited, request.body.expectedVersion);
    } catch (error) {
      if (error instanceof ScheduleVersionConflictError) return reply.code(409).send({ error: 'schedule_version_conflict', currentVersion: error.actualVersion });
      request.log.error({ err: error }, 'Schedule update failed');
      return reply.code(503).send({ error: 'schedule_update_failed' });
    }
  });

  app.get('/api/health/ready', async (request, reply) => {
    if (!repository) return reply.code(503).send({ api: 'ok', database: 'not-configured' });
    try {
      await repository.checkConnection();
      return { api: 'ok', database: 'connected' };
    } catch (error) {
      request.log.error({ err: error }, 'PostgreSQL readiness check failed');
      return reply.code(503).send({ api: 'ok', database: 'unavailable' });
    }
  });

  app.get('/api/calendar', async (_request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const overview = await repository.getOverview();
      if (!overview) return reply.code(404).send({ error: 'calendar_not_found' });
      return overview;
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  const eventBody = { type: 'object', additionalProperties: false,
    required: ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 200 },
      start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
      end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
      category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
      location: { type: 'string', maxLength: 500 }, mandatory: { type: 'boolean' }, repeatWeekly: { type: 'boolean' },
      collisionToken: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    },
  } as const;
  for (const method of ['POST', 'PUT'] as const) {
    app.route<{ Body: EventInput; Params: { id?: string } }>({ method, url: method === 'POST' ? '/api/events' : '/api/events/:id',
      schema: { body: eventBody, ...(method === 'PUT' ? { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } } : {}) },
      handler: async (request, reply) => {
        const input = request.body;
        const validDate = (value: string) => {
          const parsed = new Date(value + ':00Z');
          return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,16) === value;
        };
        if (!input.title.trim() || !validDate(input.start) || !validDate(input.end) || input.end <= input.start)
          return reply.code(400).send({ error: 'invalid_event' });
        if (!repository?.createEvent || (method === 'PUT' && !repository.updateEvent)) return reply.code(503).send({ error: 'database_not_configured' });
        try {
          const saved = method === 'POST' ? await repository.createEvent(input) : await repository.updateEvent!(request.params.id!, input);
          return reply.code(method === 'POST' ? 201 : 200).send(saved);
        } catch (error) {
          if (error instanceof CollisionError) return reply.code(409).send({ error: 'event_collision', conflicts: error.conflicts, collisionToken: error.collisionToken });
          if (error instanceof EventValidationError) return reply.code(400).send({ error: error.message });
          if (error instanceof EventNotFoundError) return reply.code(404).send({ error: error.message });
          request.log.error({ err: error }, 'Event not saved');
          return reply.code(503).send({ error: 'event_not_saved' });
        }
      },
    });
  }

  app.delete<{ Params: { id: string } }>('/api/events/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request, reply) => {
    if (!repository?.deleteEvent) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const deletedIds = await repository.deleteEvent(request.params.id);
      if (!deletedIds) return reply.code(404).send({ error: 'event_not_found' });
      return { deletedIds };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({ error: 'event_not_deleted' });
    }
  });

  // --- Jednorazowy import z Google Calendar (S23KC2S1P2-27) ---
  registerGoogleImport(app, repository, options.google);

  // --- Import: kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32) ---

  // Podgląd importu: sprawdza wiersze po każdej poprawce użytkownika. Niczego nie zapisuje w kalendarzu.
  // Jeśli podano identyfikator sesji, przedłuża ją (sesja wygasa po 15 minutach bez akcji).
  app.post<{ Body: { rows: ImportRow[]; importSessionId?: string } }>('/api/import/preview', { schema: importPreviewSchema }, async (request, reply) => {
    if (request.body.importSessionId && repository?.touchImportSession) {
      await repository.touchImportSession(request.body.importSessionId).catch((error) => request.log.warn({ err: error }, 'Could not extend import session'));
    }
    let existing: ExistingEvent[] = [];
    try {
      existing = await existingEventsFor(request.body.rows);
    } catch (error) {
      request.log.warn({ err: error }, 'Import preview could not read calendar events');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
    return { rows: buildImportPreview(request.body.rows, existing) };
  });

  // Sesja importu: zapamiętuje odczytane wiersze do kontroli (t_importy, t_pozycje_importu). Kalendarz bez zmian.
  app.post<{ Body: { source: ImportSource; format: ImportFormat; rows: ImportRow[] } }>(
    '/api/import/sessions',
    { schema: createSessionSchema },
    async (request, reply) => {
      if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
      try {
        const preview = buildImportPreview(request.body.rows, await existingEventsFor(request.body.rows));
        const session = await repository.createImportSession({ ...request.body, preview });
        return reply.code(201).send({ importSessionId: session.id, expiresAt: session.expiresAt.toISOString(), rows: preview });
      } catch (error) {
        request.log.error({ err: error }, 'Could not create import session');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    },
  );

  // Zatwierdzenie importu: ponownie sprawdza wiersze i zapisuje zaakceptowane w kalendarzu (wszystkie albo żaden).
  app.post<{ Params: { id: string }; Body: { rows: ImportRow[] } }>(
    '/api/import/sessions/:id/confirm',
    { schema: confirmSchema },
    async (request, reply) => {
      if (!repository?.confirmImportSession) return reply.code(503).send({ error: 'database_not_configured' });
      // Serwer nie ufa temu, co sprawdził ekran: reguły uruchamiamy jeszcze raz przed zapisem.
      const preview = buildImportPreview(request.body.rows);
      if (preview.some((row) => row.status === 'error')) return reply.code(422).send({ error: 'invalid_rows', rows: preview });
      const resolvedRows = request.body.rows.map((row) => ({ row, resolved: resolveRow(row) }));
      // Zmiana nocna to termin niejednoznaczny: zapis wymaga potwierdzenia użytkownika (S23KC2S1P2-44).
      const unconfirmed = resolvedRows.filter(({ row, resolved }) => resolved.ok && resolved.needsConfirmation && !row.overnightConfirmed).map(({ row }) => row.id);
      if (unconfirmed.length > 0) return reply.code(422).send({ error: 'overnight_not_confirmed', rowIds: unconfirmed });
      const accepted: AcceptedRow[] = resolvedRows.flatMap(({ row, resolved }) =>
        resolved.ok
          ? [{ id: row.id, title: resolved.title, start: resolved.start, end: resolved.end, category: row.category ?? 'Personal', location: row.location?.trim() || null, duplicateDecision: row.duplicateDecision, replacementId: row.replacementId }]
          : [],
      );
      try {
        const result = await repository.confirmImportSession(request.params.id, accepted);
        if (result.kind === 'not-found') return reply.code(404).send({ error: 'import_session_not_found' });
        if (result.kind === 'closed') return reply.code(409).send({ error: 'import_session_closed' });
        if (result.kind === 'expired') return reply.code(410).send({ error: 'import_session_expired' });
        if (result.kind === 'unknown-rows') return reply.code(422).send({ error: 'unknown_rows', rowIds: result.rowIds });
        if (result.kind === 'needs-decision') {
          return reply.code(422).send({ error: 'duplicate_decision_required', missingDecisions: result.missingDecisions, invalidDecisions: result.invalidDecisions });
        }
        const { summary } = result;
        return reply.code(201).send({
          saved: summary.added + summary.replaced,
          rejected: summary.rejected,
          summary,
          events: result.saved.filter((event) => event.action !== 'skipped'),
        });
      } catch (error) {
        request.log.error({ err: error }, 'Could not confirm import session');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    },
  );

  // Anulowanie importu: sesja kończy się bez zmian w kalendarzu.
  app.post<{ Params: { id: string } }>('/api/import/sessions/:id/cancel', { schema: cancelSchema }, async (request, reply) => {
    if (!repository?.cancelImportSession) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const cancelled = await repository.cancelImportSession(request.params.id);
      return cancelled ? { status: 'cancelled' } : reply.code(409).send({ error: 'import_session_not_active' });
    } catch (error) {
      request.log.error({ err: error }, 'Could not cancel import session');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  // --- Import grafiku pracy ze zdjęcia lub pliku (S23KC2S1P2-44) ---
  app.post<{ Body: { fileName: string; dataBase64: string } }>('/api/import/classes/read',
    { schema: readScheduleSchema, bodyLimit: READ_BODY_LIMIT }, async (request, reply) => {
      if (!repository?.createImportSession || !repository.listEventsForImport) return reply.code(503).send({ error: 'database_not_configured' });

      // Plik ICS (S23KC2S1P2-8) rozpoznajemy po treści – ten sam przycisk importu planu przyjmuje PDF, zdjęcie i ICS.
      if (looksLikeIcs(request.body.dataBase64)) {
        const ics = decodeIcsFile(request.body.dataBase64, MAX_SCHEDULE_FILE_BYTES);
        if (!ics.ok) return reply.code(422).send({ error: ics.reason });
        let overview: CalendarOverview | null;
        try { overview = await repository.getOverview(); }
        catch (error) {
          request.log.error({ err: error }, 'ICS import could not read calendar');
          return reply.code(503).send({ error: 'database_unavailable' });
        }
        const zone = overview?.user.timezone ?? 'Europe/Warsaw';
        let parsed;
        try { parsed = parseIcs(ics.text, { timeZone: zone }); }
        catch (error) {
          return reply.code(422).send({ error: error instanceof IcsError ? error.message : 'corrupted-file' });
        }
        // 3b: plik bez wydarzeń; 4a: wszystkie wydarzenia niepełne – podajemy, ile pominięto.
        if (parsed.rows.length === 0) {
          return reply.code(422).send({ error: parsed.eventCount === 0 ? 'empty-calendar' : 'no-importable-events', skipped: parsed.skipped });
        }
        try {
          const preview = buildImportPreview(parsed.rows, await repository.listEventsForImport());
          const session = await repository.createImportSession({ source: 'classes', format: 'ICS/CSV', rows: parsed.rows, preview });
          return reply.code(201).send({
            source: 'ics',
            rows: parsed.rows.map((row) => ({ ...row, reviewRequired: false, sourcePage: 1 })),
            preview,
            importSessionId: session.id,
            expiresAt: session.expiresAt.toISOString(),
            academicYear: parsed.calendarName ?? 'Plik ICS',
            calendarName: parsed.calendarName,
            dateFrom: parsed.dateFrom,
            dateTo: parsed.dateTo,
            eventCount: parsed.eventCount,
            skipped: parsed.skipped,
            fileTimeZone: parsed.fileTimeZone,
            userTimeZone: parsed.userTimeZone,
            warnings: parsed.warnings,
            collisions: importCollisions(parsed.rows, overview?.events ?? [], zone),
          });
        } catch (error) {
          request.log.error({ err: error }, 'ICS import could not create preview');
          return reply.code(503).send({ error: 'database_unavailable' });
        }
      }

      const file = checkScheduleFile(request.body.dataBase64);
      if (!file.ok) {
        request.log.warn({ stage: 'file-validation', reason: file.reason }, 'Class import rejected');
        return reply.code(422).send({ error: file.reason });
      }
      let timetable;
      try { timetable = await (file.type === 'PDF' ? readClassPdf(file.bytes) : readClassImage(file.bytes)); }
      catch (error) {
        const code = error instanceof PdfReadError ? error.message : 'unsupported-layout';
        request.log.warn({ stage: 'recognition', fileType: file.type, bytes: file.bytes.length, reason: code }, 'Class import rejected');
        return reply.code(code === 'reader-busy' ? 429 : 422).send({ error: code });
      }
      try {
        const preview = buildImportPreview(timetable.rows, await repository.listEventsForImport());
        const session = await repository.createImportSession({ source: 'classes', format: file.type === 'PDF' ? 'PDF' : 'Zdjęcie', rows: timetable.rows, preview });
        const overview = await repository.getOverview().catch(() => null);
        return reply.code(201).send({ ...timetable, preview, importSessionId: session.id, expiresAt: session.expiresAt.toISOString(),
          collisions: importCollisions(timetable.rows, overview?.events ?? [], overview?.user.timezone ?? 'Europe/Warsaw') });
      } catch (error) {
        request.log.error({ err: error }, 'Class import could not create preview');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    });

  // Sprawdza plik, odczytuje zmiany i zakłada sesję importu do kontroli. Kalendarz pozostaje bez zmian.
  app.post<{ Body: { fileName: string; dataBase64: string } }>(
    '/api/import/work-schedule/read',
    { schema: readScheduleSchema, bodyLimit: READ_BODY_LIMIT + 1024 },
    async (request, reply) => {
      const file = checkScheduleFile(request.body.dataBase64);
      if (!file.ok) return reply.code(422).send({ error: file.reason });
      if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
      let userName = '';
      try {
        userName = repository.getImportUserName ? await repository.getImportUserName() : '';
      } catch (error) {
        request.log.error({ err: error }, 'Could not read import user');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
      // Odczyt pliku jest oddzielony od bazy: błąd odczytu to problem z plikiem (422/429), a nie z serwerem (503).
      let shifts;
      try {
        shifts = await scheduleReader.read({ name: request.body.fileName, type: file.type, bytes: file.bytes }, { userName });
      } catch (error) {
        const code = error instanceof ScheduleReadError ? error.code : file.type === 'PDF' ? 'unreadable-pdf' : 'unreadable-image';
        request.log.warn({ stage: 'recognition', fileType: file.type, bytes: file.bytes.length, reason: code, err: error instanceof ScheduleReadError ? undefined : error }, 'Work schedule not read');
        return reply.code(code === 'reader-busy' ? 429 : 422).send({ error: code });
      }
      try {
        const { readStatus, rows } = mapShiftsToRows(shifts, userName);
        if (readStatus === 'none') return reply.code(422).send({ error: 'nothing_recognized', readStatusLabel: READ_STATUS_LABELS.none });
        const preview = buildImportPreview(rows, await existingEventsFor(rows));
        const session = await repository.createImportSession({ source: 'work', format: file.type === 'PDF' ? 'PDF' : 'Zdjęcie', rows, preview });
        return reply.code(201).send({
          importSessionId: session.id,
          expiresAt: session.expiresAt.toISOString(),
          fileType: file.type,
          readStatus,
          readStatusLabel: READ_STATUS_LABELS[readStatus],
          readerIsDemo: !scheduleReader.real,
          userName,
          rows,
          preview,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Could not create work schedule import session');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    },
  );

  return app;
}
