import type { FastifyInstance } from 'fastify';
import type { ScopeResolver } from '../../scope.js';
import type { PostgresNotificationRepository } from '../../../notifications/repository.js';
import { documented, withExamples } from '../../examples.js';
import { config } from '../../../config.js';

const settingsResponse = documented({ type: 'object', additionalProperties: false, required: ['enabled', 'workRemindersEnabled', 'eventChangesEnabled', 'minutesBefore', 'quietStart', 'quietEnd', 'pendingReminderCount'],
  properties: { enabled: { type: 'boolean' }, workRemindersEnabled: { type: 'boolean' }, eventChangesEnabled: { type: 'boolean' }, minutesBefore: { type: 'integer', minimum: 1, maximum: 1440 }, quietStart: { type: ['string', 'null'] }, quietEnd: { type: ['string', 'null'] }, pendingReminderCount: { type: 'integer', minimum: 0 } },
}, 'Preferencje i liczba zaplanowanych przypomnień dla bieżącego zakresu.', { settings: { summary: 'Ustawienia przypomnień', value: { enabled: true, workRemindersEnabled: true, eventChangesEnabled: true, minutesBefore: 30, quietStart: null, quietEnd: null, pendingReminderCount: 2 } } });
const dueResponse = documented({
  type: 'object', additionalProperties: false, required: ['notifications'], properties: {
    notifications: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'eventId', 'type', 'message', 'scheduledAt', 'eventStart', 'eventEnd', 'title'], properties: {
        id: { type: 'string' }, eventId: { type: 'string' }, type: { type: 'string' }, message: { type: 'string' }, scheduledAt: { type: 'string', format: 'date-time' },
        eventStart: { type: 'string' }, eventEnd: { type: 'string' }, title: { type: 'string' },
      },
    } },
  },
}, 'Lista przypomnień przejętych przez aktywnego klienta.', { due: { summary: 'Oczekujące przypomnienie', value: { notifications: [{ id: 'synthetic-notification', eventId: 'synthetic-event', type: 'Przypomnienie pracy', message: 'Przypomnienie: Zmiana, 2026-11-16 08:00–16:00', scheduledAt: '2026-11-16T07:30:00Z', eventStart: '2026-11-16T08:00', eventEnd: '2026-11-16T16:00', title: 'Zmiana' }] } } });
const ackResponse = documented({ type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['delivered'] } },
}, 'Potwierdzenie wyświetlenia powiadomienia przez klienta.', { delivered: { summary: 'Przypomnienie wyświetlone', value: { status: 'delivered' } } });
const pushConfigResponse = documented({ type: 'object', additionalProperties: false, required: ['enabled', 'applicationServerKey'], properties: {
  enabled: { type: 'boolean' }, applicationServerKey: { type: ['string', 'null'] },
} }, 'Publiczny klucz VAPID do subskrypcji Web Push. Klucz prywatny nigdy nie jest zwracany.', {
  disabled: { summary: 'Web Push nie jest skonfigurowany', value: { enabled: false, applicationServerKey: null } },
});
const pushStatusResponse = (status: 'subscribed' | 'removed') => documented({ type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: [status] } } },
  'Wynik zmiany subskrypcji Web Push.', { result: { summary: status === 'subscribed' ? 'Subskrypcja zapisana' : 'Subskrypcja usunięta', value: { status } } });
const pushSubscriptionBody = withExamples({ type: 'object', additionalProperties: false, required: ['endpoint', 'keys'], properties: {
  endpoint: { type: 'string', format: 'uri', maxLength: 2048 }, keys: { type: 'object', additionalProperties: false, required: ['p256dh', 'auth'], properties: {
    p256dh: { type: 'string', minLength: 16, maxLength: 256 }, auth: { type: 'string', minLength: 8, maxLength: 256 },
  } }, expirationTime: { type: ['number', 'null'], minimum: 0 },
} }, { synthetic: { summary: 'Synthetic browser subscription', description: 'A reserved synthetic token on an allowed provider hostname; it is not a real subscription.', value: { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-reserved-endpoint', keys: { p256dh: 'synthetic-public-key-000000000000', auth: 'synthetic-auth-key-0000' }, expirationTime: null } } });
const pushUnsubscribeBody = withExamples({ type: 'object', additionalProperties: false, required: ['endpoint'], properties: { endpoint: { type: 'string', format: 'uri', maxLength: 2048 } } }, {
  synthetic: { summary: 'Synthetic endpoint', value: { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-reserved-endpoint' } },
});
const trustedPushHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com', 'wns.windows.com'];
const isTrustedPushEndpoint = (endpoint: URL) => endpoint.protocol === 'https:' && trustedPushHosts.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith(`.${host}`));
const errorResponse = { type: 'object', description: 'Notification repository or scope error.', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true,
  'x-examples': { error: { summary: 'Błąd powiadomień', description: 'Kod błędu zależy od operacji.', value: { error: 'notification_store_unavailable' } } } } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 100 } } } as const;

export async function notificationRoutes(app: FastifyInstance, options: { repository?: PostgresNotificationRepository; scope: ScopeResolver }) {
  const repository = options.repository;
  app.get('/notifications/push-config', { schema: { tags: ['Notifications'], summary: 'Read Web Push configuration', description: 'Returns the public application server key when Web Push is configured. The private key is never exposed.', operationId: 'getWebPushConfig', response: { 200: pushConfigResponse } } }, async () => ({
    enabled: config.webPush.enabled, applicationServerKey: config.webPush.enabled ? config.webPush.publicKey : null,
  }));
  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string }; expirationTime?: number | null } }>('/notifications/subscriptions', { schema: {
    tags: ['Notifications'], summary: 'Register a browser push subscription', description: 'Stores the encrypted-delivery endpoint and keys within the current user/calendar scope. Endpoint values are never logged or returned.', operationId: 'registerWebPushSubscription', body: pushSubscriptionBody,
    response: { 201: pushStatusResponse('subscribed'), 400: errorResponse, 503: errorResponse },
  } }, async (request, reply) => {
    if (!config.webPush.enabled) return reply.code(503).send({ error: 'web_push_not_configured' });
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    let endpoint: URL;
    try { endpoint = new URL(request.body.endpoint); } catch { return reply.code(400).send({ error: 'invalid_push_endpoint' }); }
    if (!isTrustedPushEndpoint(endpoint)) return reply.code(400).send({ error: 'invalid_push_endpoint' });
    try {
      await repository.savePushSubscription(options.scope(request), { endpoint: endpoint.toString(), p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth, expirationTime: request.body.expirationTime });
      return reply.code(201).send({ status: 'subscribed' });
    } catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Web Push subscription save failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });
  app.delete<{ Body: { endpoint: string } }>('/notifications/subscriptions', { schema: {
    tags: ['Notifications'], summary: 'Remove a browser push subscription', description: 'Deletes only the endpoint owned by the current user/calendar scope. Repeated removal is safe.', operationId: 'deleteWebPushSubscription', body: pushUnsubscribeBody,
    response: { 200: pushStatusResponse('removed'), 503: errorResponse },
  } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    let endpoint: URL;
    try { endpoint = new URL(request.body.endpoint); } catch { return reply.code(400).send({ error: 'invalid_push_endpoint' }); }
    if (endpoint.protocol !== 'https:') return reply.code(400).send({ error: 'invalid_push_endpoint' });
    await repository.deletePushSubscription(options.scope(request), endpoint.toString());
    return { status: 'removed' };
  });
  app.get('/notifications/settings', { schema: { tags: ['Notifications'], summary: 'Read notification preferences', description: 'Returns in-app reminder and quiet-hours preferences for the current server-resolved scope.', operationId: 'getNotificationSettings', response: { 200: settingsResponse, 503: errorResponse } } }, async (_request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return await repository.getSettings(options.scope(_request)); }
    catch (error) { app.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification settings read failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.put<{ Body: { enabled: boolean; workRemindersEnabled: boolean; minutesBefore: number } }>('/notifications/settings', { schema: {
    tags: ['Notifications'], summary: 'Update notification preferences', description: 'Enables or disables reminder scheduling and selects a bounded lead time.', operationId: 'updateNotificationSettings',
    body: withExamples({ type: 'object', required: ['enabled', 'workRemindersEnabled', 'minutesBefore'], additionalProperties: false, properties: {
      enabled: { type: 'boolean' }, workRemindersEnabled: { type: 'boolean' }, minutesBefore: { type: 'integer', minimum: 1, maximum: 1440 },
    } }, { preferences: { summary: 'Reminder preferences', description: 'Synthetic settings; no real user data.', value: { enabled: true, workRemindersEnabled: true, minutesBefore: 30 } } }), response: { 200: settingsResponse, 400: errorResponse, 503: errorResponse },
  } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try {
      await repository.updateSettings(options.scope(request), request.body);
      return await repository.getSettings(options.scope(request));
    } catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification settings update failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.get('/notifications/due', { schema: { tags: ['Notifications'], summary: 'Claim due in-app notifications', description: 'Claims due reminders for two minutes; the client must acknowledge each one only after displaying it. Unacknowledged claims are retried.', operationId: 'claimDueNotifications', querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } }, response: { 200: dueResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return { notifications: await repository.listDue(options.scope(request), Number((request.query as { limit?: number }).limit ?? 20)) }; }
    catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification queue read failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/ack', { schema: { tags: ['Notifications'], summary: 'Acknowledge an in-app reminder', description: 'Marks a due notification as delivered after the active client successfully creates the browser notification; this is not a read receipt.', operationId: 'acknowledgeNotification', params: idParams, response: { 200: ackResponse, 404: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return await repository.acknowledge(options.scope(request), request.params.id) ? { status: 'delivered' } : reply.code(404).send({ error: 'notification_not_found' }); }
    catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification ack failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });
}
