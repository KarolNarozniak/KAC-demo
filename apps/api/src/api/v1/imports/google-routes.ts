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
import { documented, withExamples } from '../../examples.js';
import { googleCalendarsExamples, googleConnectionExamples, googleReadExamples, googleReadInputExamples } from './examples.js';

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
// Wyjaśnienia kodów błędów importu z Google pokazywane w przykładach Swagger UI.
const googleErrors: Record<string, [string, string]> = {
  'connection-not-found': ['Nie ma takiego połączenia', 'Połączenie nie istnieje albo wygasło (połączenia żyją 15 minut). Rozpocznij import z Google od nowa.'],
  'calendar-not-found': ['Nie ma takiego kalendarza', 'Na koncie Google nie ma kalendarza o podanym id – wybierz kalendarz z listy (GET .../calendars).'],
  'consent-already-given': ['Decyzja już zapisana', 'Użytkownik już się zgodził albo odmówił – drugi raz nie można. Przy odmowie trzeba rozpocząć nowe połączenie.'],
  'use-google-consent': ['Zgodę daje się na stronie Google', 'To połączenie z prawdziwym kontem Google – zgody nie zapisuje się tym endpointem, tylko na stronie logowania Google (authUrl).'],
  'access-denied': ['Użytkownik odmówił dostępu', 'Bez zgody nie można odczytać kalendarza. Żeby spróbować ponownie, rozpocznij nowe połączenie.'],
  'not-connected': ['Konto nie jest jeszcze połączone', 'Użytkownik jeszcze nie dał zgody (status pending). Poczekaj na zgodę i spróbuj ponownie.'],
  'connection-used': ['Import już wykonany', 'Import z Google jest jednorazowy: to połączenie już posłużyło do odczytu, a token został zapomniany. Żeby zaimportować jeszcze raz, rozpocznij nowe połączenie.'],
  'google-unauthorized': ['Google nie przyjął dostępu', 'Token dostępu wygasł albo użytkownik cofnął zgodę w ustawieniach Google. Rozpocznij nowe połączenie.'],
  'google-unavailable': ['Google nie odpowiada', 'Serwery Google są chwilowo niedostępne. Spróbuj ponownie za chwilę – to nie jest błąd po stronie KAC.'],
  database_unavailable: ['Baza danych nie odpowiada', 'Błąd po stronie serwera, nie danych – spróbuj ponownie za chwilę. Nic nie zostało zmienione.'],
  database_not_configured: ['Serwer uruchomiony bez bazy danych', 'API działa bez skonfigurowanej bazy (brak DATABASE_URL), więc nie da się założyć importu.'],
};
const fail = (description: string, codes: string[]) =>
  documented(errorResponse, description, Object.fromEntries(codes.map((code) => {
    const [summary, explanation] = googleErrors[code]!;
    return [code, { summary, description: explanation, value: { error: code } }];
  })));
const notFound = (codes = ['connection-not-found']) => fail('Połączenie albo kalendarz nie istnieje.', codes);
const unauthorized = () => fail('Google nie przyjął tokenu dostępu.', ['google-unauthorized']);
const unavailable = () => fail('Google jest chwilowo niedostępny.', ['google-unavailable']);

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
  app.post('/import/google/connections', { schema: { tags: ['Google import'], summary: 'Start one-time Google import', description: 'Starts OAuth PKCE or the local demo consent flow. No Google events are written until import-session confirmation.', operationId: 'startGoogleImport', response: { 201: documented(objectResponse, 'Połączenie rozpoczęte.', googleConnectionExamples), 503: fail('Baza danych niedostępna.', ['database_unavailable']) } } }, async (_request, reply) => {
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
    schema: { tags: ['Google import'], summary: 'Record demo consent decision', description: 'Records the demo consent decision. The OAuth flow records its decision at the callback endpoint.', operationId: 'consentToGoogleImport', params: idParams, body: withExamples({ type: 'object', required: ['allow'], additionalProperties: false, properties: { allow: { type: 'boolean' } } }, { allow: { summary: 'Zgoda na odczyt kalendarza', description: 'Tylko dla konta demonstracyjnego: użytkownik kliknął „Zezwól”. Przy prawdziwym koncie Google zgodę daje się na stronie Google.', value: { allow: true } }, deny: { summary: 'Odmowa', description: 'Użytkownik kliknął „Odmów” – import zostanie przerwany.', value: { allow: false } } }), response: { 200: documented(objectResponse, 'Zapisana decyzja o zgodzie.', { allowed: { summary: 'Użytkownik się zgodził', description: 'Konto jest połączone – można pobrać listę kalendarzy (GET .../calendars).', value: { status: 'connected', email: 'student.kac.demo@gmail.com' } }, denied: { summary: 'Użytkownik odmówił', description: 'Bez zgody import z Google nie jest możliwy. Żeby spróbować ponownie, trzeba rozpocząć nowe połączenie.', value: { status: 'denied' } } }),
      404: notFound(), 409: fail('Zgoda już zapisana albo połączenie w trybie OAuth.', ['consent-already-given', 'use-google-consent']) } },
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
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/import/google/callback', { schema: { tags: ['Google import'], summary: 'Complete Google OAuth callback', description: 'Google redirects here after consent. The endpoint completes PKCE exchange and renders a short status page.', operationId: 'googleOAuthCallback', querystring: { type: 'object', properties: { state: { type: 'string' }, code: { type: 'string' }, error: { type: 'string' } } }, response: {
    200: documented({ type: 'string' }, 'Strona HTML: połączono albo użytkownik odmówił zgody.', { connected: { summary: 'Połączono z Google', description: 'Strona, którą użytkownik widzi w przeglądarce po zgodzie w Google. Karta zamyka się sama, a aplikacja przechodzi do wyboru kalendarza.', value: '<!doctype html><html lang="pl">…<h1>Połączono z Google</h1>…</html>' }, denied: { summary: 'Użytkownik odmówił w Google', description: 'Strona po kliknięciu „Anuluj” na stronie Google. Import nie jest możliwy bez zgody.', value: '<!doctype html><html lang="pl">…<h1>Brak zgody</h1>…</html>' } }),
    400: documented({ type: 'string' }, 'Strona HTML: połączenie wygasło albo nieznany state.', { expired: { summary: 'Połączenie wygasło', description: 'Google wrócił z nieznanym albo przeterminowanym połączeniem (np. po ponad 15 minutach). Trzeba rozpocząć import od nowa w aplikacji.', value: '<!doctype html><html lang="pl">…<h1>Połączenie wygasło</h1>…</html>' } }),
    502: documented({ type: 'string' }, 'Strona HTML: Google nie potwierdził połączenia.', { failed: { summary: 'Nie udało się połączyć', description: 'Użytkownik się zgodził, ale Google nie wydał tokenu dostępu. Trzeba spróbować ponownie w aplikacji.', value: '<!doctype html><html lang="pl">…<h1>Nie udało się połączyć</h1>…</html>' } }),
  } } }, async (request, reply) => {
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
  app.get<{ Params: { id: string } }>('/import/google/connections/:id', { schema: { tags: ['Google import'], summary: 'Get Google connection status', operationId: 'getGoogleConnection', params: idParams, response: { 200: documented(objectResponse, 'Stan połączenia.', { pending: { summary: 'Czeka na zgodę użytkownika', description: 'Użytkownik jeszcze nie zalogował się w Google albo nie zdecydował. Aplikacja odpytuje ten adres co chwilę, aż status się zmieni.', value: { status: 'pending', mode: 'google' } }, connected: { summary: 'Połączono', description: 'Zgoda udzielona – można przejść do wyboru kalendarza.', value: { status: 'connected', email: 'student.kac.demo@gmail.com', mode: 'demo' } } }), 404: notFound() } } }, async (request, reply) => {
    const connection = connections.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    return { status: connection.status, email: connection.email, mode: connection.mode };
  });

  // 4: lista kalendarzy połączonego konta.
  app.get<{ Params: { id: string } }>('/import/google/connections/:id/calendars', { schema: { tags: ['Google import'], summary: 'List Google calendars', operationId: 'listGoogleCalendars', params: idParams, response: { 200: documented(objectResponse, 'Kalendarze połączonego konta.', googleCalendarsExamples), 401: unauthorized(), 403: fail('Użytkownik odmówił dostępu.', ['access-denied']), 404: notFound(), 409: fail('Konto nie jest połączone.', ['not-connected']), 502: unavailable() } } }, async (request, reply) => {
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
      body: withExamples({ type: 'object', required: ['calendarId', 'from', 'to'], additionalProperties: false, properties: {
        calendarId: { type: 'string', minLength: 1, maxLength: 300 },
        from: { type: 'string', pattern: datePattern }, to: { type: 'string', pattern: datePattern },
        category: { type: 'string', enum: ['Class', 'Work', 'Personal'] },
      } }, googleReadInputExamples),
      response: { 201: documented(objectResponse, 'Sesja importu z wydarzeniami do kontroli.', googleReadExamples), 401: unauthorized(), 403: fail('Użytkownik odmówił dostępu.', ['access-denied']), 404: notFound(['connection-not-found', 'calendar-not-found']), 502: unavailable(),
        409: fail('Konto nie jest połączone albo połączenie zostało już użyte.', ['not-connected', 'connection-used']),
        422: documented(errorResponse, 'Błędny zakres dat albo brak wydarzeń w zakresie.', { 'invalid-range': { summary: 'Zły zakres dat', description: 'Data końca jest przed datą początku albo zakres jest dłuższy niż rok. Połączenie zostaje – popraw daty i spróbuj ponownie.', value: { error: 'invalid-range' } }, 'no-events': { summary: 'Brak wydarzeń w zakresie', description: 'W wybranym kalendarzu i okresie nie ma wydarzeń do zaimportowania (jedno całodniowe pominięto – skippedAllDay). Połączenie zostaje: można zmienić zakres albo kalendarz.', value: { error: 'no-events', skippedAllDay: 1 } } }),
        503: fail('Baza danych niedostępna.', ['database_unavailable', 'database_not_configured']) },
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
  app.delete<{ Params: { id: string } }>('/import/google/connections/:id', { schema: { tags: ['Google import'], summary: 'Forget Google connection', description: 'Forgets the one-time connection and drops the in-memory access token.', operationId: 'forgetGoogleConnection', params: idParams, response: { 204: { type: 'null', description: 'Połączenie i token zapomniane (także gdy już nie istniało).' } } } }, async (request, reply) => {
    connections.delete(request.params.id);
    return reply.code(204).send();
  });
}
