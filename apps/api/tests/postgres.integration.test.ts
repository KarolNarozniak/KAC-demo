import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';

test('calendar persists and deletes events and weekly series in PostgreSQL', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const app = buildApi(new PostgresCalendarRepository(pool), config.corsOrigins);
  try {
    const readiness = await app.inject({ method: 'GET', url: '/api/health/ready' });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().database, 'connected');

    const response = await app.inject({ method: 'GET', url: '/api/calendar' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.source, 'postgresql');
    assert.equal(payload.calendar.id, config.demoCalendarId);
    const created = await app.inject({ method: 'POST', url: '/api/events', payload: {
      title: 'Persistence integration test', start: '2026-10-19T09:00', end: '2026-10-19T10:00',
      category: 'Work', location: 'Test office', mandatory: false, repeatWeekly: true
    } });
    assert.equal(created.statusCode, 201);
    const id = created.json().id;
    try {
      const freshApp = buildApi(new PostgresCalendarRepository(pool));
      try {
        const reread = await freshApp.inject({ method: 'GET', url: '/api/calendar' });
        const saved = reread.json().events.find((event: { id: string }) => event.id === id);
        assert.equal(saved.repeatWeekly, true);
        assert.equal(saved.start, '2026-10-19T09:00');
        assert.equal(saved.location, 'Test office');
        const series = await pool.query('select s.* from t_serie s join t_wydarzenia e using (id_serii) where e.id_wydarzenia = $1', [id]);
        assert.equal(series.rows[0].bezterminowo, true);
        const repository = new PostgresCalendarRepository(pool);
        assert.equal(await repository.deleteEvent(id, 'not-the-owner', config.demoCalendarId), null);
        assert.equal(await repository.deleteEvent(id, config.demoUserId, 'not-the-calendar'), null);
        const stillPresent = await pool.query('select id_wydarzenia from t_wydarzenia where id_wydarzenia = $1', [id]);
        assert.equal(stillPresent.rowCount, 1);
        const deleted = await freshApp.inject({ method: 'DELETE', url: `/api/events/${id}` });
        assert.equal(deleted.statusCode, 200);
        assert.deepEqual(deleted.json().deletedIds, [id]);
        const afterDelete = await freshApp.inject({ method: 'GET', url: '/api/calendar' });
        assert.equal(afterDelete.json().events.some((event: { id: string }) => event.id === id), false);
        assert.equal((await pool.query('select id_serii from t_serie where id_serii = $1', [series.rows[0].id_serii])).rowCount, 0);
        assert.equal((await freshApp.inject({ method: 'DELETE', url: `/api/events/${id}` })).statusCode, 404);
        const single = await freshApp.inject({ method: 'POST', url: '/api/events', payload: {
          title: 'Single-event deletion test', start: '2026-10-19T11:00', end: '2026-10-19T12:00',
          category: 'Personal', location: '', mandatory: false, repeatWeekly: false,
        } });
        assert.equal(single.statusCode, 201);
        const singleId = single.json().id;
        try {
          assert.equal((await freshApp.inject({ method: 'DELETE', url: `/api/events/${singleId}` })).statusCode, 200);
          assert.equal((await pool.query('select id_wydarzenia from t_wydarzenia where id_wydarzenia = $1', [singleId])).rowCount, 0);
        } finally { await pool.query('delete from t_wydarzenia where id_wydarzenia = $1', [singleId]); }
      } finally { await freshApp.close(); }
    } finally {
      const removed = await pool.query('delete from t_wydarzenia where id_wydarzenia = $1 returning id_serii', [id]);
      if (removed.rowCount) await pool.query('delete from t_serie where id_serii = $1', [removed.rows[0].id_serii]);
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
