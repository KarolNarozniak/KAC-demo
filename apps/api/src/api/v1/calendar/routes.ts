import type { FastifyInstance } from 'fastify';
import { CollisionError, EventNotFoundError, EventValidationError } from '../../../collisions.js';
import type { EventInput } from '../../../database.js';
import type { CalendarRepository } from '../../contracts.js';
import type { ScopeResolver } from '../../scope.js';
import { documented, errorExamples, withExamples } from '../../examples.js';
import { collisionCheckExamples, collisionCheckInputExamples, collisionExamples, deletedEventExamples, eventInputExamples, overviewExamples, savedEventExamples } from './examples.js';

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
const instant = { type: 'string', format: 'date-time' } as const;
/** S23KC2S1P2-302 (N10): pełny opis jednej kolizji – nazwa, kategoria, termin wydarzenia i część wspólna. */
const collisionSchema = { type: 'object', title: 'EventCollision', additionalProperties: false,
  description: 'Istniejące wydarzenie, z którym koliduje szkic. start/end i overlapStart/overlapEnd (UTC) dotyczą pierwszego kolidującego wystąpienia. Stykające się granice (koniec jednego = początek drugiego) nie są kolizją.',
  required: ['id', 'title', 'category', 'start', 'end', 'overlapStart', 'overlapEnd', 'mandatory', 'repeatWeekly', 'recurring'],
  properties: {
    id: { type: 'string' }, title: { type: 'string' },
    category: { type: 'string', description: 'Kategoria istniejącego wydarzenia: Class/Work/Personal albo jej polska nazwa z bazy (Zajęcia/Praca/Prywatne).' },
    start: instant, end: instant,
    overlapStart: { ...instant, description: 'Początek części wspólnej.' }, overlapEnd: { ...instant, description: 'Koniec części wspólnej.' },
    mandatory: { type: 'boolean', description: 'Istniejące wydarzenie to zajęcia obowiązkowe.' },
    repeatWeekly: { type: 'boolean', description: 'Istniejące wydarzenie należy do serii cotygodniowej.' },
    recurring: { type: 'boolean', description: 'Szkic i wydarzenie są seriami cotygodniowymi – ta sama kolizja powtarza się co tydzień.' },
  },
} as const;
const collisionResponse = { type: 'object', title: 'EventCollisionError', required: ['error', 'conflicts', 'collisionToken'], additionalProperties: false,
  properties: { error: { type: 'string', enum: ['event_collision'] }, conflicts: { type: 'array', minItems: 1, items: collisionSchema },
    collisionToken: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Potwierdzenie świadomego zapisu; ważne tylko dla tych samych danych i tej samej listy kolizji.' } },
} as const;
const collisionCheckResponse = { type: 'object', title: 'EventCollisionCheck', required: ['conflicts', 'collisionToken'], additionalProperties: false,
  properties: { conflicts: { type: 'array', items: collisionSchema },
    collisionToken: { anyOf: [{ type: 'string', pattern: '^[a-f0-9]{64}$' }, { type: 'null' }], description: 'null, gdy kolizji nie ma; w przeciwnym razie token do świadomego zapisu.' } },
} as const;
const collisionCheckBody = { ...eventBody, properties: { ...eventBody.properties,
  eventId: { type: 'string', minLength: 1, maxLength: 200, description: 'Identyfikator edytowanego wydarzenia – pomijany przy porównaniu, tak jak przy PUT.' } } } as const;
const eventIdParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 200 } } } as const;
const objectResponse = { type: 'object', description: 'Calendar operation result.', additionalProperties: true,
  'x-examples': { success: { summary: 'Wynik operacji kalendarza', description: 'Syntetyczny kształt bazowy; szczegóły zależą od operacji.', value: { status: 'ok' } } } } as const;
const unavailable = (codes: Record<string, string>) => errorExamples('Baza danych niedostępna albo nieskonfigurowana.', codes);
const savedEvent = documented(objectResponse, 'Zapisane wydarzenie z identyfikatorem.', savedEventExamples);
const invalidEvent = documented(objectResponse, 'Niepoprawne dane wydarzenia – błąd schematu albo walidacji dat.', {
  invalid_event: { summary: 'Błędny termin', description: 'Koniec wydarzenia nie jest później niż początek, data nie istnieje (np. 30 lutego) albo tytuł jest pusty. Nic nie zostało zapisane.', value: { error: 'invalid_event' } },
  validation: { summary: 'Brakujące albo złe pole', description: 'Żądanie odrzucone przed sprawdzeniem terminu: brakuje wymaganego pola albo ma złą wartość. message wskazuje pole – tu category musi być jedną z: Class, Work, Personal.', value: { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message: 'body/category must be equal to one of the allowed values' } },
});

export async function calendarRoutes(app: FastifyInstance, options: { repository: CalendarRepository | null; scope: ScopeResolver }) {
  const repository = options.repository;
  app.get('/calendar/overview', { schema: { tags: ['Calendar'], summary: 'Get calendar overview', description: 'Returns the active calendar, profile timezone, categories and events for the server-resolved UserScope.', operationId: 'getCalendarOverview', response: { 200: documented(objectResponse, 'Aktywny kalendarz użytkownika.', overviewExamples), 404: errorExamples('Kalendarz nie istnieje.', { calendar_not_found: 'Brak kalendarza' }), 503: unavailable({ database_unavailable: 'Baza niedostępna', database_not_configured: 'Brak DATABASE_URL' }) } } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const owner = options.scope(request);
      const overview = await repository.getOverview(owner.userId, owner.calendarId);
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
        body: withExamples(eventBody, eventInputExamples),
        ...(isCreate ? {} : { params: eventIdParams }),
        response: {
          ...(isCreate ? { 201: savedEvent } : { 200: savedEvent, 404: errorExamples('Wydarzenie nie istnieje.', { event_not_found: 'Brak wydarzenia' }) }),
          400: invalidEvent, 409: documented(collisionResponse, 'Kolizja z innymi wydarzeniami – pełna lista kolidujących pozycji.', collisionExamples),
          503: unavailable({ event_not_saved: 'Zapis nie powiódł się', database_not_configured: 'Brak DATABASE_URL' }),
        },
      },
      handler: async (request, reply) => {
        const owner = options.scope(request);
        const input = request.body;
        const validDate = (value: string) => {
          const parsed = new Date(value + ':00Z');
          return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 16) === value;
        };
        if (!input.title.trim() || !validDate(input.start) || !validDate(input.end) || input.end <= input.start)
          return reply.code(400).send({ error: 'invalid_event' });
        if (!repository?.createEvent || (!isCreate && !repository.updateEvent)) return reply.code(503).send({ error: 'database_not_configured' });
        try {
          const saved = isCreate ? await repository.createEvent(input, owner.userId, owner.calendarId) : await repository.updateEvent!(request.params.id!, input, owner.userId, owner.calendarId);
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

  // S23KC2S1P2-302 (N10): ponowne sprawdzenie kolizji po korekcie – bez zapisu, te same reguły i token co przy zapisie.
  app.post<{ Body: EventInput & { eventId?: string } }>('/calendar/events/collision-check', { schema: {
    tags: ['Calendar'], summary: 'Check event collisions without saving',
    description: 'Re-checks a draft (for example after the user corrected the time) against all active events in the calendar and returns the complete list of collisions. Nothing is saved. The returned collisionToken is accepted by POST/PUT as long as neither the draft nor the list of collisions changes.',
    operationId: 'checkCalendarEventCollisions', body: withExamples(collisionCheckBody, collisionCheckInputExamples),
    response: { 200: documented(collisionCheckResponse, 'Wynik sprawdzenia – lista kolizji (może być pusta).', collisionCheckExamples), 400: invalidEvent,
      404: errorExamples('Edytowane wydarzenie albo kalendarz nie istnieje.', { event_not_found: 'Brak wydarzenia', calendar_not_found: 'Brak kalendarza' }),
      503: unavailable({ collision_check_failed: 'Sprawdzenie nie powiodło się', database_not_configured: 'Brak DATABASE_URL' }) },
  } }, async (request, reply) => {
    if (!repository?.checkCollisions) return reply.code(503).send({ error: 'database_not_configured' });
    const { eventId, ...input } = request.body;
    if (!input.title.trim() || input.end <= input.start) return reply.code(400).send({ error: 'invalid_event' });
    try {
      const owner = options.scope(request);
      return await repository.checkCollisions(input, eventId, owner.userId, owner.calendarId);
    } catch (error) {
      if (error instanceof EventValidationError) return reply.code(400).send({ error: error.message });
      if (error instanceof EventNotFoundError) return reply.code(404).send({ error: error.message });
      request.log.error({ err: error }, 'Collision check failed');
      return reply.code(503).send({ error: 'collision_check_failed' });
    }
  });

  app.delete<{ Params: { id: string } }>('/calendar/events/:id', { schema: {
    tags: ['Calendar'], summary: 'Delete calendar event', description: 'Deletes a one-off event or an entire weekly series after confirmation by the client.',
    operationId: 'deleteCalendarEvent', params: eventIdParams, response: { 200: documented(objectResponse, 'Identyfikatory usuniętych wydarzeń.', deletedEventExamples), 404: errorExamples('Wydarzenie nie istnieje.', { event_not_found: 'Brak wydarzenia' }), 503: unavailable({ event_not_deleted: 'Usunięcie nie powiodło się', database_not_configured: 'Brak DATABASE_URL' }) },
  } }, async (request, reply) => {
    if (!repository?.deleteEvent) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const owner = options.scope(request);
      const deletedIds = await repository.deleteEvent(request.params.id, owner.userId, owner.calendarId);
      if (!deletedIds) return reply.code(404).send({ error: 'event_not_found' });
      return { deletedIds };
    } catch (error) {
      request.log.error({ err: error }, 'Event deletion failed');
      return reply.code(503).send({ error: 'event_not_deleted' });
    }
  });
}
