import type { FastifyInstance } from 'fastify';
import type { ScopeResolver } from '../../scope.js';
import type { PostgresNotificationRepository } from '../../../notifications/repository.js';
import { withExamples } from '../../examples.js';

const objectResponse = { type: 'object', description: 'Notification settings or queue result.', additionalProperties: true,
  'x-examples': { success: { summary: 'Powodzenie', description: 'Syntetyczny kształt bazowy odpowiedzi; pola zależą od operacji.', value: { status: 'ok' } } } } as const;
const errorResponse = { type: 'object', description: 'Notification repository or scope error.', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: true,
  'x-examples': { error: { summary: 'Błąd powiadomień', description: 'Kod błędu zależy od operacji.', value: { error: 'notification_request_failed' } } } } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 100 } } } as const;

export async function notificationRoutes(app: FastifyInstance, options: { repository?: PostgresNotificationRepository; scope: ScopeResolver }) {
  const repository = options.repository;
  app.get('/notifications/settings', { schema: { tags: ['Notifications'], summary: 'Read notification preferences', description: 'Returns in-app reminder and quiet-hours preferences for the current server-resolved scope.', operationId: 'getNotificationSettings', response: { 200: objectResponse, 503: errorResponse } } }, async (_request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return await repository.getSettings(options.scope(_request)); }
    catch (error) { app.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification settings read failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.put<{ Body: { enabled: boolean; workRemindersEnabled: boolean; minutesBefore: number } }>('/notifications/settings', { schema: {
    tags: ['Notifications'], summary: 'Update notification preferences', description: 'Enables or disables reminder scheduling and selects a bounded lead time.', operationId: 'updateNotificationSettings',
    body: withExamples({ type: 'object', required: ['enabled', 'workRemindersEnabled', 'minutesBefore'], additionalProperties: false, properties: {
      enabled: { type: 'boolean' }, workRemindersEnabled: { type: 'boolean' }, minutesBefore: { type: 'integer', minimum: 0, maximum: 1440 },
    } }, { preferences: { summary: 'Reminder preferences', description: 'Synthetic settings; no real user data.', value: { enabled: true, workRemindersEnabled: false, minutesBefore: 15 } } }), response: { 200: objectResponse, 400: errorResponse, 503: errorResponse },
  } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try {
      await repository.updateSettings(options.scope(request), request.body);
      return await repository.getSettings(options.scope(request));
    } catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification settings update failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.get('/notifications/due', { schema: { tags: ['Notifications'], summary: 'Read due in-app notifications', description: 'Returns due reminder queue items for the active calendar, bounded to 100 entries.', operationId: 'listDueNotifications', querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } } }, response: { 200: objectResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return { notifications: await repository.listDue(options.scope(request), Number((request.query as { limit?: number }).limit ?? 20)) }; }
    catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification queue read failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });

  app.post<{ Params: { id: string } }>('/notifications/:id/ack', { schema: { tags: ['Notifications'], summary: 'Acknowledge an in-app reminder', description: 'Marks a due notification as delivered to the active client; this is not a read receipt.', operationId: 'acknowledgeNotification', params: idParams, response: { 200: objectResponse, 404: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'notification_store_not_configured' });
    try { return await repository.acknowledge(options.scope(request), request.params.id) ? { status: 'delivered' } : reply.code(404).send({ error: 'notification_not_found' }); }
    catch (error) { request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Notification ack failed'); return reply.code(503).send({ error: 'notification_store_unavailable' }); }
  });
}
