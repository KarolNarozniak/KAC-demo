// Zajęcia przy planowaniu grafiku (S23KC2S1P2-40) na prawdziwej bazie: seria zajęć z kalendarza, generowanie i ręczna edycja.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/database.js';
import { PostgresScheduleRepository } from '../src/scheduling/repository.js';

test('grafik omija serię zajęć obowiązkowych, pokazuje ją w blockingEvents i odrzuca kolidującą zmianę', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const suffix = Date.now();
  const userId = `class-test-user-${suffix}`, calendarId = `class-test-calendar-${suffix}`, profileId = `class-test-profile-${suffix}`;
  const repository = new PostgresScheduleRepository(pool);
  await pool.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Zajęcia', $2, 'Europe/Warsaw')`, [userId, `${userId}@example.test`]);
  await pool.query(`insert into t_kalendarze (id_kalendarza, id_uzytkownika, nazwa, typ) values ($1, $2, 'Zajęcia test', 'Osobisty')`, [calendarId, userId]);
  await pool.query(`insert into t_profile_pracy (id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien, cel_godzin_tydzien, max_godzin_tydzien,
      rodzaj_stawki, czas_dojazdu_min, min_odpoczynku_min, aktywny, tryb_pracy, min_slot_min, max_slot_min)
    values ($1, $2, 30, 0, 4, 10, 'gross', 15, 0, true, 'elastyczny', 120, 360)`, [profileId, userId]);
  await pool.query(`insert into t_dostepnosc (id_profilu, dzien_tygodnia, od_godzina, do_godzina, rodzaj) values ($1, 2, '08:00', '16:00', 'Dostępny')`, [profileId]);
  // Cotygodniowy wykład obowiązkowy założony we wrześniu (czas letni), wtorek 10:00–11:30.
  await pool.query(`insert into t_serie (id_serii, id_kalendarza, czestotliwosc, data_poczatku, bezterminowo) values ($1, $2, 'Tydzien', '2026-09-29', true)`, [`${calendarId}-series`, calendarId]);
  await pool.query(`insert into t_wydarzenia (id_wydarzenia, id_kalendarza, id_kategorii, id_serii, tytul, rozpoczecie, zakonczenie, obowiazkowe, powtarzaj_co_tydzien, zrodlo, status)
    values ($1, $2, 'CAT01', $3, 'Analiza', '2026-09-29T10:00:00+02', '2026-09-29T11:30:00+02', true, true, 'Ręcznie', 'Aktywne')`, [`${calendarId}-class`, calendarId, `${calendarId}-series`]);
  const app = buildApi(null, [], { scheduleRepository: {
    getPlanningContext: () => repository.getPlanningContext(userId, calendarId, profileId),
    getLatestSchedule: (weekStart) => repository.getLatestSchedule(weekStart, calendarId),
    getScheduleById: (id)=>repository.getScheduleById(id,calendarId),
    listSchedules: (filters) => repository.listSchedules(filters, calendarId),
    getApprovedShiftEventIds: (weekStart) => repository.getApprovedShiftEventIds(weekStart, calendarId),
    saveSchedule: repository.saveSchedule.bind(repository),
    approveSchedule: (weekStart, expectedVersion) => repository.approveSchedule(weekStart, expectedVersion, calendarId),
    rejectSchedule: (weekStart, expectedVersion) => repository.rejectSchedule(weekStart, expectedVersion, calendarId),
  } });
  try {
    const context = await repository.getPlanningContext(userId, calendarId, profileId);
    const generated = await app.inject({ method: 'POST', url: '/api/v1/schedules/generate', payload: { weekStart: '2026-11-02', profileVersion: context!.profile.profileVersion } });
    assert.equal(generated.statusCode, 201, generated.body);
    const schedule = generated.json();
    // Seria rozwinięta na wybrany tydzień, z lokalną godziną 10:00 także po zmianie czasu.
    assert.deepEqual(schedule.blockingEvents.map((event: { title: string; startLocal: string; effect: string }) => [event.title, event.startLocal, event.effect]), [['Analiza', '2026-11-03T10:00', 'hard']]);
    // Praca tylko po zajęciach i dojeździe: od 11:45 (10:45 UTC).
    assert.ok(schedule.shifts.length > 0);
    for (const shift of schedule.shifts) assert.ok(shift.startLocal >= '2026-11-03T11:45', shift.startLocal);
    assert.deepEqual(schedule.freeWindows.map((window: { startLocal: string; endLocal: string }) => [window.startLocal, window.endLocal]), [['2026-11-03T11:45', '2026-11-03T16:00']]);

    // Ręczne przesunięcie zmiany na godziny zajęć: 422 z class_collision i wskazaniem zajęć.
    const rejected = await app.inject({ method: 'PUT', url: '/api/v1/schedules/2026-11-02', payload: { expectedVersion: schedule.version,
      shifts: [{ id: 'manual', startLocal: '2026-11-03T08:00', endLocal: '2026-11-03T10:00' }] } });
    assert.equal(rejected.statusCode, 422);
    const error = rejected.json().errors.find((item:{code:string})=>item.code==='class_collision');
    assert.ok(error);
    assert.equal(error.code, 'class_collision');
    assert.equal(error.details.title, 'Analiza');
    assert.deepEqual([error.details.overlapStartLocal, error.details.overlapEndLocal], ['2026-11-03T09:45', '2026-11-03T10:00']);

    // Pobranie grafiku zwraca aktualne zajęcia tygodnia.
    const latest = await app.inject({ method: 'GET', url: '/api/v1/schedules/2026-11-02' });
    assert.equal(latest.json().blockingEvents.length, 1);
  } finally {
    await app.close();
    await pool.query('delete from t_grafiki where id_kalendarza = $1', [calendarId]);
    await pool.query('delete from t_wydarzenia where id_kalendarza = $1', [calendarId]);
    await pool.query('delete from t_profile_pracy where id_profilu = $1', [profileId]);
    await pool.query('delete from t_kalendarze where id_kalendarza = $1', [calendarId]);
    await pool.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
    await pool.end();
  }
});
