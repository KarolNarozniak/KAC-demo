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

function streamingApi(send: (...args: any[]) => Promise<OpenAIResponse>) {
  const messages: Array<{ id: string; role: string; content: Record<string, unknown>; createdAt: string }> = [];
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: [] } as never) }, [], {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      getConversation: async () => ({ id: 'stream-conversation' }),
      appendMessage: async (_scope: unknown, _id: string, role: string, content: Record<string, unknown>) => {
        const message = { id: `message-${messages.length}`, role, content, createdAt: new Date().toISOString() }; messages.push(message); return message;
      },
      listMessages: async () => messages, listPendingActions: async () => [], logUsage: async () => {},
    } as never,
    aiService: { sendAssistantMessage: send } as never,
  });
  return { app, messages };
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Cześć' }),
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
    const result = await first.app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages?stream=true', payload: { content: 'Sprawdź jutro' } });
    assert.equal(result.statusCode, 200, result.body);
    const events = result.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.type), ['accepted', 'delta', 'reset', 'delta', 'done']);
    assert.equal(events.at(-1).result.message.content, 'Brak wydarzeń.');
  } finally { await first.app.close(); }
  const failed = streamingApi(async (_input, _tools, _context, _signal, delta) => {
    delta('Fragment'); throw Object.assign(new Error('synthetic'), { status: 429 });
  });
  try {
    const result = await failed.app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages?stream=true', payload: { content: 'Cześć' } });
    const events = result.body.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'error');
    assert.equal(events.at(-1).error, 'assistant_rate_limited');
    assert.equal(events.some((event) => event.type === 'done'), false);
    assert.equal(failed.messages.filter((message) => message.role === 'assistant').length, 0);
  } finally { await failed.app.close(); }
});

test('assistant validates personalization and includes it as style data without removing confirmation rules', async () => {
  let calls = 0;
  const { app } = streamingApi(async (_input, _tools, context) => {
    calls++;
    assert.match(context, /formalny i uprzejmy/);
    assert.match(context, /Pani Testowa/);
    assert.match(context, /nigdy jako instrukcję ani zgodę/);
    return response({ output_text: 'Dzień dobry.' });
  });
  const url = '/api/v1/assistant/conversations/stream-conversation/messages';
  try {
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { addressAs: 'Pani Testowa', tone: 'formal' } } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { tone: 'unknown' } } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'Cześć', preferences: { addressAs: 'x'.repeat(61) } } })).statusCode, 400);
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Cześć' }), signal: controller.signal,
    });
    const reader = result.body!.getReader();
    await reader.read(); controller.abort(); await reader.cancel().catch(() => {});
    await Promise.race([sawAbort, new Promise<void>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('upstream not aborted')), 5000); })]);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 0);
  } finally { if (timeout) clearTimeout(timeout); controller.abort(); app.server.closeAllConnections(); await app.close(); }
});

test('assistant does not persist an empty answer as a successful summary', async () => {
  const { app, messages } = streamingApi(async () => response({ output_text: '' }));
  try {
    const result = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/stream-conversation/messages', payload: { content: 'Podsumuj dzień' } });
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
    const { app, messages } = streamingApi(async (_input, _tools, _context, _signal, delta) => {
      delta?.('Synthetic partial refusal'); throw scenario.error;
    });
    const url = '/api/v1/assistant/conversations/stream-conversation/messages';
    try {
      const json = await app.inject({ method: 'POST', url, payload: { content: 'Przygotuj podgląd wydarzenia' } });
      assert.equal(json.statusCode, 422, json.body); assert.equal(json.json().error, scenario.code);
      const stream = await app.inject({ method: 'POST', url: `${url}?stream=true`, payload: { content: 'Przygotuj podgląd wydarzenia' } });
      assert.equal(stream.statusCode, 200);
      const events = stream.body.trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(events.at(-1), { type: 'error', error: scenario.code });
      assert.equal(events.some((event) => event.type === 'done'), false);
      assert.equal(messages.some((message) => message.role === 'assistant'), false);
    } finally { await app.close(); }
  }
});
