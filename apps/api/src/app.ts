import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { CalendarOverview, EventInput } from './database.js';

export type CalendarRepository = {
  deleteEvent?: (eventId: string) => Promise<string[] | null>;
  createEvent?: (input: EventInput) => Promise<EventInput & { id: string }>;
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<CalendarOverview | null>;
};

export function buildApi(repository: CalendarRepository | null, allowedOrigins: string[] = []) {
  const app: FastifyInstance = Fastify({ logger: true });
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || origins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by KAC API CORS policy'), false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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

  return app;
}
