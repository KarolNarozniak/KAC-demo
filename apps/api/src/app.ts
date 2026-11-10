import { demoScope } from './api/scope.js';
import { registerWorkProfile } from './api/v1/work-profile/routes.js';
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
import { ProfileValidationError, type WeeklyHourLimits } from './profile/validation.js';
import { PreferencesConflictError, PreferencesValidationError, type PreferenceInterval, type PreferencesSnapshot } from './profile/repository.js';
import { ProfileVersionConflictError } from './profile/validation.js';
import { checkMinimumRest, type ProposedShift } from './scheduling/rest.js';
import { mondayWeekBounds } from './scheduling/constraints.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput, ImportFormat, ImportSource } from './import/session.js';

export type CalendarRepository = {
  deleteEvent?: (eventId: string) => Promise<string[] | null>;
  updateEvent?: (id: string, input: EventInput) => Promise<EventInput & { id: string }>;
  createEvent?: (input: EventInput) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<CalendarOverview | null>;
    // Limit godzin pracy w tygodniu (user story: ustawienie limitu godzin).
  getWeeklyHourLimits?: () => Promise<WeeklyHourLimits>;
  setMaxWeeklyWorkHours?: (maxHours: number | null) => Promise<WeeklyHourLimits>;
  listWorkPreferences?: () => Promise<PreferencesSnapshot>;
  replaceWorkPreferences?: (version: string, intervals: PreferenceInterval[]) => Promise<PreferencesSnapshot>;
  getMinRestMinutes?: () => Promise<{ version: string; minRestMinutes: number }>;
  setMinRestMinutes?: (version: string, minRestMinutes: number) => Promise<{ version: string; minRestMinutes: number }>;
  getAccountTimeZone?: () => Promise<string>;
  getWorkShiftsNear?: (weekStart: Date, weekEnd: Date) => Promise<TimedEvent[]>;
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
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { calendarRoutes } from './api/v1/calendar/routes.js';
import { healthRoutes } from './api/v1/health/routes.js';
import { importRoutes } from './api/v1/imports/routes.js';
import { profileRoutes } from './api/v1/profile/routes.js';
import { schedulingRoutes } from './api/v1/scheduling/routes.js';
import type { ApiOptions, CalendarRepository } from './api/contracts.js';
import { registerGoogleImport } from './api/v1/imports/google-routes.js';
import { DemoScheduleReader } from './import/work-schedule/reader.js';
import { blockRoutes } from './api/v1/blocks/routes.js';

export type { ApiOptions, CalendarRepository } from './api/contracts.js';

const API_PREFIX = '/api/v1';

export function buildApi(repository: CalendarRepository | null, allowedOrigins: string[] = [], options: ApiOptions = {}) {
  const app: FastifyInstance = Fastify({ logger: true });
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || origins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by KAC API CORS policy'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'KAC Platform API',
        version: '1.0.0',
        summary: 'Calendar, imports, work profile and weekly schedule planning API.',
        description: [
          'Versioned JSON API for the KAC calendar application.',
          '',
          'All business endpoints live under `/api/v1`. Request and response examples use the seeded development account unless configured otherwise.',
          'Mutating operations validate user input and calendar constraints on the server. Import operations are staged and do not write calendar events until confirmation.',
          '',
          'The API contract is generated from Fastify JSON Schemas and is exported as `apps/api/openapi/openapi.json` for the Docusaurus reference.',
        ].join('\n'),
        contact: { name: 'KAC API maintainers' },
        license: { name: 'UNLICENSED' },
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

    // --- Limit godzin pracy w tygodniu (user story: ustawienie limitu godzin) ---
  app.get('/api/profile/weekly-work-limit', async (_request, reply) => {
    if (!repository?.getWeeklyHourLimits) return reply.code(503).send({ error: 'database_not_configured' });
    try { return await repository.getWeeklyHourLimits(); }
    catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });

    // --- Preferowane godziny pracy (user story: określenie preferowanych godzin) ---
  app.get('/api/work-profile/preferences', async (_request, reply) => {
    if (!repository?.listWorkPreferences) return reply.code(503).send({ error: 'database_not_configured' });
    try { return await repository.listWorkPreferences(); }
    catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });

    // --- Czas na odpoczynek (user story: planer uwzględnia czas na odpoczynek) ---
  app.get('/api/work-profile', async (_request, reply) => {
    if (!repository?.getMinRestMinutes) return reply.code(503).send({ error: 'database_not_configured' });
    try { return await repository.getMinRestMinutes(); }
    catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });

  const workProfileBody = {
    type: 'object', additionalProperties: false, required: ['version', 'minRestMinutes'],
    properties: { version: { type: 'string' }, minRestMinutes: { type: 'integer', minimum: 0 } },
  } as const;

  app.put<{ Body: { version: string; minRestMinutes: number } }>('/api/work-profile', { schema: { body: workProfileBody } }, async (request, reply) => {
    if (!repository?.setMinRestMinutes) return reply.code(503).send({ error: 'database_not_configured' });
    try { return await repository.setMinRestMinutes(request.body.version, request.body.minRestMinutes); }
    catch (error) {
      if (error instanceof ProfileVersionConflictError) return reply.code(409).send({ error: error.message });
      if (error instanceof ProfileValidationError) return reply.code(400).send({ error: error.message, field: error.field });
      request.log.error({ err: error }, 'Rest minutes not saved');
      return reply.code(503).send({ error: 'profile_not_saved' });
    }
  });

  // Walidacja dla UI (task: "nie wyliczać reguły samodzielnie w UI") — klient wysyła kandydatów, dostaje werdykt.
  const restCheckBody = {
    type: 'object', additionalProperties: false, required: ['proposals'],
    properties: {
      proposals: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'start', 'end'],
          properties: { id: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, linkedEventId: { type: 'string' } },
        },
      },
    },
  } as const;

  app.post<{ Body: { proposals: ProposedShift[] } }>('/api/scheduling/rest-check', { schema: { body: restCheckBody } }, async (request, reply) => {
    if (!repository?.getMinRestMinutes || !repository?.getWorkShiftsNear || !repository?.getAccountTimeZone) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const zone = await repository.getAccountTimeZone();
      const { minRestMinutes } = await repository.getMinRestMinutes();
      const { weekStart, weekEnd } = mondayWeekBounds(new Date(), zone);
      const existingWork = await repository.getWorkShiftsNear(weekStart, weekEnd);
      const violations = checkMinimumRest(request.body.proposals, existingWork, minRestMinutes, zone, weekStart, weekEnd);
      return { weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString(), minRestMinutes, violations };
    } catch (error) { app.log.error(error); return reply.code(503).send({ error: 'database_unavailable' }); }
  });

  const preferencesBody = {
    type: 'object', additionalProperties: false, required: ['version', 'intervals'],
    properties: {
      version: { type: 'string' },
      intervals: {
        type: 'array', maxItems: 50,
        items: {
          type: 'object', additionalProperties: false, required: ['dayOfWeek', 'startTime', 'endTime', 'weight'],
          properties: {
            dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
            startTime: { type: 'string', maxLength: 5 },
            endTime: { type: 'string', maxLength: 5 },
            weight: { type: 'number', minimum: 0 },
          },
        },
      },
    },
  } as const;

  app.put<{ Body: { version: string; intervals: PreferenceInterval[] } }>('/api/work-profile/preferences', { schema: { body: preferencesBody } }, async (request, reply) => {
    if (!repository?.replaceWorkPreferences) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      return await repository.replaceWorkPreferences(request.body.version, request.body.intervals);
    } catch (error) {
      if (error instanceof PreferencesConflictError) return reply.code(409).send({ error: error.message });
      if (error instanceof PreferencesValidationError) return reply.code(400).send({ error: error.message, rowIndex: error.rowIndex });
      request.log.error({ err: error }, 'Work preferences not saved');
      return reply.code(503).send({ error: 'preferences_not_saved' });
    }
  });

  const weeklyWorkLimitBody = {
    type: 'object', additionalProperties: false, required: ['maxHours'],
    properties: { maxHours: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 168 } },
  } as const;

  app.put<{ Body: { maxHours: number | null } }>('/api/profile/weekly-work-limit', { schema: { body: weeklyWorkLimitBody } }, async (request, reply) => {
    if (!repository?.setMaxWeeklyWorkHours) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      return await repository.setMaxWeeklyWorkHours(request.body.maxHours);
    } catch (error) {
      if (error instanceof ProfileValidationError) return reply.code(400).send({ error: error.message, field: error.field });
      request.log.error({ err: error }, 'Weekly work limit not saved');
      return reply.code(503).send({ error: 'profile_not_saved' });
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
      servers: [{ url: process.env.OPENAPI_SERVER_URL?.trim() || 'http://localhost:4000', description: 'Current API host' }],
      tags: [
        { name: 'Work profile', description: 'Versioned availability, hourly rates and pay snapshots.' },
        { name: 'System', description: 'Liveness and dependency readiness.' },
        { name: 'Calendar', description: 'Calendar overview and event lifecycle.' },
        { name: 'Work profile', description: 'Work limits, hour target, commute, availability and shift templates used by planning.' },
        { name: 'Scheduling', description: 'Weekly planning, versions, validation and approval.' },
        { name: 'Imports', description: 'Reviewable imports from schedules, ICS and class files.' },
        { name: 'Google import', description: 'One-time, read-only Google Calendar import.' },
        { name: 'Blocks', description: 'Vacation, exam sessions and days off blocks.' },
      ],
      externalDocs: { description: 'KAC bilingual developer documentation', url: process.env.DOCUSAURUS_URL ?? 'http://localhost:3000' },
    },
  });
  app.register(swaggerUi, {
    routePrefix: `${API_PREFIX}/docs`,
    staticCSP: true,
    uiConfig: { deepLinking: true, displayRequestDuration: true, docExpansion: 'list', url: `${API_PREFIX}/openapi.json` },
  });

  // This route is the stable JSON artifact consumed by Swagger UI, Docusaurus and CI drift checks.
  app.get(`${API_PREFIX}/openapi.json`, { schema: { hide: true } }, async () => app.swagger());

  const scheduleReader = options.scheduleReader ?? new DemoScheduleReader();
  app.register(async (v1) => {
    registerWorkProfile(v1,options.workProfileRepository,options.userScope??demoScope);
    await healthRoutes(v1, { repository });
    await calendarRoutes(v1, { repository });
    await profileRoutes(v1, { repository: options.workProfileRepository, scope: options.userScope });
    await schedulingRoutes(v1, { repository: options.scheduleRepository });
    await importRoutes(v1, { repository, scheduleRepository: options.scheduleRepository, scheduleReader, google: options.google });
    await blockRoutes(v1,{repository,scope:options.userScope});
    registerGoogleImport(v1, repository, options.google);
  }, { prefix: API_PREFIX });

  return app;
}