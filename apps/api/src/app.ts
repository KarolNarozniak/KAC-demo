import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DemoCalendarOverview } from './database.js';
import { buildImportPreview } from './import/preview.js';
import { resolveRow, type ImportRow } from './import/rules.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput, ImportFormat, ImportSource } from './import/session.js';

export type DemoRepository = {
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<DemoCalendarOverview | null>;
  createImportSession?: (input: CreateSessionInput) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[]) => Promise<ConfirmResult>;
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
  },
} as const;

const rowsProperty = { type: 'array', maxItems: 200, items: importRowSchema } as const;
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

export function buildApi(repository: DemoRepository | null, allowedOrigins: string[] = []) {
  const app: FastifyInstance = Fastify({ logger: true });
  const allowAnyOrigin = allowedOrigins.includes('*');
  const origins = new Set(allowedOrigins);

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowAnyOrigin || origins.has(origin)) callback(null, true);
      else callback(new Error('Origin is not allowed by KAC API CORS policy'), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
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

  // Podgląd importu: sprawdza wiersze po każdej poprawce użytkownika. Niczego nie zapisuje w kalendarzu.
  // Jeśli podano identyfikator sesji, przedłuża ją (sesja wygasa po 15 minutach bez akcji).
  app.post<{ Body: { rows: ImportRow[]; importSessionId?: string } }>('/api/import/preview', { schema: importPreviewSchema }, async (request) => {
    if (request.body.importSessionId && repository?.touchImportSession) {
      await repository.touchImportSession(request.body.importSessionId).catch((error) => request.log.warn({ err: error }, 'Could not extend import session'));
    }
    return { rows: buildImportPreview(request.body.rows) };
  });

  // Sesja importu: zapamiętuje odczytane wiersze do kontroli (t_importy, t_pozycje_importu). Kalendarz bez zmian.
  app.post<{ Body: { source: ImportSource; format: ImportFormat; rows: ImportRow[] } }>(
    '/api/import/sessions',
    { schema: createSessionSchema },
    async (request, reply) => {
      if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
      try {
        const preview = buildImportPreview(request.body.rows);
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
      const accepted: AcceptedRow[] = request.body.rows.flatMap((row) => {
        const resolved = resolveRow(row);
        return resolved.ok
          ? [{ id: row.id, title: resolved.title, start: resolved.start, end: resolved.end, category: row.category ?? 'Personal', location: row.location?.trim() || null }]
          : [];
      });
      try {
        const result = await repository.confirmImportSession(request.params.id, accepted);
        if (result.kind === 'not-found') return reply.code(404).send({ error: 'import_session_not_found' });
        if (result.kind === 'closed') return reply.code(409).send({ error: 'import_session_closed' });
        if (result.kind === 'expired') return reply.code(410).send({ error: 'import_session_expired' });
        if (result.kind === 'unknown-rows') return reply.code(422).send({ error: 'unknown_rows', rowIds: result.rowIds });
        return reply.code(201).send({ saved: result.saved.length, rejected: result.rejected, events: result.saved });
      } catch (error) {
        request.log.error({ err: error }, 'Could not confirm import session');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    },
  );

  return app;
}
