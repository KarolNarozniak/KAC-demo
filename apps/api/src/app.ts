import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
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

export type CalendarRepository = {
  deleteEvent?: (eventId: string) => Promise<string[] | null>;
  createEvent?: (input: EventInput) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<CalendarOverview | null>;
  updateEvent?: (eventId: string, input: EventInput) => Promise<EventInput & { id: string }>;
  getEventOrSeries?: (eventId: string) => Promise<any>;
  updateSeriesFrom?: (eventId: string, input: EventInput) => Promise<EventInput & { id: string }>;
  // Import (S23KC2S1P2-32): sesja, przedłużanie, zatwierdzenie i anulowanie.
  createImportSession?: (input: CreateSessionInput) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[]) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string) => Promise<boolean>;
  // Import grafiku pracy (S23KC2S1P2-44): duplikaty w kalendarzu i rozpoznawanie własnych zmian.
  listEventsForImport?: () => Promise<ExistingEvent[]>;
  getImportUserName?: () => Promise<string>;
};

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

  app.get('/api/health/live', async () => ({ api: 'ok' }));

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

  app.post<{ Body: EventInput }>('/api/events', {
    schema: { body: { type: 'object', additionalProperties: false,
      required: ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200 },
        start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
        end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
        category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
        location: { type: 'string', maxLength: 500 }, mandatory: { type: 'boolean' }, repeatWeekly: { type: 'boolean' }
      } } }
  }, async (request, reply) => {
    const input = request.body;
    const validDate = (value: string) => {
      const parsed = new Date(value + ':00Z');
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
    };
    if (!input.title.trim() || !validDate(input.start) || !validDate(input.end) || input.end <= input.start)
      return reply.code(400).send({ error: 'invalid_event' });
    if (!repository?.createEvent) return reply.code(503).send({ error: 'database_not_configured' });
    try { return reply.code(201).send(await repository.createEvent(input)); }
    catch (error) {
      app.log.error(error);
      return reply.code(503).send({ error: 'event_not_saved' });
    }
  });

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
  
  app.put<{ Params: { id: string }, Body: EventInput }>('/api/events/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } },
      body: {
        type: 'object', additionalProperties: false,
        required: ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
          end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
          category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
          location: { type: 'string', maxLength: 500 },
          mandatory: { type: 'boolean' },
          repeatWeekly: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    if (!repository?.updateEvent) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const updated = await repository.updateEvent(request.params.id, request.body);
      return updated;
    } catch (error) {
      app.log.error(error);
      return reply.code(404).send({ error: 'event_not_updated' });
    }
  });

  app.put<{ Params: { id: string }, Body: EventInput }>('/api/events/:id/series', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } },
      body: {
        type: 'object', additionalProperties: false,
        required: ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
          end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
          category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
          location: { type: 'string', maxLength: 500 },
          mandatory: { type: 'boolean' },
          repeatWeekly: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    if (!repository?.updateSeriesFrom) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const updated = await repository.updateSeriesFrom(request.params.id, request.body);
      return updated;
    } catch (error) {
      app.log.error(error);
      return reply.code(404).send({ error: 'series_not_updated' });
    }
  });

  // --- Import: kontrola rozpoznanych danych przed zapisem (S23KC2S1P2-32) ---

  // Podgląd importu: sprawdza wiersze po każdej poprawce użytkownika. Niczego nie zapisuje w kalendarzu.
  // Jeśli podano identyfikator sesji, przedłuża ją (sesja wygasa po 15 minutach bez akcji).
  app.post<{ Body: { rows: ImportRow[]; importSessionId?: string } }>('/api/import/preview', { schema: importPreviewSchema }, async (request) => {
    if (request.body.importSessionId && repository?.touchImportSession) {
      await repository.touchImportSession(request.body.importSessionId).catch((error) => request.log.warn({ err: error }, 'Could not extend import session'));
    }
    let existing: ExistingEvent[] = [];
    try {
      existing = await existingEventsFor(request.body.rows);
    } catch (error) {
      request.log.warn({ err: error }, 'Import preview could not read calendar events');
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
    await healthRoutes(v1, { repository });
    await calendarRoutes(v1, { repository });
    await profileRoutes(v1, { repository: options.workProfileRepository, scope: options.userScope });
    await schedulingRoutes(v1, { repository: options.scheduleRepository });
    await importRoutes(v1, { repository, scheduleRepository: options.scheduleRepository, scheduleReader, google: options.google });
    registerGoogleImport(v1, repository, options.google);
  }, { prefix: API_PREFIX });

  return app;
}
