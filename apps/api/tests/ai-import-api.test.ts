import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { CalendarRepository } from '../src/api/contracts.js';
import { AiInvalidOutputError } from '../src/ai/service.js';
import type { ImportRow } from '../src/import/rules.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gU8AAAAASUVORK5CYII=', 'base64').toString('base64');
const extractedRow: ImportRow = { id: 'ai-row-1', title: 'Praca', date: '2026-11-16', startTime: '08:00', endTime: '16:00',
  category: 'Work', employee: 'Anna', confidence: 0.8, sourcePage: 1, sourceSnippet: 'Anna 16.11 8:00–16:00', unresolvedFields: [] };

test('AI file import creates only a review session with source metadata', async () => {
  let storedRows: ImportRow[] = [];
  let eventWrites = 0;
  const repository: CalendarRepository = {
    checkConnection: async () => {},
    getOverview: async () => null,
    listEventsForImport: async () => [],
    getImportUserName: async () => 'Użytkownik testowy',
    createImportSession: async ({ rows }) => { storedRows = rows; return { id: 'session-ai', expiresAt: new Date('2026-11-13T13:00:00Z') }; },
    createEvent: async () => { eventWrites++; return { id: 'must-not-write' } as never; },
  };
  const app = buildApi(repository, [], { aiService: {
    extractSchedule: async (file, source) => {
      assert.equal(file.mimeType, 'image/png');
      assert.equal(source, 'work');
      return { rows: [extractedRow], usage: { inputTokens: 10, outputTokens: 20 }, responseId: 'resp-test' };
    },
    sendAssistantMessage: async () => { throw new Error('unused'); },
  }, aiRepository: { logUsage: async () => {} } as never });
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/import/ai/read', payload: { fileName: 'schedule.png', dataBase64: png, source: 'work' } });
    assert.equal(result.statusCode, 201, result.body);
    assert.equal(result.json().readerProvider, 'azure-ai-foundry');
    assert.equal(result.json().rows[0].employee, 'Anna');
    assert.equal(result.json().rows[0].sourcePage, 1);
    assert.equal(result.json().preview[0].sourceSnippet, 'Anna 16.11 8:00–16:00');
    assert.equal(storedRows[0]?.sourceSnippet, 'Anna 16.11 8:00–16:00');
    assert.equal(eventWrites, 0);
    assert.equal(storedRows[0] && 'fileBytes' in storedRows[0], false);
  } finally { await app.close(); }
});

test('malformed AI JSON is rejected without creating an import session or events', async () => {
  let sessions = 0;
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null, listEventsForImport: async () => [], getImportUserName: async () => 'Użytkownik testowy',
    createImportSession: async () => { sessions++; return { id: 'should-not-exist', expiresAt: new Date() }; } }, [], {
    aiService: { extractSchedule: async () => { throw new AiInvalidOutputError('invalid_ai_output_json'); }, sendAssistantMessage: async () => { throw new Error('unused'); } },
    aiRepository: { logUsage: async () => {} } as never,
  });
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/import/ai/read', payload: { fileName: 'schedule.png', dataBase64: png, source: 'classes' } });
    assert.equal(result.statusCode, 502);
    assert.equal(result.json().error, 'invalid_ai_output');
    assert.equal(sessions, 0);
  } finally { await app.close(); }
});
