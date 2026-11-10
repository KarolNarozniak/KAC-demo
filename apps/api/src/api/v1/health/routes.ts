import type { FastifyInstance } from 'fastify';
import type { CalendarRepository } from '../../contracts.js';

export async function healthRoutes(app: FastifyInstance, options: { repository: CalendarRepository | null }) {
  app.get('/health/live', { schema: { tags: ['System'], summary: 'Liveness probe', description: 'Confirms that the API process is accepting requests.', operationId: 'healthLive', response: { 200: { type: 'object', required: ['api'], properties: { api: { type: 'string', const: 'ok' } } } } } }, async () => ({ api: 'ok' }));
  app.get('/health/ready', { schema: { tags: ['System'], summary: 'Readiness probe', description: 'Checks API startup and PostgreSQL connectivity.', operationId: 'healthReady', response: { 200: { type: 'object', additionalProperties: true }, 503: { type: 'object', additionalProperties: true } } } }, async (request, reply) => {
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
