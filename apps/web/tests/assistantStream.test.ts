import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantApiError, streamAssistantMessage, type AssistantStreamEvent } from '../src/services/assistantApi.ts';
import { configureAssistantPreferences, defaultAssistantPreferences, normalizeAssistantPreferences } from '../src/domain/assistantPreferences.ts';

const done = { type: 'done', result: { conversationId: 'test', message: { role: 'assistant', content: 'Cześć!' }, pendingActions: [], usage: { inputTokens: 1, outputTokens: 1 } } };
function streamingFetch(start: (controller: ReadableStreamDefaultController<Uint8Array>) => void, check?: (init?: RequestInit) => void) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /messages\?stream=true$/); check?.(init);
    return new Response(new ReadableStream<Uint8Array>({ start }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  };
  return () => {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = originalUrl;
    configureAssistantPreferences(defaultAssistantPreferences);
  };
}

test('chat delivers deltas before completion and handles UTF-8 characters split between chunks', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const events: AssistantStreamEvent[] = [];
  let firstDelta!: () => void;
  const receivedDelta = new Promise<void>((resolve) => { firstDelta = resolve; });
  const restore = streamingFetch((value) => { controller = value; }, (init) => {
    assert.equal(JSON.parse(String(init?.body)).content, 'Hej');
  });
  const encoder = new TextEncoder();
  try {
    const result = streamAssistantMessage('test', 'Hej', (event) => { events.push(event); if (event.type === 'delta') firstDelta(); });
    const bytes = encoder.encode(`${JSON.stringify({ type: 'delta', text: 'Cześć!' })}\n`);
    // Split inside the two-byte encoding of ś.
    const split = bytes.indexOf(0xc5) + 1;
    controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split));
    await receivedDelta;
    assert.deepEqual(events, [{ type: 'delta', text: 'Cześć!' }]);
    controller.enqueue(encoder.encode(JSON.stringify(done))); controller.close();
    assert.equal((await result).message.content, 'Cześć!');
  } finally { restore(); }
});

test('chat rejects a truncated or failed stream instead of treating partial text as success', async () => {
  for (const ending of ['', `${JSON.stringify({ type: 'error', error: 'assistant_rate_limited' })}\n`]) {
    const restore = streamingFetch((controller) => {
      controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'delta', text: 'Fragment' })}\n${ending}`)); controller.close();
    });
    try {
      await assert.rejects(streamAssistantMessage('test', 'Hej', () => {}), (error: unknown) => {
        assert.ok(error instanceof AssistantApiError);
        assert.equal(error.code, ending ? 'assistant_rate_limited' : 'assistant_stream_interrupted'); return true;
      });
    } finally { restore(); }
  }
});

test('saved personalization is normalized and sent with each chat request', async () => {
  assert.deepEqual(normalizeAssistantPreferences({ addressAs: '  Pani\nTestowa ', tone: 'unknown' }), { addressAs: 'Pani Testowa', tone: 'neutral' });
  configureAssistantPreferences({ addressAs: 'Pani Testowa', tone: 'formal' });
  const restore = streamingFetch((controller) => { controller.enqueue(new TextEncoder().encode(`${JSON.stringify(done)}\n`)); controller.close(); }, (init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).preferences, { addressAs: 'Pani Testowa', tone: 'formal' });
  });
  try { await streamAssistantMessage('test', 'Hej', () => {}); } finally { restore(); }
});

test('chat preserves a content filter error as a Polish rejection message rather than an interrupted response', async () => {
  const restore = streamingFetch((controller) => {
    controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'delta', text: 'Synthetic partial refusal' })}\n${JSON.stringify({ type: 'error', error: 'assistant_content_filtered' })}\n`));
    controller.close();
  });
  try {
    await assert.rejects(streamAssistantMessage('test', 'Przygotuj podgląd', () => {}), (error: unknown) => {
      assert.ok(error instanceof AssistantApiError);
      assert.equal(error.code, 'assistant_content_filtered');
      assert.match(error.message, /Azure zablokował/); assert.match(error.message, /Kalendarz nie został zmieniony/);
      return true;
    });
  } finally { restore(); }
});
