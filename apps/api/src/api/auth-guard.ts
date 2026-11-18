// Ochrona API logowaniem. Wszystkie trasy /api/v1 wymagają sesji (Authorization: Bearer), z wyjątkiem jawnej listy publicznych:
// zdrowie usługi, dokumentacja, rejestracja, logowanie i reset zapomnianego hasła kodem odzyskiwania oraz powroty ze stron zgody Google
// (przeglądarka wraca tam bez nagłówka – właściciela próby wskazuje jednorazowy, losowy `state`). Nowa trasa jest więc domyślnie chroniona.
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { AuthService, AuthSession } from '../auth/service.js';
import { errorExamples } from './examples.js';
import type { ScopeResolver } from './scope.js';

declare module 'fastify' {
  interface FastifyRequest { authSession: AuthSession | null }
}

export const API_PREFIX = '/api/v1';
const PUBLIC_ROUTES = new Set([
  'GET /api/v1/health/live', 'GET /api/v1/health/ready', 'GET /api/v1/openapi.json',
  'GET /api/v1/auth/config', 'POST /api/v1/auth/register', 'POST /api/v1/auth/login', 'POST /api/v1/auth/recover',
  'GET /api/v1/integrations/google/callback', 'GET /api/v1/import/google/callback',
]);

export function isPublicRoute(method: string, url: string): boolean {
  if (!url.startsWith(API_PREFIX) || url.startsWith(`${API_PREFIX}/docs`)) return true;
  return PUBLIC_ROUTES.has(`${method === 'HEAD' ? 'GET' : method} ${url}`);
}

export const unauthorizedResponse = errorExamples('Brak ważnej sesji – trzeba się zalogować.', {
  unauthorized: ['Brak logowania albo sesja wygasła',
    'Żądanie nie ma nagłówka Authorization: Bearer albo sesja wygasła (30 dni bez użycia, 90 dni od zalogowania) lub została unieważniona – wylogowanie, zmiana hasła, usunięcie konta. Trzeba zalogować się ponownie.'],
});

/**
 * Kontrakt OpenAPI: schemat bearerAuth jest globalny, trasy publiczne mają `security: []`, a każda chroniona dokumentuje 401.
 * Działa zawsze (także bez bazy), żeby wyeksportowany kontrakt opisywał API produkcyjne.
 */
export function documentAuth(app: FastifyInstance) {
  app.addHook('onRoute', (route: RouteOptions) => {
    if (!route.schema || route.schema.hide) return;
    const methods = [route.method].flat().map(String);
    if (methods.every((method) => isPublicRoute(method, route.url))) {
      route.schema = { ...route.schema, security: [] };
      return;
    }
    const response = (route.schema.response ?? {}) as Record<string, unknown>;
    if (!response['401']) route.schema = { ...route.schema, response: { ...response, 401: unauthorizedResponse } };
  });
}

/** Sprawdzanie sesji dla każdej chronionej trasy. Zwraca resolver zakresu użytkownika czytający sesję żądania. */
export function enforceAuth(app: FastifyInstance, auth: AuthService): ScopeResolver {
  app.decorateRequest('authSession', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url;
    if (request.method === 'OPTIONS' || !url || isPublicRoute(request.method, url)) return;
    const header = request.headers.authorization ?? '';
    const token = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
    let session: AuthSession | null = null;
    try {
      session = token ? await auth.authenticate(token) : null;
    } catch (error) {
      request.log.error({ err: error }, 'Session check failed');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    request.authSession = session;
  });
  return (request) => {
    // Trasa chroniona zawsze ma sesję (hak powyżej). Brak sesji tutaj to błąd w kodzie trasy publicznej – nie zgadujemy użytkownika.
    if (!request.authSession) throw new Error('Route without a session tried to read the user scope');
    return request.authSession.scope;
  };
}
