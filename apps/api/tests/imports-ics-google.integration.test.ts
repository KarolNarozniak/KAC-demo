// Testy z prawdziwą bazą: import planu z pliku ICS (S23KC2S1P2-8) i jednorazowy import z Google Calendar (S23KC2S1P2-27)
// przez cały przebieg: plik/konto → podgląd → decyzje → zapis w kalendarzu (wszystko albo nic).
import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { semesterPlan } from './ics-fixture.js';

test('ICS i Google: zapis zajęć z serii, pominięcie duplikatu, źródło „Google” i jednorazowość', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const title = `ICS test ${Date.now()}`;
  const repository = new PostgresCalendarRepository(pool);
  const app = buildApi(repository, config.corsOrigins);
  const sessions: string[] = [];
  try {
    // --- ICS: pierwszy import zapisuje wszystkie wystąpienia serii jako zajęcia ---
    const upload = () => app.inject({ method: 'POST', url: '/api/import/classes/read',
      payload: { fileName: 'plan.ics', dataBase64: Buffer.from(semesterPlan(title)).toString('base64') } });
    const first = await upload();
    assert.equal(first.statusCode, 201);
    const body = first.json();
    sessions.push(body.importSessionId);
    const ours = body.rows.filter((row: { title: string }) => row.title.startsWith(title));
    assert.equal(ours.length, 5);
    const rows = ours.map((row: Record<string, unknown>) => ({ id: row.id, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime, category: 'Class', location: row.location }));
    const confirmed = await app.inject({ method: 'POST', url: `/api/import/sessions/${body.importSessionId}/confirm`, payload: { rows } });
    assert.equal(confirmed.statusCode, 201);
    assert.equal(confirmed.json().summary.added, 5);
    const saved = await pool.query(`select id_kategorii, miejsce, zrodlo from t_wydarzenia where tytul like $1 order by rozpoczecie`, [`${title}%`]);
    assert.equal(saved.rowCount, 5);
    assert.ok(saved.rows.every((row) => row.id_kategorii === 'CAT01' && row.zrodlo === 'Import'));
    assert.equal(saved.rows[0].miejsce, 'Sala 101, bud. 65');

    // --- ICS: ten sam plik drugi raz → duplikaty; „Pomiń” nie dodaje kopii ---
    const second = (await upload()).json();
    sessions.push(second.importSessionId);
    const again = second.rows.filter((row: { title: string }) => row.title.startsWith(title));
    assert.ok(again.every((row: { id: string }) => second.preview.find((item: { id: string }) => item.id === row.id).duplicateOfEvents.length === 1));
    const skipAll = again.map((row: Record<string, unknown>) => ({ id: row.id, title: row.title, date: row.date, startTime: row.startTime, endTime: row.endTime, category: 'Class', duplicateDecision: 'skip' }));
    const skipped = await app.inject({ method: 'POST', url: `/api/import/sessions/${second.importSessionId}/confirm`, payload: { rows: skipAll } });
    assert.deepEqual(skipped.json().summary, { added: 0, replaced: 0, skipped: 5, rejected: second.rows.length - 5 });
    assert.equal((await pool.query(`select count(*)::int as n from t_wydarzenia where tytul like $1`, [`${title}%`])).rows[0].n, 5);

    // --- Google (konto demonstracyjne): zgoda → kalendarz → podgląd → zapis ze źródłem „Google” ---
    const connection = (await app.inject({ method: 'POST', url: '/api/import/google/connections' })).json();
    await app.inject({ method: 'POST', url: `/api/import/google/connections/${connection.connectionId}/consent`, payload: { allow: true } });
    const read = await app.inject({ method: 'POST', url: `/api/import/google/connections/${connection.connectionId}/read`,
      payload: { calendarId: 'kolo-naukowe', from: '2030-03-04', to: '2030-03-10', category: 'Personal' } });
    assert.equal(read.statusCode, 201);
    const google = read.json();
    sessions.push(google.importSessionId);
    const googleRows = google.rows.map((row: Record<string, unknown>) => ({ id: row.id, title: `${title} ${row.title}`, date: row.date, startTime: row.startTime, endTime: row.endTime, category: 'Personal', location: row.location }));
    const done = await app.inject({ method: 'POST', url: `/api/import/sessions/${google.importSessionId}/confirm`, payload: { rows: googleRows } });
    assert.equal(done.statusCode, 201);
    const fromGoogle = await pool.query(`select zrodlo, id_kategorii from t_wydarzenia where tytul like $1 and zrodlo = 'Google'`, [`${title} %`]);
    assert.equal(fromGoogle.rowCount, googleRows.length);
    assert.ok(fromGoogle.rows.every((row) => row.id_kategorii === 'CAT03'));
    // Jednorazowość: po odczycie wydarzeń to samo połączenie nie pozwala czytać dalej.
    const reuse = await app.inject({ method: 'POST', url: `/api/import/google/connections/${connection.connectionId}/read`,
      payload: { calendarId: 'primary', from: '2030-03-04', to: '2030-03-10' } });
    assert.equal(reuse.json().error, 'connection-used');
  } finally {
    await pool.query('delete from t_wydarzenia where tytul like $1', [`${title}%`]);
    await pool.query('delete from t_importy where id_importu = any($1)', [sessions]);
    await app.close();
    await pool.end();
  }
});
