import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { PostgresScheduleRepository } from '../src/scheduling/repository.js';
import { validateSchedule } from '../src/scheduling/generator.js';

test('PostgreSQL schedule persistence, retrieval, edits and version conflicts', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const calendarId = `schedule-test-calendar-${Date.now()}`;
  const profileId = `schedule-test-profile-${Date.now()}`;
  const testUserId = `scheduler-user-${Date.now()}`;
  await pool.query(`insert into t_uzytkownicy(id_uzytkownika,imie,nazwisko,email) values($1,'Scheduler','Test',$2)`,[testUserId,testUserId+'@example.test']);
  const repository = new PostgresScheduleRepository(pool);
  await pool.query(`insert into t_kalendarze (id_kalendarza, id_uzytkownika, nazwa, typ) values ($1, $2, 'Schedule test', 'Osobisty')`, [calendarId, testUserId]);
  await pool.query(`insert into t_profile_pracy
    (id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien, cel_godzin_tydzien, max_godzin_tydzien,
     rodzaj_stawki, czas_dojazdu_min, min_odpoczynku_min, aktywny, tryb_pracy, min_slot_min, max_slot_min)
    values ($1, $2, 30, 2, 4, 8, 'gross', 0, 0, true, 'elastyczny', 120, 360)`, [profileId, testUserId]);
  await pool.query(`insert into t_dostepnosc (id_profilu, dzien_tygodnia, od_godzina, do_godzina, rodzaj)
    values ($1, 1, '08:00', '18:00', 'Dostępny'), ($1, 3, '08:00', '18:00', 'Dostępny')`, [profileId]);
  const app = buildApi(null, [], { scheduleRepository: {
    getPlanningContext: () => repository.getPlanningContext(testUserId, calendarId, profileId),
    getLatestSchedule: (weekStart) => repository.getLatestSchedule(weekStart, calendarId),
    getScheduleById: (id) => repository.getScheduleById(id, calendarId),
    listSchedules: (filters) => repository.listSchedules(filters, calendarId),
    getApprovedShiftEventIds: (weekStart) => repository.getApprovedShiftEventIds(weekStart, calendarId),
    saveSchedule: repository.saveSchedule.bind(repository),
    saveSettings: repository.saveSettings.bind(repository),
    approveSchedule: (weekStart, expectedVersion) => repository.approveSchedule(weekStart, expectedVersion, calendarId),
    rejectSchedule: (weekStart, expectedVersion) => repository.rejectSchedule(weekStart, expectedVersion, calendarId),
  } });
  try {
    const currentSettings = await app.inject({ method: 'GET', url: '/api/v1/scheduling/settings' });
    assert.equal(currentSettings.statusCode, 200);
    const settings = await app.inject({ method: 'PUT', url: '/api/v1/scheduling/settings', payload: {
      ...currentSettings.json(),
      mode: 'elastyczny', minimumHours: 2, targetHours: 4, maximumHours: 8, commuteBufferMinutes: 0, minimumRestMinutes: 0,
      minimumShiftMinutes: 120, maximumSlotMinutes: 360, maxHoursPerDay: 8,
      shiftTemplates: [{ id: 'test-am', name: 'Zmiana testowa', startTime: '08:00', endTime: '16:00', endsNextDay: false, daysOfWeek: [1, 2, 3, 4, 5], active: true }],
    } });
    assert.equal(settings.statusCode, 200, settings.body);
    assert.equal(settings.json().shiftTemplates[0].name, 'Zmiana testowa');
    const savedAvailability = settings.json().availability;
    const noClasses = await app.inject({ method: 'POST', url: '/api/v1/schedules/generate', payload: { weekStart: '2026-11-02', profileVersion: settings.json().profileVersion } });
    assert.equal(noClasses.statusCode, 409);
    const generated = await app.inject({ method: 'POST', url: '/api/v1/schedules/generate', payload: { weekStart: '2026-11-02', profileVersion: settings.json().profileVersion, confirmNoClasses: true } });
    assert.equal(generated.statusCode, 201, generated.body);
    assert.equal(generated.json().version, 1);
    assert.equal(generated.json().solutionStatus, 'target_met');
    assert.equal(generated.json().workflowStatus, 'proposed');
    assert.ok(generated.json().shifts.length > 0, generated.body);
    const persisted = await pool.query('select id_profilu, id_kalendarza, tydzien_od::text, version from t_grafiki where id_kalendarza = $1', [calendarId]);
    assert.equal(persisted.rowCount, 1, JSON.stringify(persisted.rows));
    assert.equal(persisted.rows[0].id_profilu, profileId);
    assert.equal(persisted.rows[0].tydzien_od, '2026-11-02');
    assert.equal(persisted.rows[0].id_kalendarza, calendarId);
    const loadedContext = await repository.getPlanningContext(testUserId, calendarId, profileId);
    assert.equal(loadedContext?.profile.calendarId, calendarId);
    const versionCheck = await pool.query('select coalesce(max(version), 0)::integer as version from t_grafiki where id_kalendarza = $1 and tydzien_od = $2', [calendarId, '2026-11-02']);
    assert.equal(versionCheck.rows[0].version, 1);
    const loaded = await app.inject({ method: 'GET', url: '/api/v1/schedules/2026-11-02' });
    assert.equal(loaded.statusCode, 200, loaded.body);
    assert.equal(loaded.json().shifts.length, generated.json().shifts.length);
    const current = loaded.json();
    assert.equal(current.weekStart, '2026-11-02');
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/schedules/id/${current.scheduleId}` })).statusCode, 200);
    const page = await app.inject({ method: 'GET', url: '/api/v1/schedules?from=2026-11-01&to=2026-11-30&limit=1&offset=0' });
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().total, 1);
    assert.equal(page.json().items.length, 1);
    assert.equal(page.json().items[0].status, 'proposed');
    const edit = { expectedVersion: current.version, shifts: current.shifts.map((shift: { candidateId: string; startLocal: string; endLocal: string }) => ({
      id: shift.candidateId, startLocal: shift.startLocal, endLocal: shift.endLocal,
    })) };
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/schedules/2026-11-02', payload: edit });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().version, 2);
    assert.equal(saved.json().shifts.length, current.shifts.length);
    const stale = await app.inject({ method: 'PUT', url: '/api/v1/schedules/2026-11-02', payload: edit });
    assert.equal(stale.statusCode, 409);
    const deletedAvailability = await pool.query('delete from t_dostepnosc where id_profilu = $1 and rodzaj = $2 returning id_dostepnosci', [profileId, 'Dostępny']);
    assert.ok(deletedAvailability.rowCount > 0);
    const contextWithoutAvailability = await repository.getPlanningContext(testUserId, calendarId, profileId);
    assert.equal(contextWithoutAvailability?.availability.length, 0);
    const currentSchedule = await repository.getLatestSchedule('2026-11-02', calendarId);
    assert.ok(currentSchedule?.shifts.length);
    const currentValidation = validateSchedule(contextWithoutAvailability!, '2026-11-02', currentSchedule!.shifts.map((shift) => ({
      id: shift.candidateId, startLocal: shift.startLocal, endLocal: shift.endLocal, templateId: shift.templateId,
    })), { mode: currentSchedule!.mode, minimumHours: currentSchedule!.minimumMinutes / 60, targetHours: currentSchedule!.targetMinutes / 60,
      maximumHours: currentSchedule!.maximumMinutes / 60, maxHoursPerDay: 8 });
    assert.ok(currentValidation.errors.length > 0, JSON.stringify(currentValidation));
    const invalidated = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/approve', payload: { expectedVersion: 2 } });
    assert.equal(invalidated.statusCode, 422);
    for (const window of savedAvailability) await pool.query(`insert into t_dostepnosc
      (id_dostepnosci, id_profilu, dzien_tygodnia, od_godzina, do_godzina, rodzaj)
      values ($1, $2, $3, $4::time, $5::time, 'Dostępny')`, [window.id, profileId, window.dayOfWeek, window.startTime, window.endTime]);
    const approved = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/approve', payload: { expectedVersion: 2 } });
    assert.equal(approved.statusCode, 200, approved.body);
    assert.equal(approved.json().isApproved, true);
    assert.equal(approved.json().workflowStatus, 'accepted');
    const calendarEvents = await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId]);
    assert.equal(calendarEvents.rowCount, approved.json().shifts.length);
    const calendarView = await new PostgresCalendarRepository(pool).getOverview(testUserId, calendarId);
    assert.equal(calendarView?.events.filter((event) => event.title === 'Zmiana pracy').length, approved.json().shifts.length);
    const reapproved = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/approve', payload: { expectedVersion: 2 } });
    assert.equal(reapproved.statusCode, 200);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, calendarEvents.rowCount);
    const editedApproved = await app.inject({ method: 'PUT', url: '/api/v1/schedules/2026-11-02', payload: { ...edit, expectedVersion: 2 } });
    assert.equal(editedApproved.statusCode, 200, editedApproved.body);
    assert.equal(editedApproved.json().version, 3);
    assert.equal(editedApproved.json().isApproved, false);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, calendarEvents.rowCount);
    const approvedAgain = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/approve', payload: { expectedVersion: 3 } });
    assert.equal(approvedAgain.statusCode, 200);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, approvedAgain.json().shifts.length);

    const currentProfile = await app.inject({ method: 'GET', url: '/api/v1/scheduling/settings' });
    const lowerTargetSettings = await app.inject({ method: 'PUT', url: '/api/v1/scheduling/settings', payload: {
      ...currentProfile.json(), minimumHours: 1, targetHours: 2, maximumHours: 8,
    } });
    assert.equal(lowerTargetSettings.statusCode, 200, lowerTargetSettings.body);
    const oldEventsBeforeReplacement = (await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount;
    const lowerDraft = await app.inject({ method: 'POST', url: '/api/v1/schedules/generate', payload: {
      weekStart: '2026-11-02', profileVersion: lowerTargetSettings.json().profileVersion, confirmNoClasses: true,
    } });
    assert.equal(lowerDraft.statusCode, 201, lowerDraft.body);
    assert.equal(lowerDraft.json().version, 4);
    assert.equal(lowerDraft.json().existingWorkMinutes, 0);
    assert.equal(lowerDraft.json().targetMinutes, 120);
    assert.equal(lowerDraft.json().proposedMinutes, 120);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, oldEventsBeforeReplacement);

    const rejected = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/reject', payload: { expectedVersion: 4 } });
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(rejected.json().schedule.version, 3);
    assert.equal(rejected.json().schedule.isApproved, true);
    assert.equal(rejected.json().schedule.workflowStatus, 'accepted');
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, oldEventsBeforeReplacement);

    const finalDraft = await app.inject({ method: 'POST', url: '/api/v1/schedules/generate', payload: {
      weekStart: '2026-11-02', profileVersion: lowerTargetSettings.json().profileVersion, confirmNoClasses: true,
    } });
    assert.equal(finalDraft.statusCode, 201, finalDraft.body);
    assert.equal(finalDraft.json().version, 5);
    assert.equal(finalDraft.json().existingWorkMinutes, 0);
    assert.equal(finalDraft.json().proposedMinutes, 120);
    const finalApproved = await app.inject({ method: 'POST', url: '/api/v1/schedules/2026-11-02/approve', payload: { expectedVersion: 5 } });
    assert.equal(finalApproved.statusCode, 200, finalApproved.body);
    assert.equal(finalApproved.json().isApproved, true);
    assert.equal(finalApproved.json().proposedMinutes, 120);
    assert.equal((await pool.query(`select id_wydarzenia from t_wydarzenia where id_kalendarza = $1 and zrodlo = 'Plan pracy'`, [calendarId])).rowCount, finalApproved.json().shifts.length);
  } finally {
    await app.close();
    await pool.query('delete from t_profile_pracy where id_profilu = $1', [profileId]);
    await pool.query('delete from t_kalendarze where id_kalendarza = $1', [calendarId]);
    await pool.query('delete from t_uzytkownicy where id_uzytkownika=$1',[testUserId]);
    await pool.end();
  }
});
