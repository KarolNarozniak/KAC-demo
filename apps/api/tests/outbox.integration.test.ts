import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { enqueueDomainEvent } from '../src/events/outbox.js';
import { PostgresEventOutboxWorker } from '../src/events/outbox-worker.js';
import { PostgresNotificationRepository } from '../src/notifications/repository.js';
import { WebPushNotificationWorker } from '../src/notifications/web-push-worker.js';

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

test('notification preferences reschedule existing shifts and unacknowledged claims are retried', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const userId = `notification-test-${Date.now()}`;
  const scope = { userId, calendarId: '' };
  const calendar = new PostgresCalendarRepository(pool);
  const notifications = new PostgresNotificationRepository(pool);
  let eventId = '';
  try {
    await pool.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa)
      values ($1, 'Test', 'Notification', $2, 'Europe/Warsaw')`, [userId, `${userId}@example.invalid`]);
    const createdCalendar = await pool.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Synthetic', 'personal') returning id_kalendarza`, [userId]);
    scope.calendarId = String(createdCalendar.rows[0].id_kalendarza);
    const created = await calendar.createEvent({ title: 'Synthetic shift', start: '2035-02-14T09:00', end: '2035-02-14T17:00', category: 'Work', location: '', mandatory: false, repeatWeekly: false }, userId, scope.calendarId);
    eventId = created.id;

    await notifications.updateSettings(scope, { enabled: true, workRemindersEnabled: true, minutesBefore: 30 });
    let planned = await pool.query(`select id_powiadomienia, planowana_data, status, tresc from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2 order by planowana_data, id_powiadomienia`, [userId, eventId]);
    assert.equal(planned.rows.filter((row) => row.status === 'Zaplanowane').length, 1);
    assert.match(planned.rows.find((row) => row.status === 'Zaplanowane').tresc, /09:00.*17:00/);
    assert.equal((await notifications.getSettings(scope)).pendingReminderCount, 1);
    const oldPlannedAt = new Date(planned.rows.find((row) => row.status === 'Zaplanowane').planowana_data).toISOString();

    await notifications.updateSettings(scope, { enabled: true, workRemindersEnabled: true, minutesBefore: 45 });
    planned = await pool.query(`select id_powiadomienia, planowana_data, status from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2 order by planowana_data, id_powiadomienia`, [userId, eventId]);
    const active = planned.rows.filter((row) => row.status === 'Zaplanowane');
    assert.equal(active.length, 1);
    assert.notEqual(new Date(active[0].planowana_data).toISOString(), oldPlannedAt);

    await notifications.updateSettings(scope, { enabled: false, workRemindersEnabled: false, minutesBefore: 45 });
    assert.equal((await pool.query(`select 1 from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2 and status = 'Zaplanowane'`, [userId, eventId])).rowCount, 0);
    assert.equal((await notifications.getSettings(scope)).pendingReminderCount, 0);
    await notifications.updateSettings(scope, { enabled: true, workRemindersEnabled: true, minutesBefore: 30 });
    await pool.query(`update t_powiadomienia set planowana_data = now() - interval '1 minute'
      where id_uzytkownika = $1 and id_wydarzenia = $2 and status = 'Zaplanowane'`, [userId, eventId]);
    const firstClaim = await notifications.listDue(scope);
    assert.equal(firstClaim.length, 1);
    assert.equal((await notifications.listDue(scope)).length, 0);
    await pool.query(`update t_powiadomienia set lease_until = now() - interval '1 second' where id_powiadomienia = $1`, [firstClaim[0].id]);
    const reclaimed = await notifications.listDue(scope);
    assert.equal(reclaimed[0]?.id, firstClaim[0].id);
    assert.equal(await notifications.acknowledge(scope, reclaimed[0].id), true);
    assert.equal((await pool.query(`select status from t_powiadomienia where id_powiadomienia = $1`, [firstClaim[0].id])).rows[0].status, 'Wysłane');
  } finally {
    await pool.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
});

test('configured Web Push worker delivers a due reminder with event navigation data', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const userId = `web-push-test-${Date.now()}`;
  const scope = { userId, calendarId: '' };
  const calendar = new PostgresCalendarRepository(pool);
  const notifications = new PostgresNotificationRepository(pool);
  const captured: Array<{ endpoint: string; payload: Record<string, unknown> }> = [];
  const transientFailures = new Set<string>();
  let eventId = '';
  try {
    await pool.query(`insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa)
      values ($1, 'Test', 'Push', $2, 'Europe/Warsaw')`, [userId, `${userId}@example.invalid`]);
    const createdCalendar = await pool.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ) values ($1, 'Synthetic', 'personal') returning id_kalendarza`, [userId]);
    scope.calendarId = String(createdCalendar.rows[0].id_kalendarza);
    const event = await calendar.createEvent({ title: 'Synthetic push shift', start: '2035-02-14T09:00', end: '2035-02-14T17:00', category: 'Work', location: '', mandatory: false, repeatWeekly: false }, userId, scope.calendarId);
    eventId = event.id;
    await notifications.updateSettings(scope, { enabled: true, workRemindersEnabled: true, minutesBefore: 30 });
    const endpoint = `https://fcm.googleapis.com/fcm/send/device-one-${userId}`;
    const retryEndpoint = `https://fcm.googleapis.com/fcm/send/device-two-${userId}`;
    for (const pushEndpoint of [endpoint, retryEndpoint]) await notifications.savePushSubscription(scope, { endpoint: pushEndpoint,
      p256dh: 'synthetic-public-key-000000000000', auth: 'synthetic-auth-key-0000' });
    await pool.query(`update t_powiadomienia set planowana_data = now() - interval '1 minute' where id_uzytkownika = $1 and id_wydarzenia = $2 and status = 'Zaplanowane'`, [userId, eventId]);
    const worker = new WebPushNotificationWorker(pool, { enabled: true, publicKey: 'synthetic-public-key', privateKey: 'synthetic-private-key', subject: 'mailto:test@example.invalid' },
      async (subscription, payload) => {
        if (subscription.endpoint === retryEndpoint && !transientFailures.has(subscription.endpoint)) {
          transientFailures.add(subscription.endpoint);
          throw Object.assign(new Error('synthetic transient failure'), { statusCode: 503 });
        }
        captured.push({ endpoint: subscription.endpoint, payload: JSON.parse(typeof payload === 'string' ? payload : payload?.toString() ?? '{}') as Record<string, unknown> });
      });
    assert.equal(await worker.runOnce(), 2);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.endpoint, endpoint);
    assert.equal((await pool.query(`select count(*)::integer as count from t_powiadomienia_push_dostawy where id_powiadomienia = (select id_powiadomienia from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2) and status = 'pending'`, [userId, eventId])).rows[0].count, 1);
    await pool.query(`update t_powiadomienia_push_dostawy set available_at = now() - interval '1 second' where id_subskrypcji = (select id_subskrypcji from t_web_push_subskrypcje where endpoint = $1)`, [retryEndpoint]);
    assert.equal(await worker.runOnce(), 1);
    assert.equal(captured.length, 2);
    assert.equal(captured[1]?.endpoint, retryEndpoint);
    const data = captured[0]?.payload.data as Record<string, unknown>;
    assert.equal(data.eventId, eventId);
    assert.equal(data.eventStart, '2035-02-14T09:00');
    assert.equal(data.eventEnd, '2035-02-14T17:00');
    assert.equal((await pool.query(`select status from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2`, [userId, eventId])).rows[0].status, 'Wysłane');
    assert.equal((await pool.query(`select count(*)::integer as count from t_powiadomienia_push_dostawy where id_powiadomienia = (select id_powiadomienia from t_powiadomienia where id_uzytkownika = $1 and id_wydarzenia = $2) and status = 'delivered'`, [userId, eventId])).rows[0].count, 2);
  } finally {
    await pool.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
    await pool.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
  }
});
