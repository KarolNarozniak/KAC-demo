import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DemoCalendarOverview } from './database.js';

export type DemoRepository = {
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<DemoCalendarOverview | null>;
};

export function buildApi(repository: DemoRepository | null, allowedOrigins: string[] = []) {
  const app: FastifyInstance = Fastify({ logger: true });
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || origins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by KAC API CORS policy'), false);
    },
    methods: ['GET', 'OPTIONS'],
  });

  app.get('/api/health/live', async () => ({ api: 'ok' }));

  app.get('/api/demo/connection', async () => {
    if (!repository) return { api: 'connected', database: 'not-configured', overview: null };
    try {
      return { api: 'connected', database: 'connected', overview: await repository.getOverview() };
    } catch (error) {
      app.log.error({ err: error }, 'Demo connection check could not read PostgreSQL');
      return { api: 'connected', database: 'unavailable', overview: null };
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

  app.get('/api/demo/calendar', async (_request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const overview = await repository.getOverview();
      if (!overview) return reply.code(404).send({ error: 'demo_calendar_not_seeded' });
      return overview;
    } catch (error) {
      app.log.error({ err: error }, 'Failed to read demo calendar from PostgreSQL');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  return app;
}
