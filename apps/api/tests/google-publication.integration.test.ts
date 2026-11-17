// Testy z prawdziwą bazą: symulowana publikacja zaakceptowanego grafiku (S23KC2S1P2-30, G07 / S23KC2S1P2-291).
// Atrapa zegara zamiast czekania na ponowienia. Każdy scenariusz sprawdza, że grafik i wydarzenia lokalne są nietknięte.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/database.js';
import { PostgresGoogleIntegrationRepository } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService } from '../src/integrations/google/service.js';
import { TokenCipher } from '../src/integrations/google/token-cipher.js';
import { FakeGoogle, OAUTH } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
const WEEK = '2035-03-05';
type Scope = { userId: string; calendarId: string };

after(async () => { await pool?.end(); });

async function withUser(work: (scope: Scope) => Promise<void>) {
  const userId = `UGP-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Publikacja', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Publikacja test', 'Osobisty') returning id_kalendarza`, [userId]);
  try {
    await work({ userId, calendarId: String(calendar.rows[0].id_kalendarza) });
  } finally {
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

/** Grafik tygodnia: status i liczba zmian (każda z wydarzeniem „Plan pracy”, jak po zatwierdzeniu). */
async function schedule(scope: Scope, input: { accepted: boolean; shifts: number; version?: number }) {
  const existing = await pool!.query(`select id_profilu from t_profile_pracy where id_uzytkownika = $1 limit 1`, [scope.userId]);
  const profile = existing.rows[0] ? existing : await pool!.query(`insert into t_profile_pracy (id_uzytkownika) values ($1) returning id_profilu`, [scope.userId]);
  const row = await pool!.query(`insert into t_grafiki (id_profilu, id_kalendarza, tydzien_od, tydzien_do, status, cel_godzin, version, approved_at)
    values ($1, $2, $3::date, $3::date + 6, $4, 20, $5, $6) returning id_grafiku`,
  [profile.rows[0].id_profilu, scope.calendarId, WEEK, input.accepted ? 'accepted' : 'proposed', input.version ?? 1, input.accepted ? new Date() : null]);
  for (let day = 0; day < input.shifts; day++) {
    const start = new Date(Date.UTC(2035, 2, 5 + day, 8)); const end = new Date(Date.UTC(2035, 2, 5 + day, 13));
    const event = input.accepted ? await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo)
      values ($1, 'CAT03', 'Zmiana pracy', $2, $3, 'Plan pracy') returning id_wydarzenia`, [scope.calendarId, start, end]) : null;
    await pool!.query(`insert into t_zmiany_pracy (id_grafiku, id_wydarzenia, rozpoczecie, zakonczenie, godziny, stawka_pln, wynagrodzenie_pln, status)
      values ($1, $2, $3, $4, 5, 30, 150, $5)`, [row.rows[0].id_grafiku, event?.rows[0].id_wydarzenia ?? null, start, end, input.accepted ? 'Zatwierdzona' : 'Propozycja']);
  }
  return String(row.rows[0].id_grafiku);
}

const snapshot = async (scope: Scope) => ({
  events: (await pool!.query(`select id_wydarzenia, tytul, rozpoczecie, zakonczenie, status, event_version, updated_at from t_wydarzenia where id_kalendarza = $1 order by id_wydarzenia`, [scope.calendarId])).rows,
  schedules: (await pool!.query(`select id_grafiku, status, version, approved_at, updated_at from t_grafiki where id_kalendarza = $1 order by id_grafiku`, [scope.calendarId])).rows,
});
const publications = async (scheduleId: string) => (await pool!.query(`select id_zmiany, id_wydarzenia, wersja_wydarzenia, tryb, zewnetrzne_id, status, operacja, id_uzytkownika
  from t_publikacje where id_grafiku = $1 order by id_zmiany`, [scheduleId])).rows;

function api(scope: Scope, delays: number[] = []) {
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null,
    sync: { sleep: async (ms) => { delays.push(ms); }, maxTries: 3, baseDelayMs: 500 } });
  return buildApi(null, [], { userScope: () => scope, googleIntegration: service });
}
const connectDemo = async (app: FastifyInstance) => {
  const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose: 'connect' } })).json();
  await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
};
const setTarget = async (app: FastifyInstance, target: string) => {
  const current = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' })).json();
  const saved = await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection',
    payload: { version: current.version, sourceCalendarIds: current.sourceCalendarIds, publicationTargetCalendarId: target } });
  assert.equal(saved.statusCode, 200);
};
const preview = (app: FastifyInstance, query = '') => app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/${WEEK}/preview${query}` });
const publish = (app: FastifyInstance, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/v1/integrations/google/publications/${WEEK}`, payload });

test('warunki wejścia: brak konta, brak grafiku, propozycja, pusty grafik, brak celu i cel bez prawa zapisu', { skip }, () => withUser(async (scope) => {
  const app = api(scope);
  try {
    assert.deepEqual((await preview(app)).json(), { error: 'not_connected' });
    await connectDemo(app);
    assert.deepEqual([(await preview(app)).statusCode, (await preview(app)).json()], [404, { error: 'schedule_not_found' }]);
    await schedule(scope, { accepted: false, shifts: 2 });
    assert.deepEqual((await preview(app)).json(), { error: 'schedule_not_accepted' });
    await schedule(scope, { accepted: true, shifts: 0, version: 2 });
    assert.deepEqual((await preview(app)).json(), { error: 'schedule_empty' });
    await schedule(scope, { accepted: true, shifts: 1, version: 3 });
    assert.deepEqual([(await preview(app)).statusCode, (await preview(app)).json()], [409, { error: 'no_publication_target' }]);
    assert.deepEqual([(await preview(app, '?calendarId=kolo-naukowe')).statusCode, (await preview(app, '?calendarId=kolo-naukowe')).json()], [422, { error: 'target_not_writable' }]);
    assert.deepEqual([(await preview(app, '?calendarId=cudzy')).statusCode, (await preview(app, '?calendarId=cudzy')).json()], [400, { error: 'unknown_calendar' }]);
    const ok = (await preview(app, '?calendarId=grafik-pracy')).json();
    assert.deepEqual([ok.simulated, ok.target.id, ok.summary], [true, 'grafik-pracy', { create: 1, update: 0, unchanged: 0 }]);
    assert.deepEqual(ok.targets.map((target: { id: string }) => target.id).sort(), ['grafik-pracy', 'primary']);
  } finally {
    await app.close();
  }
}));

test('podgląd niczego nie zmienia; błąd nie jest sukcesem; wynik częściowy i ponowienie bez duplikatów; aktualizacja po zmianie wydarzenia', { skip }, () => withUser(async (scope) => {
  const delays: number[] = [];
  const app = api(scope, delays);
  try {
    await connectDemo(app);
    const scheduleId = await schedule(scope, { accepted: true, shifts: 3 });
    await setTarget(app, 'grafik-pracy');
    const before = await snapshot(scope);

    const first = (await preview(app)).json();
    assert.deepEqual([first.scheduleVersion, first.summary, first.items.length], [1, { create: 3, update: 0, unchanged: 0 }, 3]);
    assert.deepEqual(await publications(scheduleId), []);

    // Podgląd był dla innej wersji grafiku – nic nie publikujemy.
    assert.deepEqual([(await publish(app, { expectedVersion: 7 })).statusCode, (await publish(app, { expectedVersion: 7 })).json()], [409, { error: 'schedule_version_conflict' }]);

    // Brak sieci przy każdej próbie: ograniczone ponowienia, wynik „błąd”, żadnej pozycji i ostatni sukces publikacji pusty.
    const failed = (await publish(app, { expectedVersion: 1, simulate: 'network' })).json();
    assert.deepEqual([failed.simulated, failed.attempt.status, failed.attempt.direction, failed.attempt.tries, failed.attempt.errorClass],
      [true, 'error', 'publish', 3, 'network']);
    assert.deepEqual(failed.items.map((item: { result: string }) => item.result), ['failed', 'skipped', 'skipped']);
    assert.deepEqual(delays, [500, 1000]);
    assert.deepEqual(await publications(scheduleId), []);
    let sync = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json();
    assert.deepEqual([sync.lastSuccess.publish, sync.state, sync.history[0].direction], [null, 'never', 'publish']);

    // Brak prawa zapisu i wygasłe logowanie w symulacji: błąd bez sukcesu, konto bez zmian.
    const denied = (await publish(app, { expectedVersion: 1, simulate: 'permissions' })).json();
    assert.deepEqual([denied.attempt.status, denied.attempt.errorCode, denied.attempt.errorClass], ['error', 'calendar_not_writable', 'permissions']);
    const auth = (await publish(app, { expectedVersion: 1, simulate: 'auth' })).json();
    assert.deepEqual([auth.attempt.status, auth.attempt.errorClass], ['error', 'reconnect']);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/integrations/google' })).json().status, 'connected');

    // Wynik częściowy: 2 z 3. Ponowienie publikuje tylko brakującą pozycję – bez duplikatów.
    const partial = (await publish(app, { expectedVersion: 1, simulate: 'partial' })).json();
    assert.deepEqual([partial.attempt.status, partial.attempt.changes], ['partial', 2]);
    assert.deepEqual(partial.items.map((item: { result: string }) => item.result), ['published', 'published', 'failed']);
    assert.deepEqual(partial.preview.summary, { create: 1, update: 0, unchanged: 2 });
    const retry = (await publish(app, { expectedVersion: 1 })).json();
    assert.deepEqual([retry.attempt.status, retry.attempt.changes], ['success', 1]);
    assert.deepEqual(retry.items.map((item: { result: string }) => item.result), ['unchanged', 'unchanged', 'published']);
    assert.match(retry.attempt.message, /Symulacja/);
    let rows = await publications(scheduleId);
    assert.equal(rows.length, 3);
    // Demo nie udaje identyfikatorów Google; powiązanie ma właściciela, lokalne ID i wersję.
    assert.ok(rows.every((row) => row.tryb === 'symulacja' && row.zewnetrzne_id === null && row.status === 'Opublikowano'
      && row.id_uzytkownika === scope.userId && row.id_wydarzenia && row.wersja_wydarzenia === 1));
    sync = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json();
    assert.ok(sync.lastSuccess.publish);
    assert.equal(sync.state, 'never');

    // Ponowna publikacja bez zmian niczego nie dubluje.
    const again = (await publish(app, { expectedVersion: 1 })).json();
    assert.deepEqual([again.attempt.status, again.attempt.changes, again.preview.summary], ['success', 0, { create: 0, update: 0, unchanged: 3 }]);
    assert.deepEqual(await snapshot(scope), before);

    // Wydarzenie zmieniło się po publikacji (nowa wersja) – pozycja do aktualizacji, nadal jeden wiersz na zmianę.
    await pool!.query(`update t_wydarzenia set event_version = event_version + 1 where id_wydarzenia = $1`, [rows[0].id_wydarzenia]);
    const changed = (await preview(app)).json();
    assert.deepEqual(changed.summary, { create: 0, update: 1, unchanged: 2 });
    assert.equal((await publish(app, { expectedVersion: 1 })).json().attempt.changes, 1);
    rows = await publications(scheduleId);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.filter((row) => row.operacja === 'Aktualizacja').map((row) => row.wersja_wydarzenia), [2]);
  } finally {
    await app.close();
  }
}));

test('cudzy grafik i cudze konto są niewidoczne', { skip }, () => withUser(async (owner) => withUser(async (other) => {
  const ownerApp = api(owner);
  const otherApp = api(other);
  try {
    await connectDemo(ownerApp);
    await schedule(owner, { accepted: true, shifts: 2 });
    await setTarget(ownerApp, 'grafik-pracy');
    assert.equal((await preview(ownerApp)).statusCode, 200);
    assert.deepEqual((await preview(otherApp)).json(), { error: 'not_connected' });
    await connectDemo(otherApp);
    assert.deepEqual((await preview(otherApp, '?calendarId=grafik-pracy')).json(), { error: 'schedule_not_found' });
  } finally {
    await ownerApp.close(); await otherApp.close();
  }
})));

test('widok kalendarza Google po publikacji (historyjka 30, krok 10): opublikowane zmiany razem z pozostałymi wydarzeniami tygodnia', { skip }, () => withUser(async (scope) => {
  const google = new FakeGoogle();
  google.calendarPages = [[
    { id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
    { id: 'praca@group.calendar.google.com', summary: 'Grafik pracy', accessRole: 'writer', timeZone: 'Europe/Warsaw' },
  ]];
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
    // Symulacja przy koncie Google (GOOGLE_PUBLICATION_MODE=simulation); prawdziwy zapis: google-publication-real.integration.test.ts.
    oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, sync: { sleep: async () => {} }, publication: 'simulation',
  });
  const app = buildApi(null, [], { userScope: () => scope, googleIntegration: service });
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).json();
    google.grantCode('code-1', { sub: `sub-${scope.userId}`, email: 'student@example.test', refreshToken: '1//r1' });
    await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${new URL(started.authUrl).searchParams.get('state')}&code=code-1` });
    await setTarget(app, 'praca@group.calendar.google.com');
    await schedule(scope, { accepted: true, shifts: 2 });
    const calendar = google.events('praca@group.calendar.google.com');
    calendar.put({ id: 'zespol', summary: 'Spotkanie zespołu', start: { dateTime: '2035-03-05T09:00:00+01:00' }, end: { dateTime: '2035-03-05T09:30:00+01:00' } });
    calendar.put({ id: 'pozniej', summary: 'Za dwa tygodnie', start: { dateTime: '2035-03-20T09:00:00+01:00' }, end: { dateTime: '2035-03-20T10:00:00+01:00' } });
    calendar.put({ id: 'kac', summary: 'Zmiana pracy', start: { dateTime: '2035-03-06T09:00:00+01:00' }, end: { dateTime: '2035-03-06T14:00:00+01:00' },
      extendedProperties: { private: { kacEventId: 'e-1' } } });
    assert.equal((await publish(app, { expectedVersion: 1 })).json().attempt.status, 'success');

    const view = (await app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/${WEEK}/calendar-view` })).json();
    assert.deepEqual([view.simulated, view.calendar.id, view.othersError], [true, 'praca@group.calendar.google.com', null]);
    assert.deepEqual(view.events.map((event: { title: string; published: boolean }) => [event.title, event.published]),
      [['Spotkanie zespołu', false], ['Zmiana pracy', true], ['Zmiana pracy', true]]);
    // Tydzień liczony w strefie użytkownika; własne wydarzenie KAC z Google nie dubluje opublikowanej zmiany.
    const request = calendar.requests.at(-1)!;
    assert.deepEqual([request.get('timeMin'), request.get('timeMax')], ['2035-03-04T23:00:00.000Z', '2035-03-11T23:00:00.000Z']);

    // Bez dostępu do Google widok pokazuje same opublikowane zmiany i mówi dlaczego.
    calendar.pageFailures = [{ page: 0, reply: 'network' }];
    const offline = (await app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/${WEEK}/calendar-view` })).json();
    assert.deepEqual([offline.othersError, offline.events.length], ['network_error', 2]);
  } finally {
    await app.close();
  }
}));
