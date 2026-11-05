import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { PostgresScheduleRepository } from '../src/scheduling/repository.js';

test('PostgreSQL schedule persistence, retrieval, edits and version conflicts', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const calendarId = `schedule-test-calendar-${Date.now()}`;
  const profileId = `schedule-test-profile-${Date.now()}`;
  const repository = new PostgresScheduleRepository(pool);
  await pool.query(`insert into t_kalendarze (id_kalendarza, id_uzytkownika, nazwa, typ) values ($1, $2, 'Schedule test', 'Osobisty')`, [calendarId, config.demoUserId]);
  await pool.query(`insert into t_profile_pracy
    (id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien, cel_godzin_tydzien, max_godzin_tydzien,
     czas_dojazdu_min, min_odpoczynku_min, aktywny, tryb_pracy, min_slot_min, max_slot_min)
    values ($1, $2, 30, 2, 4, 8, 0, 0, true, 'elastyczny', 120, 360)`, [profileId, config.demoUserId]);
  await pool.query(`insert into t_dostepnosc (id_profilu, dzien_tygodnia, od_godzina, do_godzina, rodzaj)
    values ($1, 1, '08:00', '18:00', 'Dostępny'), ($1, 3, '08:00', '18:00', 'Dostępny')`, [profileId]);
  const app = buildApi(null, [], { scheduleRepository: {
    getPlanningContext: () => repository.getPlanningContext(config.demoUserId, calendarId, profileId),
    getLatestSchedule: (weekStart) => repository.getLatestSchedule(weekStart, calendarId),
    saveSchedule: repository.saveSchedule.bind(repository),
    saveSettings: repository.saveSettings.bind(repository),
    approveSchedule: (weekStart, expectedVersion) => repository.approveSchedule(weekStart, expectedVersion, calendarId),
  } });
  try {
    const settings = await app.inject({ method: 'PUT', url: '/api/scheduling/settings', payload: {
      mode: 'elastyczny', minimumHours: 2, targetHours: 4, maximumHours: 8, commuteBufferMinutes: 0, minimumRestMinutes: 0,
      minimumShiftMinutes: 120, maximumSlotMinutes: 360, shiftTemplates: [{ id: 'test-am', name: 'Zmiana testowa', startTime: '08:00', endTime: '16:00', endsNextDay: false, daysOfWeek: [1, 2, 3, 4, 5], active: true }],
    } });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal(settings.json().shiftTemplates[0].name, 'Zmiana testowa');
    const generated = await app.inject({ method: 'POST', url: '/api/schedules/generate', payload: { weekStart: '2026-11-02' } });
    assert.equal(generated.statusCode, 201, generated.body);
    assert.equal(generated.json().version, 1);
    assert.equal(generated.json().solutionStatus, 'target_met');
    const persisted = await pool.query('select id_profilu, id_kalendarza, tydzien_od::text, version from t_grafiki where id_kalendarza = $1', [calendarId]);
    assert.equal(persisted.rowCount, 1, JSON.stringify(persisted.rows));
    assert.equal(persisted.rows[0].id_profilu, profileId);
    assert.equal(persisted.rows[0].tydzien_od, '2026-11-02');
    assert.equal(persisted.rows[0].id_kalendarza, calendarId);
    const loadedContext = await repository.getPlanningContext(config.demoUserId, calendarId, profileId);
    assert.equal(loadedContext?.profile.calendarId, calendarId);
    const versionCheck = await pool.query('select coalesce(max(version), 0)::integer as version from t_grafiki where id_kalendarza = $1 and tydzien_od = $2', [calendarId, '2026-11-02']);
    assert.equal(versionCheck.rows[0].version, 1);
    const loaded = await app.inject({ method: 'GET', url: '/api/schedules/2026-11-02' });
    assert.equal(loaded.statusCode, 200, loaded.body);
    assert.equal(loaded.json().shifts.length, generated.json().shifts.length);
    const current = loaded.json();
    assert.equal(current.weekStart, '2026-11-02');
    const edit = { expectedVersion: current.version, shifts: current.shifts.map((shift: { candidateId: string; startLocal: string; endLocal: string }) => ({
      id: shift.candidateId, startLocal: shift.startLocal, endLocal: shift.endLocal,
    })) };
    const saved = await app.inject({ method: 'PUT', url: '/api/schedules/2026-11-02', payload: edit });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().version, 2);
    const stale = await app.inject({ method: 'PUT', url: '/api/schedules/2026-11-02', payload: edit });
    assert.equal(stale.statusCode, 409);
    const approved = await app.inject({ method: 'POST', url: '/api/schedules/2026-11-02/approve', payload: { expectedVersion: 2 } });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().isApproved, true);
    const calendarEvents = await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId]);
    assert.equal(calendarEvents.rowCount, approved.json().shifts.length);
    const calendarView = await new PostgresCalendarRepository(pool).getOverview(config.demoUserId, calendarId);
    assert.equal(calendarView?.events.filter((event) => event.title === 'Zmiana pracy').length, approved.json().shifts.length);
    const reapproved = await app.inject({ method: 'POST', url: '/api/schedules/2026-11-02/approve', payload: { expectedVersion: 2 } });
    assert.equal(reapproved.statusCode, 200);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, calendarEvents.rowCount);
    const editedApproved = await app.inject({ method: 'PUT', url: '/api/schedules/2026-11-02', payload: { ...edit, expectedVersion: 2 } });
    assert.equal(editedApproved.statusCode, 200, editedApproved.body);
    assert.equal(editedApproved.json().version, 3);
    assert.equal(editedApproved.json().isApproved, false);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, 0);
    const approvedAgain = await app.inject({ method: 'POST', url: '/api/schedules/2026-11-02/approve', payload: { expectedVersion: 3 } });
    assert.equal(approvedAgain.statusCode, 200);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, approvedAgain.json().shifts.length);
  } finally {
    await app.close();
    await pool.query('delete from t_profile_pracy where id_profilu = $1', [profileId]);
    await pool.query('delete from t_kalendarze where id_kalendarza = $1', [calendarId]);
    await pool.end();
  }
});
