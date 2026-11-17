// Testy z prawdziwą bazą: pobieranie i stosowanie zmian z Google według trwałej tożsamości (S23KC2S1P2-23, G05 / S23KC2S1P2-289).
// Udawany Google (strony, kursory, 410, błędy stron) i stały zegar 2035-03-01 – okno odczytu: 1.02–30.08.2035.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { PostgresGoogleIntegrationRepository } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService } from '../src/integrations/google/service.js';
import { TokenCipher } from '../src/integrations/google/token-cipher.js';
import { FakeGoogle, OAUTH } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
const NOW = new Date('2035-03-01T12:00:00Z');
const SYNCED = 'Google (synchronizacja)';
type Scope = { userId: string; calendarId: string };
type Fixture = { app: FastifyInstance; scope: Scope; google: FakeGoogle; delays: number[]; clock: { now: Date } };

after(async () => { await pool?.end(); });

async function withUser(work: (scope: Scope) => Promise<void>) {
  const userId = `UGE-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Pobieranie', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Pobieranie test', 'Osobisty') returning id_kalendarza`, [userId]);
  try {
    await work({ userId, calendarId: String(calendar.rows[0].id_kalendarza) });
  } finally {
    await pool!.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

/** Prawdziwy tryb z udawanym Google: konto połączone, kalendarze „primary” (właściciel) i „kolo” (odczyt). */
async function withGoogle(work: (fixture: Fixture) => Promise<void>, google = new FakeGoogle()) {
  await withUser(async (scope) => {
    google.calendarPages = [[
      { id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
      { id: 'kolo@group.calendar.google.com', summary: 'Koło naukowe', accessRole: 'reader', timeZone: 'Europe/Warsaw' },
    ]];
    const delays: number[] = [];
    const clock = { now: NOW };
    const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
      oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async (ms) => { delays.push(ms); }, now: () => clock.now },
    });
    const app = buildApi(new PostgresCalendarRepository(pool!), [], { userScope: () => scope, googleIntegration: service });
    try {
      const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).json();
      google.grantCode('code-1', { sub: `sub-${scope.userId}`, email: 'student@example.test', refreshToken: '1//r1' });
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${new URL(started.authUrl).searchParams.get('state')}&code=code-1` })).statusCode, 200);
      await work({ app, scope, google, delays, clock });
    } finally {
      await app.close();
    }
  });
}

const timed = (id: string, summary: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  ({ id, summary, start: { dateTime: start, timeZone: 'Europe/Warsaw' }, end: { dateTime: end, timeZone: 'Europe/Warsaw' }, ...extra });
const sync = async (app: FastifyInstance, body: Record<string, unknown> = {}) => (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: body })).json();
const synced = async (scope: Scope) => (await pool!.query(`select e.id_wydarzenia, e.tytul, e.miejsce, e.event_version, e.updated_at,
    to_char(e.rozpoczecie at time zone 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') as start, to_char(e.zakonczenie at time zone 'Europe/Warsaw', 'YYYY-MM-DD HH24:MI') as end,
    extract(epoch from (e.zakonczenie - e.rozpoczecie)) / 60 as minutes, m.google_id, m.stan, m.id_konta
  from t_wydarzenia e join t_google_wydarzenia m on m.id_wydarzenia = e.id_wydarzenia
  where e.id_kalendarza = $1 and e.zrodlo = $2 order by m.google_id`, [scope.calendarId, SYNCED])).rows;
const byGoogleId = async (scope: Scope, id: string) => (await synced(scope)).find((row) => row.google_id === id);
const manual = async (scope: Scope) => (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, updated_at, event_version from t_wydarzenia
  where id_kalendarza = $1 and zrodlo <> $2 order by id_wydarzenia`, [scope.calendarId, SYNCED])).rows;
const cursor = async (scope: Scope, calendar = 'primary') => (await pool!.query(`select s.sync_token, s.pelny_odczyt_at from t_google_sync_stan s
  join t_kalendarze_google k using (id_kal_google) join t_konta_google a on a.id_konta = s.id_konta
  where a.id_uzytkownika = $1 and k.id_zewnetrzne = $2 and a.status_polaczenia = 'Połączone'`, [scope.userId, calendar])).rows[0];
const selectSources = async (app: FastifyInstance, sources: string[]) => {
  const current = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' })).json();
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection',
    payload: { version: current.version, sourceCalendarIds: sources, publicationTargetCalendarId: null } });
  assert.equal(saved.statusCode, 200, saved.body);
};
const editLocally = (app: FastifyInstance, eventId: string, title: string, start: string, end: string) =>
  app.inject({ method: 'PUT', url: `/api/v1/calendar/events/${eventId}`, payload: { title, start, end, category: 'Personal', location: '', mandatory: false, repeatWeekly: false } });

function seedPrimary(google: FakeGoogle) {
  const calendar = google.events('primary');
  calendar.pageSize = 2;
  calendar.put(timed('dentysta', 'Dentysta', '2035-03-07T15:00:00+01:00', '2035-03-07T15:45:00+01:00', { location: 'ul. Górczewska 200' }));
  // Seria cotygodniowa: instancje przed i po zmianie czasu – zawsze 9:00 czasu polskiego.
  calendar.put(timed('kurs_20350321T080000Z', 'Kurs', '2035-03-21T09:00:00+01:00', '2035-03-21T10:30:00+01:00',
    { recurringEventId: 'kurs', originalStartTime: { dateTime: '2035-03-21T09:00:00+01:00' } }));
  calendar.put(timed('kurs_20350328T070000Z', 'Kurs', '2035-03-28T09:00:00+02:00', '2035-03-28T10:30:00+02:00',
    { recurringEventId: 'kurs', originalStartTime: { dateTime: '2035-03-28T09:00:00+02:00' } }));
  // Noc zmiany czasu (25.03.2035): 1:30 → 3:30 to w rzeczywistości jedna godzina.
  calendar.put(timed('noc', 'Dyżur nocny', '2035-03-25T01:30:00+01:00', '2035-03-25T03:30:00+02:00'));
  calendar.put({ id: 'urodziny', summary: 'Urodziny', start: { date: '2035-03-10' }, end: { date: '2035-03-11' } });
  calendar.put(timed('webinar', 'Webinar', '2035-03-12T17:00:00+01:00', '2035-03-12T18:00:00+01:00', { attendees: [{ self: true, responseStatus: 'declined' }] }));
  calendar.put(timed('kac', 'Zmiana pracy', '2035-03-13T08:00:00+01:00', '2035-03-13T12:00:00+01:00', { extendedProperties: { private: { kacEventId: 'e-1' } } }));
  calendar.put(timed('daleko', 'Poza oknem', '2036-01-10T10:00:00+01:00', '2036-01-10T11:00:00+01:00'));
  return calendar;
}

test('pełny odczyt: wszystkie strony, instancje serii, zmiana czasu, pominięte całodniowe/odrzucone/własne, pusty kalendarz to sukces, powtórka bez duplikatów', { skip }, () => withGoogle(async ({ app, scope, google, clock }) => {
  const calendar = seedPrimary(google);
  await selectSources(app, ['primary', 'kolo@group.calendar.google.com']);
  const manualBefore = await manual(scope);
  const first = await sync(app);
  assert.equal(first.attempt.status, 'success', JSON.stringify(first.attempt));
  const [primary, kolo] = first.summary.calendars;
  assert.deepEqual([primary.mode, primary.reason, primary.created, primary.skippedAllDay, primary.skippedDeclined, primary.skippedOwn, primary.errorCode],
    ['full', 'first', 4, 1, 1, 1, null]);
  // Pusta poprawna odpowiedź to sukces, nie błąd „brak wydarzeń”.
  assert.deepEqual([kolo.mode, kolo.created, kolo.errorCode], ['full', 0, null]);
  assert.match(first.attempt.message, /nowe 4/);
  // Pierwszy odczyt: okno czasu, instancje serii, kolejne strony; kursor dopiero z ostatniej strony.
  const requests = calendar.requests;
  assert.ok(requests.length >= 4);
  assert.deepEqual([requests[0]!.get('singleEvents'), requests[0]!.get('timeMin'), requests[0]!.get('timeMax'), requests[0]!.get('syncToken')],
    ['true', '2035-02-01T12:00:00.000Z', '2035-08-30T12:00:00.000Z', null]);
  assert.equal((await cursor(scope)).sync_token, calendar.cursor);

  const rows = await synced(scope);
  assert.deepEqual(rows.map((row) => [row.google_id, row.tytul, row.start, row.end]), [
    ['dentysta', 'Dentysta', '2035-03-07 15:00', '2035-03-07 15:45'],
    ['kurs_20350321T080000Z', 'Kurs', '2035-03-21 09:00', '2035-03-21 10:30'],
    ['kurs_20350328T070000Z', 'Kurs', '2035-03-28 09:00', '2035-03-28 10:30'],
    ['noc', 'Dyżur nocny', '2035-03-25 01:30', '2035-03-25 03:30'],
  ]);
  assert.equal(Number(rows.find((row) => row.google_id === 'noc')!.minutes), 60);
  const outbox = await pool!.query(`select count(*)::int as n from t_event_outbox where id_uzytkownika = $1 and typ_zdarzenia = 'calendar_event.created'
    and payload->>'origin' = 'google_sync'`, [scope.userId]);
  assert.equal(outbox.rows[0].n, 4);

  // Powtórny odczyt: kursorem, bez duplikatów i bez zmian.
  const again = await sync(app);
  assert.deepEqual([again.attempt.status, again.summary.calendars[0].mode, again.summary.calendars[0].created], ['success', 'incremental', 0]);
  assert.equal(calendar.requests.at(-1)!.get('syncToken'), calendar.cursor);
  assert.match(again.attempt.message, /Brak zmian w Google/);
  assert.equal((await synced(scope)).length, 4);
  assert.deepEqual(await manual(scope), manualBefore);

  // Kursor nie dociąga instancji wchodzących w okno – po 4 tygodniach okno przesuwa się pełnym odczytem.
  // Wydarzenie sprzed nowego okna zostaje w KAC jako historia; nowe za starym końcem okna zostaje pobrane.
  calendar.put(timed('wrzesien', 'Wrzesień', '2035-09-05T10:00:00+02:00', '2035-09-05T11:00:00+02:00'));
  clock.now = new Date('2035-04-10T12:00:00Z');
  const moved = await sync(app);
  assert.deepEqual([moved.summary.calendars[0].mode, moved.summary.calendars[0].reason, moved.summary.calendars[0].created, moved.summary.calendars[0].deleted],
    ['full', 'window', 1, 0]);
  assert.ok(await byGoogleId(scope, 'dentysta'));
  assert.ok(await byGoogleId(scope, 'wrzesien'));
}));

test('zmiany przyrostowe; usunięcie w Google nie kasuje ręcznego wpisu; edycja w KAC wygrywa, „Przywróć wersję z Google”, usunięcie w KAC jest trwałe', { skip }, () => withGoogle(async ({ app, scope, google }) => {
  const calendar = seedPrimary(google);
  await selectSources(app, ['primary']);
  await sync(app);
  // Ręczny wpis z tym samym tytułem i godziną co instancja serii z Google (wpisany w KAC, bez mapowania).
  const manualId = String((await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie)
    values ($1, 'CAT03', 'Kurs', '2035-03-21T09:00:00+01:00', '2035-03-21T10:30:00+01:00') returning id_wydarzenia`, [scope.calendarId])).rows[0].id_wydarzenia);
  const manualBefore = await manual(scope);

  calendar.put(timed('dentysta', 'Dentysta', '2035-03-07T16:00:00+01:00', '2035-03-07T16:45:00+01:00', { location: 'ul. Górczewska 212' }));
  calendar.cancel('kurs_20350321T080000Z');
  calendar.put(timed('promotor', 'Konsultacje', '2035-03-08T12:00:00+01:00', '2035-03-08T13:00:00+01:00'));
  const delta = await sync(app);
  assert.deepEqual([delta.summary.calendars[0].mode, delta.summary.calendars[0].created, delta.summary.calendars[0].updated, delta.summary.calendars[0].deleted],
    ['incremental', 1, 1, 1]);
  const dentist = await byGoogleId(scope, 'dentysta');
  assert.deepEqual([dentist.start, dentist.miejsce], ['2035-03-07 16:00', 'ul. Górczewska 212']);
  assert.equal(await byGoogleId(scope, 'kurs_20350321T080000Z'), undefined);
  // Ręczny wpis nietknięty – synchronizacja zmienia tylko wydarzenia ze swojego mapowania.
  assert.deepEqual(await manual(scope), manualBefore);
  const origins = await pool!.query(`select typ_zdarzenia, count(*)::int as n from t_event_outbox where id_uzytkownika = $1 and payload->>'origin' = 'google_sync'
    group by typ_zdarzenia order by typ_zdarzenia`, [scope.userId]);
  assert.deepEqual(origins.rows.map((row) => [row.typ_zdarzenia, row.n]), [['calendar_event.created', 5], ['calendar_event.deleted', 1], ['calendar_event.updated', 1]]);

  // D05: edycja w KAC wygrywa – zmiana z Google jest konfliktem, nie nadpisaniem.
  assert.equal((await editLocally(app, dentist.id_wydarzenia, 'Dentysta (przełożone)', '2035-03-07T17:00', '2035-03-07T17:45')).statusCode, 200);
  calendar.put(timed('dentysta', 'Dentysta', '2035-03-07T18:00:00+01:00', '2035-03-07T18:45:00+01:00', { location: 'ul. Górczewska 212' }));
  const conflict = await sync(app);
  assert.deepEqual([conflict.summary.calendars[0].conflicts, conflict.summary.calendars[0].updated], [1, 0]);
  assert.deepEqual([(await byGoogleId(scope, 'dentysta')).tytul, (await byGoogleId(scope, 'dentysta')).start], ['Dentysta (przełożone)', '2035-03-07 17:00']);
  const imported = (await app.inject({ method: 'GET', url: `/api/v1/integrations/google/imported-events/${dentist.id_wydarzenia}` })).json();
  assert.deepEqual([imported.state, imported.calendar.id, imported.googleVersion.start], ['conflict', 'primary', '2035-03-07T17:00:00.000Z']);
  // Przywrócenie wersji z Google działa bez sieci (wersja zapisana lokalnie); kolejne zmiany z Google znowu się stosują.
  const restored = (await app.inject({ method: 'POST', url: `/api/v1/integrations/google/imported-events/${dentist.id_wydarzenia}/restore` })).json();
  assert.equal(restored.state, 'synced');
  assert.equal((await byGoogleId(scope, 'dentysta')).start, '2035-03-07 18:00');
  calendar.put(timed('dentysta', 'Dentysta', '2035-03-07T19:00:00+01:00', '2035-03-07T19:45:00+01:00', { location: 'ul. Górczewska 212' }));
  assert.equal((await sync(app)).summary.calendars[0].updated, 1);
  assert.equal((await byGoogleId(scope, 'dentysta')).start, '2035-03-07 19:00');

  // Usunięcie pobranego wydarzenia w KAC jest trwałe: zmiana w Google go nie odtwarza.
  const course = await byGoogleId(scope, 'kurs_20350328T070000Z');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/calendar/events/${course.id_wydarzenia}` })).statusCode, 200);
  calendar.put(timed('kurs_20350328T070000Z', 'Kurs (sala 120)', '2035-03-28T09:00:00+02:00', '2035-03-28T10:30:00+02:00', { recurringEventId: 'kurs' }));
  const afterDelete = await sync(app);
  assert.deepEqual([afterDelete.summary.calendars[0].created, afterDelete.summary.calendars[0].updated], [0, 0]);
  assert.equal(await byGoogleId(scope, 'kurs_20350328T070000Z'), undefined);

  // Usunięcie w Google wydarzenia edytowanego w KAC: lokalna kopia zostaje jako zwykłe wydarzenie (odłączone).
  const promotor = await byGoogleId(scope, 'promotor');
  await editLocally(app, promotor.id_wydarzenia, 'Konsultacje – moje notatki', '2035-03-08T12:00', '2035-03-08T13:00');
  calendar.cancel('promotor');
  const detached = await sync(app);
  assert.deepEqual([detached.summary.calendars[0].deleted, detached.summary.calendars[0].conflicts], [0, 1]);
  const kept = await byGoogleId(scope, 'promotor');
  assert.deepEqual([kept.tytul, kept.stan], ['Konsultacje – moje notatki', 'odlaczone']);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/imported-events/${promotor.id_wydarzenia}` })).json().state, 'detached');
  assert.deepEqual((await app.inject({ method: 'POST', url: `/api/v1/integrations/google/imported-events/${promotor.id_wydarzenia}/restore` })).json(), { error: 'google_version_missing' });
  assert.deepEqual((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/imported-events/${manualId}` })).json(), { error: 'not_imported' });
}));

test('błąd strony nie przesuwa kursora i niczego nie zapisuje; błąd zapisu cofa całą serię; wygasły kursor (410) – pełny odczyt tylko przestrzeni Google', { skip }, () => withGoogle(async ({ app, scope, google, delays }) => {
  const calendar = seedPrimary(google);
  await selectSources(app, ['primary', 'kolo@group.calendar.google.com']);
  google.events('kolo@group.calendar.google.com').put(timed('kolo-1', 'Spotkanie koła', '2035-03-14T18:00:00+01:00', '2035-03-14T19:30:00+01:00'));
  await sync(app);
  const tokenBefore = (await cursor(scope)).sync_token;

  // Druga strona kalendarza głównego nie odpowiada (3 próby) – kalendarz bez zmian, kursor stary; drugi kalendarz się udaje.
  calendar.put(timed('nowe-1', 'Nowe 1', '2035-03-15T10:00:00+01:00', '2035-03-15T11:00:00+01:00'));
  calendar.put(timed('nowe-2', 'Nowe 2', '2035-03-16T10:00:00+01:00', '2035-03-16T11:00:00+01:00'));
  calendar.put(timed('nowe-3', 'Nowe 3', '2035-03-17T10:00:00+01:00', '2035-03-17T11:00:00+01:00'));
  calendar.pageFailures = [{ page: 1, reply: 503 }, { page: 1, reply: 503 }, { page: 1, reply: 503 }];
  google.events('kolo@group.calendar.google.com').put(timed('kolo-2', 'Warsztaty', '2035-03-18T16:00:00+01:00', '2035-03-18T20:00:00+01:00'));
  delays.length = 0;
  const pageError = await sync(app);
  assert.deepEqual([pageError.attempt.status, pageError.attempt.errorCode, pageError.attempt.retryable], ['partial', 'google_unavailable', true]);
  assert.deepEqual(pageError.summary.calendars.map((item: { errorCode: string | null; created: number }) => [item.errorCode, item.created]), [['google_unavailable', 0], [null, 1]]);
  assert.deepEqual(delays, [500, 1000]);
  assert.equal((await cursor(scope)).sync_token, tokenBefore);
  assert.equal(await byGoogleId(scope, 'nowe-1'), undefined);
  assert.notEqual(pageError.status.state, 'success');
  // Ponowienie stosuje całą serię.
  assert.equal((await sync(app)).summary.calendars[0].created, 3);

  // Błąd zapisu w środku serii (data spoza zakresu bazy) cofa całą transakcję: nowe wydarzenie też nie powstaje, kursor stoi.
  const tokenBeforeRollback = (await cursor(scope)).sync_token;
  calendar.put(timed('nowe-4', 'Nowe 4', '2035-03-19T10:00:00+01:00', '2035-03-19T11:00:00+01:00'));
  calendar.put(timed('dentysta', 'Dentysta', '-005000-01-01T10:00:00Z', '-005000-01-01T11:00:00Z'));
  const rollback = await sync(app);
  assert.equal(rollback.summary.calendars[0].errorCode, 'sync_apply_failed');
  assert.equal(await byGoogleId(scope, 'nowe-4'), undefined);
  assert.equal((await byGoogleId(scope, 'dentysta')).start, '2035-03-07 15:00');
  assert.equal((await cursor(scope)).sync_token, tokenBeforeRollback);
  calendar.put(timed('dentysta', 'Dentysta', '2035-03-07T15:30:00+01:00', '2035-03-07T16:15:00+01:00'));
  const fixed = await sync(app);
  assert.deepEqual([fixed.summary.calendars[0].created, fixed.summary.calendars[0].updated], [1, 1]);

  // 410: zmiana w Google „zginęła” razem z kursorem. Pełny odczyt uzgadnia tylko wydarzenia z mapowania:
  // usunięte w Google znika, edytowane w KAC zostaje (odłączone), ręczny wpis nietknięty.
  const manualBefore = await manual(scope);
  const edited = await byGoogleId(scope, 'nowe-2');
  await editLocally(app, edited.id_wydarzenia, 'Nowe 2 – zmienione', '2035-03-16T10:00', '2035-03-16T11:30');
  calendar.cancel('nowe-1');
  calendar.cancel('nowe-2');
  calendar.expiredTokens.add((await cursor(scope)).sync_token);
  const full = await sync(app);
  assert.deepEqual([full.summary.calendars[0].mode, full.summary.calendars[0].reason, full.summary.calendars[0].deleted, full.summary.calendars[0].conflicts],
    ['full', 'token_expired', 1, 1]);
  assert.equal(await byGoogleId(scope, 'nowe-1'), undefined);
  assert.equal((await byGoogleId(scope, 'nowe-2')).stan, 'odlaczone');
  assert.deepEqual((await manual(scope)).filter((row) => row.id_wydarzenia !== edited.id_wydarzenia), manualBefore);
  assert.equal((await cursor(scope)).sync_token, calendar.cursor);
}));

test('odznaczenie kalendarza (D04), ponowny wybór bez duplikatów, zmiana konta i cudzy zakres', { skip }, () => withGoogle(async ({ app, scope, google }) => {
  seedPrimary(google);
  const kolo = google.events('kolo@group.calendar.google.com');
  kolo.put(timed('kolo-1', 'Spotkanie koła', '2035-03-14T18:00:00+01:00', '2035-03-14T19:30:00+01:00'));
  kolo.put(timed('kolo-2', 'Warsztaty', '2035-03-18T16:00:00+01:00', '2035-03-18T20:00:00+01:00'));
  await selectSources(app, ['primary', 'kolo@group.calendar.google.com']);
  await sync(app);
  const edited = await byGoogleId(scope, 'kolo-2');
  await editLocally(app, edited.id_wydarzenia, 'Warsztaty – zabieram laptopa', '2035-03-18T16:00', '2035-03-18T20:00');

  // Odznaczenie: pobrane wydarzenia kalendarza znikają w tej samej transakcji; edytowane zostaje; kursor skasowany.
  await selectSources(app, ['primary']);
  assert.equal(await byGoogleId(scope, 'kolo-1'), undefined);
  assert.deepEqual([(await byGoogleId(scope, 'kolo-2')).tytul, (await byGoogleId(scope, 'kolo-2')).stan], ['Warsztaty – zabieram laptopa', 'odlaczone']);
  assert.equal(await cursor(scope, 'kolo@group.calendar.google.com'), undefined);
  assert.equal((await synced(scope)).filter((row) => row.google_id.startsWith('kurs') || row.google_id === 'dentysta' || row.google_id === 'noc').length, 4);

  // Ponowny wybór: pełny odczyt, „kolo-1” wraca, edytowane „kolo-2” zostaje jedno (konflikt), bez duplikatu.
  await selectSources(app, ['primary', 'kolo@group.calendar.google.com']);
  const reselected = await sync(app);
  assert.deepEqual([reselected.summary.calendars[1].mode, reselected.summary.calendars[1].created, reselected.summary.calendars[1].conflicts], ['full', 1, 1]);
  assert.equal((await synced(scope)).filter((row) => row.google_id === 'kolo-2').length, 1);
  assert.equal((await byGoogleId(scope, 'kolo-2')).stan, 'konflikt');

  // Zmiana konta: wydarzenia poprzedniego konta zostają nietknięte; nowe konto ma własne mapowanie (klucz zawiera konto).
  const oldAccount = (await synced(scope)).map((row) => [row.id_wydarzenia, row.updated_at.toISOString(), row.id_konta]);
  const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose: 'change_account' } })).json();
  google.grantCode('code-2', { sub: `sub2-${scope.userId}`, email: 'drugie@example.test', refreshToken: '1//r2' });
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${new URL(started.authUrl).searchParams.get('state')}&code=code-2` })).statusCode, 200);
  // Nowe konto zaczyna bez wybranych kalendarzy (historyjka 23, 3a) – użytkownik wybiera je sam.
  await selectSources(app, ['primary']);
  const second = await sync(app);
  assert.equal(second.attempt.status, 'success');
  const all = await synced(scope);
  const before = new Map(oldAccount.map(([id, updated, account]) => [id, [updated, account]]));
  for (const [id, [updated, account]] of before) {
    const row = all.find((item) => item.id_wydarzenia === id);
    assert.deepEqual([row?.updated_at.toISOString(), row?.id_konta], [updated, account]);
  }
  assert.ok(all.some((row) => row.id_konta !== oldAccount[0]![2]));

  // W01: inny użytkownik nie widzi pochodzenia cudzego wydarzenia.
  await withUser(async (other) => {
    const otherApp = buildApi(new PostgresCalendarRepository(pool!), [], { userScope: () => other,
      googleIntegration: new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null }) });
    try {
      assert.deepEqual((await otherApp.inject({ method: 'GET', url: `/api/v1/integrations/google/imported-events/${all[0]!.id_wydarzenia}` })).json(), { error: 'not_imported' });
      assert.equal((await otherApp.inject({ method: 'POST', url: `/api/v1/integrations/google/imported-events/${all[0]!.id_wydarzenia}/restore` })).statusCode, 404);
    } finally {
      await otherApp.close();
    }
  });
}));

test('makieta: pierwszy odczyt, „Zmiany w Google”, błąd strony i wygasły kursor', { skip }, () => withUser(async (scope) => {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null, sync: { sleep: async () => {} } });
  const app = buildApi(new PostgresCalendarRepository(pool!), [], { userScope: () => scope, googleIntegration: service });
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose: 'connect' } })).json();
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendars' });
    await selectSources(app, ['primary', 'kolo-naukowe', 'urodziny', 'grafik-pracy']);
    const first = await sync(app);
    assert.equal(first.attempt.status, 'success');
    const byId = Object.fromEntries(first.summary.calendars.map((item: { calendarId: string }) => [item.calendarId, item]));
    assert.ok(byId.primary.created > 10);
    assert.equal(byId.primary.skippedDeclined, 1);
    assert.deepEqual([byId.urodziny.created, byId.urodziny.skippedAllDay > 0], [0, true]);
    assert.equal(byId['grafik-pracy'].skippedOwn, 1);
    const titles = new Set((await synced(scope)).map((row) => row.tytul));
    assert.ok(titles.has('Dentysta') && titles.has('Siłownia') && titles.has('Spotkanie koła naukowego') && !titles.has('Webinar (odrzucone zaproszenie)'));

    const changed = await sync(app, { simulate: 'remote_changes' });
    const primary = changed.summary.calendars.find((item: { calendarId: string }) => item.calendarId === 'primary');
    assert.deepEqual([primary.mode, primary.created, primary.updated, primary.deleted], ['incremental', 1, 1, 1]);
    assert.ok((await synced(scope)).some((row) => row.tytul === 'Konsultacje z promotorem'));

    const pageError = await sync(app, { simulate: 'page_error' });
    assert.equal(pageError.attempt.status, 'error');
    const expired = await sync(app, { simulate: 'token_expired' });
    assert.ok(expired.summary.calendars.every((item: { mode: string; reason: string }) => item.mode === 'full' && item.reason === 'token_expired'));
    assert.equal(expired.attempt.status, 'success');
  } finally {
    await app.close();
  }
}));
