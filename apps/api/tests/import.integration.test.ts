import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresDemoRepository } from '../src/database.js';

// Test z prawdziwą bazą PostgreSQL: sesja → odrzucenie wiersza → zapis w kalendarzu → wygasanie sesji.
test('import: sesja, odrzucenie wiersza, zapis w kalendarzu i wygasanie sesji', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const app = buildApi(new PostgresDemoRepository(pool), config.corsOrigins);
  const sessions: string[] = [];
  const title = `Test importu ${Date.now()}`;
  try {
    const rows = [
      { id: 'p1', title, date: '2026-11-03', startTime: '10:00', endTime: '12:00', category: 'Class', location: 'Sala 118', confidence: 0.8 },
      { id: 'p2', title: `${title} (odrzucony)`, date: '2026-11-04', startTime: '10:00', endTime: '12:00', category: 'Class' },
    ];
    const created = await app.inject({ method: 'POST', url: '/api/import/sessions', payload: { source: 'classes', format: 'PDF', rows } });
    assert.equal(created.statusCode, 201);
    const sessionId: string = created.json().importSessionId;
    sessions.push(sessionId);

    // Przed zatwierdzeniem kalendarz nie zawiera importowanych wydarzeń.
    const before = await pool.query('select count(*)::int as n from t_wydarzenia where tytul like $1', [`${title}%`]);
    assert.equal(before.rows[0].n, 0);

    // Użytkownik zatwierdza tylko pierwszy wiersz, drugi odrzuca.
    const firstRow = rows[0];
    assert.ok(firstRow);
    const confirmed = await app.inject({ method: 'POST', url: `/api/import/sessions/${sessionId}/confirm`, payload: { rows: [firstRow] } });
    assert.equal(confirmed.statusCode, 201);
    assert.equal(confirmed.json().saved, 1);
    assert.equal(confirmed.json().rejected, 1);

    const event = await pool.query('select id_kategorii, zrodlo, opis from t_wydarzenia where tytul = $1', [title]);
    assert.equal(event.rowCount, 1);
    assert.equal(event.rows[0].id_kategorii, 'CAT01');
    assert.equal(event.rows[0].zrodlo, 'Import');
    assert.match(event.rows[0].opis, /Miejsce: Sala 118/);

    const positions = await pool.query('select status_kontroli, pewnosc from t_pozycje_importu where id_importu = $1 order by id_pozycji', [sessionId]);
    assert.deepEqual(positions.rows.map((row) => row.status_kontroli), ['Zatwierdzona', 'Odrzucona']);
    assert.equal(Number(positions.rows[0].pewnosc), 0.8);

    // Drugie zatwierdzenie tej samej sesji jest blokowane.
    const again = await app.inject({ method: 'POST', url: `/api/import/sessions/${sessionId}/confirm`, payload: { rows: [firstRow] } });
    assert.equal(again.statusCode, 409);

    // Sesja bez akcji przez ponad 15 minut wygasa.
    const old = await app.inject({ method: 'POST', url: '/api/import/sessions', payload: { source: 'classes', format: 'PDF', rows: [firstRow] } });
    const oldId: string = old.json().importSessionId;
    sessions.push(oldId);
    await pool.query(`update t_importy set data_importu = now() - interval '16 minutes' where id_importu = $1`, [oldId]);
    const expired = await app.inject({ method: 'POST', url: `/api/import/sessions/${oldId}/confirm`, payload: { rows: [firstRow] } });
    assert.equal(expired.statusCode, 410);
  } finally {
    // Sprzątanie: usuwamy wszystko, co test dodał do bazy.
    await pool.query('delete from t_wydarzenia where tytul like $1', [`${title}%`]);
    await pool.query('delete from t_importy where id_importu = any($1)', [sessions]);
    await app.close();
    await pool.end();
  }
});
