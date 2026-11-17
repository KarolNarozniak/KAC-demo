// Przykłady trwałego połączenia z Google w Swagger UI (S23KC2S1P2-12, G01). Wartości odpowiadają odpowiedziom handlerów
// (tests/google-integration.integration.test.ts). Dane są syntetyczne – bez prawdziwych kont, tokenów i sekretów.
import type { NamedExamples } from '../../examples.js';

const at = '2026-11-16T18:00:00.000Z';
const attemptId = 'b9f2d6a0-5c1e-4d7a-9f3b-2e8c4a6d1f00';
const grantedReadOnly = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];
const account = { email: 'student@example.com', connectedAt: at, grantedScopes: grantedReadOnly, access: { calendarsRead: true, eventsWrite: false } };
const attempt = (status: string, extra: Record<string, unknown> = {}) => ({ attemptId, status, errorCode: null, purpose: 'connect', mode: 'demo', expiresAt: at, ...extra });

export const statusExamples: NamedExamples = {
  notConnected: {
    summary: 'Niepołączone (makieta)',
    description: 'Serwer bez klienta Google OAuth: logowanie jest symulowane, a demoAccounts to konta do wyboru (5b). requestedAccess to dostęp, o który aplikacja poprosi (krok 2).',
    value: { mode: 'demo', ready: true, problem: null, status: 'not_connected', account: null, requestedAccess: { calendarsRead: true, eventsWrite: true },
      demoAccounts: ['student.kac.demo@gmail.com', 'praca.kac.demo@gmail.com'] },
  },
  connected: {
    summary: 'Połączone, bez zapisu wydarzeń',
    description: 'Użytkownik odznaczył w Google zapis wydarzeń: account.access pokazuje realnie przyznany dostęp, który może być węższy niż requestedAccess.',
    value: { mode: 'google', ready: true, problem: null, status: 'connected', account, requestedAccess: { calendarsRead: true, eventsWrite: true }, demoAccounts: [] },
  },
  reconnect: {
    summary: 'Wymagane ponowne logowanie',
    description: 'Google odrzucił zapisany token odświeżania (wygasł albo cofnięto zgodę). Konto zostaje przypisane, dane lokalne są bez zmian.',
    value: { mode: 'google', ready: true, problem: null, status: 'reconnect_required', account, requestedAccess: { calendarsRead: true, eventsWrite: true }, demoAccounts: [] },
  },
  noKey: {
    summary: 'Brak klucza szyfrowania',
    description: 'Serwer ma klienta Google, ale nie ma GOOGLE_TOKEN_ENCRYPTION_KEY: nie zapisze tokenów, więc nie rozpoczyna logowania (ready: false).',
    value: { mode: 'google', ready: false, problem: 'token_key_missing', status: 'not_connected', account: null, requestedAccess: { calendarsRead: true, eventsWrite: true }, demoAccounts: [] },
  },
};

export const connectBodyExamples: NamedExamples = {
  connect: { summary: 'Połącz', description: 'Pierwsze połączenie. Przy połączonym koncie kończy się 409 already_connected (1a).', value: { purpose: 'connect' } },
  change: { summary: 'Zmień konto', description: 'Obecne konto zostaje zastąpione dopiero po udanym zalogowaniu na inne; anulowanie zostawia obecne połączenie.', value: { purpose: 'change_account' } },
  reconnect: { summary: 'Połącz ponownie', description: 'Po „wymagane ponowne logowanie” albo by przyznać brakujący dostęp. Google podpowiada to samo konto.', value: { purpose: 'reconnect' } },
};

export const startedExamples: NamedExamples = {
  demo: { summary: 'Makieta', description: 'Bez authUrl – zgodę daje się przez demo-consent.', value: attempt('pending') },
  google: {
    summary: 'Google',
    description: 'authUrl otwiera stronę wyboru konta i zgody Google (dostęp offline, PKCE S256). Aplikacja odpytuje stan próby, aż przestanie być pending.',
    value: attempt('pending', { mode: 'google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=example.apps.googleusercontent.com&response_type=code&access_type=offline' }),
  },
};

export const attemptExamples: NamedExamples = {
  pending: { summary: 'Oczekuje', description: 'Użytkownik jeszcze nie zdecydował na stronie Google.', value: attempt('pending', { mode: 'google' }) },
  connected: { summary: 'Połączono', value: attempt('connected') },
  denied: { summary: 'Odmowa (5a)', description: 'Nic nie zostało zapisane.', value: attempt('denied', { errorCode: 'access_denied' }) },
  error: { summary: 'Błąd autoryzacji (6a)', description: 'Google odrzucił kod (wygasł albo został użyty). Nic nie zostało zapisane.', value: attempt('error', { mode: 'google', errorCode: 'authorization_code_invalid' }) },
  expired: { summary: 'Wygasła', description: 'Próba nie doczekała się decyzji przed expiresAt.', value: attempt('expired', { mode: 'google' }) },
};

export const cancelledExamples: NamedExamples = {
  cancelled: { summary: 'Anulowano', description: 'Późniejszy powrót z Google dla tej próby niczego nie zapisze.', value: attempt('cancelled', { purpose: 'change_account' }) },
  alreadyFinished: { summary: 'Już zakończona', description: 'Próba zakończyła się przed anulowaniem – odpowiedź pokazuje jej prawdziwy wynik.', value: attempt('connected') },
};

export const demoConsentBodyExamples: NamedExamples = {
  allow: { summary: 'Zgoda', description: 'Wybrane konto makiety (5b) i zgoda na dostęp.', value: { allow: true, account: 'student.kac.demo@gmail.com' } },
  deny: { summary: 'Odmowa', description: 'Odmowa dostępu (5a).', value: { allow: false } },
};

export const demoConsentExamples: NamedExamples = {
  connected: { summary: 'Połączono', value: attempt('connected') },
  denied: { summary: 'Odmowa', value: attempt('denied', { errorCode: 'access_denied' }) },
};

export const calendarsExamples: NamedExamples = {
  calendars: {
    summary: 'Lista kalendarzy',
    description: 'Wszystkie strony listy z Google. accessRole: owner i writer pozwalają zapisywać wydarzenia, reader – tylko odczyt.',
    value: { account, complete: true, calendars: [
      { id: 'primary', name: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' },
      { id: 'praca@group.calendar.google.com', name: 'Grafik pracy', primary: false, accessRole: 'writer', timeZone: 'Europe/Warsaw' },
      { id: 'kolo@group.calendar.google.com', name: 'Koło naukowe', primary: false, accessRole: 'reader', timeZone: null },
    ] },
  },
  empty: { summary: 'Konto bez kalendarzy (7a)', description: 'Pusta lista nie rozłącza konta.', value: { account, calendars: [], complete: true } },
};

const keep = 'Dane w KAC są bez zmian.';
/** Kody błędów integracji: [tytuł, wyjaśnienie]. */
export const integrationErrors: Record<string, [string, string]> = {
  integration_not_configured: ['Serwer bez bazy danych', 'API działa bez bazy danych, więc nie może zapisać połączenia z Google.'],
  token_key_missing: ['Brak klucza szyfrowania', 'Serwer ma klienta Google, ale nie ma GOOGLE_TOKEN_ENCRYPTION_KEY – nie zapisze tokenów, więc nie rozpoczyna logowania.'],
  token_key_invalid: ['Zły klucz szyfrowania', 'GOOGLE_TOKEN_ENCRYPTION_KEY musi mieć 32 bajty zapisane w base64.'],
  already_connected: ['Konto już połączone', 'Konto Google jest już połączone (1a). Użyj „Zmień konto” (change_account) albo „Połącz ponownie” (reconnect).'],
  not_connected: ['Brak połączonego konta', 'Najpierw połącz konto Google.'],
  attempt_not_found: ['Nie ma takiej próby', 'Próba połączenia nie istnieje albo należy do innego użytkownika.'],
  invalid_demo_account: ['Nieznane konto makiety', 'Przy zgodzie wybierz jedno z kont z demoAccounts.'],
  demo_only: ['Tylko w makiecie', 'Serwer używa prawdziwego Google – zgodę daje się na stronie authUrl, nie tym endpointem.'],
  reconnect_required: ['Wymagane ponowne logowanie', `Google nie przyjął zapisanego dostępu (wygasł albo cofnięto zgodę). ${keep}`],
  insufficient_permissions: ['Brak uprawnień', 'Przyznana zgoda nie obejmuje odczytu kalendarzy. Trzeba połączyć ponownie i zaznaczyć dostęp do kalendarza.'],
  rate_limited: ['Limit zapytań Google', `Google chwilowo ogranicza zapytania. Spróbuj ponownie za chwilę. ${keep}`],
  google_unavailable: ['Google nie odpowiada', `Brak połączenia z Google albo błąd po jego stronie. Spróbuj ponownie. ${keep}`],
  google_error: ['Błąd Google', `Google odrzucił żądanie. Spróbuj ponownie albo połącz konto od nowa. ${keep}`],
  network_error: ['Brak połączenia z Google', `Brak internetu albo przekroczony czas odpowiedzi. Spróbuj ponownie. ${keep}`],
  api_not_enabled: ['Calendar API wyłączone', 'W projekcie Google Cloud nie jest włączone Google Calendar API – to błąd konfiguracji, nie brak zgody użytkownika.'],
  sync_disabled: ['Synchronizacja wyłączona', `Użytkownik odmówił zgody przy ponownym logowaniu. Trzeba połączyć konto ponownie. ${keep}`],
  sync_in_progress: ['Synchronizacja trwa', 'Inna próba synchronizacji tego konta jeszcze trwa. Poczekaj na jej wynik.'],
  no_calendars_selected: ['Nie wybrano kalendarzy', 'Synchronizacja dotyczy wybranych kalendarzy – wybierz co najmniej jeden w ustawieniach integracji. Konto zostaje połączone.'],
  selection_conflict: ['Wybór zmienił się w międzyczasie', 'Ktoś zapisał wybór w innym oknie (inna wersja). Nic nie zostało zmienione – wczytaj aktualny wybór.'],
  unknown_calendar: ['Nieznany kalendarz', 'Kalendarz nie należy do połączonego konta Google. Nic nie zostało zmienione.'],
  calendar_unavailable: ['Kalendarz niedostępny', 'Konto Google straciło dostęp do tego kalendarza albo kalendarz usunięto.'],
  target_not_writable: ['Brak prawa zapisu', 'Kalendarz publikacji musi pozwalać na dodawanie wydarzeń (właściciel albo odczyt i zapis).'],
  write_access_missing: ['Brak zgody na zapis', 'Zgoda Google nie obejmuje dodawania wydarzeń. Połącz konto ponownie i zaznacz dostęp do wydarzeń.'],
};

/** Strona HTML zwracana przeglądarce po powrocie z Google. */
export const callbackPage = (title: string, message: string): NamedExamples => ({
  page: { summary: title, description: message, value: `<!doctype html><html lang="pl"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main></html>` },
});

// --- Synchronizacja (G06) ---
const syncAttempt = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'c1d2e3f4-0000-4000-8000-000000000006', direction: 'read', scope: 'calendar_list', operation: 'Lista kalendarzy', status,
  startedAt: '2026-11-17T08:30:00.000Z', finishedAt: '2026-11-17T08:30:02.000Z', tries: 1, changes: 0, errorCode: null, message: null,
  errorClass: null, retryable: false, ...extra,
});
const success = syncAttempt('success', { changes: 4, message: 'Odczytane kalendarze: 4.' });
const networkError = syncAttempt('error', { tries: 3, errorCode: 'network_error', errorClass: 'network', retryable: true,
  message: 'Brak połączenia z Google (brak internetu albo przekroczony czas).' });
const reconnectError = syncAttempt('error', { errorCode: 'reconnect_required', errorClass: 'reconnect', retryable: false,
  message: 'Google nie przyjmuje zapisanego dostępu – trzeba ponownie połączyć konto.' });
const statusWith = (last: Record<string, unknown> | null, lastRead: string | null, extra: Record<string, unknown> = {}) => ({
  connection: 'connected', enabled: true, sourcesSelected: 2, state: last ? last.status : 'never', lastAttempt: last,
  lastSuccess: { read: lastRead, publish: null }, history: last ? [last] : [], ...extra,
});

export const syncStatusExamples: NamedExamples = {
  never: { summary: 'Nigdy', description: 'Konto połączone, synchronizacji jeszcze nie było.', value: statusWith(null, null) },
  success: { summary: 'Sukces', value: statusWith(success, '2026-11-17T08:30:02.000Z') },
  error: { summary: 'Błąd po ponowieniach', description: 'Trzy próby nie dotarły do Google. Ostatni sukces pozostaje z wcześniejszej synchronizacji.',
    value: statusWith(networkError, '2026-11-16T18:00:00.000Z') },
  reconnect: { summary: 'Wymagane ponowne logowanie', value: statusWith(reconnectError, '2026-11-16T18:00:00.000Z', { connection: 'reconnect_required' }) },
};

export const syncBodyExamples: NamedExamples = {
  normal: { summary: 'Zwykła synchronizacja', value: {} },
  simulate: { summary: 'Makieta: brak internetu', description: 'Tylko w trybie demonstracyjnym – pokazuje przebieg błędu i ponowień.', value: { simulate: 'network' } },
};

export const syncRunExamples: NamedExamples = {
  success: { summary: 'Udana synchronizacja', value: { attempt: success, status: statusWith(success, '2026-11-17T08:30:02.000Z') } },
  error: { summary: 'Błąd sieci po ponowieniach', value: { attempt: networkError, status: statusWith(networkError, '2026-11-16T18:00:00.000Z') } },
};

// --- Odłączenie (G03) ---
export const disconnectExamples: NamedExamples = {
  revoked: { summary: 'Odłączono i cofnięto zgodę', description: 'Dane dostępu usunięte w KAC, Google potwierdził cofnięcie zgody.',
    value: { status: 'not_connected', account: 'student@example.com', alreadyDisconnected: false, local: 'removed', remote: 'revoked' } },
  remoteFailed: { summary: 'Zgoda w Google nie cofnięta', description: 'KAC usunął dane dostępu, ale Google nie potwierdził cofnięcia zgody (np. brak internetu). Użytkownik może usunąć dostęp w ustawieniach konta Google.',
    value: { status: 'not_connected', account: 'student@example.com', alreadyDisconnected: false, local: 'removed', remote: 'failed' } },
  again: { summary: 'Powtórne odłączenie', value: { status: 'not_connected', account: null, alreadyDisconnected: true, local: 'nothing_to_remove', remote: 'not_applicable' } },
};

// --- Wybór kalendarzy (G04) ---
const selectionCalendars = [
  { id: 'primary', name: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw', available: true, writable: true, source: true, publicationTarget: false },
  { id: 'praca@group.calendar.google.com', name: 'Grafik pracy', primary: false, accessRole: 'writer', timeZone: 'Europe/Warsaw', available: true, writable: true, source: false, publicationTarget: true },
  { id: 'kolo@group.calendar.google.com', name: 'Koło naukowe', primary: false, accessRole: 'reader', timeZone: null, available: true, writable: false, source: true, publicationTarget: false },
];
export const selectionExamples: NamedExamples = {
  selected: { summary: 'Wybrane kalendarze', description: 'Dwa kalendarze do planowania i „Grafik pracy” jako kalendarz publikacji.',
    value: { version: 3, calendars: selectionCalendars, sourceCalendarIds: ['primary', 'kolo@group.calendar.google.com'],
      publicationTargetCalendarId: 'praca@group.calendar.google.com', canPublish: true, targetProblem: null } },
  lostAccess: { summary: 'Utrata uprawnień', description: 'Kalendarz publikacji zniknął z konta Google – zostaje widoczny z problemem do rozwiązania.',
    value: { version: 3, calendars: [selectionCalendars[0], { ...selectionCalendars[1], accessRole: null, available: false, writable: false }],
      sourceCalendarIds: ['primary'], publicationTargetCalendarId: 'praca@group.calendar.google.com', canPublish: true, targetProblem: 'unavailable' } },
};
export const selectionBodyExamples: NamedExamples = {
  save: { summary: 'Zapis wyboru', value: { version: 2, sourceCalendarIds: ['primary', 'kolo@group.calendar.google.com'], publicationTargetCalendarId: 'praca@group.calendar.google.com' } },
  none: { summary: 'Bez kalendarza publikacji', value: { version: 2, sourceCalendarIds: ['primary'], publicationTargetCalendarId: null } },
};
