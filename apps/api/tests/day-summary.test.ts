// S23KC2S1P2-254 / S23KC2S1P2-270: fakty dnia, wolne okna, sumy, cache podsumowania i awaria AI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ApiOptions } from '../src/api/contracts.js';
import { computeDayFacts, freeWindowsInRange, localDaySummary, totalsInRange, type SourceEvent } from '../src/ai/calendar-facts.js';
import { executeAssistantTool } from '../src/ai/tools.js';

const zone = 'Europe/Warsaw';
const lab: SourceEvent = { id: 'E001', title: 'Laboratorium', start: '2026-10-12T08:00', end: '2026-10-12T09:35', category: 'Zajęcia', mandatory: true, repeatWeekly: true };
const work: SourceEvent = { id: 'W1', title: 'Praca', start: '2026-11-16T12:00', end: '2026-11-16T16:00', category: 'Praca' };
const night: SourceEvent = { id: 'N1', title: 'Zmiana nocna', start: '2026-11-16T22:00', end: '2026-11-17T06:00', category: 'Praca' };

test('S23KC2S1P2-270: fakty dnia rozwijają serię, przycinają zmianę nocną do dnia i liczą przerwy', () => {
  const monday = computeDayFacts([lab, work, night], '2026-11-16', zone);
  assert.deepEqual(monday.events.map((item) => [item.title, item.startLocal, item.endLocal, item.category]), [
    ['Laboratorium', '2026-11-16T08:00', '2026-11-16T09:35', 'Class'],
    ['Praca', '2026-11-16T12:00', '2026-11-16T16:00', 'Work'],
    ['Zmiana nocna', '2026-11-16T22:00', '2026-11-17T06:00', 'Work'],
  ]);
  assert.equal(monday.events[2]?.endsAfterDay, true);
  assert.deepEqual(monday.gaps.map((gap) => [gap.startLocal, gap.endLocal, gap.minutes]),
    [['2026-11-16T09:35', '2026-11-16T12:00', 145], ['2026-11-16T16:00', '2026-11-16T22:00', 360]]);
  assert.deepEqual(monday.totals, { classMinutes: 95, workMinutes: 240 + 120, personalMinutes: 0, busyMinutes: 95 + 240 + 120 });

  const tuesday = computeDayFacts([lab, work, night], '2026-11-17', zone);
  assert.equal(tuesday.events.length, 1);
  assert.equal(tuesday.events[0]?.startsBeforeDay, true);
  assert.equal(tuesday.totals.workMinutes, 360, 'tylko część zmiany nocnej przypadająca na ten dzień');
});

test('S23KC2S1P2-254 KA2/KA5: pusty dzień ma jasny tekst, a odcisk zmienia się tylko po zmianie wydarzeń', () => {
  const empty = computeDayFacts([lab], '2026-11-18', zone);
  assert.equal(empty.events.length, 0);
  assert.equal(localDaySummary(empty), 'Na dziś nie masz żadnych wydarzeń w kalendarzu.');
  const before = computeDayFacts([lab, work], '2026-11-16', zone).fingerprint;
  assert.equal(computeDayFacts([work, lab], '2026-11-16', zone).fingerprint, before, 'kolejność odczytu nie zmienia odcisku');
  assert.notEqual(computeDayFacts([lab, { ...work, end: '2026-11-16T17:00' }], '2026-11-16', zone).fingerprint, before);
  assert.match(localDaySummary(computeDayFacts([lab, work], '2026-11-16', zone)), /Masz dziś 2 wydarzenia: 08:00–09:35 Laboratorium \(zajęcia\), 12:00–16:00 Praca \(praca\)\. Najdłuższa przerwa: 09:35–12:00 \(2 h 25 min\)\. Praca łącznie: 4 h\./);
});

test('S23KC2S1P2-254 KA3: wolne okno w podanych ramach nie przecina żadnego wydarzenia', () => {
  const windows = freeWindowsInRange([lab, work], '2026-11-16', '2026-11-17', '08:00', '20:00', 60, zone);
  assert.deepEqual(windows.map((item) => [item.startLocal, item.endLocal, item.minutes]), [
    ['2026-11-16T09:35', '2026-11-16T12:00', 145], ['2026-11-16T16:00', '2026-11-16T20:00', 240],
    ['2026-11-17T08:00', '2026-11-17T20:00', 720],
  ]);
  const busy = [lab, work].flatMap((event) => computeDayFacts([event], '2026-11-16', zone).events);
  for (const window of windows) for (const event of busy)
    assert.ok(window.endLocal <= event.startLocal || window.startLocal >= event.endLocal, `${window.startLocal} przecina ${event.title}`);
  assert.equal(freeWindowsInRange([lab], '2026-11-16', '2026-11-16', '08:00', '10:00', 30, zone).length, 0, 'okno 25 min jest krótsze niż wymagane');
});

test('S23KC2S1P2-254 KA4: suma pracy uwzględnia serie, zmiany nocne i rzeczywisty czas przy zmianie czasu', () => {
  const weeklyWork: SourceEvent = { id: 'S1', title: 'Praca', start: '2027-03-21T01:00', end: '2027-03-21T05:00', category: 'Praca', repeatWeekly: true };
  // 28.03.2027 o 02:00 zegary przesuwają się na 03:00: lokalnie 01:00–05:00, ale realnie 3 h.
  assert.equal(totalsInRange([weeklyWork], '2027-03-28', '2027-03-28', zone).workMinutes, 180);
  assert.equal(totalsInRange([weeklyWork], '2027-03-21', '2027-03-28', zone).workMinutes, 240 + 180);
  const week = totalsInRange([lab, work, night], '2026-11-16', '2026-11-22', zone);
  assert.equal(week.workMinutes, 240 + 480);
  assert.equal(week.classMinutes, 95);
});

function calendar(events: SourceEvent[]) {
  return { checkConnection: async () => {}, getOverview: async () => ({ source: 'postgresql', user: { id: 'U001', name: 'Demo', timezone: zone },
    calendar: { id: 'K001', name: 'Demo' }, counts: { events: events.length, categories: 2 }, events: events.map((event) => ({ ...event, color: '#000', mandatory: Boolean(event.mandatory) })) }) } as never;
}

test('S23KC2S1P2-254 KA5/KA6: GET /assistant/day-summary – bez AI dla pustego dnia, cache po odcisku, odświeżenie i awaria modelu', async () => {
  const events: SourceEvent[] = [lab, work];
  let calls = 0;
  let failWith: unknown = null;
  const options: ApiOptions = {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiService: {
      extractSchedule: async () => { throw new Error('not used'); },
      sendAssistantMessage: async () => { throw new Error('not used'); },
      summarizeDay: async (facts, trustedContext) => {
        calls++;
        assert.match(trustedContext, /strefa IANA Europe\/Warsaw/);
        if (failWith) throw failWith;
        return { text: `Masz ${facts.events.length} wydarzenia (wywołanie ${calls}).`, usage: { inputTokens: 10, outputTokens: 5 } };
      },
    },
  };
  const app = buildApi(calendar(events), [], options);
  try {
    const empty = await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-18' });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().status, 'empty');
    assert.equal(calls, 0, 'pusty dzień nie wywołuje modelu');

    const first = (await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16' })).json();
    assert.equal(first.status, 'ai'); assert.equal(first.cached, false); assert.equal(calls, 1);
    assert.equal(first.facts.totals.workMinutes, 240);
    const again = (await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16' })).json();
    assert.equal(again.cached, true); assert.equal(again.text, first.text); assert.equal(calls, 1, 'niezmieniony kalendarz – bez kolejnego wywołania');

    events.push({ id: 'P1', title: 'Siłownia', start: '2026-11-16T18:00', end: '2026-11-16T19:00', category: 'Prywatne' });
    const changed = (await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16' })).json();
    assert.equal(changed.cached, false); assert.notEqual(changed.fingerprint, first.fingerprint); assert.equal(calls, 2);
    const refreshed = (await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16&refresh=true' })).json();
    assert.equal(refreshed.cached, false); assert.equal(calls, 3);

    failWith = Object.assign(new Error('rate'), { status: 429 });
    const failed = await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16&refresh=true' });
    assert.equal(failed.statusCode, 200, 'awaria AI nie blokuje ekranu Dziś');
    assert.equal(failed.json().status, 'local'); assert.equal(failed.json().aiAvailable, false); assert.equal(failed.json().aiError, 'assistant_rate_limited');
    assert.match(failed.json().text, /^Masz dziś 3 wydarzenia/);

    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-02-30' })).statusCode, 400);
  } finally { await app.close(); }

  // Jawna usługa bez summarizeDay: bez niej buildApi utworzyłby prawdziwego klienta Azure, gdy lokalny .env ma endpoint.
  const withoutAi = buildApi(calendar([work]), [], { userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiService: { extractSchedule: async () => { throw new Error('not used'); }, sendAssistantMessage: async () => { throw new Error('not used'); } } });
  try {
    const local = (await withoutAi.inject({ method: 'GET', url: '/api/v1/assistant/day-summary?date=2026-11-16' })).json();
    assert.equal(local.status, 'local'); assert.equal(local.aiError, 'azure_ai_not_configured');
  } finally { await withoutAi.close(); }
});

test('S23KC2S1P2-270: narzędzia asystenta liczą wolne okna i sumy na backendzie, a wyszukiwanie rozwija serie', async () => {
  const context = { scope: { userId: 'U001', calendarId: 'K001' }, conversationId: 'c1', calendar: calendar([lab, work]),
    ai: { createAction: async () => { throw new Error('not used'); } }, actionTtlMinutes: 15 } as never;
  const search = await executeAssistantTool('calendar_search_events', JSON.stringify({ from: '2026-11-23', to: '2026-11-23', query: null }), context);
  assert.deepEqual((search.events as Array<{ title: string; start: string }>).map((item) => [item.title, item.start]), [['Laboratorium', '2026-11-23T08:00']]);
  const day = await executeAssistantTool('calendar_search_events', JSON.stringify({ from: '2026-11-16', to: '2026-11-16', query: null }), context);
  assert.deepEqual((day.events as Array<{ title: string; mandatory?: boolean }>).map((item) => [item.title, item.mandatory]), [['Laboratorium', true], ['Praca', undefined]],
    'obowiązkowość tylko przy zajęciach');
  const windows = await executeAssistantTool('calendar_free_windows', JSON.stringify({ from: '2026-11-16', to: '2026-11-16', dayStart: '08:00', dayEnd: '20:00', minMinutes: 60 }), context);
  assert.equal((windows.windows as unknown[]).length, 2);
  const totals = await executeAssistantTool('calendar_time_totals', JSON.stringify({ from: '2026-11-16', to: '2026-11-22' }), context);
  assert.equal(totals.workMinutes, 240); assert.equal(totals.classMinutes, 95);
  assert.deepEqual(await executeAssistantTool('calendar_free_windows', JSON.stringify({ from: '2026-11-01', to: '2026-11-30', dayStart: '08:00', dayEnd: '20:00', minMinutes: 60 }), context),
    { error: 'invalid_or_too_wide_date_range' });
  assert.deepEqual(await executeAssistantTool('calendar_time_totals', JSON.stringify({ from: '2026-11-16', to: '2026-11-22', extra: 1 }), context), { error: 'invalid_tool_arguments' });
});
