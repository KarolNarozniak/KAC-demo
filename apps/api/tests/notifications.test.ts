import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { reminderText, reminderTime } from '../src/notifications/schedule.js';
import { config } from '../src/config.js';

test('reminders are sent immediately after their lead time but never after shift start', () => {
  const now = new Date('2026-11-16T08:45:00Z');
  const futureStart = new Date('2026-11-16T09:00:00Z');
  assert.equal(reminderTime(futureStart, 30, 'Europe/Warsaw', now)?.toISOString(), now.toISOString());
  assert.equal(reminderTime(new Date('2026-11-16T08:30:00Z'), 30, 'Europe/Warsaw', now), null);
});

test('quiet hours defer a reminder to their end and notification text includes both shift times', () => {
  const start = new Date('2026-11-16T11:00:00Z');
  const end = new Date('2026-11-16T19:00:00Z');
  const planned = reminderTime(start, 300, 'Europe/Warsaw', new Date('2026-11-15T00:00:00Z'), '22:00:00', '08:00:00');
  assert.equal(planned?.toISOString(), '2026-11-16T07:00:00.000Z');
  assert.equal(reminderText('Zmiana', start, end, 'Europe/Warsaw'), 'Przypomnienie: Zmiana, 2026-11-16 12:00–2026-11-16 20:00');
});

test('notification API validates lead time, claims due reminders and acknowledges display', async () => {
  const calls: unknown[] = [];
  const app = buildApi(null, [], { notificationRepository: {
    getSettings: async () => ({ enabled: true, workRemindersEnabled: true, eventChangesEnabled: true, minutesBefore: 30, quietStart: null, quietEnd: null, pendingReminderCount: 1 }),
    updateSettings: async (_scope, settings) => { calls.push(settings); },
    listDue: async () => [{ id: 'n1', eventId: 'e1', type: 'Przypomnienie pracy', message: 'Zmiana', scheduledAt: '2035-02-14T08:30:00Z', eventStart: '2035-02-14T09:00', eventEnd: '2035-02-14T17:00', title: 'Zmiana' }],
    acknowledge: async (_scope, id) => id === 'n1',
  } as never });
  try {
    for (const minutesBefore of [0, 1441]) {
      const invalid = await app.inject({ method: 'PUT', url: '/api/v1/notifications/settings', payload: { enabled: true, workRemindersEnabled: true, minutesBefore } });
      assert.equal(invalid.statusCode, 400);
    }
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/notifications/settings', payload: { enabled: true, workRemindersEnabled: true, minutesBefore: 45 } });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(calls, [{ enabled: true, workRemindersEnabled: true, minutesBefore: 45 }]);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/notifications/settings' })).json().pendingReminderCount, 1);
    const due = await app.inject({ method: 'GET', url: '/api/v1/notifications/due' });
    assert.equal(due.statusCode, 200);
    assert.equal(due.json().notifications[0].eventEnd, '2035-02-14T17:00');
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/notifications/n1/ack', payload: {} })).json().status, 'delivered');
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/notifications/missing/ack', payload: {} })).statusCode, 404);
  } finally { await app.close(); }
});

test('Web Push endpoints expose only public VAPID data and scope subscription changes', async () => {
  const calls: unknown[] = [];
  const original = { publicKey: config.webPush.publicKey, privateKey: config.webPush.privateKey, subject: config.webPush.subject };
  config.webPush.publicKey = 'synthetic-public-vapid-key';
  config.webPush.privateKey = 'synthetic-private-vapid-key';
  config.webPush.subject = 'mailto:test@example.invalid';
  const app = buildApi(null, [], { userScope: () => ({ userId: 'user-one', calendarId: 'calendar-one' }), notificationRepository: {
    getSettings: async () => ({ enabled: false, workRemindersEnabled: true, eventChangesEnabled: true, minutesBefore: 30, quietStart: null, quietEnd: null, pendingReminderCount: 0 }),
    updateSettings: async () => {}, listDue: async () => [], acknowledge: async () => true,
    savePushSubscription: async (scope, input) => { calls.push({ type: 'save', scope, input }); },
    deletePushSubscription: async (scope, endpoint) => { calls.push({ type: 'delete', scope, endpoint }); return true; },
  } as never });
  try {
    const configResult = await app.inject({ method: 'GET', url: '/api/v1/notifications/push-config' });
    assert.equal(configResult.statusCode, 200);
    assert.deepEqual(configResult.json(), { enabled: true, applicationServerKey: 'synthetic-public-vapid-key' });
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-reserved-endpoint', keys: { p256dh: 'synthetic-public-key-000000000000', auth: 'synthetic-auth-key-0000' }, expirationTime: null };
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/notifications/subscriptions', payload: subscription })).statusCode, 201);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/notifications/subscriptions', payload: { endpoint: subscription.endpoint } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/notifications/subscriptions', payload: { ...subscription, endpoint: 'http://fcm.googleapis.com/synthetic' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/notifications/subscriptions', payload: { ...subscription, endpoint: 'https://attacker.example.invalid/collect' } })).statusCode, 400);
    assert.equal(calls.length, 2);
    assert.deepEqual((calls[0] as { scope: unknown }).scope, { userId: 'user-one', calendarId: 'calendar-one' });
    assert.equal('privateKey' in configResult.json(), false);
  } finally {
    config.webPush.publicKey = original.publicKey; config.webPush.privateKey = original.privateKey; config.webPush.subject = original.subject;
    await app.close();
  }
});
