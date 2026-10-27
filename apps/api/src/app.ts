import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { DemoCalendarOverview } from './database.js';
import { buildImportPreview } from './import/preview.js';
import { resolveRow, type ExistingEvent, type ImportRow } from './import/rules.js';
import { checkScheduleFile, MAX_SCHEDULE_FILE_BYTES } from './import/work-schedule/file-check.js';
import { mapShiftsToRows, READ_STATUS_LABELS } from './import/work-schedule/mapping.js';
import { DemoScheduleReader, type ScheduleReader } from './import/work-schedule/reader.js';
import type { AcceptedRow, ConfirmResult, CreateSessionInput, ImportFormat, ImportSource } from './import/session.js';

export type DemoRepository = {
  checkConnection: () => Promise<void>;
  getOverview: () => Promise<DemoCalendarOverview | null>;
  createImportSession?: (input: CreateSessionInput) => Promise<{ id: string; expiresAt: Date }>;
  touchImportSession?: (sessionId: string) => Promise<void>;
  confirmImportSession?: (sessionId: string, rows: AcceptedRow[]) => Promise<ConfirmResult>;
  cancelImportSession?: (sessionId: string) => Promise<boolean>;
  listEventsForImport?: () => Promise<ExistingEvent[]>;
  getImportUserName?: () => Promise<string>;
};

export type ApiOptions = {
  /** Mechanizm odczytu grafiku (S23KC2S1P2-44). Domyślnie czytnik demonstracyjny. */
  scheduleReader?: ScheduleReader;
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

const confirmSchema = {
  params: { type: 'object', required: ['id'], properties: { id: sessionIdSchema } },
  body: { type: 'object', required: ['rows'], additionalProperties: false, properties: { rows: rowsProperty } },
} as const;

export function buildApi(repository: DemoRepository | null, allowedOrigins: string[] = [], options: ApiOptions = {}) {
  const app: FastifyInstance = Fastify({ logger: true });
  const scheduleReader: ScheduleReader =
    options.scheduleReader ?? new DemoScheduleReader(async () => (repository?.getImportUserName ? repository.getImportUserName() : ''));
  // Wydarzenia z kalendarza do wykrywania duplikatów zmian pracy. Bez bazy porównanie jest pomijane.
  const existingEventsFor = async (rows: ImportRow[]): Promise<ExistingEvent[]> => {
    if (!repository?.listEventsForImport || !rows.some((row) => row.category === 'Work')) return [];
    return repository.listEventsForImport();
  };
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
          ? [{ id: row.id, title: resolved.title, start: resolved.start, end: resolved.end, category: row.category ?? 'Personal', location: row.location?.trim() || null, duplicateDecision: row.duplicateDecision }]
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

  // Import grafiku pracy (S23KC2S1P2-44): sprawdza plik, odczytuje zmiany i zakłada sesję importu do kontroli.
  // Kalendarz pozostaje bez zmian, dopóki użytkownik nie zatwierdzi importu.
  app.post<{ Body: { fileName: string; dataBase64: string } }>(
    '/api/import/work-schedule/read',
    { schema: readScheduleSchema, bodyLimit: READ_BODY_LIMIT + 1024 },
    async (request, reply) => {
      const file = checkScheduleFile(request.body.dataBase64);
      if (!file.ok) return reply.code(422).send({ error: file.reason });
      if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
      try {
        const userName = repository.getImportUserName ? await repository.getImportUserName() : '';
        const shifts = await scheduleReader.read({ name: request.body.fileName, type: file.type, bytes: file.bytes });
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
        request.log.error({ err: error }, 'Could not read work schedule');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    },
  );

  return app;
}
