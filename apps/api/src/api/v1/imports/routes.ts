import type { FastifyInstance } from 'fastify';
import type { ApiDependencies } from '../../contracts.js';
import { readClassImage } from '../../../import/classes/image-reader.js';
import { readClassPdf, PdfReadError } from '../../../import/classes/reader.js';
import { importCollisions } from '../../../import/collisions-preview.js';
import { decodeIcsFile, IcsError, looksLikeIcs, parseIcs } from '../../../import/ics/parse.js';
import { buildImportPreview } from '../../../import/preview.js';
import { resolveRow, type ExistingEvent, type ImportRow } from '../../../import/rules.js';
import { checkScheduleFile, MAX_SCHEDULE_FILE_BYTES } from '../../../import/work-schedule/file-check.js';
import { mapShiftsToRows, READ_STATUS_LABELS } from '../../../import/work-schedule/mapping.js';
import { ScheduleReadError } from '../../../import/work-schedule/local-reader.js';
import type { AcceptedRow, ImportFormat, ImportSource } from '../../../import/session.js';
import type { CalendarOverview } from '../../../database.js';
import { documented, errorExamples, withExamples, type NamedExamples } from '../../examples.js';
import { classReadExamples, confirmExamples, confirmInputExamples, confirmRejectedExamples, createSessionExamples, fileErrorExamples, previewExamples, previewInputExamples, readFileExamples,
  sessionExamples, workScheduleReadExamples } from './examples.js';

const importRowSchema = { type: 'object', required: ['id', 'title', 'date', 'startTime', 'endTime'], additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 }, title: { type: 'string', maxLength: 200 }, date: { type: 'string', maxLength: 10 },
    startTime: { type: 'string', maxLength: 5 }, endTime: { type: 'string', maxLength: 5 }, endDate: { type: 'string', maxLength: 10 },
    category: { type: 'string', enum: ['Class', 'Work', 'Personal'] }, location: { type: 'string', maxLength: 200 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
    employee: { type: 'string', maxLength: 200 }, overnightConfirmed: { type: 'boolean' }, duplicateDecision: { type: 'string', enum: ['skip', 'replace', 'keepBoth'] }, replacementId: { type: 'string', minLength: 1, maxLength: 200 } },
} as const;
const rowsProperty = { type: 'array', maxItems: 1000, items: importRowSchema } as const;
const sessionIdSchema = { type: 'string', minLength: 1, maxLength: 64 } as const;
const ok = (description: string, examples: NamedExamples) => documented({ type: 'object', additionalProperties: true }, description, examples);
const unavailable = () => errorExamples('Baza danych niedostępna albo nieskonfigurowana.', { database_unavailable: 'Baza niedostępna', database_not_configured: 'Brak DATABASE_URL' });
const fileResponses = (created: NamedExamples) => ({ 201: ok('Odczytane wiersze, podgląd i sesja importu do kontroli.', created),
  422: ok('Plik pusty, za duży, w nieobsługiwanym formacie, uszkodzony albo bez rozpoznanych danych.', fileErrorExamples),
  429: errorExamples('Czytnik plików jest zajęty – spróbuj ponownie za chwilę.', { 'reader-busy': 'Czytnik zajęty' }), 503: unavailable() });
const importPreviewSchema = { body: { type: 'object', required: ['rows'], additionalProperties: false, properties: { rows: rowsProperty, importSessionId: sessionIdSchema } } } as const;
const createSessionSchema = { body: { type: 'object', required: ['source', 'format', 'rows'], additionalProperties: false, properties: {
  source: { type: 'string', enum: ['classes', 'work'] }, format: { type: 'string', enum: ['PDF', 'Zdjęcie', 'ICS/CSV'] }, rows: { ...rowsProperty, minItems: 1 },
} } } as const;
const confirmSchema = { params: { type: 'object', required: ['id'], properties: { id: sessionIdSchema } }, body: { type: 'object', required: ['rows'], additionalProperties: false, properties: { rows: rowsProperty } } } as const;
const readBodyLimit = Math.ceil(MAX_SCHEDULE_FILE_BYTES * 1.4) + 4096;
const readScheduleSchema = { body: { type: 'object', required: ['fileName', 'dataBase64'], additionalProperties: false, properties: {
  fileName: { type: 'string', minLength: 1, maxLength: 255 }, dataBase64: { type: 'string', maxLength: readBodyLimit },
} } } as const;
const cancelSchema = { params: { type: 'object', required: ['id'], properties: { id: sessionIdSchema } } } as const;

export async function importRoutes(app: FastifyInstance, options: ApiDependencies) {
  const { repository, scheduleReader } = options;
  const existingEventsFor = async (_rows: ImportRow[]): Promise<ExistingEvent[]> => repository?.listEventsForImport ? repository.listEventsForImport() : [];

  app.post<{ Body: { rows: ImportRow[]; importSessionId?: string } }>('/import/preview', { schema: { ...importPreviewSchema, body: withExamples(importPreviewSchema.body, previewInputExamples),
    tags: ['Imports'], summary: 'Preview and validate import rows', description: 'Checks imported rows against each other and the calendar. Does not write events.', operationId: 'previewImport', response: { 200: ok('Wiersze ze statusem kontroli, duplikatami i oznaczeniem zmian nocnych.', previewExamples), 503: unavailable() },
  } }, async (request, reply) => {
    if (request.body.importSessionId && repository?.touchImportSession) {
      await repository.touchImportSession(request.body.importSessionId).catch((error) => request.log.warn({ err: error }, 'Could not extend import session'));
    }
    let existing: ExistingEvent[] = [];
    try { existing = await existingEventsFor(request.body.rows); }
    catch (error) {
      request.log.warn({ err: error }, 'Import preview could not read calendar events');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
    return { rows: buildImportPreview(request.body.rows, existing) };
  });

  app.post<{ Body: { source: ImportSource; format: ImportFormat; rows: ImportRow[] } }>('/import/sessions', { schema: { ...createSessionSchema, body: withExamples(createSessionSchema.body, createSessionExamples),
    tags: ['Imports'], summary: 'Create import review session', description: 'Stores a proposed import and its initial validation. Calendar records are unchanged until confirmation.', operationId: 'createImportSession', response: { 201: ok('Sesja importu utworzona; kalendarz bez zmian.', sessionExamples), 503: unavailable() },
  } }, async (request, reply) => {
    if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const preview = buildImportPreview(request.body.rows, await existingEventsFor(request.body.rows));
      const session = await repository.createImportSession({ ...request.body, preview });
      return reply.code(201).send({ importSessionId: session.id, expiresAt: session.expiresAt.toISOString(), rows: preview });
    } catch (error) {
      request.log.error({ err: error }, 'Could not create import session');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  app.post<{ Params: { id: string }; Body: { rows: ImportRow[] } }>('/import/sessions/:id/confirm', { schema: { ...confirmSchema, body: withExamples(confirmSchema.body, confirmInputExamples),
    tags: ['Imports'], summary: 'Confirm reviewed import rows', description: 'Revalidates the accepted rows and writes the whole accepted batch atomically. Duplicate decisions must be explicit.', operationId: 'confirmImportSession', response: { 201: ok('Zapisane wydarzenia i podsumowanie (wszystkie albo żadne).', confirmExamples),
      404: errorExamples('Sesja importu nie istnieje.', { import_session_not_found: 'Brak sesji' }), 409: errorExamples('Sesja jest już zamknięta.', { import_session_closed: 'Sesja zamknięta' }),
      410: errorExamples('Sesja wygasła po 15 minutach bez akcji.', { import_session_expired: 'Sesja wygasła' }),
      422: ok('Błędne wiersze, niepotwierdzona zmiana nocna, brak decyzji o duplikatach albo wiersze spoza sesji.', confirmRejectedExamples), 503: unavailable() },
  } }, async (request, reply) => {
    if (!repository?.confirmImportSession) return reply.code(503).send({ error: 'database_not_configured' });
    const preview = buildImportPreview(request.body.rows);
    if (preview.some((row) => row.status === 'error')) return reply.code(422).send({ error: 'invalid_rows', rows: preview });
    const resolvedRows = request.body.rows.map((row) => ({ row, resolved: resolveRow(row) }));
    const unconfirmed = resolvedRows.filter(({ row, resolved }) => resolved.ok && resolved.needsConfirmation && !row.overnightConfirmed).map(({ row }) => row.id);
    if (unconfirmed.length > 0) return reply.code(422).send({ error: 'overnight_not_confirmed', rowIds: unconfirmed });
    const accepted: AcceptedRow[] = resolvedRows.flatMap(({ row, resolved }) => resolved.ok
      ? [{ id: row.id, title: resolved.title, start: resolved.start, end: resolved.end, category: row.category ?? 'Personal', location: row.location?.trim() || null, duplicateDecision: row.duplicateDecision, replacementId: row.replacementId }]
      : []);
    try {
      const result = await repository.confirmImportSession(request.params.id, accepted);
      if (result.kind === 'not-found') return reply.code(404).send({ error: 'import_session_not_found' });
      if (result.kind === 'closed') return reply.code(409).send({ error: 'import_session_closed' });
      if (result.kind === 'expired') return reply.code(410).send({ error: 'import_session_expired' });
      if (result.kind === 'unknown-rows') return reply.code(422).send({ error: 'unknown_rows', rowIds: result.rowIds });
      if (result.kind === 'needs-decision') return reply.code(422).send({ error: 'duplicate_decision_required', missingDecisions: result.missingDecisions, invalidDecisions: result.invalidDecisions });
      const { summary } = result;
      return reply.code(201).send({ saved: summary.added + summary.replaced, rejected: summary.rejected, summary, events: result.saved.filter((event) => event.action !== 'skipped') });
    } catch (error) {
      request.log.error({ err: error }, 'Could not confirm import session');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  app.post<{ Params: { id: string } }>('/import/sessions/:id/cancel', { schema: { ...cancelSchema,
    tags: ['Imports'], summary: 'Cancel import session', description: 'Closes the pending import without changing the calendar.', operationId: 'cancelImportSession', response: { 200: ok('Sesja anulowana; kalendarz bez zmian.', { cancelled: { summary: 'Import anulowany', description: 'Użytkownik zrezygnował z importu. Odczytane wiersze zostały odrzucone, a kalendarz się nie zmienił.', value: { status: 'cancelled' } } }),
      409: errorExamples('Sesja nie jest aktywna.', { import_session_not_active: 'Sesja nieaktywna' }), 503: unavailable() },
  } }, async (request, reply) => {
    if (!repository?.cancelImportSession) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const cancelled = await repository.cancelImportSession(request.params.id);
      return cancelled ? { status: 'cancelled' } : reply.code(409).send({ error: 'import_session_not_active' });
    } catch (error) {
      request.log.error({ err: error }, 'Could not cancel import session');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  app.post<{ Body: { fileName: string; dataBase64: string } }>('/import/classes/read', { schema: { ...readScheduleSchema, body: withExamples(readScheduleSchema.body, readFileExamples),
    tags: ['Imports'], summary: 'Read a class timetable', description: 'Reads an ICS, text PDF or WAT timetable image, builds a review session and returns collision diagnostics. Does not modify the calendar.', operationId: 'readClassTimetable', response: fileResponses(classReadExamples),
  }, bodyLimit: readBodyLimit }, async (request, reply) => {
    if (!repository?.createImportSession || !repository.listEventsForImport) return reply.code(503).send({ error: 'database_not_configured' });
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
      catch (error) { return reply.code(422).send({ error: error instanceof IcsError ? error.message : 'corrupted-file' }); }
      if (parsed.rows.length === 0) return reply.code(422).send({ error: parsed.eventCount === 0 ? 'empty-calendar' : 'no-importable-events', skipped: parsed.skipped });
      try {
        const preview = buildImportPreview(parsed.rows, await repository.listEventsForImport());
        const session = await repository.createImportSession({ source: 'classes', format: 'ICS/CSV', rows: parsed.rows, preview });
        return reply.code(201).send({ source: 'ics', rows: parsed.rows.map((row) => ({ ...row, reviewRequired: false, sourcePage: 1 })), preview,
          importSessionId: session.id, expiresAt: session.expiresAt.toISOString(), academicYear: parsed.calendarName ?? 'Plik ICS',
          calendarName: parsed.calendarName, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, eventCount: parsed.eventCount,
          skipped: parsed.skipped, fileTimeZone: parsed.fileTimeZone, userTimeZone: parsed.userTimeZone, warnings: parsed.warnings,
          collisions: importCollisions(parsed.rows, overview?.events ?? [], zone) });
      } catch (error) {
        request.log.error({ err: error }, 'ICS import could not create preview');
        return reply.code(503).send({ error: 'database_unavailable' });
      }
    }
    const file = checkScheduleFile(request.body.dataBase64);
    if (!file.ok) return reply.code(422).send({ error: file.reason });
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

  app.post<{ Body: { fileName: string; dataBase64: string } }>('/import/work-schedule/read', { schema: { ...readScheduleSchema, body: withExamples(readScheduleSchema.body, readFileExamples),
    tags: ['Imports'], summary: 'Read a work schedule', description: 'Uses the configured local PDF/image reader and creates a review session. Calendar changes require explicit confirmation.', operationId: 'readWorkSchedule', response: fileResponses(workScheduleReadExamples),
  }, bodyLimit: readBodyLimit + 1024 }, async (request, reply) => {
    const file = checkScheduleFile(request.body.dataBase64);
    if (!file.ok) return reply.code(422).send({ error: file.reason });
    if (!repository?.createImportSession) return reply.code(503).send({ error: 'database_not_configured' });
    let userName = '';
    try { userName = repository.getImportUserName ? await repository.getImportUserName() : ''; }
    catch (error) {
      request.log.error({ err: error }, 'Could not read import user');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
    let shifts;
    try { shifts = await scheduleReader.read({ name: request.body.fileName, type: file.type, bytes: file.bytes }, { userName }); }
    catch (error) {
      const code = error instanceof ScheduleReadError ? error.code : file.type === 'PDF' ? 'unreadable-pdf' : 'unreadable-image';
      request.log.warn({ stage: 'recognition', fileType: file.type, bytes: file.bytes.length, reason: code, err: error instanceof ScheduleReadError ? undefined : error }, 'Work schedule not read');
      return reply.code(code === 'reader-busy' ? 429 : 422).send({ error: code });
    }
    try {
      const { readStatus, rows } = mapShiftsToRows(shifts, userName);
      if (readStatus === 'none') return reply.code(422).send({ error: 'nothing_recognized', readStatusLabel: READ_STATUS_LABELS.none });
      const preview = buildImportPreview(rows, await existingEventsFor(rows));
      const session = await repository.createImportSession({ source: 'work', format: file.type === 'PDF' ? 'PDF' : 'Zdjęcie', rows, preview });
      return reply.code(201).send({ importSessionId: session.id, expiresAt: session.expiresAt.toISOString(), fileType: file.type,
        readStatus, readStatusLabel: READ_STATUS_LABELS[readStatus], readerIsDemo: !scheduleReader.real, userName, rows, preview });
    } catch (error) {
      request.log.error({ err: error }, 'Could not create work schedule import session');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });
}
