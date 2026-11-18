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
import { ImportedEventError } from '../../../integrations/google/events-sync.js';
import { PUBLICATION_SIMULATIONS, PublicationError, type PublicationSimulation } from '../../../integrations/google/publication.js';
import { CORRECTION_SIMULATIONS, CorrectionError, type CorrectionSimulation } from '../../../integrations/google/corrections.js';
import {
  attemptExamples, calendarsExamples, callbackPage, cancelledExamples, connectBodyExamples, demoConsentBodyExamples, demoConsentExamples,
  calendarViewExamples, correctionStatusExamples, correctionSyncExamples, importedEventExamples, disconnectExamples, divergenceExamples, integrationErrors, publicationBodyExamples, publicationPreviewExamples, publicationResultExamples, selectionBodyExamples, selectionExamples, startedExamples, statusExamples, syncBodyExamples, syncRunExamples, syncStatusExamples,
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

const publicationItemSchema = { type: 'object', additionalProperties: false,
  required: ['shiftId', 'eventId', 'eventVersion', 'title', 'start', 'end', 'action', 'publishedAt'], properties: {
    shiftId: { type: 'string' }, eventId: { type: 'string', description: 'Lokalne wydarzenie KAC utworzone przy zatwierdzeniu grafiku.' },
    eventVersion: { type: 'integer', minimum: 1 }, title: { type: 'string' }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' },
    action: { type: 'string', enum: ['create', 'update', 'unchanged'], description: 'create – jeszcze nie publikowano; update – wydarzenie zmieniło się od publikacji; unchanged – pominięte.' },
    publishedAt: nullable({ type: 'string', format: 'date-time' }) } } as const;
const publicationPreviewSchema = { type: 'object', additionalProperties: false,
  required: ['simulated', 'weekStart', 'scheduleId', 'scheduleVersion', 'target', 'targets', 'items', 'summary'], properties: {
    simulated: { type: 'boolean', description: 'true – symulacja (konto demonstracyjne albo GOOGLE_PUBLICATION_MODE=simulation): nic nie trafia do Google. false – prawdziwy zapis.' },
    weekStart: { type: 'string', format: 'date' }, scheduleId: { type: 'string' }, scheduleVersion: { type: 'integer', minimum: 1 },
    target: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
    targets: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'primary'],
      properties: { id: { type: 'string' }, name: { type: 'string' }, primary: { type: 'boolean' } } } },
    items: { type: 'array', items: publicationItemSchema },
    summary: { type: 'object', additionalProperties: false, required: ['create', 'update', 'unchanged'], properties: {
      create: { type: 'integer', minimum: 0 }, update: { type: 'integer', minimum: 0 }, unchanged: { type: 'integer', minimum: 0 } } } } } as const;
const publicationResultSchema = { type: 'object', additionalProperties: false, required: ['simulated', 'attempt', 'items', 'preview'], properties: {
  simulated: { type: 'boolean' }, attempt: syncAttemptSchema,
  items: { type: 'array', items: { ...publicationItemSchema, required: [...publicationItemSchema.required, 'result'], properties: { ...publicationItemSchema.properties,
    result: { type: 'string', enum: ['published', 'unchanged', 'failed', 'skipped'] } } } },
  preview: publicationPreviewSchema } } as const;
const calendarSyncResultSchema = { type: 'object', additionalProperties: false,
  required: ['calendarId', 'name', 'mode', 'reason', 'created', 'updated', 'deleted', 'unchanged', 'conflicts', 'skippedAllDay', 'skippedDeclined', 'skippedOwn', 'errorCode'], properties: {
    calendarId: { type: 'string' }, name: { type: 'string' },
    mode: { type: 'string', enum: ['full', 'incremental'], description: 'full – pełny odczyt okna (pierwszy raz, przesunięcie okna, wygasły kursor); incremental – tylko zmiany od ostatniego kursora.' },
    reason: nullable({ type: 'string', enum: ['first', 'window', 'token_expired'] }),
    created: { type: 'integer', minimum: 0 }, updated: { type: 'integer', minimum: 0 }, deleted: { type: 'integer', minimum: 0 }, unchanged: { type: 'integer', minimum: 0 },
    conflicts: { type: 'integer', minimum: 0, description: 'Zmiany z Google niezastosowane, bo wydarzenie edytowano w KAC (D05).' },
    skippedAllDay: { type: 'integer', minimum: 0 }, skippedDeclined: { type: 'integer', minimum: 0 },
    skippedOwn: { type: 'integer', minimum: 0, description: 'Wydarzenia opublikowane przez KAC – nie wracają jako nowe wpisy.' },
    errorCode: nullable({ type: 'string', description: 'Błąd tego kalendarza – nic z niego nie zapisano, kursor bez zmian.' }) } } as const;
const importedEventSchema = { type: 'object', additionalProperties: false, required: ['eventId', 'calendar', 'account', 'state', 'googleVersion', 'lastSyncAt', 'connected'], properties: {
  eventId: { type: 'string' }, calendar: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
  account: { type: 'string' }, state: { type: 'string', enum: ['synced', 'conflict', 'detached'],
    description: 'synced – zgodne z Google; conflict – edytowane w KAC, Google nie nadpisuje; detached – usunięte w Google, lokalna kopia została.' },
  googleVersion: nullable({ type: 'object', additionalProperties: false, required: ['title', 'start', 'end', 'location'], properties: {
    title: { type: 'string' }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' }, location: { type: 'string' } } }),
  lastSyncAt: nullable({ type: 'string', format: 'date-time' }), connected: { type: 'boolean' } } } as const;

const correctionItemSchema = { type: 'object', additionalProperties: false,
  required: ['eventId', 'calendar', 'state', 'simulated', 'errorCode', 'errorClass', 'message', 'tries', 'lastTryAt', 'publishedAt', 'snapshot', 'lastOperation'], properties: {
    eventId: { type: 'string', description: 'Lokalne ID wydarzenia (zostaje także po jego usunięciu).' },
    calendar: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
    state: { type: 'string', enum: ['synced', 'pending', 'error', 'missing', 'pending_delete', 'deleted'],
      description: 'synced – zgodne; pending – lokalna zmiana czeka; error – nieudana aktualizacja; missing – brak wydarzenia w Google (nie tworzymy nowego); pending_delete – usunięte lokalnie, czeka na usunięcie w Google; deleted – usunięte w obu.' },
    simulated: { type: 'boolean' }, errorCode: nullable({ type: 'string' }),
    errorClass: nullable({ type: 'string', enum: ['network', 'reconnect', 'permissions', 'rate_limit', 'server', 'other'] }),
    message: nullable({ type: 'string' }), tries: { type: 'integer', minimum: 0 },
    lastTryAt: nullable({ type: 'string', format: 'date-time' }), publishedAt: nullable({ type: 'string', format: 'date-time' }),
    snapshot: nullable({ type: 'object', additionalProperties: false, required: ['title', 'start', 'end'],
      properties: { title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } } }),
    lastOperation: nullable({ type: 'string', enum: ['Utworzenie', 'Aktualizacja'], description: 'Ostatnia operacja w Google; usunięcie wynika ze stanu.' }) } } as const;
const correctionStatusSchema = { type: 'object', additionalProperties: false, required: ['eventId', 'items'], properties: {
  eventId: { type: 'string' }, items: { type: 'array', items: correctionItemSchema } } } as const;
const correctionSyncSchema = { type: 'object', additionalProperties: false, required: ['eventId', 'result', 'errorCode', 'items'], properties: {
  eventId: { type: 'string' }, result: { type: 'string', enum: ['nothing', 'success', 'error'], description: 'nothing – wszystko już było zgodne.' },
  errorCode: nullable({ type: 'string' }), items: { type: 'array', items: correctionItemSchema } } } as const;
const eventParams = { type: 'object', additionalProperties: false, required: ['eventId'], properties: { eventId: { type: 'string', minLength: 1, maxLength: 200 } } } as const;

const calendarViewSchema = { type: 'object', additionalProperties: false, required: ['simulated', 'calendar', 'weekStart', 'events', 'othersError'], properties: {
  simulated: { type: 'boolean', description: 'true – opublikowane zmiany są symulacją i pochodzą z pozycji publikacji; false – wszystko odczytano z Google.' },
  calendar: { type: 'object', additionalProperties: false, required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
  weekStart: { type: 'string', format: 'date' },
  events: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'start', 'end', 'published'], properties: {
    id: { type: 'string' }, title: { type: 'string' }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' },
    published: { type: 'boolean', description: 'true – zmiana opublikowana przez KAC; false – pozostałe wydarzenie kalendarza.' } } } },
  othersError: nullable({ type: 'string', description: 'Pozostałych wydarzeń nie udało się odczytać – widok zawiera tylko opublikowane zmiany.' }) } } as const;

const weekParams = { type: 'object', additionalProperties: false, required: ['weekStart'], properties: { weekStart: { type: 'string', format: 'date' } } } as const;
const publicationBlocked = ['schedule_version_conflict', 'schedule_not_accepted', 'schedule_empty', 'no_publication_target', 'calendar_unavailable', 'reconnect_required'];

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
      if (error instanceof IntegrationFlowError || error instanceof SyncFlowError || error instanceof SelectionError || error instanceof PublicationError || error instanceof CorrectionError || error instanceof ImportedEventError) return reply.code(error.status).send({ error: error.code });
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
    // Bez sesji KAC: przeglądarka wraca z Google bez nagłówka Authorization, właściciela wskazuje jednorazowy state.
    const result = await service.callback(request.query, (code) => request.log.warn({ code }, 'Google integration sign-in failed'));
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

  app.get<{ Params: { weekStart: string }; Querystring: { calendarId?: string } }>('/integrations/google/publications/:weekStart/preview', { schema: {
    tags: ['Google integration'], summary: 'Preview schedule publication', operationId: 'previewGooglePublication',
    description: 'Lists the shifts of the accepted schedule for the week that a publication would create or update in the chosen calendar (default: the publication calendar from the calendar selection). Changes nothing. For an account connected through Google the publication writes real events (simulated=false); a demo account, or GOOGLE_PUBLICATION_MODE=simulation, only simulates it.',
    params: weekParams,
    querystring: { type: 'object', additionalProperties: false, properties: { calendarId: { type: 'string', minLength: 1, maxLength: 1024, description: 'Inny kalendarz z prawem zapisu niż domyślny.' } } },
    response: {
      200: documented(publicationPreviewSchema, 'Podgląd publikacji.', publicationPreviewExamples),
      400: fail('Kalendarz nie należy do połączonego konta.', ['unknown_calendar']),
      404: fail('Brak konta albo grafiku.', ['not_connected', 'schedule_not_found']),
      409: fail('Grafiku nie można opublikować.', publicationBlocked.filter((code) => code !== 'schedule_version_conflict')),
      422: fail('Kalendarz bez prawa zapisu.', ['target_not_writable', 'write_access_missing']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.publication.preview(scope(request), request.params.weekStart, request.query.calendarId)));

  app.get<{ Params: { weekStart: string }; Querystring: { calendarId?: string } }>('/integrations/google/publications/:weekStart/calendar-view', { schema: {
    tags: ['Google integration'], summary: 'Google calendar view after publication', operationId: 'getGooglePublicationCalendarView',
    description: 'Step 10 of story 30: the week of the target Google calendar with the published shifts among the other events. With real publication everything is read from Google and KAC shifts are recognised by the kacEventId private property. In a simulation (or when Google cannot be read) published shifts come from the publication records and other events from Google or the demo account.',
    params: weekParams,
    querystring: { type: 'object', additionalProperties: false, properties: { calendarId: { type: 'string', minLength: 1, maxLength: 1024 } } },
    response: {
      200: documented(calendarViewSchema, 'Widok kalendarza Google.', calendarViewExamples),
      400: fail('Kalendarz nie należy do połączonego konta.', ['unknown_calendar']),
      404: fail('Brak konta.', ['not_connected']),
      409: fail('Brak kalendarza publikacji.', ['no_publication_target']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.publication.calendarView(scope(request), request.params.weekStart, request.query.calendarId)));

  app.post<{ Params: { weekStart: string }; Body: { expectedVersion: number; calendarId?: string | null; simulate?: PublicationSimulation } }>('/integrations/google/publications/:weekStart', { schema: {
    tags: ['Google integration'], summary: 'Publish accepted schedule', operationId: 'publishGoogleSchedule',
    description: 'Confirmed publication of the accepted schedule after the preview. For an account connected through Google each shift becomes a Google event with an ID derived from the account, calendar and shift, so a retry after a lost response does not create a duplicate; an already published shift is updated, and one deleted by hand in Google is published again. A demo account (or GOOGLE_PUBLICATION_MODE=simulation) only simulates it: nothing is sent to Google and the result is marked simulated. Each shift has one publication record per calendar, so a retry after an error publishes only what is missing. The attempt is recorded in the sync registry with direction publish. A Google-side error is the attempt result (200), not an HTTP error.',
    params: weekParams,
    body: withExamples({ type: 'object', additionalProperties: false, required: ['expectedVersion'], properties: {
      expectedVersion: { type: 'integer', minimum: 1, description: 'Wersja grafiku z podglądu.' },
      calendarId: nullable({ type: 'string', minLength: 1, maxLength: 1024 }),
      simulate: { type: 'string', enum: [...PUBLICATION_SIMULATIONS], description: 'Wymuszony wynik symulacji (błąd, wynik częściowy).' } } }, publicationBodyExamples),
    response: {
      200: documented(publicationResultSchema, 'Wynik próby publikacji.', publicationResultExamples),
      400: fail('Kalendarz nie należy do połączonego konta.', ['unknown_calendar']),
      404: fail('Brak konta albo grafiku.', ['not_connected', 'schedule_not_found']),
      409: fail('Grafiku nie można opublikować.', [...publicationBlocked, 'publication_in_progress']),
      422: fail('Kalendarz bez prawa zapisu.', ['target_not_writable', 'write_access_missing']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.publication.publish(scope(request), request.params.weekStart, request.body)));

  app.get<{ Params: { eventId: string } }>('/integrations/google/publications/events/:eventId', { schema: {
    tags: ['Google integration'], summary: 'Get published event sync state', operationId: 'getGooglePublishedEvent',
    description: 'Synchronization state of a published work shift in each calendar it was published to (simulated=true for a demo account). Also works after the local event was deleted, because the publication record keeps a tombstone.',
    params: eventParams,
    response: { 200: documented(correctionStatusSchema, 'Stan publikacji wydarzenia.', correctionStatusExamples),
      404: fail('Wydarzenie nie było publikowane.', ['publication_not_found']), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.corrections.status(scope(request), request.params.eventId)));

  app.post<{ Params: { eventId: string } }>('/integrations/google/publications/events/:eventId/sync', { schema: {
    tags: ['Google integration'], summary: 'Sync published event correction', operationId: 'syncGooglePublishedEvent',
    description: 'Retry ("Ponów synchronizację") for an edited or deleted published shift; the app also calls it right after saving. Sends the latest local state, not an old job body: an update of a Google event that no longer exists reports missing without creating a new one, and deleting an already missing event succeeds. A Google error is the result (200) and never reverts the local change. A shift published through a Google account is patched or deleted in Google (events.patch / events.delete); a demo publication is only simulated.',
    params: eventParams,
    response: { 200: documented(correctionSyncSchema, 'Wynik synchronizacji.', correctionSyncExamples),
      404: fail('Wydarzenie nie było publikowane.', ['publication_not_found']), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.corrections.sync(scope(request), request.params.eventId)));

  app.get('/integrations/google/publications/divergences', { schema: {
    tags: ['Google integration'], summary: 'List differences between KAC and Google', operationId: 'listGooglePublicationDivergences',
    description: 'Published shifts whose Google copy is not in sync: pending, failed, missing in Google, or deleted locally but not yet in Google.',
    response: { 200: documented({ type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: correctionItemSchema } } },
      'Rozbieżności.', divergenceExamples), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.corrections.divergences(scope(request))));

  app.put<{ Body: { simulate: CorrectionSimulation | null } }>('/integrations/google/publications/simulation', { schema: {
    tags: ['Google integration'], summary: 'Force next correction sync result (simulation)', operationId: 'setGoogleCorrectionSimulation',
    description: 'Demo helper: the next correction sync of this account returns the chosen error (used once). null clears it.',
    body: withExamples({ type: 'object', additionalProperties: false, required: ['simulate'], properties: { simulate: nullable({ type: 'string', enum: [...CORRECTION_SIMULATIONS] }) } },
      { missing: { summary: 'Następna aktualizacja: brak wydarzenia w Google', value: { simulate: 'missing' } }, clear: { summary: 'Bez wymuszonego wyniku', value: { simulate: null } } }),
    response: { 200: documented({ type: 'object', additionalProperties: false, required: ['simulate'], properties: { simulate: nullable({ type: 'string', enum: [...CORRECTION_SIMULATIONS] }) } },
      'Ustawiony wynik następnej synchronizacji.', { missing: { summary: 'Brak wydarzenia w Google', value: { simulate: 'missing' } } }),
      404: fail('Brak połączonego konta.', ['not_connected']), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.corrections.simulateNext(scope(request), request.body.simulate)));

  app.get('/integrations/google/sync', { schema: {
    tags: ['Google integration'], summary: 'Get Google sync state', operationId: 'getGoogleSync',
    description: 'Sync registry for the connected account: state of the last attempt (never, running, success, partial, error), error class, time of the last successful read and publication, and recent attempts. A failed attempt never overwrites the last success.',
    response: { 200: documented(syncStatusSchema, 'Stan synchronizacji.', syncStatusExamples), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.sync.status(scope(request))));

  app.post<{ Body: { simulate?: SimulatedFailure } }>('/integrations/google/sync', { schema: {
    tags: ['Google integration'], summary: 'Synchronize with Google now', operationId: 'runGoogleSync',
    description: 'Reads the calendar list, then downloads and applies event changes from the selected source calendars (G05): a full read of the time window the first time (and after the sync cursor expires or the window must move), afterwards only changes since the cursor. Each calendar is applied atomically together with its new cursor; a page error saves nothing for that calendar and keeps the cursor. Only events created by the synchronization are changed or deleted – manual events are never touched; events edited in KAC are not overwritten (conflict). Network errors, rate limits and Google server errors are retried a limited number of times with growing delays; a rejected login asks for reconnecting. Google errors are part of the attempt result (200). simulate is accepted only in demo mode.',
    body: withExamples({ type: 'object', additionalProperties: false, properties: {
      simulate: { type: 'string', enum: [...SIMULATED_FAILURES], description: 'Tylko makieta: wymuszony błąd albo wynik częściowy.' } } }, syncBodyExamples),
    response: {
      200: documented({ type: 'object', additionalProperties: false, required: ['attempt', 'status', 'summary'], properties: { attempt: syncAttemptSchema, status: syncStatusSchema,
        summary: nullable({ type: 'object', additionalProperties: false, required: ['calendars'], properties: { calendars: { type: 'array', items: calendarSyncResultSchema } },
          description: 'Wynik pobierania zmian per kalendarz; null, gdy nie doszło do odczytu wydarzeń (np. błąd listy kalendarzy).' }) } },
        'Wynik próby (także nieudanej) i aktualny stan synchronizacji.', syncRunExamples),
      404: fail('Brak połączonego konta.', ['not_connected']),
      409: fail('Synchronizacja niemożliwa w tej chwili.', ['sync_disabled', 'sync_in_progress', 'demo_only', 'no_calendars_selected']),
      503: fail('Integracja niedostępna.', ['integration_not_configured']),
    },
  } }, async (request, reply) => handle(reply, (google) => google.sync.runRead(scope(request), { simulate: request.body?.simulate })));

  app.get<{ Params: { eventId: string } }>('/integrations/google/imported-events/:eventId', { schema: {
    tags: ['Google integration'], summary: 'Get synchronized event origin', operationId: 'getGoogleImportedEvent',
    description: 'For an event created by the Google synchronization: source calendar, whether it was edited in KAC (Google changes are then not applied) or deleted in Google, and the latest Google version.',
    params: eventParams,
    response: { 200: documented(importedEventSchema, 'Pochodzenie i stan wydarzenia.', importedEventExamples),
      404: fail('Wydarzenie nie pochodzi z synchronizacji Google.', ['not_imported']), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.importedEvents.get(scope(request), request.params.eventId)));

  app.post<{ Params: { eventId: string } }>('/integrations/google/imported-events/:eventId/restore', { schema: {
    tags: ['Google integration'], summary: 'Restore Google version of an event', operationId: 'restoreGoogleImportedEvent',
    description: 'Replaces a local edit of a synchronized event with the latest Google version; later Google changes are applied again. Works without network – the Google version is stored locally.',
    params: eventParams,
    response: { 200: documented(importedEventSchema, 'Przywrócona wersja z Google.', { restored: importedEventExamples.synced! }),
      404: fail('Wydarzenie nie pochodzi z synchronizacji Google.', ['not_imported']),
      409: fail('Nie ma czego przywrócić.', ['google_version_missing', 'restore_series']), 503: fail('Integracja niedostępna.', ['integration_not_configured']) },
  } }, async (request, reply) => handle(reply, (google) => google.importedEvents.restore(scope(request), request.params.eventId)));
}
