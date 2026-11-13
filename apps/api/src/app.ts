import { demoScope } from './api/scope.js';
import { registerWorkProfile } from './api/v1/work-profile/routes.js';
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
import { blockRoutes } from './api/v1/blocks/routes.js';
import { aiImportRoutes } from './api/v1/imports/ai-routes.js';
import { assistantRoutes } from './api/v1/assistant/routes.js';
import { notificationRoutes } from './api/v1/notifications/routes.js';
import { AiRepository } from './ai/repository.js';
import { AiService } from './ai/service.js';
import { FoundryResponsesClient } from './ai/foundry.js';
import { config } from './config.js';

export type { ApiOptions, CalendarRepository } from './api/contracts.js';

const API_PREFIX = '/api/v1';

export function buildApi(repository: CalendarRepository | null, allowedOrigins: string[] = [], options: ApiOptions = {}) {
  // `x-examples` to przykłady dla Swagger UI (api/examples.ts); Ajv w trybie strict musi znać ten klucz.
  const app: FastifyInstance = Fastify({ logger: true, ajv: { customOptions: { keywords: ['x-examples'] } } });
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
      servers: [{ url: process.env.OPENAPI_SERVER_URL?.trim() || 'http://localhost:4000', description: 'Current API host' }],
      tags: [
        { name: 'System', description: 'Liveness and dependency readiness.' },
        { name: 'Calendar', description: 'Calendar overview and event lifecycle.' },
        { name: 'Work profile', description: 'Work limits, hour target, commute, versioned availability, hourly rate and shift templates used by planning.' },
        { name: 'Scheduling', description: 'Weekly planning, versions, validation and approval.' },
        { name: 'Imports', description: 'Reviewable imports from schedules, ICS and class files.' },
        { name: 'Google import', description: 'One-time, read-only Google Calendar import.' },
        { name: 'Blocks', description: 'Vacation, exam sessions and days off blocks.' },
        { name: 'AI imports', description: 'AI document extraction into the existing review/confirmation pipeline.' },
        { name: 'Assistant', description: 'Application-scoped conversations and confirmation-gated calendar actions.' },
        { name: 'Notifications', description: 'In-app notification preferences and due reminder queue.' },
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
  const aiService = options.aiService ?? (config.azureAi.projectEndpoint && config.azureAi.modelDeployment
    ? new AiService(new FoundryResponsesClient(config.azureAi))
    : undefined);
  app.register(async (v1) => {
    registerWorkProfile(v1,options.workProfileRepository,options.userScope??demoScope);
    await healthRoutes(v1, { repository });
    await calendarRoutes(v1, { repository, scope: options.userScope ?? demoScope });
    await profileRoutes(v1, { repository: options.workProfileRepository, scope: options.userScope });
    await schedulingRoutes(v1, { repository: options.scheduleRepository, scope: options.userScope ?? demoScope });
    await importRoutes(v1, { repository, scheduleRepository: options.scheduleRepository, scheduleReader, google: options.google, scope: options.userScope ?? demoScope });
    await aiImportRoutes(v1, { repository, aiService, aiRepository: options.aiRepository, scope: options.userScope ?? demoScope });
    await assistantRoutes(v1, { repository, workProfileRepository: options.workProfileRepository, aiService, aiRepository: options.aiRepository, scope: options.userScope ?? demoScope });
    await notificationRoutes(v1, { repository: options.notificationRepository, scope: options.userScope ?? demoScope });
    await blockRoutes(v1,{repository,scope:options.userScope});
    registerGoogleImport(v1, repository, options.google ?? {}, options.userScope ?? demoScope);
  }, { prefix: API_PREFIX });

  return app;
}
