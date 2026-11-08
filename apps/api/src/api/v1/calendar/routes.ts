import type { FastifyInstance } from 'fastify';
import { CollisionError, EventNotFoundError, EventValidationError } from '../../../collisions.js';
import type { EventInput } from '../../../database.js';
import type { CalendarRepository } from '../../contracts.js';

const eventBody = { type: 'object', additionalProperties: false,
  required: ['title', 'start', 'end', 'category', 'location', 'mandatory', 'repeatWeekly'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
    end: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
    category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
    location: { type: 'string', maxLength: 500 }, mandatory: { type: 'boolean' }, repeatWeekly: { type: 'boolean' },
    collisionToken: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  },
} as const;
const eventIdParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } as const;
const objectResponse = { type: 'object', additionalProperties: true } as const;

export async function calendarRoutes(app: FastifyInstance, options: { repository: CalendarRepository | null }) {
  const repository = options.repository;
  app.get('/calendar/overview', { schema: { tags: ['Calendar'], summary: 'Get calendar overview', description: 'Returns the active calendar, profile timezone, categories and occurrences for the configured development account.', operationId: 'getCalendarOverview', response: { 200: objectResponse, 404: objectResponse, 503: objectResponse } } }, async (_request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const overview = await repository.getOverview();
      if (!overview) return reply.code(404).send({ error: 'calendar_not_found' });
      return overview;
    } catch (error) {
      app.log.error({ err: error }, 'Calendar overview unavailable');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  for (const method of ['POST', 'PUT'] as const) {
    const isCreate = method === 'POST';
    app.route<{ Body: EventInput; Params: { id?: string } }>({
      method,
      url: isCreate ? '/calendar/events' : '/calendar/events/:id',
      schema: {
        tags: ['Calendar'],
        summary: isCreate ? 'Create calendar event' : 'Update calendar event or series',
        description: isCreate
          ? 'Creates an event after server-side validation and collision checking. Weekly events are saved as a series.'
          : 'Updates an event after server-side validation and collision checking. Updating a weekly event edits its series.',
        operationId: isCreate ? 'createCalendarEvent' : 'updateCalendarEvent',
        body: eventBody,
        ...(isCreate ? {} : { params: eventIdParams }),
        response: { 200: objectResponse, 201: objectResponse, 400: objectResponse, 404: objectResponse, 409: objectResponse, 503: objectResponse },
      },
      handler: async (request, reply) => {
        const input = request.body;
        const validDate = (value: string) => {
          const parsed = new Date(value + ':00Z');
          return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
        };
        if (!input.title.trim() || !validDate(input.start) || !validDate(input.end) || input.end <= input.start)
          return reply.code(400).send({ error: 'invalid_event' });
        if (!repository?.createEvent || (!isCreate && !repository.updateEvent)) return reply.code(503).send({ error: 'database_not_configured' });
        try {
          const saved = isCreate ? await repository.createEvent(input) : await repository.updateEvent!(request.params.id!, input);
          return reply.code(isCreate ? 201 : 200).send(saved);
        } catch (error) {
          if (error instanceof CollisionError) return reply.code(409).send({ error: 'event_collision', conflicts: error.conflicts, collisionToken: error.collisionToken });
          if (error instanceof EventValidationError) return reply.code(400).send({ error: error.message });
          if (error instanceof EventNotFoundError) return reply.code(404).send({ error: error.message });
          request.log.error({ err: error }, 'Event not saved');
          return reply.code(503).send({ error: 'event_not_saved' });
        }
      },
    });
  }

  app.delete<{ Params: { id: string } }>('/calendar/events/:id', { schema: {
    tags: ['Calendar'], summary: 'Delete calendar event', description: 'Deletes a one-off event or an entire weekly series after confirmation by the client.',
    operationId: 'deleteCalendarEvent', params: eventIdParams, response: { 200: objectResponse, 404: objectResponse, 503: objectResponse },
  } }, async (request, reply) => {
    if (!repository?.deleteEvent) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const deletedIds = await repository.deleteEvent(request.params.id);
      if (!deletedIds) return reply.code(404).send({ error: 'event_not_found' });
      return { deletedIds };
    } catch (error) {
      request.log.error({ err: error }, 'Event deletion failed');
      return reply.code(503).send({ error: 'event_not_deleted' });
    }
  });
}
