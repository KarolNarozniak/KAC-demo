// API trwałej integracji z Google Calendar (S23KC2S1P2-12: G01 / S23KC2S1P2-284 i G02 / S23KC2S1P2-286).
//
//  1–2  GET  /integrations/google                            stan połączenia, zakres dostępu i realnie przyznane uprawnienia
//  3    POST /integrations/google/connect                    początek logowania: connect | change_account | reconnect
// G03  DELETE /integrations/google                         odłączenie konta i cofnięcie zgody w Google (S23KC2S1P2-35)
//  4–6  GET  /integrations/google/callback                   powrót ze strony zgody Google (strona HTML, state jednorazowy)
//       POST /integrations/google/attempts/:id/demo-consent  makieta zgody, gdy serwer nie ma klienta Google OAuth
//       GET  /integrations/google/attempts/:id               stan próby (aplikacja odpytuje po otwarciu strony Google)
//       POST /integrations/google/attempts/:id/cancel        anulowanie – późniejszy powrót z Google niczego nie zapisze
//  7    GET  /integrations/google/calendars                  lista kalendarzy połączonego konta
// G06  GET  /integrations/google/sync                       stan synchronizacji: ostatnia próba, ostatni sukces, historia (S23KC2S1P2-17)
//      POST /integrations/google/sync                       „Synchronizuj z Google” z ograniczonymi ponowieniami błędów przejściowych
// Jednorazowy import (/import/google/*, S23KC2S1P2-27) ma osobny kontrakt i nie korzysta z tych endpointów.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ScopeResolver } from '../../scope.js';
import { documented, errorExamples, withExamples } from '../../examples.js';
import { GoogleIntegrationError } from '../../../integrations/google/oauth-client.js';
import type { AuthAttempt } from '../../../integrations/google/repository.js';
import { GoogleIntegrationService, IntegrationFlowError } from '../../../integrations/google/service.js';
import { SIMULATED_FAILURES, SyncFlowError, type SimulatedFailure } from '../../../integrations/google/sync.js';
import { SelectionError } from '../../../integrations/google/selection.js';
import {
  attemptExamples, calendarsExamples, callbackPage, cancelledExamples, connectBodyExamples, demoConsentBodyExamples, demoConsentExamples,
  disconnectExamples, integrationErrors, selectionBodyExamples, selectionExamples, startedExamples, statusExamples, syncBodyExamples, syncRunExamples, syncStatusExamples,
} from './examples.js';

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const accessSchema = { type: 'object', additionalProperties: false, required: ['calendarsRead', 'eventsWrite'], properties: {
  calendarsRead: { type: 'boolean', description: 'Odczyt listy kalendarzy i wydarzeń.' },
  eventsWrite: { type: 'boolean', description: 'Dodawanie i zmiana wydarzeń (np. publikacja grafiku).' } } } as const;
const accountSchema = { type: 'object', additionalProperties: false, required: ['email', 'connectedAt', 'grantedScopes', 'access'], properties: {
  email: { type: 'string' },
  connectedAt: nullable({ type: 'string', format: 'date-time' }),
  grantedScopes: { type: 'array', items: { type: 'string' }, description: 'Zakresy faktycznie przyznane przez użytkownika w Google.' },
  access: accessSchema } } as const;
const statusSchema = { type: 'object', additionalProperties: false, required: ['mode', 'ready', 'problem', 'status', 'account', 'requestedAccess', 'demoAccounts'], properties: {
  mode: { type: 'string', enum: ['google', 'demo'], description: 'google – prawdziwe OAuth; demo – makieta, gdy serwer nie ma klienta Google.' },
  ready: { type: 'boolean', description: 'false, gdy serwer nie może bezpiecznie zapisać tokenów (brak albo zły klucz szyfrowania).' },
  problem: nullable({ type: 'string', enum: ['token_key_missing', 'token_key_invalid'] }),
  status: { type: 'string', enum: ['not_connected', 'connected', 'reconnect_required'] },
  account: nullable(accountSchema),
  requestedAccess: accessSchema,
  demoAccounts: { type: 'array', items: { type: 'string' }, description: 'Konta makiety do wyboru (5b); puste w trybie google.' } } } as const;
const attemptSchema = { type: 'object', additionalProperties: false, required: ['attemptId', 'status', 'errorCode', 'purpose', 'mode', 'expiresAt'], properties: {
  attemptId: { type: 'string' },
  status: { type: 'string', enum: ['pending', 'processing', 'connected', 'denied', 'error', 'cancelled', 'expired'] },
  errorCode: nullable({ type: 'string' }),
  purpose: { type: 'string', enum: ['connect', 'change_account', 'reconnect'] },
  mode: { type: 'string', enum: ['google', 'demo'] },
  expiresAt: { type: 'string', format: 'date-time' },
  authUrl: { type: 'string', description: 'Tylko przy rozpoczęciu w trybie google: strona logowania i zgody Google.' } } } as const;
const calendarSchema = { type: 'object', additionalProperties: false, required: ['id', 'name', 'primary', 'accessRole', 'timeZone'], properties: {
  id: { type: 'string' }, name: { type: 'string' }, primary: { type: 'boolean' },
  accessRole: { type: 'string', enum: ['owner', 'writer', 'reader', 'freeBusyReader'] }, timeZone: nullable({ type: 'string' }) } } as const;
const syncAttemptSchema = { type: 'object', additionalProperties: false,
  required: ['id', 'direction', 'scope', 'operation', 'status', 'startedAt', 'finishedAt', 'tries', 'changes', 'errorCode', 'message', 'errorClass', 'retryable'], properties: {
    id: { type: 'string' }, direction: { type: 'string', enum: ['read', 'publish'] }, scope: nullable({ type: 'string' }), operation: { type: 'string' },
    status: { type: 'string', enum: ['running', 'success', 'partial', 'error'] },
    startedAt: { type: 'string', format: 'date-time' }, finishedAt: nullable({ type: 'string', format: 'date-time' }),
    tries: { type: 'integer', minimum: 1, description: 'Liczba prób w tym uruchomieniu (pierwsza + automatyczne ponowienia).' },
    changes: { type: 'integer', minimum: 0 }, errorCode: nullable({ type: 'string' }), message: nullable({ type: 'string' }),
    errorClass: nullable({ type: 'string', enum: ['network', 'reconnect', 'permissions', 'rate_limit', 'server', 'other'] }),
    retryable: { type: 'boolean', description: 'Czy „Spróbuj ponownie” ma sens (false, gdy trzeba połączyć konto ponownie).' } } } as const;
const syncStatusSchema = { type: 'object', additionalProperties: false, required: ['connection', 'enabled', 'sourcesSelected', 'state', 'lastAttempt', 'lastSuccess', 'history'], properties: {
  connection: { type: 'string', enum: ['not_connected', 'connected', 'reconnect_required'] },
  enabled: { type: 'boolean', description: 'Zgoda na synchronizację; odmowa przy ponownym logowaniu ją wyłącza.' },
  sourcesSelected: { type: 'integer', minimum: 0, description: 'Liczba wybranych kalendarzy źródłowych (G04); przy 0 synchronizacja nie rusza.' },
  state: { type: 'string', enum: ['never', 'running', 'success', 'partial', 'error'] },
  lastAttempt: nullable(syncAttemptSchema),
  lastSuccess: { type: 'object', additionalProperties: false, required: ['read', 'publish'], properties: {
    read: nullable({ type: 'string', format: 'date-time' }), publish: nullable({ type: 'string', format: 'date-time' }) } },
  history: { type: 'array', items: syncAttemptSchema, description: 'Ostatnie próby, najnowsza pierwsza (najwyżej 10).' } } } as const;

const selectionCalendarSchema = { type: 'object', additionalProperties: false,
  required: ['id', 'name', 'primary', 'accessRole', 'timeZone', 'available', 'writable', 'source', 'publicationTarget'], properties: {
    id: { type: 'string' }, name: { type: 'string' }, primary: { type: 'boolean' },
    accessRole: nullable({ type: 'string', enum: ['owner', 'writer', 'reader', 'freeBusyReader'] }), timeZone: nullable({ type: 'string' }),
    available: { type: 'boolean', description: 'false – kalendarz zniknął z konta Google albo konto straciło do niego dostęp.' },
    writable: { type: 'boolean', description: 'Konto może dodawać wydarzenia (owner/writer).' },
    source: { type: 'boolean', description: 'Uwzględniany przy planowaniu i synchronizacji.' },
    publicationTarget: { type: 'boolean', description: 'Kalendarz docelowy publikacji grafiku.' } } } as const;
const selectionSchema = { type: 'object', additionalProperties: false,
  required: ['version', 'calendars', 'sourceCalendarIds', 'publicationTargetCalendarId', 'canPublish', 'targetProblem'], properties: {
    version: { type: 'integer', minimum: 1 }, calendars: { type: 'array', items: selectionCalendarSchema },
    sourceCalendarIds: { type: 'array', items: { type: 'string' } }, publicationTargetCalendarId: nullable({ type: 'string' }),
    canPublish: { type: 'boolean', description: 'Czy zgoda Google obejmuje zapis wydarzeń.' },
    targetProblem: nullable({ type: 'string', enum: ['unavailable', 'not_writable', 'write_access_missing'] }) } } as const;

const idParams = { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } } as const;

const fail = (description: string, codes: string[]) => errorExamples(description, Object.fromEntries(codes.map((code) => [code, integrationErrors[code]!])));
const html = (description: string, title: string, message: string) => documented({ type: 'string' }, description, callbackPage(title, message));

/** Kody błędów Google → status HTTP odpowiedzi API. */
const GOOGLE_ERROR_STATUS: Record<string, number> = {
  reconnect_required: 409, insufficient_permissions: 403, rate_limited: 429, calendar_not_found: 404, google_unavailable: 502, google_error: 502,
  network_error: 504, api_not_enabled: 502,
};

const viewAttempt = (attempt: AuthAttempt, authUrl?: string | null) => ({
  attemptId: attempt.id, status: attempt.status, errorCode: attempt.errorCode, purpose: attempt.purpose, mode: attempt.mode, expiresAt: attempt.expiresAt,
  ...(authUrl ? { authUrl } : {}),
});

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const page = (title: string, message: string) => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0B111B;color:#F2F5FC;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:440px;text-align:center}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Możesz zamknąć tę kartę i wrócić do aplikacji KAC.</p></main></body></html>`;

export function registerGoogleIntegration(app: FastifyInstance, service: GoogleIntegrationService | null, scope: ScopeResolver) {
  const handle = async (reply: FastifyReply, work: (service: GoogleIntegrationService) => Promise<unknown>) => {
    if (!service) return reply.code(503).send({ error: 'integration_not_configured' });
    try {
      return await work(service);
    } catch (error) {
      if (error instanceof IntegrationFlowError || error instanceof SyncFlowError || error instanceof SelectionError) return reply.code(error.status).send({ error: error.code });
      if (error instanceof GoogleIntegrationError) return reply.code(GOOGLE_ERROR_STATUS[error.code] ?? 502).send({ error: error.code });
      throw error;
    }
  };

  app.get('/integrations/google', { schema: {
    tags: ['Google integration'], summary: 'Get Google connection state', operationId: 'getGoogleIntegration',
    description: 'Shows whether a Google account is connected, which access the app asks for (read calendars, read and write events) and which access the user actually granted. Tokens and their ciphertexts are never returned.',
    response: { 200: documented(statusSchema, 'Stan połączenia z Google.', statusExamples), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.status(scope(request))));

  app.delete('/integrations/google', { schema: {
    tags: ['Google integration'], summary: 'Disconnect Google account', operationId: 'disconnectGoogleIntegration',
    description: 'Disconnects the Google account in one transaction: status "Niepołączone", sync consent off, a new connection generation (work and token refreshes of the old generation are rejected), stored tokens deleted, open sign-in attempts cancelled (a late Google return saves nothing), running syncs finished and queued Google work stopped. Local events are never deleted. Afterwards the app asks Google to revoke its consent; remote is "revoked" only when Google confirmed it. Repeating the call is safe. The one-time import keeps its own DELETE on its connection resource (204).',
    response: {
      200: documented({ type: 'object', additionalProperties: false, required: ['status', 'account', 'alreadyDisconnected', 'local', 'remote'], properties: {
        status: { type: 'string', enum: ['not_connected'] },
        account: nullable({ type: 'string', description: 'Adres odłączonego konta.' }),
        alreadyDisconnected: { type: 'boolean', description: 'true – konto było już odłączone (powtórne wywołanie).' },
        local: { type: 'string', enum: ['removed', 'nothing_to_remove'], description: 'Stan w KAC: dane dostępu usunięte albo nie było czego usuwać.' },
        remote: { type: 'string', enum: ['revoked', 'failed', 'not_applicable'], description: 'Stan w Google: zgoda cofnięta, nie udało się jej cofnąć albo nie dotyczy (makieta).' } } },
      'Konto odłączone.', disconnectExamples),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.disconnect(scope(request))));

  app.post<{ Body: { purpose?: 'connect' | 'change_account' | 'reconnect' } }>('/integrations/google/connect', { schema: {
    tags: ['Google integration'], summary: 'Start Google sign-in', operationId: 'startGoogleIntegration',
    description: 'Creates a single-use sign-in attempt valid for 10 minutes. In google mode the response has authUrl (Google account choice and consent, offline access, PKCE S256); in demo mode consent is simulated with demo-consent. change_account replaces the current account only after the new sign-in succeeds; cancelling keeps the current connection. Connecting never changes calendar events.',
    body: withExamples({ type: 'object', additionalProperties: false, properties: { purpose: { type: 'string', enum: ['connect', 'change_account', 'reconnect'], default: 'connect' } } }, connectBodyExamples),
    response: {
      201: documented(attemptSchema, 'Rozpoczęta próba połączenia.', startedExamples),
      404: fail('Brak konta do ponownego połączenia.', ['not_connected']),
      409: fail('Konto już połączone.', ['already_connected']),
      503: fail('Serwer nie może bezpiecznie zapisać połączenia.', ['integration_not_configured', 'token_key_missing', 'token_key_invalid']),
    },
  } }, async (request, reply) => handle(reply, async (google) => {
    const started = await google.start(scope(request), request.body?.purpose ?? 'connect');
    return reply.code(201).send(viewAttempt(started.attempt, started.authUrl));
  }));

  app.get<{ Params: { id: string } }>('/integrations/google/attempts/:id', { schema: {
    tags: ['Google integration'], summary: 'Get sign-in attempt state', operationId: 'getGoogleIntegrationAttempt',
    description: 'Polled by the app while the Google page is open in another tab. A pending attempt past expiresAt is reported as expired.', params: idParams,
    response: {
      200: documented(attemptSchema, 'Stan próby.', attemptExamples),
      404: fail('Nie ma takiej próby.', ['attempt_not_found']), 503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, async (google) => viewAttempt(await google.attempt(scope(request), request.params.id))));

  app.post<{ Params: { id: string } }>('/integrations/google/attempts/:id/cancel', { schema: {
    tags: ['Google integration'], summary: 'Cancel sign-in attempt', operationId: 'cancelGoogleIntegrationAttempt',
    description: 'Cancels a pending attempt (closed window, 5a). A later return from Google for it saves nothing; an existing connection is kept. An attempt that already finished is returned unchanged.', params: idParams,
    response: {
      200: documented(attemptSchema, 'Stan próby po anulowaniu.', cancelledExamples),
      404: fail('Nie ma takiej próby.', ['attempt_not_found']), 503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, async (google) => viewAttempt(await google.cancel(scope(request), request.params.id))));

  app.post<{ Params: { id: string }; Body: { allow: boolean; account?: string } }>('/integrations/google/attempts/:id/demo-consent', { schema: {
    tags: ['Google integration'], summary: 'Record simulated Google consent', operationId: 'giveGoogleIntegrationDemoConsent',
    description: 'Demo mode only: the user picks a demo account (5b) and allows or denies access (5a). Demo accounts have no tokens. A decision on a finished or expired attempt changes nothing.', params: idParams,
    body: withExamples({ type: 'object', additionalProperties: false, required: ['allow'], properties: { allow: { type: 'boolean' }, account: { type: 'string', maxLength: 200 } } }, demoConsentBodyExamples),
    response: {
      200: documented(attemptSchema, 'Wynik decyzji.', demoConsentExamples),
      400: fail('Nieznane konto makiety.', ['invalid_demo_account']), 404: fail('Nie ma takiej próby.', ['attempt_not_found']),
      409: fail('Serwer używa prawdziwego Google.', ['demo_only']), 503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, async (google) =>
    viewAttempt(await google.demoConsent(scope(request), request.params.id, request.body.allow, request.body.account))));

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/integrations/google/callback', { schema: {
    tags: ['Google integration'], summary: 'Complete Google sign-in', operationId: 'completeGoogleIntegration',
    description: 'Google redirects the browser here. The state is single-use and expires; the code is exchanged with the PKCE verifier, tokens are encrypted before saving and never shown or logged. Denied consent, a missing calendar scope, expired codes and Google errors save nothing.',
    querystring: { type: 'object', properties: { state: { type: 'string', maxLength: 200 }, code: { type: 'string', maxLength: 2000 }, error: { type: 'string', maxLength: 200 } } },
    response: {
      200: html('Strona HTML: połączono albo użytkownik odmówił zgody.', 'Połączono z Google', 'Konto student@example.com jest połączone z KAC. Możesz wrócić do aplikacji.'),
      400: html('Strona HTML: nieznany, wygasły albo użyty state.', 'Połączenie wygasło', 'Ten link logowania wygasł albo został już użyty. Rozpocznij łączenie ponownie w aplikacji.'),
      409: html('Strona HTML: konflikt kont albo brak trwałego dostępu; nic nie zapisano.', 'Nie połączono konta', 'Masz już połączone konto Google. Żeby połączyć inne, użyj w aplikacji „Zmień konto”.'),
      502: html('Strona HTML: błąd Google; nic nie zapisano.', 'Nie udało się połączyć', 'Google nie potwierdził połączenia. Dane dostępu nie zostały zapisane – spróbuj ponownie w aplikacji.'),
      503: html('Strona HTML: integracja niedostępna (serwer bez bazy danych).', 'Integracja niedostępna', 'Serwer nie może zapisać połączenia z Google.'),
    },
  } }, async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    if (!service) return reply.code(503).send(page('Integracja niedostępna', 'Serwer nie może zapisać połączenia z Google.'));
    // Do logu trafia tylko kod błędu – nigdy kod autoryzacji ani tokeny.
    const result = await service.callback(scope(request), request.query, (code) => request.log.warn({ code }, 'Google integration sign-in failed'));
    return reply.code(result.httpStatus).send(page(result.title, result.message));
  });

  app.get('/integrations/google/calendars', { schema: {
    tags: ['Google integration'], summary: 'List calendars of the connected account', operationId: 'listGoogleIntegrationCalendars',
    description: 'Reads all calendar list pages from Google with access roles and stores them for later calendar choice. An empty list keeps the connection (7a). A token rejected by Google is refreshed once before reporting reconnect_required; local events are never changed.',
    response: {
      200: documented({ type: 'object', additionalProperties: false, required: ['account', 'calendars', 'complete'], properties: {
        account: accountSchema, calendars: { type: 'array', items: calendarSchema },
        complete: { type: 'boolean', description: 'false, gdy Google zwrócił więcej stron niż limit (20 stron po 250 kalendarzy).' } } },
      'Kalendarze połączonego konta.', calendarsExamples),
      403: fail('Zgoda nie obejmuje odczytu kalendarzy.', ['insufficient_permissions']),
      404: fail('Brak połączonego konta.', ['not_connected']),
      409: fail('Wymagane ponowne logowanie.', ['reconnect_required']),
      429: fail('Limit Google.', ['rate_limited']),
      502: fail('Google nie odpowiada albo projekt Google Cloud nie ma włączonego Calendar API.', ['google_unavailable', 'google_error', 'api_not_enabled']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
      504: fail('Brak połączenia z Google.', ['network_error']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.calendars(scope(request))));

  app.get('/integrations/google/calendar-selection', { schema: {
    tags: ['Google integration'], summary: 'Get calendar selection', operationId: 'getGoogleCalendarSelection',
    description: 'Calendars stored for the connected account with the user choice: source calendars used for planning and sync, and one publication target with write access. Calendars that disappeared from Google stay visible as unavailable while they are selected. Refresh the list from Google first with GET /integrations/google/calendars.',
    response: {
      200: documented(selectionSchema, 'Wybór kalendarzy.', selectionExamples),
      404: fail('Brak połączonego konta.', ['not_connected']), 503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.selection.get(scope(request))));

  app.put<{ Body: { version: number; sourceCalendarIds: string[]; publicationTargetCalendarId: string | null } }>('/integrations/google/calendar-selection', { schema: {
    tags: ['Google integration'], summary: 'Save calendar selection', operationId: 'saveGoogleCalendarSelection',
    description: 'Saves the whole selection atomically with version control: either all source calendars and the publication target change, or nothing does. The server rejects foreign calendar IDs, calendars without access and a publication target without write access (role owner/writer and the calendar.events consent). Unselecting a calendar only excludes it from future syncs; nothing is deleted from KAC.',
    body: withExamples({ type: 'object', additionalProperties: false, required: ['version', 'sourceCalendarIds', 'publicationTargetCalendarId'], properties: {
      version: { type: 'integer', minimum: 1, description: 'Wersja odczytana razem z wyborem.' },
      sourceCalendarIds: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 1024 } },
      publicationTargetCalendarId: nullable({ type: 'string', minLength: 1, maxLength: 1024 }) } }, selectionBodyExamples),
    response: {
      200: documented(selectionSchema, 'Zapisany wybór (nowa wersja).', selectionExamples),
      400: fail('Kalendarz nie należy do połączonego konta.', ['unknown_calendar']),
      404: fail('Brak połączonego konta.', ['not_connected']),
      409: fail('Wybór zmienił się w międzyczasie albo kalendarz jest niedostępny.', ['selection_conflict', 'calendar_unavailable']),
      422: fail('Kalendarz publikacji bez prawa zapisu.', ['target_not_writable', 'write_access_missing']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.selection.save(scope(request), request.body)));

  app.get('/integrations/google/sync', { schema: {
    tags: ['Google integration'], summary: 'Get Google sync state', operationId: 'getGoogleSync',
    description: 'Sync registry for the connected account: state of the last attempt (never, running, success, partial, error), error class, time of the last successful read and publication, and recent attempts. A failed attempt never overwrites the last success.',
    response: { 200: documented(syncStatusSchema, 'Stan synchronizacji.', syncStatusExamples), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.sync.status(scope(request))));

  app.post<{ Body: { simulate?: SimulatedFailure } }>('/integrations/google/sync', { schema: {
    tags: ['Google integration'], summary: 'Synchronize with Google now', operationId: 'runGoogleSync',
    description: 'Runs a read synchronization (calendar list) and records the attempt. Network errors, rate limits and Google server errors are retried automatically a limited number of times with growing delays; a rejected login is not retried and asks for reconnecting. Google errors are part of the attempt result (200), local events are never changed. simulate is accepted only in demo mode.',
    body: withExamples({ type: 'object', additionalProperties: false, properties: {
      simulate: { type: 'string', enum: [...SIMULATED_FAILURES], description: 'Tylko makieta: wymuszony błąd albo wynik częściowy.' } } }, syncBodyExamples),
    response: {
      200: documented({ type: 'object', additionalProperties: false, required: ['attempt', 'status'], properties: { attempt: syncAttemptSchema, status: syncStatusSchema } },
        'Wynik próby (także nieudanej) i aktualny stan synchronizacji.', syncRunExamples),
      404: fail('Brak połączonego konta.', ['not_connected']),
      409: fail('Synchronizacja niemożliwa w tej chwili.', ['sync_disabled', 'sync_in_progress', 'demo_only', 'no_calendars_selected']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.sync.runRead(scope(request), { simulate: request.body?.simulate })));
}
