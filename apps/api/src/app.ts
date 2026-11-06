import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { calendarRoutes } from './api/v1/calendar/routes.js';
import { healthRoutes } from './api/v1/health/routes.js';
import { importRoutes } from './api/v1/imports/routes.js';
import { schedulingRoutes } from './api/v1/scheduling/routes.js';
import type { ApiOptions, CalendarRepository } from './api/contracts.js';
import { registerGoogleImport } from './api/v1/imports/google-routes.js';
import { DemoScheduleReader } from './import/work-schedule/reader.js';

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
        summary: 'Calendar, imports and weekly schedule planning API.',
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
      servers: [{ url: process.env.OPENAPI_SERVER_URL?.trim() || 'http://localhost:4000', description: 'Current API host' }],
      tags: [
        { name: 'System', description: 'Liveness and dependency readiness.' },
        { name: 'Calendar', description: 'Calendar overview and event lifecycle.' },
        { name: 'Scheduling', description: 'Weekly planning, constraints, versions and approval.' },
        { name: 'Imports', description: 'Reviewable imports from schedules, ICS and class files.' },
        { name: 'Google import', description: 'One-time, read-only Google Calendar import.' },
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
    await healthRoutes(v1, { repository });
    await calendarRoutes(v1, { repository });
    await schedulingRoutes(v1, { repository: options.scheduleRepository });
    await importRoutes(v1, { repository, scheduleRepository: options.scheduleRepository, scheduleReader, google: options.google });
    registerGoogleImport(v1, repository, options.google);
  }, { prefix: API_PREFIX });

  return app;
}
