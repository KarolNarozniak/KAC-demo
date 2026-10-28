// Jednorazowy import z Google Calendar (S23KC2S1P2-27): konto demonstracyjne, prawdziwy OAuth (z udawanym Google),
// odmowa dostępu (3a), brak wydarzeń (6a), jednorazowość połączenia i przeliczanie stref czasowych.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type CalendarRepository } from '../src/app.js';
import { CONNECTION_TTL_MS, GoogleConnections } from '../src/import/google/connections.js';
import { googleEventsToRows } from '../src/import/google/mapping.js';
import type { FetchLike } from '../src/import/google/oauth.js';
import type { CreateSessionInput } from '../src/import/session.js';

function fakeRepository() {
  const sessions: CreateSessionInput[] = [];
  const repository: CalendarRepository = {
    checkConnection: async () => {},
    getOverview: async () => ({ source: 'postgresql', user: { id: 'U001', name: 'Student', timezone: 'Europe/Warsaw' }, calendar: { id: 'K001', name: 'K' },
      counts: { events: 0, categories: 3 }, events: [] }),
    listEventsForImport: async () => [],
    createImportSession: async (input) => { sessions.push(input); return { id: `IMP-G${sessions.length}`, expiresAt: new Date('2026-11-01T12:00:00Z') }; },
  };
  return { repository, sessions };
}

test('mapowanie wydarzeń Google: strefa użytkownika, całodniowe pominięte, odwołane ignorowane, przez północ', () => {
  const { rows, skippedAllDay } = googleEventsToRows([
    { id: 'a', summary: ' Spotkanie ', location: 'Online', start: { dateTime: '2026-11-03T18:00:00Z' }, end: { dateTime: '2026-11-03T19:00:00Z' } },
    { id: 'b', summary: 'Urodziny', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
    { id: 'c', summary: 'Odwołane', status: 'cancelled', start: { dateTime: '2026-11-05T10:00:00+01:00' }, end: { dateTime: '2026-11-05T11:00:00+01:00' } },
    { id: 'd', summary: 'Impreza', start: { dateTime: '2026-11-06T22:00:00+01:00' }, end: { dateTime: '2026-11-07T02:00:00+01:00' } },
  ], 'Europe/Warsaw', 'Personal');
  assert.deepEqual(rows.map((row) => [row.title, row.date, row.startTime, row.endTime, row.endDate ?? '', row.category]), [
    ['Spotkanie', '2026-11-03', '19:00', '20:00', '', 'Personal'],
    ['Impreza', '2026-11-06', '22:00', '02:00', '2026-11-07', 'Personal'],
  ]);
  assert.equal(skippedAllDay, 1);
});

test('połączenie wygasa po 15 minutach i po imporcie zapomina token', () => {
  let now = 0;
  const store = new GoogleConnections(() => now);
  const connection = store.create('demo', null);
  store.update(connection.id, { status: 'connected', accessToken: 'secret' });
  store.markUsed(connection.id);
  assert.equal(store.get(connection.id)?.accessToken, null);
  assert.equal(store.get(connection.id)?.status, 'used');
  now = CONNECTION_TTL_MS + 1;
  assert.equal(store.get(connection.id), null);
});

test('tryb demonstracyjny: odmowa (3a), kalendarze, brak wydarzeń (6a), podgląd i jednorazowość', async () => {
  const { repository, sessions } = fakeRepository();
  const app = buildApi(repository);
  try {
    const start = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    assert.equal(start.mode, 'demo');
    const denied = await app.inject({ method: 'POST', url: `/api/import/google/connections/${start.connectionId}/consent`, payload: { allow: false } });
    assert.equal(denied.json().status, 'denied');
    assert.equal((await app.inject({ method: 'GET', url: `/api/import/google/connections/${start.connectionId}/calendars` })).statusCode, 403);

    const second = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    await app.inject({ method: 'POST', url: `/api/import/google/connections/${second.connectionId}/consent`, payload: { allow: true } });
    const calendars = (await app.inject({ method: 'GET', url: `/api/import/google/connections/${second.connectionId}/calendars` })).json();
    assert.ok(calendars.calendars.length >= 2);

    const read = (calendarId: string, from: string, to: string) => app.inject({ method: 'POST', url: `/api/import/google/connections/${second.connectionId}/read`, payload: { calendarId, from, to } });
    const empty = await read('urodziny', '2026-11-02', '2026-11-30');
    assert.equal(empty.statusCode, 422);
    assert.equal(empty.json().error, 'no-events');
    assert.ok(empty.json().skippedAllDay > 0);
    assert.equal((await read('primary', '2026-11-10', '2026-11-02')).json().error, 'invalid-range');

    const ok = await read('primary', '2026-11-02', '2026-11-15');
    assert.equal(ok.statusCode, 201);
    const body = ok.json();
    assert.ok(body.rows.some((row: { title: string }) => row.title === 'Siłownia'));
    assert.ok(body.rows.every((row: { category: string }) => row.category === 'Personal'));
    assert.equal(body.preview.length, body.rows.length);
    assert.equal(sessions[0]?.source, 'google');
    // Import jest jednorazowy – ponowny odczyt wymaga nowego połączenia.
    assert.equal((await read('primary', '2026-11-02', '2026-11-15')).json().error, 'connection-used');
  } finally { await app.close(); }
});

test('prawdziwy OAuth (udawany Google): PKCE, tylko odczyt, odmowa, wymiana kodu, kalendarze, wydarzenia i błąd tokenu', async () => {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  let calendarStatus = 200;
  const idToken = `x.${Buffer.from(JSON.stringify({ email: 'jan@gmail.com' })).toString('base64url')}.y`;
  const fakeFetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.token', id_token: idToken });
    if (url.includes('/calendarList')) return json({ items: [{ id: 'jan@gmail.com', summary: 'Jan', primary: true }, { id: 'uczelnia', summary: 'Uczelnia' }] }, calendarStatus);
    if (url.includes('/events')) return json({ items: [
      { id: 'e1', summary: 'Konsultacje', start: { dateTime: '2026-11-05T10:00:00+01:00' }, end: { dateTime: '2026-11-05T11:00:00+01:00' } },
      { id: 'e2', summary: 'Święto', start: { date: '2026-11-11' }, end: { date: '2026-11-12' } },
    ] });
    return json({}, 404);
  };
  const { repository } = fakeRepository();
  const app = buildApi(repository, [], { google: { oauth: { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:4000/api/import/google/callback' }, fetch: fakeFetch } });
  try {
    const refused = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    const refusedPage = await app.inject({ method: 'GET', url: `/api/import/google/callback?state=${refused.connectionId}&error=access_denied` });
    assert.match(refusedPage.body, /Brak zgody/);
    assert.equal((await app.inject({ method: 'GET', url: `/api/import/google/connections/${refused.connectionId}` })).json().status, 'denied');

    const start = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    assert.equal(start.mode, 'google');
    const auth = new URL(start.authUrl);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.match(auth.searchParams.get('scope') ?? '', /calendar\.readonly/);
    assert.doesNotMatch(auth.searchParams.get('scope') ?? '', /auth\/calendar(\s|$)/); // bez prawa zapisu
    assert.equal(auth.searchParams.get('state'), start.connectionId);

    assert.equal((await app.inject({ method: 'GET', url: '/api/import/google/callback?state=nieznany&code=abc' })).statusCode, 400);
    const callback = await app.inject({ method: 'GET', url: `/api/import/google/callback?state=${start.connectionId}&code=abc` });
    assert.match(callback.body, /Połączono z Google/);
    const tokenRequest = new URLSearchParams(calls.find((call) => call.url.includes('oauth2.googleapis.com'))?.init?.body ?? '');
    assert.ok((tokenRequest.get('code_verifier') ?? '').length >= 43);
    const status = (await app.inject({ method: 'GET', url: `/api/import/google/connections/${start.connectionId}` })).json();
    assert.deepEqual(status, { status: 'connected', email: 'jan@gmail.com', mode: 'google' });
    // Token nie wychodzi poza serwer.
    assert.doesNotMatch(JSON.stringify(status), /ya29/);

    const calendars = (await app.inject({ method: 'GET', url: `/api/import/google/connections/${start.connectionId}/calendars` })).json();
    assert.deepEqual(calendars.calendars.map((calendar: { id: string }) => calendar.id), ['jan@gmail.com', 'uczelnia']);
    assert.ok(calls.some((call) => call.init?.headers?.Authorization === 'Bearer ya29.token'));

    const read = await app.inject({ method: 'POST', url: `/api/import/google/connections/${start.connectionId}/read`, payload: { calendarId: 'uczelnia', from: '2026-11-01', to: '2026-11-30', category: 'Class' } });
    assert.equal(read.statusCode, 201);
    const body = read.json();
    assert.deepEqual(body.rows.map((row: { title: string; date: string; startTime: string; category: string }) => [row.title, row.date, row.startTime, row.category]), [['Konsultacje', '2026-11-05', '10:00', 'Class']]);
    assert.equal(body.skippedAllDay, 1);
    assert.equal(body.calendarName, 'Uczelnia');
    const eventsUrl = new URL(calls.find((call) => call.url.includes('/events'))!.url);
    assert.equal(eventsUrl.searchParams.get('singleEvents'), 'true');
    assert.equal(eventsUrl.searchParams.get('timeMin'), '2026-10-31T23:00:00.000Z');

    // Odrzucony token Google → czytelny błąd zamiast awarii.
    const third = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    await app.inject({ method: 'GET', url: `/api/import/google/callback?state=${third.connectionId}&code=abc` });
    calendarStatus = 401;
    const unauthorized = await app.inject({ method: 'GET', url: `/api/import/google/connections/${third.connectionId}/calendars` });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error, 'google-unauthorized');
  } finally { await app.close(); }
});
