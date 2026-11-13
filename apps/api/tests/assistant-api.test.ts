import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ApiOptions } from '../src/api/contracts.js';
import type { Response as OpenAIResponse, ResponseInputItem } from 'openai/resources/responses/responses.js';
import { AiActionNotFoundError, AiActionStalePreviewError } from '../src/ai/repository.js';

const response = (overrides: Record<string, unknown>) => ({ id: 'response-test', status: 'completed', output_text: '', output: [], usage: { input_tokens: 12, output_tokens: 8 }, ...overrides }) as unknown as OpenAIResponse;

test('assistant reconstructs stateless history, calls only registered tools and stores a final response', async () => {
  const messages: Array<{ role: string; content: Record<string, unknown> }> = [];
  const pendingActions: Array<Record<string, unknown>> = [];
  const timeContexts: string[] = [];
  let modelCalls = 0;
  const options: ApiOptions = {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      createConversation: async () => ({ id: 'conversation-1', modelDeployment: 'gpt-5-mini', title: 'Nowa rozmowa', status: 'active',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      getConversation: async () => ({ id: 'conversation-1', modelDeployment: 'gpt-5-mini', title: 'Test', status: 'active',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      listConversations: async () => [],
      appendMessage: async (_scope, _conversationId, role, content) => { messages.push({ role, content }); return { id: String(messages.length), role, content, createdAt: new Date().toISOString() }; },
      listMessages: async () => messages.map((message, index) => ({ id: String(index), ...message, createdAt: new Date().toISOString() })) as never,
       listPendingActions: async () => pendingActions, closeConversation: async () => true, logUsage: async () => {},
      createAction: async () => { throw new Error('not used'); }, getAction: async () => null, claimAction: async () => { throw new Error('not used'); },
      completeAction: async () => {}, releaseAction: async () => {}, cancelAction: async () => false, cancelPendingActions: async () => {},
    } as never,
    aiService: {
      sendAssistantMessage: async (input: ResponseInputItem[], tools, trustedContext, signal) => {
        modelCalls++;
        assert.ok(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        assert.match(trustedContext ?? '', /strefa IANA Europe\/Warsaw/);
        timeContexts.push(trustedContext ?? '');
        assert.ok(tools.some((tool) => tool.name === 'work_profile_get'));
        if (modelCalls === 1) {
          assert.ok(input.some((item) => 'role' in item && item.role === 'user'));
          assert.match(trustedContext ?? '', /czas UTC/);
          return response({ output: [{ type: 'function_call', id: 'fc1', call_id: 'call1', name: 'calendar_search_events', arguments: JSON.stringify({ from: '2026-11-16', to: '2026-11-16', query: null }) }] });
        }
        assert.ok(input.some((item) => 'type' in item && item.type === 'function_call_output' && item.call_id === 'call1'));
        if (modelCalls === 2) return response({ output: [{ type: 'function_call', id: 'fc2', call_id: 'call2', name: 'work_profile_get', arguments: '{}' }] });
        assert.ok(input.some((item) => 'type' in item && item.type === 'function_call_output' && item.call_id === 'call2'));
        return response({ output_text: 'Masz profil pracy z celem 20 godzin.' });
      },
      extractSchedule: async () => { throw new Error('not used'); },
    },
  };
  const app = buildApi({
    checkConnection: async () => {}, getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: [], calendar: { id: 'K001' }, counts: { events: 0, categories: 0 } } as never),
  }, [], options);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations', payload: { title: 'Test planowania' } });
    assert.equal(created.statusCode, 201, created.body);
    const sent = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/conversation-1/messages', payload: { content: 'Ile godzin mam w celu?' } });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().message.content, 'Masz profil pracy z celem 20 godzin.');
    assert.equal(modelCalls, 3);
    assert.equal(timeContexts.length, 3);
    assert.equal(messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(messages.filter((message) => message.role === 'tool').length, 2);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 3);
    pendingActions.push({ id: 'pending-1', conversationId: 'conversation-1', kind: 'calendar_event_update', status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { id: 'event-1', original: { title: 'Existing', start: '2026-11-16T10:00', end: '2026-11-16T11:00', category: 'Praca', location: '', mandatory: false, repeatWeekly: false, eventVersion: 1 },
        event: { title: 'Updated', start: '2026-11-16T12:00', end: '2026-11-16T13:00', category: 'Work', location: '', mandatory: false, repeatWeekly: false } } });
    const history = await app.inject({ method: 'GET', url: '/api/v1/assistant/conversations/conversation-1/messages' });
    assert.equal(history.statusCode, 200, history.body);
    assert.equal(history.json().messages.length, messages.length);
    assert.equal(history.json().pendingActions[0].id, 'pending-1');
  } finally { await app.close(); }
});

function actionApi(overrides: Record<string, unknown> = {}, calendarOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
    updateEvent: async () => { calls.push('update'); return { id: 'event-1' } as never; },
    deleteEvent: async () => { calls.push('delete'); return ['event-1']; }, ...calendarOverrides } as never, [], {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      claimAction: async () => ({ id: 'action-1', conversationId: 'conversation-1', kind: 'calendar_event_update',
        payload: { id: 'event-1', original: { title: 'Old' }, event: { title: 'New' } }, status: 'processing', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      completeAction: async () => { calls.push('complete'); }, releaseAction: async () => {}, failAction: async () => { calls.push('fail'); },
      ...overrides,
    } as never,
  });
  return { app, calls };
}

test('assistant action cancellation never invokes a calendar mutation', async () => {
  const { app, calls } = actionApi({ cancelAction: async (_scope: unknown, id: string) => id === 'action-1' });
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/assistant/actions/action-1/cancel', payload: {} });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().status, 'cancelled');
    assert.deepEqual(calls, []);
  } finally { await app.close(); }
});

test('assistant refuses expired actions and marks stale previews failed without mutating calendar', async () => {
  const expired = actionApi({ claimAction: async () => { throw new AiActionNotFoundError('ai_action_not_found_or_expired'); } });
  try {
    assert.equal((await expired.app.inject({ method: 'POST', url: '/api/v1/assistant/actions/action-1/confirm', payload: {} })).statusCode, 404);
    assert.deepEqual(expired.calls, []);
  } finally { await expired.app.close(); }

  const stale = actionApi({}, { updateEvent: async () => { throw new AiActionStalePreviewError('ai_action_stale_preview'); } });
  try {
    const result = await stale.app.inject({ method: 'POST', url: '/api/v1/assistant/actions/action-1/confirm', payload: {} });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().error, 'ai_action_stale_preview');
    assert.deepEqual(stale.calls, ['fail']);
  } finally { await stale.app.close(); }
});

test('assistant provider 429 and timeout failures stop after one request and return a controlled error', async () => {
  for (const scenario of [
    { error: Object.assign(new Error('rate limited'), { status: 429 }), status: 429, code: 'assistant_rate_limited' },
    { error: Object.assign(new Error('timed out'), { name: 'TimeoutError' }), status: 504, code: 'assistant_timeout' },
  ]) {
    let providerCalls = 0;
    const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null } as never, [], {
      userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
      aiRepository: {
        getConversation: async () => ({ id: 'conversation-1', title: 'Test', modelDeployment: 'gpt-5-mini', status: 'active',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        appendMessage: async () => ({ id: 'message', role: 'user', content: { text: 'test' }, createdAt: new Date().toISOString() }),
        listMessages: async () => [], listPendingActions: async () => [], logUsage: async () => {},
      } as never,
      aiService: { sendAssistantMessage: async () => { providerCalls++; throw scenario.error; } } as never,
    });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/conversation-1/messages', payload: { content: 'test' } });
      assert.equal(created.statusCode, scenario.status);
      assert.equal(created.json().error, scenario.code);
      assert.equal(providerCalls, 1);
    } finally { await app.close(); }
  }
});
