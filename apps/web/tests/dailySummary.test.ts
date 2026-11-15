// S23KC2S1P2-254 / S23KC2S1P2-271: karta „Twój dzień w skrócie”.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getDaySummary, type DaySummary } from '../src/services/assistantApi.ts';
import { dayEventsKey, daySummaryView } from '../src/domain/daySummary.ts';
import type { Occurrence } from '../src/domain/model.ts';

function stubFetch(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown }) {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  };
}

const summary = (overrides: Partial<DaySummary>): DaySummary => ({ date: '2026-11-16', timeZone: 'Europe/Warsaw', status: 'ai', text: 'Masz dziś zajęcia o 8:00.',
  aiAvailable: true, cached: false, generatedAt: '2026-11-16T06:00:00.000Z', fingerprint: 'f1',
  facts: { events: [], gaps: [], totals: { classMinutes: 0, workMinutes: 0, personalMinutes: 0, busyMinutes: 0 } }, ...overrides });

test('S23KC2S1P2-271: karta pobiera podsumowanie jednym odczytem GET, a odświeżenie wymusza nowe', async () => {
  const requests: string[] = [];
  const restore = stubFetch((url, init) => { requests.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`); return { body: summary({}) }; });
  try {
    assert.equal((await getDaySummary('2026-11-16')).text, 'Masz dziś zajęcia o 8:00.');
    await getDaySummary('2026-11-16', true);
    assert.deepEqual(requests, ['GET /api/v1/assistant/day-summary?date=2026-11-16', 'GET /api/v1/assistant/day-summary?date=2026-11-16&refresh=true']);
  } finally { restore(); }
});

test('S23KC2S1P2-271: błąd API daje polski komunikat', async () => {
  const restore = stubFetch(() => ({ status: 503, body: { error: 'calendar_unavailable' } }));
  try { await assert.rejects(getDaySummary('2026-11-16'), /Nie udało się odczytać kalendarza/); }
  finally { restore(); }
});

test('S23KC2S1P2-271: pusty dzień, podsumowanie bez AI i wynik AI mają czytelne stany', () => {
  assert.deepEqual(daySummaryView(summary({ status: 'empty', text: 'Na dziś nie masz żadnych wydarzeń w kalendarzu.' })),
    { tone: 'muted', text: 'Na dziś nie masz żadnych wydarzeń w kalendarzu.', note: '' });
  assert.match(daySummaryView(summary({ status: 'local', aiAvailable: false, aiError: 'assistant_unavailable' })).note, /chwilowo niedostępny/);
  assert.match(daySummaryView(summary({ status: 'local', aiAvailable: false, aiError: 'azure_ai_not_configured' })).note, /nie jest skonfigurowany/);
  assert.equal(daySummaryView(summary({})).note, '');
});

test('S23KC2S1P2-271: klucz dnia zmienia się tylko po zmianie wydarzeń, nie po ponownym renderze', () => {
  const occurrence = (overrides: Partial<Occurrence>): Occurrence => ({ id: 'E1', title: 'Laboratorium', start: '2026-11-16T08:00', end: '2026-11-16T09:35',
    category: 'Class', mandatory: true, repeatWeekly: true, occurrenceStart: new Date('2026-11-16T07:00:00Z'), occurrenceEnd: new Date('2026-11-16T08:35:00Z'), ...overrides });
  const a = occurrence({}), b = occurrence({ id: 'E2', title: 'Praca', category: 'Work', mandatory: false, occurrenceStart: new Date('2026-11-16T11:00:00Z'), occurrenceEnd: new Date('2026-11-16T15:00:00Z') });
  const key = dayEventsKey('2026-11-16', [a, b]);
  assert.equal(dayEventsKey('2026-11-16', [b, { ...a }]), key, 'ta sama zawartość w innej kolejności');
  assert.equal(dayEventsKey('2026-11-16', [a, b, occurrence({ id: 'P', preview: true })]), key, 'podgląd propozycji grafiku nie jest wydarzeniem');
  assert.notEqual(dayEventsKey('2026-11-16', [a, { ...b, occurrenceEnd: new Date('2026-11-16T16:00:00Z') }]), key);
  assert.notEqual(dayEventsKey('2026-11-17', [a, b]), key);
});
