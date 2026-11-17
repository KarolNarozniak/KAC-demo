// Pobieranie zmian z Google (S23KC2S1P2-23, G05): żądania events.list, kursor 410, makieta „serwera Google” i komunikat wyniku.
import assert from 'node:assert/strict';
import test from 'node:test';
import { demoEventDelta, demoIntegrationEvents } from '../src/integrations/google/demo.js';
import type { CalendarSyncResult } from '../src/integrations/google/events-sync.js';
import { GoogleIntegrationError, listIntegrationEventsPage } from '../src/integrations/google/oauth-client.js';
import { summaryMessage } from '../src/integrations/google/sync.js';

const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('events.list: pełny odczyt z oknem i instancjami serii, przyrostowy tylko z kursorem, strony i kody błędów', async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => { urls.push(url); return respond(200, { items: [{ id: 'a' }, { nope: true }], nextPageToken: 'p2' }); };
  const window = { from: new Date('2035-02-01T00:00:00Z'), to: new Date('2035-08-30T00:00:00Z') };
  const page = await listIntegrationEventsPage('token', fetchImpl, 'kolo@group.calendar.google.com', { syncToken: null, window, pageToken: null });
  assert.deepEqual(page, { items: [{ id: 'a' }], nextPageToken: 'p2', nextSyncToken: null });
  const full = new URL(urls[0]!);
  assert.equal(full.pathname, '/calendar/v3/calendars/kolo%40group.calendar.google.com/events');
  assert.deepEqual([full.searchParams.get('singleEvents'), full.searchParams.get('timeMin'), full.searchParams.get('syncToken')], ['true', '2035-02-01T00:00:00.000Z', null]);
  // Google nie pozwala łączyć syncToken z timeMin/timeMax.
  await listIntegrationEventsPage('token', fetchImpl, 'primary', { syncToken: 'tok', window, pageToken: 'p2' });
  const incremental = new URL(urls[1]!);
  assert.deepEqual([incremental.searchParams.get('syncToken'), incremental.searchParams.get('timeMin'), incremental.searchParams.get('pageToken')], ['tok', null, 'p2']);

  const failing = (status: number, body: unknown = {}) => async () => respond(status, body);
  const code = async (status: number, body?: unknown) => {
    try { await listIntegrationEventsPage('token', failing(status, body), 'primary', { syncToken: 'tok', window: null, pageToken: null }); return null; }
    catch (error) { return error instanceof GoogleIntegrationError ? error.code : 'other'; }
  };
  assert.equal(await code(410), 'sync_token_expired');
  assert.equal(await code(401), 'reconnect_required');
  assert.equal(await code(404), 'calendar_not_found');
  assert.equal(await code(503), 'google_unavailable');
  assert.equal(await code(429), 'rate_limited');
  const offline = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(listIntegrationEventsPage('token', offline, 'primary', { syncToken: null, window, pageToken: null }), (error: unknown) =>
    error instanceof GoogleIntegrationError && error.code === 'network_error');
});

test('makieta: stan wyjściowy i „po zmianach w Google” oraz różnica jak w odczycie przyrostowym', () => {
  const window = { from: new Date('2035-02-01T12:00:00Z'), to: new Date('2035-08-30T12:00:00Z') };
  const base = demoIntegrationEvents('student.kac.demo@gmail.com', 'primary', 0, window);
  const changed = demoIntegrationEvents('student.kac.demo@gmail.com', 'primary', 1, window);
  assert.ok(base.some((event) => event.recurringEventId === 'demo-silownia'));
  assert.ok(base.every((event) => Date.parse(event.end!.dateTime!) > window.from.getTime() && Date.parse(event.start!.dateTime!) < window.to.getTime()));
  const delta = demoEventDelta(base, changed);
  assert.deepEqual(delta.map((event) => [event.id.replace(/_\d+$/, ''), event.status]).sort(),
    [['demo-angielski', 'cancelled'], ['demo-dentysta', 'confirmed'], ['demo-promotor', 'confirmed']]);
  assert.deepEqual(demoEventDelta(changed, changed), []);
  assert.deepEqual(demoIntegrationEvents('praca.kac.demo@gmail.com', 'primary', 0, window), []);
  // Wydarzenia całodniowe i oznaczone jako publikacja KAC są w danych – pomija je dopiero synchronizacja.
  assert.ok(demoIntegrationEvents('student.kac.demo@gmail.com', 'urodziny', 0, window).every((event) => event.start?.date));
  assert.ok(demoIntegrationEvents('student.kac.demo@gmail.com', 'grafik-pracy', 0, window).some((event) => event.extendedProperties?.private?.kacEventId));
  // Kalendarz publikacji ma też przykładowe pozostałe wydarzenia (historyjka 30, krok 10).
  assert.ok(demoIntegrationEvents('student.kac.demo@gmail.com', 'grafik-pracy', 0, window).some((event) => event.summary === 'Spotkanie zespołu'));
});

test('komunikat wyniku: zmiany, konflikty, pominięte całodniowe i kalendarze z błędem', () => {
  const result = (extra: Partial<CalendarSyncResult>): CalendarSyncResult => ({ calendarId: 'primary', name: 'Student', mode: 'incremental', reason: null,
    created: 0, updated: 0, deleted: 0, unchanged: 0, conflicts: 0, skippedAllDay: 0, skippedDeclined: 0, skippedOwn: 0, errorCode: null, ...extra });
  assert.equal(summaryMessage([result({ created: 3, updated: 1, skippedAllDay: 2, conflicts: 1 }), result({ name: 'Koło', deleted: 1 })]),
    'Kalendarze: 2. Pobrano zmiany z Google: nowe 3, zmienione 1, usunięte 1. (konflikty z edycją w KAC: 1, pominięte całodniowe: 2)');
  assert.equal(summaryMessage([result({})]), 'Kalendarze: 1. Brak zmian w Google.');
  assert.equal(summaryMessage([result({ created: 1 }), result({ name: 'Koło', errorCode: 'google_unavailable', created: 5 })]),
    'Kalendarze: 1. Pobrano zmiany z Google: nowe 1. Nie udało się pobrać: „Koło”.');
});
