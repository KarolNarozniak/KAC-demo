import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';

test('calendar persists events and weekly series in PostgreSQL', { skip: !config.databaseUrl }, async () => {
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
      } finally { await freshApp.close(); }
    } finally {
      const removed = await pool.query('delete from t_wydarzenia where id_wydarzenia = $1 returning id_serii', [id]);
      await pool.query('delete from t_serie where id_serii = $1', [removed.rows[0].id_serii]);
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
