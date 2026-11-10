// Profil pracy i cel godzin (S23KC2S1P2-182, S23KC2S1P2-157) na prawdziwej bazie PostgreSQL.
// Test zakłada własnego użytkownika, więc nie zmienia profilu użytkownika demonstracyjnego.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/database.js';
import { PostgresWorkProfileRepository } from '../src/profile/repository.js';

test('profil pracy: zapis, cel miesięczny, walidacja, wersje i jeden aktywny profil', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const suffix = Date.now();
  const userId = `profile-test-user-${suffix}`, calendarId = `profile-test-calendar-${suffix}`, profileId = `profile-test-${suffix}`;
  await pool.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa) values ($1, 'Test', 'Profil', $2, 'Europe/Warsaw')`, [userId, `${userId}@example.test`]);
  await pool.query(`insert into t_kalendarze (id_kalendarza, id_uzytkownika, nazwa, typ) values ($1, $2, 'Profil test', 'Osobisty')`, [calendarId, userId]);
  await pool.query(`insert into t_profile_pracy (id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien, cel_godzin_tydzien, max_godzin_tydzien, czas_dojazdu_min, min_odpoczynku_min, aktywny)
    values ($1, $2, 30, 10, 20, 30, 15, 30, true)`, [profileId, userId]);
  const app = buildApi(null, [], { workProfileRepository: new PostgresWorkProfileRepository(pool), userScope: () => ({ userId, calendarId }) });
  const get = async () => (await app.inject({ method: 'GET', url: '/api/v1/work-profile' })).json();
  const put = (payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/v1/work-profile', payload });
  const row = async () => (await pool!.query(`select min_godzin_tydzien::float as min, cel_godzin_tydzien::float as tydzien, cel_godzin_miesiac::float as miesiac,
    okres_celu, czas_dojazdu_min from t_profile_pracy where id_profilu = $1`, [profileId])).rows[0];
  try {
    const initial = await get();
    assert.deepEqual([initial.minimumHours, initial.targetHours, initial.targetPeriod, initial.maximumHours, initial.commuteBufferMinutes], [10, 20, 'week', 30, 15]);

    // Zmiana limitów, dni dostępności i dojazdu oraz cel miesięczny – wszystko w jednym zapisie.
    const saved = await put({ ...initial, minimumHours: 12, targetHours: 100, targetPeriod: 'month', maximumHours: 28, commuteBufferMinutes: 40,
      availability: [{ id: `${profileId}-mon`, dayOfWeek: 1, startTime: '14:00', endTime: '22:00' }, { id: `${profileId}-wed`, dayOfWeek: 3, startTime: '16:00', endTime: '22:00' }] });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.notEqual(saved.json().profileVersion, initial.profileVersion);
    assert.deepEqual([saved.json().targetHours, saved.json().targetPeriod, saved.json().targetMinutes, saved.json().weeklyTargetMinutes], [100, 'month', 6000, 1385]);
    assert.deepEqual(saved.json().availability.map((window: { dayOfWeek: number }) => window.dayOfWeek), [1, 3]);
    assert.deepEqual(await row(), { min: 12, tydzien: 23.08, miesiac: 100, okres_celu: 'Miesiac', czas_dojazdu_min: 40 });

    // Powrót do celu tygodniowego czyści wartość miesięczną.
    const weekly = await put({ ...saved.json(), targetHours: 18, targetPeriod: 'week' });
    assert.equal(weekly.statusCode, 200, weekly.body);
    assert.deepEqual(await row(), { min: 12, tydzien: 18, miesiac: null, okres_celu: 'Tydzien', czas_dojazdu_min: 40 });

    // Błędne dane: 422 przy polach i brak jakiejkolwiek zmiany w bazie.
    const before = await row();
    const invalid = await put({ ...weekly.json(), minimumHours: 35, maximumHours: 30, targetHours: null });
    assert.equal(invalid.statusCode, 422);
    assert.deepEqual(invalid.json().fields, { minimumHours: 'min_greater_than_max', targetHours: 'required' });
    assert.deepEqual(await row(), before);

    // Zapis ze starą wersją (np. drugie okno): 409 z aktualnym profilem.
    const stale = await put({ ...saved.json(), targetHours: 25, targetPeriod: 'week' });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().profile.targetHours, 18);

    // Dwa zapisy naraz z tą samą wersją: dokładnie jeden przechodzi.
    const current = await get();
    const results = await Promise.all([put({ ...current, targetHours: 15 }), put({ ...current, targetHours: 16 })]);
    assert.deepEqual(results.map((response) => response.statusCode).sort(), [200, 409]);

    // S23KC2S1P2-186: drugi aktywny profil tego samego użytkownika jest odrzucany przez bazę.
    await assert.rejects(pool.query(`insert into t_profile_pracy (id_profilu, id_uzytkownika, stawka_pln, aktywny) values ($1, $2, 30, true)`, [`${profileId}-2`, userId]),
      (error: { code?: string }) => error.code === '23505');
  } finally {
    await app.close();
    await pool.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
    await pool.end();
  }
});
