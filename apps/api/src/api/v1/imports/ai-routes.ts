import type { FastifyInstance } from 'fastify';
import type { ApiDependencies } from '../../contracts.js';
import { AiFileValidationError, validateAiFile } from '../../../ai/file-validation.js';
import { buildImportPreview } from '../../../import/preview.js';
import { importCollisions } from '../../../import/collisions-preview.js';
import { mapShiftsToRows, READ_STATUS_LABELS } from '../../../import/work-schedule/mapping.js';
import { MAX_SCHEDULE_FILE_BYTES } from '../../../import/work-schedule/file-check.js';
import type { ImportRow } from '../../../import/rules.js';
import { config } from '../../../config.js';
import { AiInvalidOutputError } from '../../../ai/service.js';
import { documented, errorExamples, withExamples } from '../../examples.js';

const maximumBodyBytes = Math.ceil(MAX_SCHEDULE_FILE_BYTES * 1.4) + 4096;
const aiReadSchema = { body: withExamples({ type: 'object', required: ['fileName', 'dataBase64', 'source'], additionalProperties: false,
  properties: { fileName: { type: 'string', minLength: 1, maxLength: 255 }, dataBase64: { type: 'string', maxLength: maximumBodyBytes }, source: { type: 'string', enum: ['classes', 'work'] } },
}, {
  classImage: { summary: 'Syntetyczny plan zajęć (PNG)', description: 'Przykład kontraktu; treść nie jest prawdziwym plikiem ani prawdziwymi danymi.', value: { fileName: 'plan-demo.png', dataBase64: 'U1lOVEhFVElDLVBOZw==', source: 'classes' } },
  workPdf: { summary: 'Syntetyczny grafik pracy (PDF)', description: 'Przykład kontraktu; treść nie jest prawdziwym plikiem ani prawdziwymi danymi.', value: { fileName: 'grafik-demo.pdf', dataBase64: 'U1lOVEhFVElDLVBQRA==', source: 'work' } },
}) } as const;
const objectResponse = { type: 'object', description: 'AI extraction result and review-only import session; this operation does not change the calendar.', additionalProperties: true } as const;
const lowConfidence = 0.7;

export async function aiImportRoutes(app: FastifyInstance, options: Pick<ApiDependencies, 'repository' | 'aiService' | 'aiRepository' | 'scope'>) {
  app.post<{ Body: { fileName: string; dataBase64: string; source: 'classes' | 'work' } }>('/import/ai/read', {
    schema: { ...aiReadSchema, tags: ['AI imports'], summary: 'Read a timetable with Azure AI Foundry',
      description: 'Validates a JPG, PNG or PDF, sends the original bytes to the configured Foundry model deployment using stateless Responses API, validates strict JSON output and creates a review-only import session. No calendar event is written until the standard confirm endpoint is called.',
      operationId: 'readScheduleWithAi', response: {
        201: documented(objectResponse, 'Import session and editable preview; no calendar event is written.', {
          classRows: { summary: 'Syntetyczny podgląd zajęć', description: 'Wartości testowe schematu; nie są prawdziwym plikiem.', value: { source: 'ai', importSessionId: 'synthetic-session', rows: [{ title: 'Matematyka', date: '2026-11-16', startTime: '10:00', endTime: '11:30', category: 'Class', sourcePage: 1, confidence: 0.92 }], preview: [] } },
          workRows: { summary: 'Syntetyczny podgląd zmiany pracy', description: 'Wartości testowe schematu; nie są prawdziwym plikiem.', value: { source: 'work', importSessionId: 'synthetic-session', rows: [{ title: 'Praca', employee: 'Pracownik testowy', date: '2026-11-16', startTime: '08:00', endTime: '16:00', category: 'Work', sourcePage: 1, confidence: 0.92 }], preview: [] } },
        }),
        400: errorExamples('Fastify odrzucił żądanie niezgodne ze schematem.', { FST_ERR_VALIDATION: 'Niepoprawne body requestu.' }),
        413: errorExamples('Plik lub jego zdekodowany obraz przekracza limit.', { 'file-too-large': 'Plik przekracza 5 MB.', 'too-many-pages': 'PDF przekracza limit stron.', 'image-too-large': 'Obraz przekracza limit pikseli.', 'ai-payload-too-large': 'Obraz po kompresji nadal przekracza limit requestu modelu.' }),
        422: errorExamples('Format albo wynik AI nie nadaje się do bezpiecznego importu.', { 'unsupported-format': 'Nieobsługiwany format.', 'corrupted-file': 'Plik jest uszkodzony.', invalid_ai_output: 'Wynik AI nie pasuje do oczekiwanego JSON.', nothing_recognized: 'Nie rozpoznano wierszy do importu.' }),
        429: errorExamples('Lokalny parser PDF jest zajęty.', { 'reader-busy': 'Spróbuj ponownie po zakończeniu bieżącej walidacji.' }),
        502: errorExamples('Odpowiedź AI jest niepoprawna.', { invalid_ai_output: 'Wynik AI nie pasuje do oczekiwanego JSON.' }),
        503: errorExamples('Wymagana usługa jest niedostępna lub nieskonfigurowana.', { azure_ai_not_configured: 'Azure AI nie jest skonfigurowane.', database_not_configured: 'Baza danych nie jest skonfigurowana.', azure_ai_request_failed: 'Wywołanie modelu nie powiodło się.' }),
      },
    }, bodyLimit: maximumBodyBytes,
  }, async (request, reply) => {
    const { repository, aiService, aiRepository } = options;
    if (!aiService) return reply.code(503).send({ error: 'azure_ai_not_configured' });
    if (!repository?.createImportSession || !repository.listEventsForImport || !repository.getImportUserName) return reply.code(503).send({ error: 'database_not_configured' });
    const scope = options.scope(request);
    const startedAt = Date.now();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let operation = 'ai_class_import';
    try {
      const file = await validateAiFile(request.body.fileName, request.body.dataBase64, config.azureAi.maxPdfPages, config.azureAi.maxImagePixels);
      operation = request.body.source === 'work' ? 'ai_work_import' : 'ai_class_import';
      const [userName, existingEvents, overview] = await Promise.all([
        repository.getImportUserName(scope.userId),
        repository.listEventsForImport(scope.calendarId, scope.userId),
        repository.getOverview(scope.userId, scope.calendarId),
      ]);
      const extracted = await aiService.extractSchedule(file, request.body.source, userName);
      usage = extracted.usage;
      if (!extracted.rows.length) {
        await aiRepository?.logUsage(scope, operation, 'foundry-agent', usage.inputTokens, usage.outputTokens, Date.now() - startedAt, 'ok');
        return reply.code(422).send({ error: 'nothing_recognized' });
      }

      const mappedWork = request.body.source === 'work'
        ? mapShiftsToRows(extracted.rows.map((row) => ({
          employee: row.employee, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime,
          location: row.location, confidence: row.confidence ?? 0, sourcePage: row.sourcePage, sourceSnippet: row.sourceSnippet,
          unresolvedFields: row.unresolvedFields,
        })), userName)
        : null;
      if (mappedWork?.readStatus === 'none') return reply.code(422).send({ error: 'nothing_recognized' });
      const importRows: ImportRow[] = mappedWork?.rows ?? extracted.rows.map((row) => ({ ...row, sourcePage: row.sourcePage ?? 1 }));

      const preview = buildImportPreview(importRows, existingEvents);
      const session = await repository.createImportSession({
        source: request.body.source,
        format: file.type === 'PDF' ? 'PDF' : 'Zdjęcie',
        rows: importRows,
        preview,
      }, scope.userId);
      const collisions = importCollisions(importRows, overview?.events ?? [], overview?.user.timezone ?? 'Europe/Warsaw');
      await aiRepository?.logUsage(scope, operation, 'foundry-agent', usage.inputTokens, usage.outputTokens, Date.now() - startedAt, 'ok')
        .catch((error) => request.log.warn({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI usage metric not persisted'));

      if (request.body.source === 'work') {
        return reply.code(201).send({
          source: 'work', readerProvider: 'azure-ai-foundry', importSessionId: session.id, expiresAt: session.expiresAt.toISOString(),
          fileType: file.type, readStatus: mappedWork!.readStatus, readStatusLabel: READ_STATUS_LABELS[mappedWork!.readStatus],
          readerIsDemo: false, userName, rows: mappedWork!.rows.map((row) => ({ ...row, incomplete: row.incomplete || Boolean(row.unresolvedFields?.length) || (row.confidence ?? 0) < lowConfidence })),
          preview, collisions, filePageCount: file.pageCount, usage,
        });
      }

      const dates = importRows.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
      const rows = importRows.map((row) => ({ ...row, sourcePage: row.sourcePage ?? 1,
        reviewRequired: Boolean(row.unresolvedFields?.length) || (row.confidence ?? 0) < lowConfidence,
      }));
      return reply.code(201).send({
        source: 'ai', readerProvider: 'azure-ai-foundry', importSessionId: session.id, expiresAt: session.expiresAt.toISOString(),
        academicYear: 'Odczyt AI', dateFrom: dates[0] ?? '', dateTo: dates.at(-1) ?? '', rows,
        preview, collisions, warnings: ['Odczyt AI wymaga sprawdzenia przed zatwierdzeniem.'], filePageCount: file.pageCount, usage,
      });
    } catch (error) {
      if (error instanceof AiFileValidationError) {
        const status = error.code === 'file-too-large' || error.code === 'image-too-large' || error.code === 'ai-payload-too-large' ? 413 : error.code === 'reader-busy' ? 429 : 422;
        return reply.code(status).send({ error: error.code });
      }
      const code = error instanceof AiInvalidOutputError ? 'invalid_ai_output' : 'azure_ai_request_failed';
      await aiRepository?.logUsage(scope, operation, 'foundry-agent', usage.inputTokens, usage.outputTokens, Date.now() - startedAt, 'error', code).catch(() => undefined);
      request.log.error({ code, name: error instanceof Error ? error.name : 'unknown' }, 'Azure AI import failed');
      return reply.code(code === 'invalid_ai_output' ? 502 : 503).send({ error: code });
    }
  });
}
