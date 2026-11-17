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
    case 'no_calendars_selected': return NO_SOURCES_TEXT;
    case 'selection_conflict': return 'Wybór kalendarzy zmienił się w innym oknie. Nic nie zapisano – wczytaliśmy aktualny wybór, sprawdź go i zapisz ponownie.';
    case 'unknown_calendar': return 'Kalendarza nie ma już na koncie Google. Odśwież listę i wybierz ponownie. Nic nie zapisano.';
    case 'calendar_unavailable': return 'Konto Google straciło dostęp do tego kalendarza. Wybierz inny. Nic nie zapisano.';
    case 'target_not_writable': return 'Do tego kalendarza nie można dodawać wydarzeń. Wybierz kalendarz z prawem zapisu. Nic nie zapisano.';
    case 'write_access_missing': return 'Zgoda Google nie obejmuje dodawania wydarzeń. Połącz konto ponownie i zaznacz ten dostęp. Nic nie zapisano.';
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
  connection: 'not_connected' | 'connected' | 'reconnect_required'; enabled: boolean; sourcesSelected: number; state: SyncState;
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
export function syncActions(status: Pick<SyncStatus, 'enabled' | 'connection' | 'state' | 'lastAttempt'> & { sourcesSelected?: number }): { sync: boolean; retry: boolean; reconnect: boolean } {
  const needsLogin = !status.enabled || status.connection === 'reconnect_required' || status.lastAttempt?.errorClass === 'reconnect';
  const failed = status.state === 'error' || status.state === 'partial';
  // G04: bez wybranych kalendarzy nie ma czego synchronizować – najpierw wybór (konto zostaje połączone).
  const hasSources = (status.sourcesSelected ?? 1) > 0;
  return {
    sync: status.enabled && hasSources && !needsLogin && !failed && status.state !== 'running',
    retry: status.enabled && hasSources && !needsLogin && failed && Boolean(status.lastAttempt?.retryable),
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

// --- Odłączenie konta i cofnięcie zgody (S23KC2S1P2-35, G03) ---

export type DisconnectResult = {
  status: 'not_connected'; account: string | null; alreadyDisconnected: boolean; local: 'removed' | 'nothing_to_remove'; remote: 'revoked' | 'failed' | 'not_applicable';
};

/** Treść okna potwierdzenia: co się stanie, a co zostanie bez zmian. */
export const disconnectWarning = (email: string, mode: 'google' | 'demo') =>
  `Odłączyć konto ${email}? KAC usunie zapisane dane dostępu i zatrzyma synchronizację${mode === 'google' ? ', a potem poprosi Google o cofnięcie zgody' : ''}. ` +
  'Twoje wydarzenia w KAC zostaną bez zmian. Wysłanego już żądania do Google nie da się cofnąć.';

/**
 * Wynik odłączenia. Stan w KAC i stan w Google są opisane osobno – nie mówimy o cofnięciu zgody,
 * jeśli Google go nie potwierdził (usunięto tylko dane lokalne).
 */
export function disconnectNotice(result: DisconnectResult): Notice {
  if (result.alreadyDisconnected) return { tone: 'info', text: 'Konto Google było już odłączone. Nic się nie zmieniło.' };
  const who = result.account ? `konto ${result.account}` : 'konto Google';
  const local = `Odłączono ${who}: KAC usunął dane dostępu i zatrzymał synchronizację. Wydarzenia w KAC zostały bez zmian.`;
  if (result.remote === 'revoked') return { tone: 'success', text: `${local} Google potwierdził cofnięcie zgody.` };
  if (result.remote === 'failed') return { tone: 'error', text: `${local} Nie udało się jednak cofnąć zgody w Google – usuń dostęp KAC ręcznie w ustawieniach konta Google (Bezpieczeństwo → połączenia z aplikacjami innych firm).` };
  return { tone: 'success', text: local };
}

/** Okno jednorazowego importu (S23KC2S1P2-27): informacja, że trwałe połączenie z Ustawień nie jest tu używane. */
export const importLinkedAccountHint = (email: string) =>
  `W Ustawieniach masz połączone konto ${email}. Import jednorazowy ma osobną zgodę – połączenie z Ustawień nie jest tu używane, więc Google poprosi o zgodę jeszcze raz.`;

export const NO_SOURCES_TEXT = 'Nie wybrano kalendarzy do synchronizacji. Wybierz co najmniej jeden powyżej – konto Google zostaje połączone.';

// --- Wybór kalendarzy (S23KC2S1P2-41, G04) ---

export type SelectionCalendar = {
  id: string; name: string; primary: boolean; accessRole: AccessRole | null; timeZone: string | null;
  available: boolean; writable: boolean; source: boolean; publicationTarget: boolean;
};
export type TargetProblem = 'unavailable' | 'not_writable' | 'write_access_missing';
export type CalendarSelection = {
  version: number; calendars: SelectionCalendar[]; sourceCalendarIds: string[]; publicationTargetCalendarId: string | null;
  canPublish: boolean; targetProblem: TargetProblem | null;
};
export type SelectionDraft = { sources: string[]; target: string | null };

export const draftFrom = (selection: CalendarSelection): SelectionDraft =>
  ({ sources: [...selection.sourceCalendarIds], target: selection.publicationTargetCalendarId });

/** Krok 4: zaznaczenie kalendarza źródłowego. Niedostępnego nie da się dodać na nowo – można go tylko odznaczyć. */
export function toggleSource(selection: CalendarSelection, draft: SelectionDraft, id: string): SelectionDraft {
  if (draft.sources.includes(id)) return { ...draft, sources: draft.sources.filter((source) => source !== id) };
  const calendar = selection.calendars.find((item) => item.id === id);
  if (!calendar?.available) return draft;
  return { ...draft, sources: [...draft.sources, id] };
}

/** Krok 5: kandydaci na kalendarz publikacji – tylko dostępne kalendarze z prawem zapisu (serwer sprawdza to jeszcze raz). */
export const targetOptions = (selection: CalendarSelection) => selection.calendars.filter((calendar) => calendar.available && calendar.writable);

/** Problem w szkicu, który blokuje zapis jeszcze przed wysłaniem (np. cel stracił prawo zapisu). */
export function draftProblem(selection: CalendarSelection, draft: SelectionDraft): string | null {
  if (draft.target === null) return null;
  if (!selection.canPublish) return 'Zgoda Google nie obejmuje dodawania wydarzeń, więc nie można ustawić kalendarza publikacji. Połącz konto ponownie albo wybierz „Bez publikacji”.';
  if (!targetOptions(selection).some((calendar) => calendar.id === draft.target)) return 'Wybrany kalendarz publikacji nie pozwala już na dodawanie wydarzeń. Wybierz inny albo „Bez publikacji”.';
  return null;
}

const nameOf = (selection: CalendarSelection, id: string) => selection.calendars.find((calendar) => calendar.id === id)?.name ?? id;

/** Krok 6: podsumowanie zmian przed zatwierdzeniem. Pusta lista – nic się nie zmieniło. */
export function selectionChanges(selection: CalendarSelection, draft: SelectionDraft): string[] {
  const lines: string[] = [];
  const before = new Set(selection.sourceCalendarIds);
  const after = new Set(draft.sources);
  const added = selection.calendars.filter((calendar) => after.has(calendar.id) && !before.has(calendar.id)).map((calendar) => calendar.name);
  const removed = selection.calendars.filter((calendar) => before.has(calendar.id) && !after.has(calendar.id)).map((calendar) => calendar.name);
  if (added.length) lines.push(`Dodane do planowania i synchronizacji: ${added.join(', ')}.`);
  if (removed.length) lines.push(`Wyłączone z przyszłych synchronizacji: ${removed.join(', ')}. Wydarzenia już zapisane w KAC zostają.`);
  if (draft.target !== selection.publicationTargetCalendarId) {
    lines.push(draft.target === null ? 'Bez kalendarza publikacji – grafik nie będzie publikowany w Google.' : `Kalendarz publikacji: ${nameOf(selection, draft.target)}.`);
  }
  if (lines.length && draft.sources.length === 0) lines.push(NO_SOURCES_TEXT);
  return lines;
}

/** Krótkie podsumowanie zapisanego wyboru w widoku panelu. */
export function selectionSummary(selection: CalendarSelection): string {
  const count = selection.sourceCalendarIds.length;
  const sources = count === 0 ? 'Brak kalendarzy do planowania' : count === 1 ? '1 kalendarz do planowania' : `${count} kalendarzy do planowania`;
  const target = selection.publicationTargetCalendarId ? `publikacja: ${nameOf(selection, selection.publicationTargetCalendarId)}` : 'bez kalendarza publikacji';
  return `${sources} · ${target}`;
}

export function targetProblemText(problem: TargetProblem | null): string | null {
  switch (problem) {
    case 'unavailable': return 'Konto Google straciło dostęp do kalendarza publikacji (albo kalendarz usunięto). Wybierz inny – do tego czasu grafik nie zostanie opublikowany.';
    case 'not_writable': return 'Kalendarz publikacji nie pozwala już na dodawanie wydarzeń. Wybierz inny kalendarz z prawem zapisu.';
    case 'write_access_missing': return 'Zgoda Google nie obejmuje dodawania wydarzeń, więc grafik nie zostanie opublikowany. Połącz konto ponownie i zaznacz ten dostęp.';
    default: return null;
  }
}
