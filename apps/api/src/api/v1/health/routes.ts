import type { FastifyInstance } from 'fastify';
import type { CalendarRepository } from '../../contracts.js';
import { documented } from '../../examples.js';
import { notReadyExamples, readyExamples } from '../calendar/examples.js';

export async function healthRoutes(app: FastifyInstance, options: { repository: CalendarRepository | null }) {
  app.get('/health/live', { schema: { tags: ['System'], summary: 'Liveness probe', description: 'Confirms that the API process is accepting requests.', operationId: 'healthLive', response: { 200: documented({ type: 'object', required: ['api'], properties: { api: { type: 'string', const: 'ok' } } }, 'Proces API odpowiada.', { ok: { summary: 'API działa', value: { api: 'ok' } } }) } } }, async () => ({ api: 'ok' }));
  app.get('/health/ready', { schema: { tags: ['System'], summary: 'Readiness probe', description: 'Checks API startup and PostgreSQL connectivity.', operationId: 'healthReady', response: { 200: documented({ type: 'object', additionalProperties: true }, 'API i PostgreSQL są gotowe.', readyExamples), 503: documented({ type: 'object', additionalProperties: true }, 'Baza nieskonfigurowana albo niedostępna.', notReadyExamples) } } }, async (request, reply) => {
    if (!options.repository) return reply.code(503).send({ api: 'ok', database: 'not-configured' });
    try {
      await options.repository.checkConnection();
      return { api: 'ok', database: 'connected' };
    } catch (error) {
      request.log.error({ err: error }, 'PostgreSQL readiness check failed');
      return reply.code(503).send({ api: 'ok', database: 'unavailable' });
    }
  });
}
