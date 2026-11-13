import assert from 'node:assert/strict';
import test from 'node:test';
import { dailySummaryPrompt, getDailySummary } from '../src/services/assistantApi.ts';

const date = '2026-11-13';
const conversation = { id: 'conversation-summary', title: `Dzień w skrócie ${date}`, modelDeployment: 'gpt-5-mini',
  createdAt: '2026-11-13T12:00:00Z', updatedAt: '2026-11-13T12:00:00Z', expiresAt: '2026-12-13T12:00:00Z' };

function stubFetch(handler: (url: URL, init?: RequestInit) => unknown) {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return new Response(JSON.stringify(handler(url, init)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  };
}

test('daily summary creates a dated assistant conversation and asks for a read-only summary', async () => {
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const restore = stubFetch((url, init) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ path: url.pathname, method, body });
    if (url.pathname === '/api/v1/assistant/conversations' && method === 'GET') return { conversations: [] };
    if (url.pathname === '/api/v1/assistant/conversations' && method === 'POST') return conversation;
    if (url.pathname.endsWith('/messages') && method === 'POST') return { conversationId: conversation.id,
      message: { role: 'assistant', content: 'O 10:00 masz zajęcia, a po południu masz wolne.' }, pendingActions: [], usage: { inputTokens: 20, outputTokens: 18 } };
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  try {
    const result = await getDailySummary(date);
    assert.equal(result.conversationId, conversation.id);
    assert.equal(result.text, 'O 10:00 masz zajęcia, a po południu masz wolne.');
    assert.equal(requests.length, 3);
    assert.equal(requests[1]?.body?.title, conversation.title);
    assert.equal(requests[2]?.body?.content, dailySummaryPrompt);
    assert.match(dailySummaryPrompt, /Nie twórz ani nie zmieniaj wydarzeń/);
  } finally { restore(); }
});

test('daily summary reuses the saved answer for the same date unless explicitly refreshed', async () => {
  const requests: string[] = [];
  const restore = stubFetch((url, init) => {
    requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === '/api/v1/assistant/conversations') return { conversations: [conversation] };
    if (url.pathname.endsWith('/messages')) return { messages: [
      { id: 'user-1', role: 'user', content: { text: dailySummaryPrompt }, createdAt: '2026-11-13T12:00:00Z' },
      { id: 'assistant-1', role: 'assistant', content: { text: 'Masz dziś spokojny dzień.' }, createdAt: '2026-11-13T12:00:01Z' },
    ], pendingActions: [] };
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url.pathname}`);
  });
  try {
    const result = await getDailySummary(date);
    assert.equal(result.text, 'Masz dziś spokojny dzień.');
    assert.deepEqual(requests, ['GET /api/v1/assistant/conversations', `GET /api/v1/assistant/conversations/${conversation.id}/messages`]);
  } finally { restore(); }
});
