// Dokumentacja API (S23KC2S1P2-184): specyfikacja OpenAPI generowana ze schematów tras Fastify.
// Swagger UI: /api/docs, specyfikacja JSON: /api/openapi.json.
// Rejestracja musi nastąpić w buildApi() przed trasami – plugin zbiera trasy w momencie ich dodawania.

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export const API_DOCS_PATH = '/api/docs';
export const OPENAPI_JSON_PATH = '/api/openapi.json';

export const tags = {
  health: 'Health',
  calendar: 'Calendar',
  events: 'Events',
  import: 'Import',
  workSchedule: 'Work schedule import',
  google: 'Google import',
} as const;

// Odpowiedzi opisujemy luźno (additionalProperties: true), żeby schemat nie obcinał pól, których nie wymienia.
export const errorResponse = (description: string) => ({
  description,
  type: 'object',
  required: ['error'],
  additionalProperties: true,
  properties: { error: { type: 'string', description: 'Kod błędu, np. database_unavailable' } },
}) as const;

export const okResponse = (description: string) => ({ description, type: 'object', additionalProperties: true }) as const;

export const databaseErrors = {
  503: errorResponse('Baza danych nie jest skonfigurowana lub jest niedostępna'),
} as const;

export function registerApiDocs(app: FastifyInstance) {
  app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'KAC API',
        description: 'API aplikacji KAC – kalendarz studenta, import planu zajęć i grafiku pracy.',
        version: '1.0.0',
      },
      tags: [
        { name: tags.health, description: 'Stan API i połączenia z bazą' },
        { name: tags.calendar, description: 'Kalendarz użytkownika' },
        { name: tags.events, description: 'Tworzenie, edycja i usuwanie wydarzeń z kontrolą kolizji' },
        { name: tags.import, description: 'Import planu zajęć: odczyt pliku, podgląd, sesja importu, zatwierdzenie' },
        { name: tags.workSchedule, description: 'Import grafiku pracy ze zdjęcia lub pliku PDF' },
        { name: tags.google, description: 'Jednorazowy import z Google Calendar' },
      ],
    },
  });

  app.register(swaggerUi, { routePrefix: API_DOCS_PATH });

  app.get(OPENAPI_JSON_PATH, { schema: { hide: true } }, async () => app.swagger());
}
