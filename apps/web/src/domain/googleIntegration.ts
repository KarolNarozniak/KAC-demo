// Panel „Google Calendar” w Ustawieniach (S23KC2S1P2-12, G02 / S23KC2S1P2-286): stan panelu i teksty dla użytkownika.
// Czyste funkcje bez React – testowane w tests/googleIntegration.test.ts. Tokeny nigdy nie trafiają do aplikacji; serwer zwraca tylko stan.

export type GoogleAccess = { calendarsRead: boolean; eventsWrite: boolean };
export type GoogleAccountView = { email: string; connectedAt: string | null; grantedScopes: string[]; access: GoogleAccess };
export type GoogleIntegrationStatus = {
  mode: 'google' | 'demo';
  ready: boolean;
  problem: 'token_key_missing' | 'token_key_invalid' | null;
  status: 'not_connected' | 'connected' | 'reconnect_required';
  account: GoogleAccountView | null;
  requestedAccess: GoogleAccess;
  demoAccounts: string[];
};
export type AttemptPurpose = 'connect' | 'change_account' | 'reconnect';
export type AttemptStatus = 'pending' | 'processing' | 'connected' | 'denied' | 'error' | 'cancelled' | 'expired';
export type IntegrationAttempt = {
  attemptId: string; status: AttemptStatus; errorCode: string | null; purpose: AttemptPurpose; mode: 'google' | 'demo'; expiresAt: string; authUrl?: string;
};
export type AccessRole = 'owner' | 'writer' | 'reader' | 'freeBusyReader';
export type IntegrationCalendar = { id: string; name: string; primary: boolean; accessRole: AccessRole; timeZone: string | null };

export type PanelState = 'loading' | 'offline' | 'unavailable' | 'connecting' | 'not_connected' | 'connected' | 'reconnect_required';
export type Notice = { tone: 'success' | 'info' | 'error'; text: string };

/** Co odpytywać i jak często, gdy strona zgody Google jest otwarta w innej karcie. */
export const ATTEMPT_POLL_MS = 2000;
/** Zapas po terminie próby – gdy serwer jest chwilowo nieosiągalny, nie czekamy w nieskończoność. */
export const ATTEMPT_GRACE_MS = 15_000;

export const attemptFinished = (status: AttemptStatus) => status !== 'pending' && status !== 'processing';

/** Stan panelu z odpowiedzi serwera, błędu wczytania i trwającej próby połączenia. */
export function panelState(input: { status: GoogleIntegrationStatus | null; loadError: string | null; attempt: IntegrationAttempt | null }): PanelState {
  if (input.attempt && !attemptFinished(input.attempt.status)) return 'connecting';
  if (!input.status) {
    if (!input.loadError) return 'loading';
    return input.loadError === 'network' ? 'offline' : 'unavailable';
  }
  if (!input.status.ready) return 'unavailable';
  return input.status.status;
}

/** Próba czeka dłużej niż pozwala serwer (np. brak odpowiedzi API) – kończymy ją po stronie aplikacji. */
export const attemptOverdue = (attempt: Pick<IntegrationAttempt, 'expiresAt'>, now: number) => now > new Date(attempt.expiresAt).getTime() + ATTEMPT_GRACE_MS;

/** Krok 2: zakres dostępu, o który aplikacja poprosi, zanim użytkownik przejdzie do Google. */
export function requestedAccessLines(access: GoogleAccess): string[] {
  const lines: string[] = [];
  if (access.calendarsRead) lines.push('Odczyt listy Twoich kalendarzy i ich wydarzeń');
  if (access.eventsWrite) lines.push('Dodawanie i zmiana wydarzeń w wybranym kalendarzu (np. publikacja zaakceptowanego grafiku pracy)');
  return lines;
}

/** Dostęp, który użytkownik realnie przyznał – może być węższy niż ten, o który prosiliśmy. */
export function grantedAccessLines(access: GoogleAccess): { text: string; granted: boolean }[] {
  return [
    { text: 'Odczyt kalendarzy i wydarzeń', granted: access.calendarsRead },
    { text: 'Dodawanie i zmiana wydarzeń', granted: access.eventsWrite },
  ];
}

export function grantedAccessWarning(access: GoogleAccess): string | null {
  if (!access.calendarsRead) return 'Nie przyznano odczytu kalendarzy – lista kalendarzy nie jest dostępna. Wybierz „Połącz ponownie” i zaznacz dostęp do kalendarza.';
  if (!access.eventsWrite) return 'Nie przyznano zapisu wydarzeń – publikacja grafiku w Google nie będzie możliwa. Wybierz „Połącz ponownie” i zaznacz dostęp do wydarzeń.';
  return null;
}

const ROLE_LABELS: Record<AccessRole, string> = { owner: 'właściciel', writer: 'odczyt i zapis', reader: 'tylko odczyt', freeBusyReader: 'tylko wolny/zajęty' };
const ROLE_ORDER: Record<AccessRole, number> = { owner: 0, writer: 1, reader: 2, freeBusyReader: 3 };
export const accessRoleLabel = (role: AccessRole) => ROLE_LABELS[role];
export const canWriteTo = (calendar: Pick<IntegrationCalendar, 'accessRole'>) => calendar.accessRole === 'owner' || calendar.accessRole === 'writer';

/** Krok 7: najpierw kalendarz główny, potem te z prawem zapisu, na końcu tylko do odczytu; w grupie – alfabetycznie. */
export function sortCalendars(calendars: IntegrationCalendar[]): IntegrationCalendar[] {
  return [...calendars].sort((a, b) => Number(b.primary) - Number(a.primary) || ROLE_ORDER[a.accessRole] - ROLE_ORDER[b.accessRole]
    || a.name.localeCompare(b.name, 'pl'));
}

export function calendarsSummary(calendars: IntegrationCalendar[], complete: boolean): string {
  if (!calendars.length) return 'To konto nie ma żadnych kalendarzy. Połączenie zostaje – możesz dodać kalendarz w Google albo zmienić konto.';
  const writable = calendars.filter(canWriteTo).length;
  const total = `${calendars.length} ${plural(calendars.length, 'kalendarz', 'kalendarze', 'kalendarzy')}`;
  const writes = writable ? ` (z prawem zapisu: ${writable})` : ' – żaden nie pozwala na zapis wydarzeń';
  return `${complete ? '' : 'Pierwsze '}${total}${writes}.${complete ? '' : ' Google zwrócił więcej kalendarzy, niż mieści lista.'}`;
}

function plural(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  const tens = count % 100, units = count % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

export function connectedAtLabel(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `połączono ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** „Zmień konto”: obecne połączenie zostaje do chwili udanego zalogowania na nowe konto. */
export const changeAccountWarning = (email: string) =>
  `Obecne połączenie z ${email} zostanie zastąpione dopiero po udanym zalogowaniu na inne konto. Jeśli anulujesz albo odmówisz zgody, zostanie bez zmian.`;

/** Wynik zakończonej próby połączenia (5a, 6a, anulowanie, konflikt kont). */
export function attemptNotice(attempt: Pick<IntegrationAttempt, 'status' | 'errorCode' | 'purpose'>): Notice | null {
  const keep = attempt.purpose === 'connect' ? 'Twoje dane w KAC pozostały bez zmian.' : 'Dotychczasowe połączenie zostało bez zmian.';
  switch (attempt.status) {
    case 'connected':
      return { tone: 'success', text: attempt.purpose === 'change_account' ? 'Zmieniono konto Google.' : 'Połączono z Google Calendar.' };
    case 'denied':
      // Historyjka 17, 5a: odmowa przy ponownym logowaniu wyłącza synchronizację.
      if (attempt.purpose === 'reconnect') return { tone: 'info', text: 'Nie udzielono zgody – synchronizacja z Google jest wyłączona. Lokalne wydarzenia pozostały bez zmian.' };
      return attempt.errorCode === 'calendar_scope_missing'
        ? { tone: 'error', text: `Zgoda nie obejmowała dostępu do kalendarza, więc konto nie zostało połączone. Spróbuj ponownie i zaznacz dostęp do kalendarza. ${keep}` }
        : { tone: 'info', text: `Nie udzielono zgody – konto Google nie zostało połączone. ${keep}` };
    case 'cancelled':
      return { tone: 'info', text: `Anulowano łączenie z Google. ${keep}` };
    case 'expired':
      return { tone: 'info', text: `Czas na zalogowanie w Google minął. Spróbuj ponownie. ${keep}` };
    case 'error':
      return { tone: 'error', text: `${attemptErrorText(attempt.errorCode)} ${keep}` };
    default:
      return null;
  }
}

function attemptErrorText(code: string | null): string {
  switch (code) {
    case 'already_connected': return 'Masz już połączone konto Google – żeby połączyć inne, użyj „Zmień konto”.';
    case 'reconnect_account_mismatch': return 'Wybrano inne konto Google niż połączone – żeby je zmienić, użyj „Zmień konto”.';
    case 'no_refresh_token': return 'Google nie wydał trwałego dostępu. Usuń dostęp KAC w ustawieniach konta Google (Bezpieczeństwo → Aplikacje innych firm) i połącz ponownie.';
    case 'authorization_code_invalid': return 'Kod logowania wygasł albo został już użyty. Spróbuj ponownie.';
    case 'google_unavailable': return 'Google nie odpowiada. Sprawdź połączenie z internetem i spróbuj ponownie.';
    case 'missing_account_identity': return 'Google nie potwierdził adresu e-mail konta. Wybierz konto z potwierdzonym adresem.';
    default: return 'Nie udało się połączyć z Google (błąd autoryzacji). Spróbuj ponownie.';
  }
}

/** Błędy API panelu → komunikat. „network” to brak internetu albo serwera KAC (2a). */
export function apiErrorMessage(code: string): string {
  switch (code) {
    case 'network': return 'Brak połączenia z internetem albo z serwerem KAC. Sprawdź połączenie i spróbuj ponownie.';
    case 'integration_not_configured': return 'Serwer działa bez bazy danych, więc nie może zapisać połączenia z Google.';
    case 'token_key_missing': return 'Serwer nie ma klucza szyfrowania danych Google (GOOGLE_TOKEN_ENCRYPTION_KEY), więc logowanie jest wyłączone. Twoje dane w KAC są bez zmian.';
    case 'token_key_invalid': return 'Klucz szyfrowania danych Google na serwerze jest nieprawidłowy (wymagane 32 bajty w base64), więc logowanie jest wyłączone.';
    case 'already_connected': return 'Konto Google jest już połączone. Użyj „Zmień konto” albo „Połącz ponownie”.';
    case 'not_connected': return 'Konto Google nie jest połączone.';
    case 'attempt_not_found': return 'Próba połączenia wygasła. Spróbuj ponownie.';
    case 'invalid_demo_account': return 'Wybierz jedno z kont z listy.';
    case 'reconnect_required': return 'Google nie przyjął zapisanego dostępu – połącz konto ponownie. Twoje dane w KAC są bez zmian.';
    case 'insufficient_permissions': return 'Przyznany dostęp nie pozwala odczytać listy kalendarzy. Wybierz „Połącz ponownie” i zaznacz dostęp do kalendarza.';
    case 'rate_limited': return 'Google chwilowo ogranicza liczbę zapytań. Spróbuj ponownie za chwilę.';
    case 'network_error': return 'Brak połączenia z Google – sprawdź internet i spróbuj ponownie.';
    case 'api_not_enabled': return 'W projekcie Google Cloud nie jest włączone Google Calendar API. Włącz je w konsoli Google Cloud.';
    case 'sync_disabled': return SYNC_DISABLED_TEXT;
    case 'sync_in_progress': return 'Synchronizacja już trwa – poczekaj na jej wynik.';
    case 'google_unavailable':
    case 'google_error': return 'Google nie odpowiada. Spróbuj ponownie za chwilę.';
    default: return `Operacja nie powiodła się (${code}). Spróbuj ponownie.`;
  }
}

/** Problem z konfiguracją serwera pokazywany zamiast przycisku logowania. */
export const unavailableMessage = (status: GoogleIntegrationStatus | null, loadError: string | null) =>
  apiErrorMessage(status?.problem ?? loadError ?? 'integration_not_configured');

// --- Synchronizacja i błędy (S23KC2S1P2-17, G06) ---

export type SyncErrorClass = 'network' | 'reconnect' | 'permissions' | 'rate_limit' | 'server' | 'other';
export type SyncState = 'never' | 'running' | 'success' | 'partial' | 'error';
export type SyncAttempt = {
  id: string; direction: 'read' | 'publish'; scope: string | null; operation: string; status: 'running' | 'success' | 'partial' | 'error';
  startedAt: string; finishedAt: string | null; tries: number; changes: number; errorCode: string | null; message: string | null;
  errorClass: SyncErrorClass | null; retryable: boolean;
};
export type SyncStatus = {
  connection: 'not_connected' | 'connected' | 'reconnect_required'; enabled: boolean; state: SyncState;
  lastAttempt: SyncAttempt | null; lastSuccess: { read: string | null; publish: string | null }; history: SyncAttempt[];
};
export type SimulatedFailure = 'network' | 'flaky' | 'auth' | 'server' | 'rate_limit' | 'partial' | 'permissions';

/** Makieta: przyciski wymuszające wynik, żeby pokazać przebiegi błędów bez prawdziwego Google. */
export const SIMULATIONS: { id: SimulatedFailure | null; label: string }[] = [
  { id: null, label: 'Bez błędu' }, { id: 'network', label: 'Brak internetu' }, { id: 'flaky', label: 'Chwilowy błąd sieci' },
  { id: 'auth', label: 'Wygasłe logowanie' }, { id: 'server', label: 'Błąd serwera Google' }, { id: 'rate_limit', label: 'Limit zapytań' },
  { id: 'partial', label: 'Wynik częściowy' }, { id: 'permissions', label: 'Brak uprawnień' },
];

const SYNC_STATE_LABELS: Record<SyncState, string> = {
  never: 'Nigdy nie synchronizowano', running: 'W trakcie', success: 'Zsynchronizowano', partial: 'Częściowo', error: 'Błąd',
};
export const syncStateLabel = (state: SyncState) => SYNC_STATE_LABELS[state];

const ERROR_CLASS_LABELS: Record<SyncErrorClass, string> = {
  network: 'Brak połączenia – brak internetu albo Google nie odpowiedział na czas',
  reconnect: 'Wygasłe logowanie – Google nie przyjmuje zapisanego dostępu',
  permissions: 'Brak uprawnień do kalendarza',
  rate_limit: 'Limit zapytań Google – spróbuj za chwilę',
  server: 'Błąd po stronie Google',
  other: 'Inny błąd',
};
export const syncErrorLabel = (attempt: Pick<SyncAttempt, 'errorClass' | 'errorCode'>) =>
  attempt.errorCode === 'api_not_enabled' ? 'W projekcie Google Cloud nie jest włączone Google Calendar API' : ERROR_CLASS_LABELS[attempt.errorClass ?? 'other'];

const dateTime = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const lastSuccessLabel = (status: Pick<SyncStatus, 'lastSuccess'>) =>
  status.lastSuccess.read ? `Ostatnia udana synchronizacja: ${dateTime(status.lastSuccess.read)}` : 'Ostatnia udana synchronizacja: jeszcze nie było';
export const attemptTimeLabel = (attempt: Pick<SyncAttempt, 'startedAt'>) => dateTime(attempt.startedAt);

/** Które przyciski pokazać po próbie (krok 2 historyjki 17). Przy wygasłym logowaniu zwykłe ponowienie nic nie da. */
export function syncActions(status: Pick<SyncStatus, 'enabled' | 'connection' | 'state' | 'lastAttempt'>): { sync: boolean; retry: boolean; reconnect: boolean } {
  const needsLogin = !status.enabled || status.connection === 'reconnect_required' || status.lastAttempt?.errorClass === 'reconnect';
  const failed = status.state === 'error' || status.state === 'partial';
  return {
    sync: status.enabled && !needsLogin && !failed && status.state !== 'running',
    retry: status.enabled && !needsLogin && failed && Boolean(status.lastAttempt?.retryable),
    reconnect: needsLogin || status.lastAttempt?.errorClass === 'permissions',
  };
}

/** Komunikat po próbie: sukces (2a), wynik częściowy albo błąd z przyczyną i zapewnieniem o danych lokalnych. */
export function syncResultNotice(attempt: SyncAttempt): Notice {
  if (attempt.status === 'success') return { tone: 'success', text: `Synchronizacja zakończona. ${attempt.message ?? ''}`.trim() };
  if (attempt.status === 'partial') return { tone: 'info', text: `Synchronizacja częściowa – ${attempt.message ?? 'nie wszystko udało się odczytać.'} Lokalne wydarzenia pozostały bez zmian.` };
  const retries = attempt.tries > 1 ? ` (próby: ${attempt.tries})` : '';
  return { tone: 'error', text: `Synchronizacja nie powiodła się${retries}: ${syncErrorLabel(attempt)}. Lokalne wydarzenia pozostały bez zmian.` };
}

export const SYNC_DISABLED_TEXT = 'Synchronizacja jest wyłączona, bo przy ponownym logowaniu nie udzielono zgody. Lokalne wydarzenia pozostały bez zmian.';
