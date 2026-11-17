// Testy z prawdziwą bazą i udawanym Google: prawdziwa publikacja grafiku (G07) i korekty opublikowanych zmian (G09)
// dla konta połączonego przez Google. Sprawdzają zapis w Google, brak duplikatów przy ponowieniu, korekty, odświeżenie tokenu,
// worker outboxa i to, że synchronizacja (G05) nie pobiera z powrotem własnych wydarzeń KAC.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { after } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { PostgresEventOutboxWorker } from '../src/events/outbox-worker.js';
import { PostgresGoogleIntegrationRepository } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService } from '../src/integrations/google/service.js';
import { TokenCipher } from '../src/integrations/google/token-cipher.js';
import { FakeGoogle, OAUTH } from './google-integration-fakes.js';

const skip = !config.databaseUrl;
const WEEK = '2035-03-05';
const WORK = 'praca@group.calendar.google.com';
type Scope = { userId: string; calendarId: string };
type Fixture = { app: FastifyInstance; scope: Scope; google: FakeGoogle; service: GoogleIntegrationService; scheduleId: string; events: string[] };

after(async () => { await pool?.end(); });

async function withRealAccount(work: (fixture: Fixture) => Promise<void>, options: { publication?: 'google' | 'simulation' } = {}) {
  const userId = `UGR-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Publikacja', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Publikacja Google test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  const google = new FakeGoogle();
  google.calendarPages = [[
    { id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
    { id: WORK, summary: 'Grafik pracy', accessRole: 'writer', timeZone: 'Europe/Warsaw' },
  ]];
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), {
    oauth: OAUTH, cipher: new TokenCipher(randomBytes(32)), fetch: google.fetch, publication: options.publication,
    sync: { sleep: async () => {}, now: () => new Date('2035-03-01T00:00:00Z') },
  });
  const app = buildApi(new PostgresCalendarRepository(pool!), [], { userScope: () => scope, googleIntegration: service });
  try {
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).json();
    google.grantCode('code-1', { sub: `sub-${userId}`, email: 'student@example.test', refreshToken: '1//r1' });
    await app.inject({ method: 'GET', url: `/api/v1/integrations/google/callback?state=${new URL(started.authUrl).searchParams.get('state')}&code=code-1` });
    const selection = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' })).json();
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection',
      payload: { version: selection.version, sourceCalendarIds: [WORK], publicationTargetCalendarId: WORK } });
    assert.equal(saved.statusCode, 200);
    const profile = await pool!.query(`insert into t_profile_pracy (id_uzytkownika, stawka_pln) values ($1, 30) returning id_profilu`, [userId]);
    const schedule = await pool!.query(`insert into t_grafiki (id_profilu, id_kalendarza, tydzien_od, tydzien_do, status, cel_godzin, version, approved_at)
      values ($1, $2, $3::date, $3::date + 6, 'accepted', 10, 1, now()) returning id_grafiku`, [profile.rows[0].id_profilu, scope.calendarId, WEEK]);
    const events: string[] = [];
    for (let day = 0; day < 2; day++) {
      const start = `2035-03-0${5 + day}T09:00`; const end = `2035-03-0${5 + day}T14:00`;
      const event = await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo, miejsce)
        values ($1, (select id_kategorii from t_kategorie where nazwa = 'Praca' limit 1), 'Zmiana pracy', $2::timestamp at time zone 'Europe/Warsaw',
          $3::timestamp at time zone 'Europe/Warsaw', 'Plan pracy', '') returning id_wydarzenia`, [scope.calendarId, start, end]);
      events.push(String(event.rows[0].id_wydarzenia));
      await pool!.query(`insert into t_zmiany_pracy (id_grafiku, id_wydarzenia, rozpoczecie, zakonczenie, godziny, stawka_pln, wynagrodzenie_pln, status)
        values ($1, $2, $3::timestamp at time zone 'Europe/Warsaw', $4::timestamp at time zone 'Europe/Warsaw', 5, 30, 150, 'Zatwierdzona')`,
      [schedule.rows[0].id_grafiku, event.rows[0].id_wydarzenia, start, end]);
    }
    await work({ app, scope, google, service, scheduleId: String(schedule.rows[0].id_grafiku), events });
  } finally {
    await app.close();
    await pool!.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

const preview = async (fixture: Fixture) => (await fixture.app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/${WEEK}/preview` })).json();
const publish = async (fixture: Fixture) => (await fixture.app.inject({ method: 'POST', url: `/api/v1/integrations/google/publications/${WEEK}`, payload: { expectedVersion: 1 } })).json();
const rows = async (fixture: Fixture) => (await pool!.query(`select ref_wydarzenia, status, tryb, zewnetrzne_id, kod_bledu from t_publikacje
  where id_uzytkownika = $1 order by ref_wydarzenia`, [fixture.scope.userId])).rows;
const rowFor = async (fixture: Fixture, index: number) => (await rows(fixture)).find((row) => row.ref_wydarzenia === fixture.events[index])!;
const edit = (fixture: Fixture, index: number, from: string, to: string) => fixture.app.inject({ method: 'PUT', url: `/api/v1/calendar/events/${fixture.events[index]}`,
  payload: { title: 'Zmiana pracy', start: `2035-03-0${5 + index}T${from}`, end: `2035-03-0${5 + index}T${to}`, category: 'Work', location: '', mandatory: false, repeatWeekly: false } });
const sync = async (fixture: Fixture, index: number) => (await fixture.app.inject({ method: 'POST', url: `/api/v1/integrations/google/publications/events/${fixture.events[index]}/sync` })).json();
const work = (fixture: Fixture) => fixture.google.events(WORK);

test('publikacja: wydarzenia powstają w Google z kacEventId, pozycje mają tryb google i zewnętrzne ID, ponowna publikacja niczego nie dubluje', { skip }, () => withRealAccount(async (fixture) => {
  work(fixture).put({ id: 'zespol', summary: 'Spotkanie zespołu', start: { dateTime: '2035-03-05T07:00:00Z' }, end: { dateTime: '2035-03-05T07:30:00Z' } });
  const before = await preview(fixture);
  assert.deepEqual([before.simulated, before.summary.create], [false, 2]);
  const result = await publish(fixture);
  assert.deepEqual([result.simulated, result.attempt.status], [false, 'success']);
  assert.doesNotMatch(result.attempt.message, /Symulacja/);
  const published = work(fixture).active().filter((item) => item.extendedProperties?.private?.kacEventId);
  assert.deepEqual(published.map((item) => item.extendedProperties.private.kacEventId).sort(), [...fixture.events].sort());
  assert.ok(published.every((item) => /^kac[0-9a-v]+$/.test(item.id) && item.summary === 'Zmiana pracy'));
  assert.deepEqual((await rows(fixture)).map((row) => [row.status, row.tryb]), [['Opublikowano', 'google'], ['Opublikowano', 'google']]);
  assert.deepEqual((await rows(fixture)).map((row) => row.zewnetrzne_id).sort(), published.map((item) => item.id).sort());

  const again = await preview(fixture);
  assert.deepEqual(again.summary, { create: 0, update: 0, unchanged: 2 });
  const writes = work(fixture).writes.length;
  assert.equal((await publish(fixture)).attempt.status, 'success');
  assert.equal(work(fixture).writes.length, writes);

  // Widok kalendarza czyta wszystko z Google: zmiany KAC rozpoznane po kacEventId, bez duplikatów z pozycji publikacji.
  const view = (await fixture.app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/${WEEK}/calendar-view` })).json();
  assert.equal(view.simulated, false);
  assert.deepEqual(view.events.map((event: { title: string; published: boolean }) => [event.title, event.published]),
    [['Spotkanie zespołu', false], ['Zmiana pracy', true], ['Zmiana pracy', true]]);

  // G05: kalendarz publikacji jest też źródłem – synchronizacja pobiera „Spotkanie zespołu”, ale nie własne zmiany KAC.
  const read = (await fixture.app.inject({ method: 'POST', url: '/api/v1/integrations/google/sync', payload: {} })).json();
  assert.equal(read.attempt.status, 'success');
  const imported = (await pool!.query(`select tytul from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Google (synchronizacja)' and status = 'Aktywne'`,
    [fixture.scope.calendarId])).rows.map((row) => row.tytul);
  assert.deepEqual(imported, ['Spotkanie zespołu']);
}));

test('ponowienie po utraconej odpowiedzi nie tworzy duplikatu; zmiana po publikacji jest aktualizacją tego samego wydarzenia', { skip }, () => withRealAccount(async (fixture) => {
  // Pierwszy zapis dochodzi do Google, ale odpowiedź ginie – ponowienie dostaje 409 i aktualizuje istniejące wydarzenie.
  work(fixture).writeFailures = ['lost-response'];
  const result = await publish(fixture);
  assert.equal(result.attempt.status, 'success');
  assert.equal(work(fixture).active().length, 2);
  assert.deepEqual(work(fixture).writes.slice(0, 3).map((write) => write.method), ['POST', 'POST', 'PATCH']);

  // Zmiana godzin poza korektą (np. nowa wersja wydarzenia): publikacja wykrywa „update” i poprawia to samo wydarzenie.
  await pool!.query(`update t_wydarzenia set rozpoczecie = rozpoczecie + interval '1 hour', event_version = event_version + 1 where id_wydarzenia = $1`, [fixture.events[0]]);
  assert.equal((await preview(fixture)).summary.update, 1);
  const externalId = (await rowFor(fixture, 0)).zewnetrzne_id;
  assert.equal((await publish(fixture)).attempt.status, 'success');
  assert.equal(work(fixture).get(externalId)!.start.dateTime, new Date('2035-03-05T09:00:00Z').toISOString());
  assert.equal(work(fixture).active().length, 2);
}));

test('korekty: edycja i usunięcie w Google, wydarzenie usunięte ręcznie w Google bez tworzenia nowego, ponowna publikacja je przywraca', { skip }, () => withRealAccount(async (fixture) => {
  assert.equal((await publish(fixture)).attempt.status, 'success');
  const [first, second] = [(await rowFor(fixture, 0)).zewnetrzne_id, (await rowFor(fixture, 1)).zewnetrzne_id];

  assert.equal((await edit(fixture, 0, '10:00', '15:00')).statusCode, 200);
  let result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.items[0].state, result.items[0].simulated], ['success', 'synced', false]);
  assert.equal(work(fixture).get(first)!.start.dateTime, new Date('2035-03-05T09:00:00Z').toISOString());
  assert.equal(work(fixture).get(first)!.extendedProperties.private.kacEventId, fixture.events[0]);

  assert.equal((await fixture.app.inject({ method: 'DELETE', url: `/api/v1/calendar/events/${fixture.events[1]}` })).statusCode, 200);
  result = await sync(fixture, 1);
  assert.deepEqual([result.result, result.items[0].state], ['success', 'deleted']);
  assert.equal(work(fixture).get(second)!.status, 'cancelled');

  // Użytkownik usunął wydarzenie w Google: korekta zgłasza brak i nie tworzy nowego.
  work(fixture).cancel(first);
  assert.equal((await edit(fixture, 0, '11:00', '15:00')).statusCode, 200);
  result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.errorCode, result.items[0].state], ['error', 'event_not_found', 'missing']);
  assert.equal(work(fixture).active().length, 0);

  // Świadoma ponowna publikacja przywraca to samo wydarzenie z aktualnymi godzinami.
  const again = await preview(fixture);
  assert.deepEqual(again.items.map((item: { action: string }) => item.action), ['create']);
  assert.equal((await publish(fixture)).attempt.status, 'success');
  assert.deepEqual([work(fixture).get(first)!.status, work(fixture).get(first)!.start.dateTime], ['confirmed', new Date('2035-03-05T10:00:00Z').toISOString()]);
  assert.equal(work(fixture).active().length, 1);
}));

test('worker outboxa wykonuje korektę w Google; błąd przejściowy czeka na ponowienie; wygasły token jest odświeżany', { skip }, () => withRealAccount(async (fixture) => {
  assert.equal((await publish(fixture)).attempt.status, 'success');
  const externalId = (await rowFor(fixture, 0)).zewnetrzne_id;
  const worker = new PostgresEventOutboxWorker(pool!, 5, undefined, fixture.service.correctionEngine);
  const deliveries = async () => (await pool!.query(`select d.status, d.error_code, o.id_outbox from t_event_outbox_delivery d join t_event_outbox o using (id_outbox)
    where o.id_agregatu = $1 and d.consumer = 'google' order by o.wersja_agregatu`, [fixture.events[0]])).rows;

  work(fixture).writeFailures = [503];
  assert.equal((await edit(fixture, 0, '10:00', '14:00')).statusCode, 200);
  for (const delivery of await deliveries()) await worker.runOnce(delivery.id_outbox);
  assert.deepEqual((await deliveries()).map((row) => [row.status, row.error_code]), [['pending', 'google_unavailable']]);
  assert.equal((await rowFor(fixture, 0)).status, 'Błąd');

  // Google odrzuca dotychczasowy token: jedno odświeżenie i korekta przechodzi.
  for (const token of fixture.google.calendarTokens) fixture.google.rejectedAccessTokens.add(token);
  const refreshes = fixture.google.refreshCount();
  await pool!.query(`update t_event_outbox_delivery d set available_at = now() from t_event_outbox o
    where o.id_outbox = d.id_outbox and o.id_agregatu = $1 and d.consumer = 'google'`, [fixture.events[0]]);
  for (const delivery of await deliveries()) await worker.runOnce(delivery.id_outbox);
  assert.deepEqual((await deliveries()).map((row) => row.status), ['delivered']);
  assert.equal(fixture.google.refreshCount(), refreshes + 1);
  assert.equal((await rowFor(fixture, 0)).status, 'Opublikowano');
  assert.equal(work(fixture).get(externalId)!.start.dateTime, new Date('2035-03-05T09:00:00Z').toISOString());
}));

test('GOOGLE_PUBLICATION_MODE=simulation: konto Google, ale nic nie trafia do Google i wynik jest oznaczony jako symulacja', { skip }, () => withRealAccount(async (fixture) => {
  assert.equal((await preview(fixture)).simulated, true);
  const result = await publish(fixture);
  assert.deepEqual([result.simulated, result.attempt.status], [true, 'success']);
  assert.equal(work(fixture).writes.length, 0);
  assert.deepEqual((await rows(fixture)).map((row) => [row.tryb, row.zewnetrzne_id]), [['symulacja', null], ['symulacja', null]]);
}, { publication: 'simulation' }));
