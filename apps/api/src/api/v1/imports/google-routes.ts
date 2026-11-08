// API jednorazowego importu z Google Calendar (S23KC2S1P2-27).
//
// Przebieg (zgodnie ze scenariuszem):
//  1–3. POST /api/v1/import/google/connections – początek połączenia. Tryb „google”: adres strony zgody Google;
//       po zgodzie Google przekierowuje na GET /api/v1/import/google/callback. Tryb „demo” (bez konfiguracji OAuth):
//       zgoda na przykładowym koncie – POST /api/v1/import/google/connections/:id/consent.
//       3a: odmowa dostępu → status „denied”, import niemożliwy.
//  4.   GET /api/v1/import/google/connections/:id/calendars – lista kalendarzy.
//  5–6. POST /api/v1/import/google/connections/:id/read – kalendarz + zakres dat → podgląd (sesja importu).
//       6a: brak wydarzeń w zakresie → 422 „no-events”, połączenie zostaje, można zmienić zakres.
//  7–8. Zatwierdzenie i anulowanie – wspólne endpointy sesji importu (/api/v1/import/sessions/:id/confirm|cancel).
// Token Google nie opuszcza serwera i jest zapominany po odczycie wydarzeń (import jednorazowy).

import type { FastifyInstance } from 'fastify';
import type { CalendarRepository } from '../../contracts.js';
import { importCollisions } from '../../../import/collisions-preview.js';
import { buildImportPreview } from '../../../import/preview.js';
import { DEFAULT_TIME_ZONE, toInstant, type ImportCategory } from '../../../import/rules.js';
import { GoogleConnections } from '../../../import/google/connections.js';
import { DEMO_GOOGLE_ACCOUNT, DemoGoogleCalendar } from '../../../import/google/demo.js';
import { googleEventsToRows } from '../../../import/google/mapping.js';
import { authorizationUrl, createPkce, exchangeCode, GoogleCalendarApi, type FetchLike, type GoogleOAuthConfig } from '../../../import/google/oauth.js';
import { GoogleApiError, type GoogleCalendarSource } from '../../../import/google/types.js';

export type GoogleImportOptions = {
  /** Konfiguracja klienta OAuth. Bez niej działa konto demonstracyjne. */
  oauth?: GoogleOAuthConfig | null;
  fetch?: FetchLike;
  connections?: GoogleConnections;
};

const MAX_RANGE_DAYS = 366;
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } } as const;
const datePattern = '^\\d{4}-\\d{2}-\\d{2}$';
const objectResponse = { type: 'object', additionalProperties: true } as const;
const errorResponse = { type: 'object', required: ['error'], properties: { error: { type: 'string' }, details: { type: 'object', additionalProperties: true } }, additionalProperties: true } as const;

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const page = (title: string, message: string) => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0B111B;color:#F2F5FC;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:420px;text-align:center}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Możesz zamknąć tę kartę i wrócić do aplikacji KAC.</p></main><script>setTimeout(()=>window.close(),1500)</script></body></html>`;

export function registerGoogleImport(app: FastifyInstance, repository: CalendarRepository | null, options: GoogleImportOptions = {}) {
  const connections = options.connections ?? new GoogleConnections();
  const oauth = options.oauth ?? null;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const source: GoogleCalendarSource = oauth ? new GoogleCalendarApi(fetchImpl) : new DemoGoogleCalendar();

  const userZone = async () => {
    const overview = await repository?.getOverview().catch(() => null);
    return { overview, zone: overview?.user.timezone ?? DEFAULT_TIME_ZONE };
  };

  const googleError = (error: unknown) => {
    if (error instanceof GoogleApiError) return { status: error.code === 'google-unavailable' ? 502 : error.code === 'calendar-not-found' ? 404 : 401, code: error.code };
    return { status: 502, code: 'google-unavailable' };
  };

  // 1–2: początek połączenia z kontem Google.
  app.post('/import/google/connections', { schema: { tags: ['Google import'], summary: 'Start one-time Google import', description: 'Starts OAuth PKCE or the local demo consent flow. No Google events are written until import-session confirmation.', operationId: 'startGoogleImport', response: { 201: objectResponse, 503: errorResponse } } }, async (_request, reply) => {
    if (oauth) {
      const pkce = createPkce();
      const connection = connections.create('google', pkce.verifier);
      return reply.code(201).send({ connectionId: connection.id, mode: 'google', authUrl: authorizationUrl(oauth, connection.id, pkce.challenge) });
    }
    const connection = connections.create('demo', null);
    return reply.code(201).send({ connectionId: connection.id, mode: 'demo', demoAccount: DEMO_GOOGLE_ACCOUNT });
  });

  // 3 (tryb demo): użytkownik zezwala na odczyt wydarzeń albo odmawia (3a).
  app.post<{ Params: { id: string }; Body: { allow: boolean } }>('/import/google/connections/:id/consent', {
    schema: { tags: ['Google import'], summary: 'Record demo consent decision', description: 'Records the demo consent decision. The OAuth flow records its decision at the callback endpoint.', operationId: 'consentToGoogleImport', params: idParams, body: { type: 'object', required: ['allow'], additionalProperties: false, properties: { allow: { type: 'boolean' } } }, response: { 200: objectResponse, 404: errorResponse, 409: errorResponse } },
  }, async (request, reply) => {
    const connection = connections.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    if (connection.mode !== 'demo') return reply.code(409).send({ error: 'use-google-consent' });
    if (connection.status !== 'pending') return reply.code(409).send({ error: 'consent-already-given' });
    const updated = connections.update(connection.id, request.body.allow
      ? { status: 'connected', email: DEMO_GOOGLE_ACCOUNT, accessToken: 'demo' }
      : { status: 'denied' });
    return { status: updated!.status, email: updated!.email };
  });

  // 3 (tryb google): powrót ze strony zgody Google.
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/import/google/callback', { schema: { tags: ['Google import'], summary: 'Complete Google OAuth callback', description: 'Google redirects here after consent. The endpoint completes PKCE exchange and renders a short status page.', operationId: 'googleOAuthCallback', querystring: { type: 'object', properties: { state: { type: 'string' }, code: { type: 'string' }, error: { type: 'string' } } }, response: { 200: { type: 'string' }, 400: { type: 'string' }, 502: { type: 'string' } } } }, async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    const { state, code, error } = request.query;
    const connection = state ? connections.get(state) : null;
    if (!connection || connection.mode !== 'google' || connection.status !== 'pending') {
      return reply.code(400).send(page('Połączenie wygasło', 'Rozpocznij import z Google Calendar ponownie w aplikacji.'));
    }
    if (error || !code) {
      connections.update(connection.id, { status: 'denied', codeVerifier: null });
      return reply.send(page('Brak zgody', 'Bez zgody na odczyt wydarzeń import z Google Calendar nie jest możliwy.'));
    }
    try {
      const token = await exchangeCode(oauth!, code, connection.codeVerifier ?? '', fetchImpl);
      connections.update(connection.id, { status: 'connected', accessToken: token.accessToken, email: token.email, codeVerifier: null });
      return reply.send(page('Połączono z Google', `Konto ${token.email ?? ''} jest połączone na czas importu.`));
    } catch (err) {
      request.log.warn({ err }, 'Google token exchange failed');
      connections.update(connection.id, { status: 'error', codeVerifier: null });
      return reply.code(502).send(page('Nie udało się połączyć', 'Google nie potwierdził połączenia. Spróbuj ponownie w aplikacji.'));
    }
  });

  // Stan połączenia – aplikacja sprawdza go, czekając na zgodę w Google.
  app.get<{ Params: { id: string } }>('/import/google/connections/:id', { schema: { tags: ['Google import'], summary: 'Get Google connection status', operationId: 'getGoogleConnection', params: idParams, response: { 200: objectResponse, 404: errorResponse } } }, async (request, reply) => {
    const connection = connections.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    return { status: connection.status, email: connection.email, mode: connection.mode };
  });

  // 4: lista kalendarzy połączonego konta.
  app.get<{ Params: { id: string } }>('/import/google/connections/:id/calendars', { schema: { tags: ['Google import'], summary: 'List Google calendars', operationId: 'listGoogleCalendars', params: idParams, response: { 200: objectResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 502: errorResponse } } }, async (request, reply) => {
    const connection = connections.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    if (connection.status === 'denied') return reply.code(403).send({ error: 'access-denied' });
    if (connection.status !== 'connected' || !connection.accessToken) return reply.code(409).send({ error: 'not-connected' });
    try {
      return { email: connection.email, calendars: await source.listCalendars(connection.accessToken) };
    } catch (error) {
      const failure = googleError(error);
      request.log.warn({ err: error }, 'Google calendars not read');
      return reply.code(failure.status).send({ error: failure.code });
    }
  });

  // 5–6: wybrany kalendarz i zakres dat → podgląd wydarzeń (sesja importu, kalendarz bez zmian).
  app.post<{ Params: { id: string }; Body: { calendarId: string; from: string; to: string; category?: ImportCategory } }>('/import/google/connections/:id/read', {
    schema: {
      tags: ['Google import'], summary: 'Read events from a Google calendar', description: 'Reads a bounded date range and opens a review session; import confirmation uses the shared imports endpoint.', operationId: 'readGoogleCalendar',
      params: idParams,
      body: { type: 'object', required: ['calendarId', 'from', 'to'], additionalProperties: false, properties: {
        calendarId: { type: 'string', minLength: 1, maxLength: 300 },
        from: { type: 'string', pattern: datePattern }, to: { type: 'string', pattern: datePattern },
        category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
      } },
      response: { 201: objectResponse, 401: errorResponse, 403: errorResponse, 404: errorResponse, 409: errorResponse, 422: errorResponse, 503: errorResponse },
    },
  }, async (request, reply) => {
    if (!repository?.createImportSession || !repository.listEventsForImport) return reply.code(503).send({ error: 'database_not_configured' });
    const connection = connections.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    if (connection.status === 'denied') return reply.code(403).send({ error: 'access-denied' });
    if (connection.status !== 'connected' || !connection.accessToken) return reply.code(409).send({ error: connection.status === 'used' ? 'connection-used' : 'not-connected' });

    const { overview, zone } = await userZone();
    const { calendarId, from, to } = request.body;
    const start = toInstant(from, '00:00', zone);
    const endDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const end = toInstant(endDay, '00:00', zone);
    if (!start || !end || end <= start || end.getTime() - start.getTime() > (MAX_RANGE_DAYS + 1) * 86_400_000) {
      return reply.code(422).send({ error: 'invalid-range' });
    }

    let events;
    try {
      events = await source.listEvents(connection.accessToken, calendarId, start, end);
    } catch (error) {
      const failure = googleError(error);
      request.log.warn({ err: error }, 'Google events not read');
      return reply.code(failure.status).send({ error: failure.code });
    }
    const { rows, skippedAllDay } = googleEventsToRows(events, zone, request.body.category ?? 'Personal');
    // 6a: brak wydarzeń w zakresie – połączenie zostaje, użytkownik może zmienić zakres lub kalendarz.
    if (rows.length === 0) return reply.code(422).send({ error: 'no-events', skippedAllDay });

    try {
      const calendars = await source.listCalendars(connection.accessToken).catch(() => []);
      const preview = buildImportPreview(rows, await repository.listEventsForImport());
      const session = await repository.createImportSession({ source: 'google', format: 'Google', rows, preview });
      // Jednorazowość: wydarzenia są już w sesji importu, token Google nie jest dalej potrzebny.
      connections.markUsed(connection.id);
      return reply.code(201).send({
        importSessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
        email: connection.email,
        calendarName: calendars.find((calendar) => calendar.id === calendarId)?.name ?? calendarId,
        from, to, rows, preview, skippedAllDay,
        collisions: importCollisions(rows, overview?.events ?? [], zone),
      });
    } catch (error) {
      request.log.error({ err: error }, 'Google import could not create preview');
      return reply.code(503).send({ error: 'database_unavailable' });
    }
  });

  // Rezygnacja z połączenia (np. zamknięcie okna importu) – token jest od razu zapominany.
  app.delete<{ Params: { id: string } }>('/import/google/connections/:id', { schema: { tags: ['Google import'], summary: 'Forget Google connection', description: 'Forgets the one-time connection and drops the in-memory access token.', operationId: 'forgetGoogleConnection', params: idParams, response: { 204: { type: 'null' } } } }, async (request, reply) => {
    connections.delete(request.params.id);
    return reply.code(204).send();
  });
}
