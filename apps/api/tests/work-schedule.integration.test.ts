import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import type { ScheduleReader } from '../src/import/work-schedule/reader.js';
import { pdfBytes, toBase64 } from './fixtures.js';

// Test z prawdziwą bazą: plik → odczyt → podgląd → decyzje → zapis w kalendarzu (S23KC2S1P2-44).
test('import grafiku: zastąpienie duplikatu, zmiana nocna, odrzucenie cudzych zmian i anulowanie', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const title = `Praca test ${Date.now()}`;
  const repository = new PostgresCalendarRepository(pool);
  const userName = await repository.getImportUserName();
  // Czytnik testowy zwraca grafik z unikalnym tytułem, żeby test nie dotykał danych startowych bazy.
  const reader: ScheduleReader = {
    real: true,
    read: async () => [
      { employee: userName, title, date: '2026-11-02', startTime: '16:00', endTime: '20:00', confidence: 0.9 },
      { employee: userName, title, date: '2026-11-04', startTime: '22:00', endTime: '06:00', confidence: 0.9 },
      { employee: 'Anna Nowak', title, date: '2026-11-05', startTime: '08:00', endTime: '14:00', confidence: 0.9 },
    ],
  };
  const app = buildApi(repository, config.corsOrigins, { scheduleReader: reader });
  const sessions: string[] = [];
  try {
    // W kalendarzu jest już zmiana o tym samym tytule i początku co pierwsza zmiana z grafiku.
    const existing = await pool.query(
      `insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, opis)
       values ($1, 'CAT02', $2, '2026-11-02 16:00:00+01', '2026-11-02 19:00:00+01', 'stara wersja') returning id_wydarzenia`,
      [config.demoCalendarId, title],
    );
    const existingId: string = existing.rows[0].id_wydarzenia;

    const response = await app.inject({ method: 'POST', url: '/api/import/work-schedule/read', payload: { fileName: 'grafik.pdf', dataBase64: toBase64(pdfBytes()) } });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    sessions.push(body.importSessionId);
    assert.equal(body.readStatus, 'all');
    assert.deepEqual(body.rows.map((row: { isOwn: boolean }) => row.isOwn), [true, true, false]);
    assert.deepEqual(body.preview[0].duplicateOfEvents.map((event: { id: string }) => event.id), [existingId]);
    assert.equal(body.preview[1].overnight, true);

    // Użytkownik: zastępuje duplikat, potwierdza zmianę nocną, nie bierze zmiany innego pracownika.
    const [first, second] = body.rows;
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/import/sessions/${body.importSessionId}/confirm`,
      payload: {
        rows: [
          { id: first.id, title: first.title, date: first.date, startTime: first.startTime, endTime: first.endTime, category: 'Work', duplicateDecision: 'replace' },
          { id: second.id, title: second.title, date: second.date, startTime: second.startTime, endTime: second.endTime, category: 'Work', overnightConfirmed: true },
        ],
      },
    });
    assert.equal(confirmed.statusCode, 201);
    assert.deepEqual(confirmed.json().summary, { added: 1, replaced: 1, skipped: 0, rejected: 1 });

    const events = await pool.query(`select id_wydarzenia, zakonczenie, id_kategorii from t_wydarzenia where tytul = $1 order by rozpoczecie`, [title]);
    assert.equal(events.rowCount, 2);
    assert.equal(events.rows[0].id_wydarzenia, existingId); // zastąpione, a nie dodane drugi raz
    assert.equal(new Date(events.rows[0].zakonczenie).toISOString(), '2026-11-02T19:00:00.000Z'); // nowy koniec 20:00 czasu polskiego
    assert.equal(new Date(events.rows[1].zakonczenie).toISOString(), '2026-11-05T05:00:00.000Z'); // zmiana nocna do 06:00
    assert.ok(events.rows.every((row) => row.id_kategorii === 'CAT02'));

    const positions = await pool.query(`select status_kontroli from t_pozycje_importu where id_importu = $1 order by id_pozycji`, [body.importSessionId]);
    assert.deepEqual(positions.rows.map((row) => row.status_kontroli), ['Zastąpiła', 'Zatwierdzona', 'Odrzucona']);

    // Drugi import tego samego grafiku i anulowanie: kalendarz bez zmian, import ma status „Anulowany”.
    const second2 = await app.inject({ method: 'POST', url: '/api/import/work-schedule/read', payload: { fileName: 'grafik.pdf', dataBase64: toBase64(pdfBytes()) } });
    const secondId: string = second2.json().importSessionId;
    sessions.push(secondId);
    const cancelled = await app.inject({ method: 'POST', url: `/api/import/sessions/${secondId}/cancel` });
    assert.equal(cancelled.statusCode, 200);
    const status = await pool.query(`select status from t_importy where id_importu = $1`, [secondId]);
    assert.equal(status.rows[0].status, 'Anulowany');
    const after = await pool.query(`select count(*)::int as n from t_wydarzenia where tytul = $1`, [title]);
    assert.equal(after.rows[0].n, 2);
  } finally {
    await pool.query('delete from t_wydarzenia where tytul = $1', [title]);
    await pool.query('delete from t_importy where id_importu = any($1)', [sessions]);
    await app.close();
    await pool.end();
  }
});
