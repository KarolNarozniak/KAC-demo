import assert from 'node:assert/strict';
import test from 'node:test';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses.js';
import { AiInvalidOutputError, AiService } from '../src/ai/service.js';
import type { FoundryResponsesProvider } from '../src/ai/foundry.js';
import { executeAssistantTool, assistantTools, type AssistantToolContext } from '../src/ai/tools.js';

const response = (output: string) => ({ id: 'resp-test', output_text: output, usage: { input_tokens: 10, output_tokens: 15 } }) as unknown as OpenAIResponse;
const provider = (output: string, capture?: (options: Record<string, unknown>) => void) => ({
  respond: async (options: Record<string, unknown>) => { capture?.(options); return response(output); },
});

test('AI import uses stateless Responses, a strict JSON Schema and normalizes employee shifts', async () => {
  let request: Record<string, unknown> | undefined;
  const output = JSON.stringify({ rows: [
    { eventType: 'event', title: '', date: '2026-11-15', startTime: '08:00', endTime: '16:00', location: null, employee: 'Anna', confidence: 0.93, sourcePage: 1, sourceSnippet: 'Anna 15.11 8:00–16:00', unresolvedFields: ['title', 'location'] },
    { eventType: 'off_day', title: 'WOLNE', date: '2026-11-16', startTime: null, endTime: null, location: null, employee: 'Anna', confidence: 0.99, sourcePage: 1, sourceSnippet: 'WOLNE', unresolvedFields: [] },
  ] });
  const service = new AiService(provider(output, (options) => { request = options; }) as unknown as FoundryResponsesProvider);
  const result = await service.extractSchedule({ fileName: 'rota.png', mimeType: 'image/png', bytes: Buffer.from('synthetic') }, 'work', 'Użytkownik');

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.title, 'Praca');
  assert.equal(result.rows[0]?.category, 'Work');
  assert.equal(result.rows[0]?.employee, 'Anna');
  assert.equal(result.rows[0]?.sourcePage, 1);
  assert.deepEqual(result.rows[0]?.unresolvedFields, []);
  assert.equal(request?.store, false);
  assert.equal((request?.text as { format: { type: string; strict: boolean } }).format.type, 'json_schema');
  assert.equal((request?.text as { format: { type: string; strict: boolean } }).format.strict, true);
  const image = (request?.input as Array<{ content: Array<{ type: string; image_url?: string }> }>)[0]?.content.find((item) => item.type === 'input_image');
  assert.match(image?.image_url ?? '', /^data:image\/png;base64,/);
});

test('AI import rejects malformed JSON instead of creating a partial import', async () => {
  const service = new AiService(provider('not-json') as unknown as FoundryResponsesProvider);
  await assert.rejects(() => service.extractSchedule({ fileName: 'rota.pdf', mimeType: 'application/pdf', bytes: Buffer.from('pdf') }, 'work', 'Użytkownik'), AiInvalidOutputError);
});

test('assistant tool registry creates a pending proposal but never writes a calendar event', async () => {
  let storedAction: Record<string, unknown> | undefined;
  let eventWrites = 0;
  const context: AssistantToolContext = {
    scope: { userId: 'U-test', calendarId: 'K-test' },
    conversationId: 'C-test',
    calendar: {
      getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: [], categories: [] } as never),
      createEvent: async () => { eventWrites++; return {} as never; },
      checkConnection: async () => {},
    },
    ai: { createAction: async (_scope, conversationId, kind, payload) => {
      storedAction = { conversationId, kind, payload };
      return { id: 'A-test', conversationId, kind, payload, status: 'pending', expiresAt: '2026-11-13T13:00:00.000Z' };
    } },
    actionTtlMinutes: 15,
  };
  const tool = assistantTools.find((item) => item.name === 'calendar_prepare_event_create');
  assert.ok(tool);
  const result = await executeAssistantTool(tool.name, JSON.stringify({ title: 'Spotkanie projektu', start: '2026-11-16T10:00', end: '2026-11-16T11:00',
    category: 'Personal', location: '', mandatory: false, repeatWeekly: false }), context);
  assert.equal(result.status, 'awaiting_user_confirmation');
  assert.equal(storedAction?.kind, 'calendar_event_create');
  assert.equal(eventWrites, 0);
  const injection = await executeAssistantTool(tool.name, JSON.stringify({ userId: 'U-other', title: 'x', start: '2026-11-16T10:00', end: '2026-11-16T11:00',
    category: 'Personal', location: '', mandatory: false, repeatWeekly: false }), context);
  assert.equal(injection.error, 'invalid_tool_arguments');
});

test('tool registry only exposes the reviewed calendar and profile operations', () => {
  assert.deepEqual(assistantTools.map((tool) => tool.name), [
    'calendar_search_events', 'work_profile_get', 'calendar_prepare_event_create',
    'calendar_prepare_event_update', 'calendar_prepare_event_delete',
  ]);
  assert.ok(assistantTools.every((tool) => tool.strict));
});
