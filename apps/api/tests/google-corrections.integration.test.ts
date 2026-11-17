// Testy z prawdziwą bazą: korekta i usunięcie opublikowanej zmiany z symulowaną synchronizacją (S23KC2S1P2-47, G09 / S23KC2S1P2-292).
// Edycja i usunięcie idą przez zwykłe API kalendarza; synchronizację wykonuje worker outboxa albo „Ponów synchronizację”.
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

const skip = !config.databaseUrl;
const WEEK = '2035-03-05';
type Scope = { userId: string; calendarId: string };
type Fixture = { app: FastifyInstance; scope: Scope; scheduleId: string; events: string[] };

after(async () => { await pool?.end(); });

async function withPublishedSchedule(work: (fixture: Fixture) => Promise<void>) {
  const userId = `UGK-${Date.now()}-${randomBytes(3).toString('hex')}`;
  await pool!.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Korekta', $2, 'Europe/Warsaw')`,
    [userId, `${userId}@example.invalid`]);
  const calendar = await pool!.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Korekta test', 'Osobisty') returning id_kalendarza`, [userId]);
  const scope = { userId, calendarId: String(calendar.rows[0].id_kalendarza) };
  const service = new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool!), { oauth: null, cipher: null, sync: { sleep: async () => {} } });
  const app = buildApi(new PostgresCalendarRepository(pool!), [], { userScope: () => scope, googleIntegration: service });
  try {
    // Połączone konto demonstracyjne z kalendarzem publikacji i zaakceptowany grafik z trzema zmianami (stawka 30 zł w snapshocie).
    const started = (await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: { purpose: 'connect' } })).json();
    await app.inject({ method: 'POST', url: `/api/v1/integrations/google/attempts/${started.attemptId}/demo-consent`, payload: { allow: true, account: 'student.kac.demo@gmail.com' } });
    const selection = (await app.inject({ method: 'GET', url: '/api/v1/integrations/google/calendar-selection' })).json();
    await app.inject({ method: 'PUT', url: '/api/v1/integrations/google/calendar-selection',
      payload: { version: selection.version, sourceCalendarIds: selection.sourceCalendarIds, publicationTargetCalendarId: 'grafik-pracy' } });
    const profile = await pool!.query(`insert into t_profile_pracy (id_uzytkownika, stawka_pln) values ($1, 55) returning id_profilu`, [userId]);
    const schedule = await pool!.query(`insert into t_grafiki (id_profilu, id_kalendarza, tydzien_od, tydzien_do, status, cel_godzin, version, approved_at,
        proposed_minutes, total_minutes, target_minutes, plan_godzin, szac_placa_pln)
      values ($1, $2, $3::date, $3::date + 6, 'accepted', 15, 1, now(), 900, 900, 900, 15, 450) returning id_grafiku`, [profile.rows[0].id_profilu, scope.calendarId, WEEK]);
    const events: string[] = [];
    for (let day = 0; day < 3; day++) {
      const start = `2035-03-0${5 + day}T09:00`; const end = `2035-03-0${5 + day}T14:00`;
      const event = await pool!.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo, miejsce)
        values ($1, (select id_kategorii from t_kategorie where nazwa = 'Praca' limit 1), 'Zmiana pracy', $2::timestamp at time zone 'Europe/Warsaw',
          $3::timestamp at time zone 'Europe/Warsaw', 'Plan pracy', '') returning id_wydarzenia`, [scope.calendarId, start, end]);
      events.push(String(event.rows[0].id_wydarzenia));
      await pool!.query(`insert into t_zmiany_pracy (id_grafiku, id_wydarzenia, rozpoczecie, zakonczenie, godziny, stawka_pln, wynagrodzenie_pln, status)
        values ($1, $2, $3::timestamp at time zone 'Europe/Warsaw', $4::timestamp at time zone 'Europe/Warsaw', 5, 30, 150, 'Zatwierdzona')`,
      [schedule.rows[0].id_grafiku, event.rows[0].id_wydarzenia, start, end]);
    }
    const published = (await app.inject({ method: 'POST', url: `/api/v1/integrations/google/publications/${WEEK}`, payload: { expectedVersion: 1 } })).json();
    assert.equal(published.attempt.status, 'success');
    await work({ app, scope, scheduleId: String(schedule.rows[0].id_grafiku), events });
  } finally {
    await app.close();
    await pool!.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool!.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
}

const shiftInput = (day: number, from: string, to: string) => ({ title: 'Zmiana pracy', start: `2035-03-0${5 + day}T${from}`, end: `2035-03-0${5 + day}T${to}`,
  category: 'Work', location: '', mandatory: false, repeatWeekly: false });
const edit = (fixture: Fixture, index: number, from: string, to: string) =>
  fixture.app.inject({ method: 'PUT', url: `/api/v1/calendar/events/${fixture.events[index]}`, payload: shiftInput(index, from, to) });
const remove = (fixture: Fixture, index: number) => fixture.app.inject({ method: 'DELETE', url: `/api/v1/calendar/events/${fixture.events[index]}` });
const sync = async (fixture: Fixture, index: number) => (await fixture.app.inject({ method: 'POST', url: `/api/v1/integrations/google/publications/events/${fixture.events[index]}/sync` })).json();
const simulate = (fixture: Fixture, value: string | null) => fixture.app.inject({ method: 'PUT', url: '/api/v1/integrations/google/publications/simulation', payload: { simulate: value } });
const rows = async (fixture: Fixture) => (await pool!.query(`select ref_wydarzenia, id_wydarzenia, status, kod_bledu, wersja_wydarzenia, zewnetrzne_id, migawka, id_kal_google
  from t_publikacje where id_uzytkownika = $1 order by ref_wydarzenia`, [fixture.scope.userId])).rows;
const rowFor = async (fixture: Fixture, index: number) => (await rows(fixture)).find((row) => row.ref_wydarzenia === fixture.events[index])!;
const googleDeliveries = async (fixture: Fixture, index: number) => (await pool!.query(`select d.status, d.error_code, o.id_outbox from t_event_outbox_delivery d
  join t_event_outbox o using (id_outbox) where o.id_agregatu = $1 and d.consumer = 'google' order by o.wersja_agregatu`, [fixture.events[index]])).rows;
async function drain(fixture: Fixture, index: number, worker = new PostgresEventOutboxWorker(pool!, 5)) {
  for (const delivery of await googleDeliveries(fixture, index)) await worker.runOnce(delivery.id_outbox);
}

test('edycja: korekta grafiku ze snapshotem stawki, zlecenie w tej samej transakcji i aktualizacja przez worker', { skip }, () => withPublishedSchedule(async (fixture) => {
  const othersBefore = (await rows(fixture)).filter((row) => row.ref_wydarzenia !== fixture.events[0]);
  const saved = await edit(fixture, 0, '10:00', '16:00');
  assert.equal(saved.statusCode, 200);
  // D07: zmiana w bieżącym grafiku, kwota liczona stawką z chwili zatwierdzenia (30 zł), nie bieżącą stawką profilu (55 zł).
  const shift = (await pool!.query(`select godziny, wynagrodzenie_pln, status from t_zmiany_pracy where id_wydarzenia = $1`, [fixture.events[0]])).rows[0];
  assert.deepEqual([Number(shift.godziny), Number(shift.wynagrodzenie_pln), shift.status], [6, 180, 'Skorygowana']);
  const correction = (await pool!.query(`select k.status from t_korekty_grafiku k join t_zmiany_pracy z using (id_zmiany) where z.id_wydarzenia = $1`, [fixture.events[0]])).rows;
  assert.deepEqual(correction.map((row) => row.status), ['Zastosowana']);
  const totals = (await pool!.query(`select proposed_minutes, szac_placa_pln, plan_godzin from t_grafiki where id_grafiku = $1`, [fixture.scheduleId])).rows[0];
  assert.deepEqual([totals.proposed_minutes, Number(totals.szac_placa_pln), Number(totals.plan_godzin)], [960, 480, 16]);
  assert.equal((await rowFor(fixture, 0)).status, 'Oczekuje');
  assert.deepEqual((await googleDeliveries(fixture, 0)).map((row) => row.status), ['pending']);

  await drain(fixture, 0);
  const row = await rowFor(fixture, 0);
  assert.deepEqual([row.status, row.wersja_wydarzenia, row.zewnetrzne_id], ['Opublikowano', 2, null]);
  assert.equal(row.migawka.start, new Date('2035-03-05T09:00:00Z').toISOString());
  assert.deepEqual((await googleDeliveries(fixture, 0)).map((delivery) => delivery.status), ['delivered']);
  // Inne opublikowane zmiany nietknięte; nic nie zostało utworzone na nowo.
  assert.deepEqual((await rows(fixture)).filter((item) => item.ref_wydarzenia !== fixture.events[0]), othersBefore);
  assert.equal((await rows(fixture)).length, 3);
  const sync = (await fixture.app.inject({ method: 'GET', url: '/api/v1/integrations/google/sync' })).json();
  assert.equal(sync.history[0].operation, 'Aktualizacja opublikowanej zmiany (symulacja)');
}));

test('błąd synchronizacji nie cofa zmiany lokalnej, ponowienie; brak wydarzenia w Google bez tworzenia nowego; błąd przejściowy w workerze', { skip }, () => withPublishedSchedule(async (fixture) => {
  await simulate(fixture, 'network');
  assert.equal((await edit(fixture, 0, '11:00', '15:00')).statusCode, 200);
  let result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.errorCode, result.items[0].state, result.items[0].errorClass], ['error', 'network_error', 'error', 'network']);
  const local = (await pool!.query(`select to_char(rozpoczecie at time zone 'Europe/Warsaw', 'HH24:MI') as start from t_wydarzenia where id_wydarzenia = $1`, [fixture.events[0]])).rows[0];
  assert.equal(local.start, '11:00');
  const divergences = (await fixture.app.inject({ method: 'GET', url: '/api/v1/integrations/google/publications/divergences' })).json();
  assert.deepEqual(divergences.items.map((item: { eventId: string }) => item.eventId), [fixture.events[0]]);
  result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.items[0].state], ['success', 'synced']);
  // Ponowienie zamknęło zaległe zlecenie – worker nie zrobi niczego drugi raz.
  assert.deepEqual((await googleDeliveries(fixture, 0)).map((row) => row.status), ['delivered']);

  // 6c: wydarzenie usunięte w Google – aktualizacja zgłasza brak i nie tworzy nowego; kolejne edycje go nie odtwarzają.
  await simulate(fixture, 'missing');
  await edit(fixture, 1, '12:00', '17:00');
  result = await sync(fixture, 1);
  assert.deepEqual([result.result, result.errorCode, result.items[0].state], ['error', 'event_not_found', 'missing']);
  assert.match(result.items[0].message, /nie zostało utworzone/);
  await edit(fixture, 1, '12:00', '18:00');
  assert.equal((await sync(fixture, 1)).result, 'nothing');
  assert.equal((await rowFor(fixture, 1)).status, 'Brak w Google');
  assert.equal((await rows(fixture)).length, 3);

  // Błąd przejściowy w workerze: zlecenie wraca do kolejki z przerwą, pozycja „Błąd”; ponowienie z interfejsu kończy sprawę.
  await simulate(fixture, 'server');
  await edit(fixture, 2, '08:00', '12:00');
  await drain(fixture, 2);
  const [delivery] = await googleDeliveries(fixture, 2);
  assert.deepEqual([delivery.status, delivery.error_code], ['pending', 'google_unavailable']);
  assert.equal((await rowFor(fixture, 2)).status, 'Błąd');
  assert.equal((await sync(fixture, 2)).result, 'success');
  assert.deepEqual((await googleDeliveries(fixture, 2)).map((row) => row.status), ['delivered']);
}));

test('usunięcie: nagrobek z celem Google, ponowienie po błędzie, usunięcie brakującego wydarzenia to sukces', { skip }, () => withPublishedSchedule(async (fixture) => {
  await simulate(fixture, 'network');
  assert.equal((await remove(fixture, 0)).statusCode, 200);
  let row = await rowFor(fixture, 0);
  // FK wydarzenia wyzerowany, ale pozycja zna cel Google, migawkę i stan.
  assert.deepEqual([row.id_wydarzenia, row.status, row.migawka.title], [null, 'Do usunięcia', 'Zmiana pracy']);
  assert.ok(row.id_kal_google);
  const shift = (await pool!.query(`select z.status from t_zmiany_pracy z join t_korekty_grafiku k using (id_zmiany)
    where z.id_grafiku = $1 and k.status = 'Usunięta'`, [fixture.scheduleId])).rows;
  assert.deepEqual(shift.map((item) => item.status), ['Usunięta']);
  assert.equal(Number((await pool!.query(`select szac_placa_pln from t_grafiki where id_grafiku = $1`, [fixture.scheduleId])).rows[0].szac_placa_pln), 300);

  let result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.items[0].state, result.items[0].errorCode], ['error', 'pending_delete', 'network_error']);
  assert.equal((await fixture.app.inject({ method: 'GET', url: `/api/v1/integrations/google/publications/events/${fixture.events[0]}` })).json().items[0].state, 'pending_delete');
  result = await sync(fixture, 0);
  assert.deepEqual([result.result, result.items[0].state], ['success', 'deleted']);

  // Wydarzenia nie ma już w Google – usunięcie i tak kończy się sukcesem.
  await simulate(fixture, 'missing');
  await remove(fixture, 1);
  assert.deepEqual([(await sync(fixture, 1)).result, (await rowFor(fixture, 1)).status], ['success', 'Usunięto']);
  assert.equal((await rowFor(fixture, 2)).status, 'Opublikowano');
}));

test('edycja → edycja → usunięcie i dwa workery w dowolnej kolejności nie odtwarzają starego stanu; restart z wygasłą dzierżawą', { skip }, () => withPublishedSchedule(async (fixture) => {
  await edit(fixture, 0, '10:00', '15:00');
  await edit(fixture, 0, '10:30', '15:30');
  await remove(fixture, 0);
  const deliveries = await googleDeliveries(fixture, 0);
  assert.equal(deliveries.length, 3);
  const [left, right] = [new PostgresEventOutboxWorker(pool!, 5), new PostgresEventOutboxWorker(pool!, 5)];
  // Najpierw usunięcie, potem obie edycje – równolegle, w odwrotnej kolejności.
  await left.runOnce(deliveries[2].id_outbox);
  await Promise.all([left.runOnce(deliveries[1].id_outbox), right.runOnce(deliveries[0].id_outbox)]);
  const row = await rowFor(fixture, 0);
  assert.deepEqual([row.status, row.id_wydarzenia], ['Usunięto', null]);
  assert.deepEqual((await googleDeliveries(fixture, 0)).map((delivery) => delivery.status), ['delivered', 'delivered', 'delivered']);
  assert.deepEqual((await rows(fixture)).filter((item) => item.ref_wydarzenia !== fixture.events[0]).map((item) => item.status), ['Opublikowano', 'Opublikowano']);

  // Restart: zlecenie przejęte przez worker, który padł (dzierżawa minęła), przejmuje inny worker.
  await edit(fixture, 1, '07:00', '12:00');
  const [stuck] = await googleDeliveries(fixture, 1);
  await pool!.query(`update t_event_outbox_delivery set status = 'processing', worker_id = 'worker-dead', lease_until = now() - interval '1 minute', attempts = 1
    where id_outbox = $1 and consumer = 'google'`, [stuck.id_outbox]);
  await new PostgresEventOutboxWorker(pool!, 5).runOnce(stuck.id_outbox);
  assert.deepEqual([(await rowFor(fixture, 1)).status, (await rowFor(fixture, 1)).wersja_wydarzenia], ['Opublikowano', 2]);
}));
