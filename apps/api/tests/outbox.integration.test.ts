import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { pool } from '../src/database.js';
import { enqueueDomainEvent } from '../src/events/outbox.js';
import { PostgresEventOutboxWorker } from '../src/events/outbox-worker.js';

test('outbox enqueue is transactional and concurrent workers claim a job once', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const aggregateId = `outbox-test-${Date.now()}`;
  const scope = { userId: config.demoUserId, calendarId: config.demoCalendarId };
  const client = await pool.connect();
  try {
    await client.query('begin');
    await enqueueDomainEvent(client, scope, 'calendar_event', aggregateId, 'calendar_event.created', {
      origin: 'test', timeZone: 'Europe/Warsaw', after: { title: 'Synthetic', start: '2027-01-01T12:00', end: '2027-01-01T13:00', category: 'Personal' },
    });
    await client.query('rollback');
    const rolledBack = await pool.query('select id_outbox from t_event_outbox where id_agregatu = $1', [aggregateId]);
    assert.equal(rolledBack.rowCount, 0);

    await client.query('begin');
    await enqueueDomainEvent(client, scope, 'calendar_event', aggregateId, 'calendar_event.created', {
      origin: 'test', timeZone: 'Europe/Warsaw', after: { title: 'Synthetic', start: '2027-01-01T12:00', end: '2027-01-01T13:00', category: 'Personal' },
    });
    await client.query('commit');
    const outboxId = await pool.query('select id_outbox from t_event_outbox where id_agregatu = $1', [aggregateId]);
    assert.equal(outboxId.rowCount, 1);

    const left = new PostgresEventOutboxWorker(pool, 1);
    const right = new PostgresEventOutboxWorker(pool, 1);
    const claimed = await Promise.all([left.runOnce(outboxId.rows[0].id_outbox), right.runOnce(outboxId.rows[0].id_outbox)]);
    assert.equal(claimed.reduce((sum, value) => sum + value, 0), 2);
    const result = await pool.query('select status, proby from t_event_outbox where id_agregatu = $1', [aggregateId]);
    const deliveries = await pool.query('select d.consumer, d.status, d.attempts from t_event_outbox_delivery d join t_event_outbox o using (id_outbox) where o.id_agregatu = $1 order by d.consumer', [aggregateId]);
    assert.equal(result.rows[0].status, 'blocked', JSON.stringify(deliveries.rows));
    assert.equal(Number(result.rows[0].proby), 0);
    assert.deepEqual(deliveries.rows.map((row) => [row.consumer, row.status, Number(row.attempts)]), [['google', 'blocked', 1], ['notifications', 'delivered', 1]]);
  } finally {
    client.release();
    await pool.query('delete from t_event_outbox where id_agregatu = $1', [aggregateId]);
  }
});
