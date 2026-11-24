import { demoScope } from './api/scope.js';
import { registerWorkProfile } from './api/v1/work-profile/routes.js';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { extname } from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { calendarRoutes } from './api/v1/calendar/routes.js';
import { healthRoutes } from './api/v1/health/routes.js';
import { importRoutes } from './api/v1/imports/routes.js';
import { profileRoutes } from './api/v1/profile/routes.js';
import { schedulingRoutes } from './api/v1/scheduling/routes.js';
import type { ApiOptions, CalendarRepository } from './api/contracts.js';
import { registerGoogleImport } from './api/v1/imports/google-routes.js';
import { registerGoogleIntegration } from './api/v1/integrations/google-routes.js';
import { requestLogSerializer } from './api/log-redaction.js';
import { documentAuth, enforceAuth } from './api/auth-guard.js';
import { documentAiLimit, enforceAiLimit } from './api/ai-limit.js';
import { authRoutes } from './api/v1/auth/routes.js';
import { clientAddress, trustProxyOption } from './api/client-address.js';
import { acceptEmptyBodies } from './api/empty-body.js';
import { DemoScheduleReader } from './import/work-schedule/reader.js';
import { blockRoutes } from './api/v1/blocks/routes.js';
import { aiImportRoutes } from './api/v1/imports/ai-routes.js';
import { assistantImportRoutes } from './api/v1/assistant/import-routes.js';
import { assistantRoutes } from './api/v1/assistant/routes.js';
import { notificationRoutes } from './api/v1/notifications/routes.js';
import { premiumRoutes } from './api/v1/premium/routes.js';
import { AiRepository } from './ai/repository.js';
import { AiService } from './ai/service.js';
import { FoundryResponsesClient } from './ai/foundry.js';
import { config } from './config.js';

export type { ApiOptions, CalendarRepository } from './api/contracts.js';

const API_PREFIX = '/api/v1';

export function buildApi(repository: CalendarRepository | null, allowedOrigins: string[] = [], options: ApiOptions = {}) {
  // `x-examples` to przykłady dla Swagger UI (api/examples.ts); Ajv w trybie strict musi znać ten klucz.
  // Log żądań bez kodu autoryzacji i state z adresów powrotu Google (api/log-redaction.ts).
  const app: FastifyInstance = Fastify({ logger: { serializers: { req: requestLogSerializer } }, ajv: { customOptions: { keywords: ['x-examples'] } },
    trustProxy: trustProxyOption(options.trustProxy ?? config.trustProxy) });
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  acceptEmptyBodies(app);
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
        { name: 'Auth', description: 'KAC account: registration, sign-in sessions (Authorization: Bearer), password change and account deletion.' },
        { name: 'Calendar', description: 'Calendar overview and event lifecycle.' },
        { name: 'Work profile', description: 'Work limits, hour target, commute, versioned availability, hourly rate and shift templates used by planning.' },
        { name: 'Scheduling', description: 'Weekly planning, versions, validation and approval.' },
        { name: 'Imports', description: 'Reviewable imports from schedules, ICS and class files.' },
        { name: 'Google import', description: 'One-time, read-only Google Calendar import.' },
        { name: 'Google integration', description: 'Persistent Google account connection: consent, encrypted tokens, granted access and calendar list.' },
        { name: 'Blocks', description: 'Vacation, exam sessions and days off blocks.' },
        { name: 'AI imports', description: 'AI document extraction into the existing review/confirmation pipeline.' },
        { name: 'Assistant', description: 'Application-scoped conversations and confirmation-gated calendar actions.' },
        { name: 'Premium', description: 'Premium campaign information and account-bound code redemption.' },
        { name: 'Notifications', description: 'In-app notification preferences and due reminder queue.' },
      ],
      externalDocs: { description: 'KAC bilingual developer documentation', url: process.env.DOCUSAURUS_URL ?? 'http://localhost:3000' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Token sesji z POST /api/v1/auth/login albo /auth/register.' } } },
      security: [{ bearerAuth: [] }],
    },
  });
  app.register(swaggerUi, {
    routePrefix: `${API_PREFIX}/docs`,
    staticCSP: true,
    uiConfig: { deepLinking: true, displayRequestDuration: true, docExpansion: 'list', url: `${API_PREFIX}/openapi.json` },
  });

  // Logowanie: kontrakt zawsze opisuje sesję (bearerAuth, 401), a sprawdzanie sesji działa, gdy serwer ma usługę kont (baza danych).
  // Bez niej (testy z wstrzykniętym użytkownikiem, API bez bazy) zakres użytkownika ustala options.userScope albo użytkownik demonstracyjny.
  documentAuth(app);
  app.register(rateLimit, { global: false, keyGenerator: (request) => clientAddress(request.ip) });
  const scope = options.auth ? enforceAuth(app, options.auth) : options.userScope ?? demoScope;
  documentAiLimit(app);
  enforceAiLimit(app, { repository: options.aiRepository, scope, dailyLimit: options.aiDailyLimit ?? config.aiDailyLimit });

  // This route is the stable JSON artifact consumed by Swagger UI, Docusaurus and CI drift checks.
  app.get(`${API_PREFIX}/openapi.json`, { schema: { hide: true } }, async () => app.swagger());

  const scheduleReader = options.scheduleReader ?? new DemoScheduleReader();
  const aiService = options.aiService ?? (config.azureAi.projectEndpoint && config.azureAi.modelDeployment
    ? new AiService(new FoundryResponsesClient(config.azureAi))
    : undefined);
  app.register(async (v1) => {
    // Własna obsługa błędów logowania – w osobnym kontekście, żeby nie zmieniała odpowiedzi pozostałych tras.
    await v1.register(async (group) => authRoutes(group, { auth: options.auth ?? null, limits: options.authRateLimits }));
    registerWorkProfile(v1, options.workProfileRepository, scope);
    await healthRoutes(v1, { repository });
    await calendarRoutes(v1, { repository, scope });
    await profileRoutes(v1, { repository: options.workProfileRepository, scope });
    await schedulingRoutes(v1, { repository: options.scheduleRepository, scope });
    await importRoutes(v1, { repository, scheduleRepository: options.scheduleRepository, scheduleReader, google: options.google, scope });
    await aiImportRoutes(v1, { repository, aiService, aiRepository: options.aiRepository, scope });
    await assistantImportRoutes(v1, { repository, aiService, aiRepository: options.aiRepository, scheduleReader, scope });
    await assistantRoutes(v1, { repository, workProfileRepository: options.workProfileRepository, aiService, aiRepository: options.aiRepository, scope });
    await notificationRoutes(v1, { repository: options.notificationRepository, scope });
    await premiumRoutes(v1, { service: options.premiumService, scope });
    await blockRoutes(v1, { repository, scope });
    registerGoogleImport(v1, repository, options.google ?? {}, scope);
    registerGoogleIntegration(v1, options.googleIntegration ?? null, scope);
  }, { prefix: API_PREFIX });

  if (options.webRoot) {
    app.register(fastifyStatic, {
      root: options.webRoot,
      prefix: '/',
      dotfiles: 'ignore',
      maxAge: 0,
      allowedPath: (_pathName, _root, request) => {
        const pathname = new URL(request.raw.url ?? '/', 'http://localhost').pathname;
        return pathname !== API_PREFIX && !pathname.startsWith(`${API_PREFIX}/`);
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.raw.url ?? '/', 'http://localhost').pathname;
      const isApiPath = pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
      const isAssetPath = extname(pathname) !== '' || pathname.startsWith('/_expo/') || pathname.startsWith('/assets/');
      if (request.method === 'GET' && !isApiPath && !isAssetPath && request.headers.accept?.includes('text/html'))
        return reply.type('text/html; charset=utf-8').sendFile('index.html');
      return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: `Route ${request.method}:${pathname} not found` });
    });
  }

  return app;
}
