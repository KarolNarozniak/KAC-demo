import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ApiOptions } from '../src/api/contracts.js';
import type { Response as OpenAIResponse, ResponseInputItem } from 'openai/resources/responses/responses.js';
import { AiActionNotFoundError, AiActionStalePreviewError } from '../src/ai/repository.js';
import { makeTestAuth, premiumTestHeaders } from './helpers/premium-auth.js';

const premiumSession = { sessionId: 'test-session', scope: { userId: 'U001', calendarId: 'K001' }, isPremium: true, premiumExpiresAt: '2035-01-01T00:00:00.000Z' };

const response = (overrides: Record<string, unknown>) => ({ id: 'response-test', status: 'completed', output_text: '', output: [], usage: { input_tokens: 12, output_tokens: 8 }, ...overrides }) as unknown as OpenAIResponse;

test('assistant reconstructs stateless history, calls only registered tools and stores a final response', async () => {
  const messages: Array<{ role: string; content: Record<string, unknown> }> = [];
  const pendingActions: Array<Record<string, unknown>> = [];
  const timeContexts: string[] = [];
  let modelCalls = 0;
  const options: ApiOptions = {
    auth: makeTestAuth(premiumSession),
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
    const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations', headers: premiumTestHeaders, payload: { title: 'Test planowania' } });
    assert.equal(created.statusCode, 201, created.body);
    const sent = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/conversation-1/messages', headers: premiumTestHeaders, payload: { content: 'Ile godzin mam w celu?' } });
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
    const history = await app.inject({ method: 'GET', url: '/api/v1/assistant/conversations/conversation-1/messages', headers: premiumTestHeaders });
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
      auth: makeTestAuth(premiumSession),
      aiRepository: {
        getConversation: async () => ({ id: 'conversation-1', title: 'Test', modelDeployment: 'gpt-5-mini', status: 'active',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }),
        appendMessage: async () => ({ id: 'message', role: 'user', content: { text: 'test' }, createdAt: new Date().toISOString() }),
        listMessages: async () => [], listPendingActions: async () => [], logUsage: async () => {},
      } as never,
      aiService: { sendAssistantMessage: async () => { providerCalls++; throw scenario.error; } } as never,
    });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/conversation-1/messages', headers: premiumTestHeaders, payload: { content: 'test' } });
      assert.equal(created.statusCode, scenario.status);
      assert.equal(created.json().error, scenario.code);
      assert.equal(providerCalls, 1);
    } finally { await app.close(); }
  }
});

test('assistant create confirmation returns collisions and retries the same action with explicit decision', async () => {
  const { CollisionError } = await import('../src/collisions.js');
  const token = 'a'.repeat(64);
  const event = { title: 'Spotkanie testowe', start: '2026-11-16T10:00', end: '2026-11-16T11:00', category: 'Personal', location: '', mandatory: false, repeatWeekly: false };
  let writes = 0;
  let released = 0;
  let completed = false;
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
    createEvent: async (input, userId, calendarId, actionId) => {
      assert.equal(userId, 'U001'); assert.equal(calendarId, 'K001'); assert.equal(actionId, 'action-create');
      if (input.collisionToken !== token) throw new CollisionError([{ id: 'existing', title: 'Zajęcia testowe', category: 'Class', start: event.start, end: event.end, overlapStart: event.start, overlapEnd: event.end }], token);
      writes++;
      return { ...input, id: 'created-event' };
    },
  }, [], {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      claimAction: async () => ({ id: 'action-create', conversationId: 'conversation-1', kind: 'calendar_event_create', payload: { event }, status: completed ? 'confirmed' : 'processing', eventId: completed ? 'created-event' : undefined, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      releaseAction: async () => { released++; }, completeAction: async () => { completed = true; },
    } as never,
  });
  try {
    const url = '/api/v1/assistant/actions/action-create/confirm';
    const blocked = await app.inject({ method: 'POST', url, payload: {} });
    assert.equal(blocked.statusCode, 409, blocked.body);
    assert.equal(blocked.json().conflicts[0].title, 'Zajęcia testowe');
    assert.equal(blocked.json().collisionToken, token);
    assert.equal(writes, 0); assert.equal(released, 1);
    const invalid = await app.inject({ method: 'POST', url, payload: { collisionToken: 'invalid' } });
    assert.equal(invalid.statusCode, 400);
    const changed = await app.inject({ method: 'POST', url, payload: { collisionToken: 'b'.repeat(64) } });
    assert.equal(changed.statusCode, 409); assert.equal(writes, 0);
    const accepted = await app.inject({ method: 'POST', url, payload: { collisionToken: token } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().eventId, 'created-event');
    const retry = await app.inject({ method: 'POST', url, payload: {} });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().eventId, 'created-event');
    assert.equal(writes, 1);
  } finally { await app.close(); }
});

function streamingApi(send: (...args: any[]) => Promise<OpenAIResponse>, extraAi: Record<string, unknown> = {}, extraCalendar: Record<string, unknown> = {}) {
  const messages: Array<{ id: string; role: string; content: Record<string, unknown>; createdAt: string }> = [];
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: [] } as never), ...extraCalendar }, [], {
    auth: makeTestAuth(premiumSession),
    aiRepository: {
      getConversation: async () => ({ id: 'stream-conversation' }),
      appendMessage: async (_scope: unknown, _id: string, role: string, content: Record<string, unknown>) => {
        const message = { id: `message-${messages.length}`, role, content, createdAt: new Date().toISOString() }; messages.push(message); return message;
      },
      listMessages: async () => messages.slice(-24), listPendingActions: async () => [], logUsage: async () => {}, ...extraAi,
    } as never,
    aiService: { sendAssistantMessage: send } as never,
  });
  const inject = (options: Parameters<typeof app.inject>[0]) => app.inject({ ...options, headers: { ...premiumTestHeaders, ...options.headers } });
  return { app, messages, inject };
}

test('assistant stream delivers accepted and text deltas before generation finishes, then persists one final answer', async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let completed = false;
  const { app, messages } = streamingApi(async (_input, _tools, _context, _signal, delta) => {
    delta('Dzień '); await gate; delta('dobry!'); completed = true;
    return response({ output_text: 'Dzień dobry!' });
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const result = await fetch(`${address}/api/v1/assistant/conversations/stream-conversation/messages?stream=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...premiumTestHeaders }, body: JSON.stringify({ content: 'Cześć' }),
    });
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type') ?? '', /application\/x-ndjson/);
    reader = result.body!.getReader();
    let text = '';
    while (!text.includes('"type":"delta"')) text += new TextDecoder().decode((await reader.read()).value);
    assert.equal(completed, false);
    assert.match(text, /"type":"accepted"/);
    assert.equal(messages.length, 1);
    finish();
    while (true) { const part = await reader.read(); if (part.done) break; text += new TextDecoder().decode(part.value); }
    const events = text.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.type === 'delta').map((event) => event.text).join(''), 'Dzień dobry!');
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).result.message.content, 'Dzień dobry!');
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 1);
  } finally { finish(); await reader?.cancel(); await app.close(); }
});

test('assistant stream resets provisional text around tool rounds and returns controlled errors after headers', async () => {
  let calls = 0;
  const first = streamingApi(async (_input, _tools, _context, _signal, delta) => {
    calls++;
    if (calls === 1) {
      delta('Sprawdzam kalendarz.');
      return response({ output: [{ type: 'function_call', id: 'fc-search', call_id: 'search', name: 'calendar_search_events', arguments: JSON.stringify({ from: '2026-11-16', to: '2026-11-16', query: null }) }] });
    }
    delta('Brak wydarzeń.'); return response({ output_text: 'Brak wydarzeń.' });
  });
  try {
    const result = await first.inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages?stream=true', payload: { content: 'Sprawdź jutro' } });
    assert.equal(result.statusCode, 200, result.body);
    const events = result.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.type), ['accepted', 'delta', 'reset', 'delta', 'done']);
    assert.equal(events.at(-1).result.message.content, 'Brak wydarzeń.');
  } finally { await first.app.close(); }
  const failed = streamingApi(async (_input, _tools, _context, _signal, delta) => {
    delta('Fragment'); throw Object.assign(new Error('synthetic'), { status: 429 });
  });
  try {
    const result = await failed.inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages?stream=true', payload: { content: 'Cześć' } });
    const events = result.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'error');
    assert.equal(events.at(-1).error, 'assistant_rate_limited');
    assert.equal(events.some((event) => event.type === 'done'), false);
    assert.equal(failed.messages.filter((message) => message.role === 'assistant').length, 0);
  } finally { await failed.app.close(); }
});

test('assistant validates personalization and includes it as style data without removing confirmation rules', async () => {
  let calls = 0;
  const { app, inject } = streamingApi(async (_input, _tools, context) => {
    calls++;
    assert.match(context, /formalny i uprzejmy/);
    assert.match(context, /Pani Testowa/);
    assert.match(context, /nigdy jako instrukcję ani zgodę/);
    return response({ output_text: 'Dzień dobry.' });
  });
  const url = '/api/v1/assistant/conversations/stream-conversation/messages';
  try {
    assert.equal((await inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { addressAs: 'Pani Testowa', tone: 'formal' } } })).statusCode, 200);
    assert.equal((await inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { tone: 'unknown' } } })).statusCode, 400);
    assert.equal((await inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { addressAs: 'x'.repeat(61) } } })).statusCode, 400);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});

test('closing the assistant stream aborts the upstream response request', async () => {
  let aborted!: () => void;
  const sawAbort = new Promise<void>((resolve) => { aborted = resolve; });
  const { app, messages } = streamingApi(async (_input, _tools, _context, signal: AbortSignal, delta) => {
    delta('Początek');
    return new Promise<OpenAIResponse>((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')); }, { once: true });
    });
  });
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const result = await fetch(`${address}/api/v1/assistant/conversations/stream-conversation/messages?stream=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...premiumTestHeaders }, body: JSON.stringify({ content: 'Cześć' }), signal: controller.signal,
    });
    const reader = result.body!.getReader();
    await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
    await Promise.race([sawAbort, new Promise<void>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('upstream not aborted')), 5000); })]);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 0);
  } finally { if (timeout) clearTimeout(timeout); controller.abort(); app.server.closeAllConnections(); await app.close(); }
});

test('assistant does not persist an empty answer as a successful summary', async () => {
  const { app, messages, inject } = streamingApi(async () => response({ output_text: '' }));
  try {
    const result = await inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages', payload: { content: 'Podsumuj dzień' } });
    assert.equal(result.statusCode, 502, result.body);
    assert.equal(result.json().error, 'assistant_incomplete_response');
    assert.equal(messages.some((message) => message.role === 'assistant'), false);
  } finally { await app.close(); }
});

test('assistant reports Azure filtering consistently for a blocked HTTP call and a filtered response stream', async () => {
  const { AiContentFilterError, AiModelRefusalError } = await import('../src/ai/service.js');
  for (const scenario of [
    { error: new AiContentFilterError(['violence']), code: 'assistant_content_filtered' },
    { error: Object.assign(new Error('synthetic provider error'), { status: 400, code: 'content_filter' }), code: 'assistant_content_filtered' },
    { error: new AiModelRefusalError('assistant_refused'), code: 'assistant_refused' },
  ]) {
    const { app, messages, inject } = streamingApi(async (_input, _tools, _context, _signal, delta) => {
      delta?.('Synthetic partial refusal'); throw scenario.error;
    });
    const url = '/api/v1/assistant/conversations/stream-conversation/messages';
    try {
      const json = await inject({ method: 'POST', url, payload: { content: 'Przygotuj podgląd wydarzenia' } });
      assert.equal(json.statusCode, 422, json.body); assert.equal(json.json().error, scenario.code);
      const stream = await inject({ method: 'POST', url: `${url}?stream=true`, payload: { content: 'Przygotuj podgląd wydarzenia' } });
      assert.equal(stream.statusCode, 200);
      const events = stream.body.trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(events.at(-1).type, 'error'); assert.equal(events.at(-1).error, scenario.code);
      assert.deepEqual(events.at(-1).pendingActions, []);
      assert.equal(events.some((event) => event.type === 'done'), false);
      assert.equal(messages.some((message) => message.role === 'assistant'), false);
    } finally { await app.close(); }
  }
});

const bulkEvent = { title: 'Zajęcia testowe', start: '2026-11-17T09:00', end: '2026-11-17T12:30', category: 'Class', location: 'Sala testowa', mandatory: false, repeatWeekly: false };
const bulkCalls = Array.from({ length: 5 }, (_, index) => ({ type: 'function_call', id: `fc-bulk-${index}`, call_id: `bulk-${index}`,
  name: index < 4 ? 'calendar_prepare_event_update' : 'calendar_prepare_event_create',
  arguments: JSON.stringify({ ...bulkEvent, start: `2026-11-${index < 4 ? 17 + index : 16}T09:00`, end: `2026-11-${index < 4 ? 17 + index : 16}T12:30`, ...(index < 4 ? { id: `event-${index}` } : {}) }),
}));

function bulkFixture() {
  const pending: any[] = [];
  let writes = 0;
  return { pending, writes: () => writes,
    ai: {
      listPendingActions: async () => pending,
      createAction: async (_scope: unknown, conversationId: string, kind: string, payload: Record<string, unknown>) => {
        const action = { id: `proposal-${pending.length}`, conversationId, kind, payload, status: 'pending', expiresAt: new Date(Date.now() + 900_000).toISOString() };
        pending.push(action); return action;
      },
    },
    calendar: {
      getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: Array.from({ length: 4 }, (_, index) => ({ ...bulkEvent, id: `event-${index}`, start: `2026-11-${17 + index}T08:00`, end: `2026-11-${17 + index}T11:30`, category: 'Zajęcia', eventVersion: 1 })) }),
      createEvent: async () => { writes++; throw new Error('must not write calendar'); },
      updateEvent: async () => { writes++; throw new Error('must not write calendar'); },
    },
  };
}

test('assistant prepares four updates and one creation in either serial or grouped tool calls without saving events', async () => {
  const { config } = await import('../src/config.js');
  const originalRounds = config.azureAi.maxToolRounds; config.azureAi.maxToolRounds = 8;
  try {
    for (const grouped of [false, true]) {
      const fixture = bulkFixture(); let calls = 0;
      const { app, inject } = streamingApi(async (input) => {
        const priorCalls = new Set(input.filter((item: any) => item.type === 'function_call').map((item: any) => item.call_id));
        for (const item of input.filter((item: any) => item.type === 'function_call_output')) assert.ok(priorCalls.has(item.call_id));
        const index = calls++;
        if (grouped ? index === 0 : index < bulkCalls.length) return response({ output: grouped ? bulkCalls : [bulkCalls[index]] });
        return response({ output_text: 'Przygotowano pięć propozycji do potwierdzenia.' });
      }, fixture.ai, fixture.calendar);
      try {
        const result = await inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages?stream=true', payload: { content: 'Przygotuj cztery zmiany i dodanie zajęć testowych.' } });
        const events = result.body.trim().split('\n').map((line) => JSON.parse(line));
        assert.equal(events.at(-1).type, 'done', result.body);
        assert.equal(events.at(-1).result.pendingActions.length, 5);
        assert.equal(fixture.pending.filter((action) => action.kind === 'calendar_event_update').length, 4);
        assert.equal(fixture.pending.filter((action) => action.kind === 'calendar_event_create').length, 1);
        assert.equal(fixture.writes(), 0);
      } finally { await app.close(); }
    }
  } finally { config.azureAi.maxToolRounds = originalRounds; }
});

test('tool limit returns prepared previews and retry reuses them instead of creating duplicates', async () => {
  const { config } = await import('../src/config.js');
  const originalRounds = config.azureAi.maxToolRounds; config.azureAi.maxToolRounds = 2;
  const fixture = bulkFixture(); let calls = 0;
  const { app, inject } = streamingApi(async () => {
    const index = calls++;
    if (index < bulkCalls.length) return response({ output: [bulkCalls[index]] });
    return response({ output_text: 'Przygotowano wszystkie propozycje.' });
  }, fixture.ai, fixture.calendar);
  const url = '/api/v1/assistant/conversations/stream-conversation/messages?stream=true';
  try {
    const stopped = await inject({ method: 'POST', url, payload: { content: 'Przygotuj zmiany zajęć.' } });
    const failure = stopped.body.trim().split('\n').map((line) => JSON.parse(line)).at(-1);
    assert.equal(failure.type, 'error'); assert.equal(failure.error, 'assistant_tool_limit');
    assert.equal(failure.pendingActions.length, 2);
    const existingIds = fixture.pending.map((action) => action.id);
    calls = 0; config.azureAi.maxToolRounds = 8;
    const retried = await inject({ method: 'POST', url, payload: { content: 'Przygotuj pozostałe propozycje.' } });
    const done = retried.body.trim().split('\n').map((line) => JSON.parse(line)).at(-1);
    assert.equal(done.type, 'done', retried.body); assert.equal(done.result.pendingActions.length, 5);
    assert.deepEqual(fixture.pending.slice(0, 2).map((action) => action.id), existingIds);
    assert.equal(fixture.writes(), 0);
  } finally { config.azureAi.maxToolRounds = originalRounds; await app.close(); }
});

test('assistant retains complete tool context when the current turn exceeds the 24-message history window', async () => {
  let calls = 0;
  const { app, inject } = streamingApi(async (input) => {
    if (calls++ === 0) return response({ output: Array.from({ length: 30 }, (_, index) => ({ type: 'function_call', id: `fc-read-${index}`, call_id: `read-${index}`, name: 'calendar_search_events', arguments: JSON.stringify({ from: '2026-11-16', to: '2026-11-16', query: null }) })) });
    assert.equal(input.filter((item: any) => item.type === 'function_call').length, 30);
    assert.equal(input.filter((item: any) => item.type === 'function_call_output').length, 30);
    assert.ok(input.some((item: any) => item.role === 'user' && item.content === 'Sprawdź terminy testowe'));
    return response({ output_text: 'Terminy sprawdzone.' });
  });
  try {
    const result = await inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages', payload: { content: 'Sprawdź terminy testowe' } });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().message.content, 'Terminy sprawdzone.');
  } finally { await app.close(); }
});

test('assistant replaces a stale pending update rather than reusing its obsolete snapshot', async () => {
  const fixture = bulkFixture();
  fixture.pending.push({ id: 'stale-proposal', kind: 'calendar_event_update', conversationId: 'stream-conversation', status: 'pending', expiresAt: new Date(Date.now() + 900_000).toISOString(),
    payload: { id: 'event-0', original: { ...bulkEvent, category: 'Zajęcia', eventVersion: 99 }, event: { ...bulkEvent } } });
  let calls = 0;
  const { app, inject } = streamingApi(async () => calls++ === 0 ? response({ output: [bulkCalls[0]] }) : response({ output_text: 'Nowa propozycja gotowa.' }), fixture.ai, fixture.calendar);
  try {
    const result = await inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages', payload: { content: 'Przygotuj ponownie zmianę.' } });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(fixture.pending.length, 2);
    assert.equal(fixture.pending[1].payload.original.eventVersion, 1);
    assert.equal(fixture.writes(), 0);
  } finally { await app.close(); }
});

test('retry refreshes expired action results and prepares only three missing updates after two confirmations', async () => {
  const fixture = bulkFixture();
  const overview = await fixture.calendar.getOverview();
  overview.events[3] = { ...overview.events[3], start: '2026-11-20T09:00', end: '2026-11-20T12:30', eventVersion: 2 };
  overview.events.push({ ...bulkEvent, id: 'saved-4', start: '2026-11-16T09:00', end: '2026-11-16T12:30', category: 'Zajęcia', eventVersion: 1 });
  const oldActions = bulkCalls.map((call, index) => {
    const args = JSON.parse(call.arguments); const { id, ...event } = args;
    return { id: `old-${index}`, conversationId: 'stream-conversation', kind: index < 4 ? 'calendar_event_update' : 'calendar_event_create',
      status: index < 3 ? 'expired' : 'confirmed', expiresAt: '2026-01-01T00:00:00Z', eventId: index >= 3 ? `saved-${index}` : undefined,
      payload: index < 4 ? { id, original: { ...event, start: event.start.replace('09:00', '08:00'), end: event.end.replace('12:30', '11:30'), category: 'Zajęcia', eventVersion: 1 }, event } : { event } };
  });
  const oldHistory: any[] = [
    { id: 'old-calls', role: 'assistant', content: { toolCalls: bulkCalls.map((call) => ({ id: call.id, callId: call.call_id, name: call.name, arguments: call.arguments })) }, createdAt: '2026-01-01T00:00:00Z' },
    ...oldActions.map((action, index) => ({ id: `old-result-${index}`, role: 'tool', content: { name: bulkCalls[index].name, callId: bulkCalls[index].call_id,
      result: { status: 'awaiting_user_confirmation', actionId: action.id, expiresAt: action.expiresAt, preview: action.payload } }, createdAt: '2026-01-01T00:00:00Z' })),
  ];
  let liveMessages: any[] = []; let calls = 0;
  const { app, messages, inject } = streamingApi(async (input) => {
    if (calls++ === 0) {
      const results = input.filter((item: any) => item.type === 'function_call_output').map((item: any) => JSON.parse(item.output));
      assert.deepEqual(results.map((result: any) => result.status), ['expired', 'expired', 'expired', 'confirmed', 'confirmed']);
      assert.ok(results.slice(0, 3).every((result: any) => result.requiresNewProposal === true));
      return response({ output: bulkCalls.slice(0, 3).map((call, index) => ({ ...call, id: `retry-fc-${index}`, call_id: `retry-${index}` })) });
    }
    return response({ output_text: 'Przygotowano trzy brakujące propozycje. Dwa pozostałe wydarzenia są już zapisane.' });
  }, { ...fixture.ai, listMessages: async () => [...oldHistory, ...liveMessages], getAction: async (scope: any, id: string) => {
    assert.equal(scope.userId, 'U001'); assert.equal(scope.calendarId, 'K001'); return oldActions.find((action) => action.id === id) ?? null;
  } }, { ...fixture.calendar, getOverview: async () => overview });
  liveMessages = messages;
  try {
    const result = await inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages', payload: { content: 'Przygotuj ponownie brakujące przesunięcia.' } });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().pendingActions.length, 3);
    assert.deepEqual(fixture.pending.map((action) => action.payload.event.start), ['2026-11-17T09:00', '2026-11-18T09:00', '2026-11-19T09:00']);
    assert.equal(fixture.writes(), 0);
    assert.equal(oldHistory[1].content.result.status, 'awaiting_user_confirmation');
  } finally { await app.close(); }
});
