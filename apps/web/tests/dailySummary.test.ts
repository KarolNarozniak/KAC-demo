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

test('empty daily calendar uses a fixed message without any assistant requests', async () => {
  const restore = stubFetch(() => { throw new Error('Empty days must not call the API'); });
  try {
    const { getDailySummaryForCalendar } = await import('../src/services/assistantApi.ts');
    const result = await getDailySummaryForCalendar([], new Date(2026, 10, 18, 10));
    assert.match(result.text, /Nie masz dziś zaplanowanych wydarzeń/);
  } finally { restore(); }
});

test('daily summary automatically regenerates after today changes and reuses unchanged days', async () => {
  const { getDailySummaryForCalendar } = await import('../src/services/assistantApi.ts');
  let turns = 0;
  const restore = stubFetch((url, init) => {
    if (url.pathname.endsWith('/config')) return { enabled: true };
    if (url.pathname.endsWith('/conversations')) return { conversations: [conversation] };
    if (url.pathname.endsWith('/messages') && init?.method === 'POST') {
      turns++;
      return { message: { content: `Podsumowanie ${turns}` }, pendingActions: [] };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const now = new Date(2026, 10, 13, 10);
  const event = { id: 'daily-test', title: 'Spotkanie', start: '2026-11-13T12:00', end: '2026-11-13T13:00', category: 'Personal' as const, mandatory: false, repeatWeekly: false };
  try {
    const first = await getDailySummaryForCalendar([event], now);
    const unchanged = await getDailySummaryForCalendar([{ ...event }], now);
    assert.equal(first.text, unchanged.text);
    assert.equal(turns, 1);
    await getDailySummaryForCalendar([event, { ...event, id: 'tomorrow', start: '2026-11-14T12:00', end: '2026-11-14T13:00' }], now);
    assert.equal(turns, 1);
    assert.equal((await getDailySummaryForCalendar([event, { ...event, id: 'second' }], now)).text, 'Podsumowanie 2');
    assert.equal((await getDailySummaryForCalendar([{ ...event, title: 'Zmienione spotkanie' }], now)).text, 'Podsumowanie 3');
    assert.match((await getDailySummaryForCalendar([], now)).text, /Nie masz dziś/);
    assert.equal(turns, 3);
  } finally { restore(); }
});

test('daily summary conversations are hidden from Assistant but remain available to the daily card', async () => {
  const { listAssistantConversations } = await import('../src/services/assistantApi.ts');
  const restore = stubFetch((url) => {
    if (url.pathname.endsWith('/conversations')) return { conversations: [conversation, { ...conversation, id: 'chat', title: 'Moja rozmowa' }] };
    if (url.pathname.endsWith('/messages')) return { messages: [
      { role: 'user', content: { text: dailySummaryPrompt } },
      { role: 'assistant', content: { text: 'Twoje wydarzenia.' } },
    ] };
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  try {
    assert.deepEqual((await listAssistantConversations()).conversations.map((item) => item.id), ['chat']);
    assert.equal((await getDailySummary(date)).text, 'Twoje wydarzenia.');
  } finally { restore(); }
});

test('day context includes recurring and overnight events and greeting follows local time', async () => {
  const { dailySummaryContext, dayGreeting } = await import('../src/domain/dailySummary.ts');
  const event = { id: 'weekly', title: 'Zajęcia', start: '2026-11-06T10:00', end: '2026-11-06T11:00', category: 'Class' as const, mandatory: true, repeatWeekly: true };
  const today = new Date(2026, 10, 13, 10);
  assert.equal(dailySummaryContext([event], today).empty, false);
  assert.equal(dailySummaryContext([{ ...event, repeatWeekly: false }], today).empty, true);
  assert.equal(dailySummaryContext([{ ...event, start: '2026-11-12T23:00', end: '2026-11-13T01:00', repeatWeekly: false }], today).empty, false);
  assert.equal(dayGreeting(new Date(2026, 10, 13, 9)), 'Dzień dobry!');
  assert.equal(dayGreeting(new Date(2026, 10, 13, 18)), 'Dobry wieczór!');
  assert.equal(dayGreeting(new Date(2026, 10, 14, 1)), 'Dobry wieczór!');
  assert.match(dailySummaryPrompt, /Nie wypisuj daty/);
});
