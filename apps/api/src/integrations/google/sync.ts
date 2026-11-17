// Synchronizacja z Google: rejestr prób, ostatni sukces i kontrolowane ponowienia (S23KC2S1P2-17, G06 / S23KC2S1P2-290).
//
// Każda próba trafia do t_synchronizacje (kierunek, zakres, operacja, liczba prób, wynik, kod błędu, czas). Ostatni sukces odczytu
// i publikacji jest w koncie osobno, więc nieudana próba go nie nadpisuje. Błędy przejściowe (sieć, limit, błąd serwera Google)
// są ponawiane najwyżej kilka razy z rosnącą przerwą; brak zgody nie jest ponawiany, tylko prowadzi do „Połącz ponownie”.
// Synchronizacja odczytuje listę kalendarzy, a potem pobiera i stosuje zmiany wydarzeń z wybranych kalendarzy (G05, events-sync.ts).
// Publikacja (G07) i korekty (G09) korzystają z tego samego rejestru (operation/scope), zamiast budować własne mechanizmy ponowień.
import type { UserScope } from '../../api/scope.js';
import { demoIntegrationCalendars } from './demo.js';
import { accessFromScopes, GoogleIntegrationError, type GoogleErrorCode, type IntegrationCalendar } from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository, SyncAttemptRecord, SyncDirection } from './repository.js';
import type { CalendarSyncResult, EventSyncSimulation } from './events-sync.js';
import type { GoogleIntegrationService } from './service.js';

/** Klasa błędu widoczna dla użytkownika – zgodna z potrzebami informacyjnymi historyjek 17 i 47. */
export type SyncErrorClass = 'network' | 'reconnect' | 'permissions' | 'rate_limit' | 'server' | 'other';
export type SyncState = 'never' | 'running' | 'success' | 'partial' | 'error';
/** Makieta: wymuszony wynik, żeby pokazać przebiegi błędów bez prawdziwego Google. */
export const SIMULATED_FAILURES = ['network', 'flaky', 'auth', 'server', 'rate_limit', 'partial', 'permissions', 'remote_changes', 'page_error', 'token_expired'] as const;
const EVENT_SIMULATIONS = new Set<string>(['remote_changes', 'page_error', 'token_expired']);
export type SimulatedFailure = typeof SIMULATED_FAILURES[number];

export type SyncAttemptView = Omit<SyncAttemptRecord, 'accountId'> & { errorClass: SyncErrorClass | null; retryable: boolean };
/** Wynik pobierania zmian (G05) per kalendarz – do komunikatu po synchronizacji (krok 7 historyjki 23). */
export type SyncSummary = { calendars: CalendarSyncResult[] };

/** „Pobrano zmiany: 3 nowe, 1 zmienione…” – jedna linia do rejestru prób i komunikatu w panelu. */
export function summaryMessage(calendars: CalendarSyncResult[]): string {
  const ok = calendars.filter((calendar) => !calendar.errorCode);
  const sum = (key: 'created' | 'updated' | 'deleted' | 'conflicts' | 'skippedAllDay') => ok.reduce((total, calendar) => total + calendar[key], 0);
  const parts = [['nowe', sum('created')], ['zmienione', sum('updated')], ['usunięte', sum('deleted')]].filter(([, value]) => value) as [string, number][];
  const changes = parts.length ? `Pobrano zmiany z Google: ${parts.map(([label, value]) => `${label} ${value}`).join(', ')}.` : 'Brak zmian w Google.';
  const extra = [sum('conflicts') ? `konflikty z edycją w KAC: ${sum('conflicts')}` : '', sum('skippedAllDay') ? `pominięte całodniowe: ${sum('skippedAllDay')}` : '']
    .filter(Boolean).join(', ');
  const failed = calendars.filter((calendar) => calendar.errorCode).map((calendar) => `„${calendar.name}”`);
  return [`Kalendarze: ${ok.length}.`, changes, extra ? `(${extra})` : '', failed.length ? `Nie udało się pobrać: ${failed.join(', ')}.` : '']
    .filter(Boolean).join(' ');
}
export type SyncStatusView = {
  connection: 'not_connected' | 'connected' | 'reconnect_required';
  enabled: boolean;
  /** Liczba wybranych kalendarzy źródłowych (G04). Bez wyboru synchronizacja nie rusza, ale konto zostaje. */
  sourcesSelected: number;
  state: SyncState;
  lastAttempt: SyncAttemptView | null;
  lastSuccess: { read: string | null; publish: string | null };
  history: SyncAttemptView[];
};

export class SyncFlowError extends Error {
  constructor(readonly code: 'not_connected' | 'sync_disabled' | 'sync_in_progress' | 'demo_only' | 'no_calendars_selected', readonly status: number) { super(code); }
}

const TRANSIENT = new Set<string>(['network_error', 'google_unavailable', 'rate_limited']);
export const isTransientCode = (code: string | null | undefined) => Boolean(code && TRANSIENT.has(code));

export function classifySyncError(code: string | null | undefined): SyncErrorClass | null {
  if (!code) return null;
  switch (code) {
    case 'network_error': return 'network';
    case 'reconnect_required': return 'reconnect';
    case 'insufficient_permissions':
    case 'calendar_not_writable':
    case 'calendar_not_found': return 'permissions';
    case 'rate_limited': return 'rate_limit';
    case 'google_unavailable':
    case 'google_error':
    case 'api_not_enabled': return 'server';
    default: return 'other';
  }
}

const MESSAGES: Record<string, string> = {
  network_error: 'Brak połączenia z Google (brak internetu albo przekroczony czas).',
  reconnect_required: 'Google nie przyjmuje zapisanego dostępu – trzeba ponownie połączyć konto.',
  insufficient_permissions: 'Przyznany dostęp nie pozwala odczytać kalendarzy.',
  calendar_not_found: 'Kalendarz nie istnieje albo konto straciło do niego dostęp.',
  calendar_not_writable: 'Konto nie ma prawa dodawać wydarzeń do wybranego kalendarza.',
  rate_limited: 'Google chwilowo ogranicza liczbę zapytań.',
  google_unavailable: 'Google zwrócił błąd serwera.',
  google_error: 'Google odrzucił zapytanie.',
  api_not_enabled: 'W projekcie Google Cloud nie jest włączone Google Calendar API.',
  incomplete_list: 'Google zwrócił więcej kalendarzy, niż mieści jedna synchronizacja.',
  calendar_too_large: 'Kalendarz ma więcej wydarzeń, niż KAC pobiera w jednej synchronizacji – nic z niego nie zapisano.',
  sync_apply_failed: 'Nie udało się zapisać zmian w KAC – nic nie zostało zmienione, następna próba zacznie od tego samego miejsca.',
  sync_token_expired: 'Google unieważnił znacznik zmian – potrzebny jest pełny odczyt kalendarza.',
  sync_interrupted: 'Próba została przerwana (np. restart serwera).',
};
export const messageFor = (code: string) => MESSAGES[code] ?? 'Synchronizacja nie powiodła się.';

export const attemptView = ({ accountId: _accountId, ...attempt }: SyncAttemptRecord): SyncAttemptView => ({
  ...attempt,
  errorClass: attempt.status === 'error' ? classifySyncError(attempt.errorCode) : null,
  // Ponowienie ma sens, gdy błąd nie wymaga nowej zgody; przy „Połącz ponownie” zwykłe ponowienie nic nie da.
  retryable: attempt.status === 'error' || attempt.status === 'partial' ? attempt.errorCode !== 'reconnect_required' : false,
});

export type SyncOptions = {
  /** Czekanie między ponowieniami – w testach atrapa zegara. */
  sleep?: (ms: number) => Promise<void>;
  /** Łączna liczba prób w jednym uruchomieniu (pierwsza + ponowienia). */
  maxTries?: number;
  baseDelayMs?: number;
  /** Zegar okna odczytu wydarzeń (G05) – w testach stała data. */
  now?: () => Date;
};

export class GoogleSyncService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly baseDelayMs: number;
  private readonly now: () => Date;

  constructor(private readonly repository: PostgresGoogleIntegrationRepository, private readonly integration: GoogleIntegrationService, options: SyncOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxTries = Math.max(1, options.maxTries ?? 3);
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.now = options.now ?? (() => new Date());
  }

  async status(scope: UserScope): Promise<SyncStatusView> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) return { connection: 'not_connected', enabled: false, sourcesSelected: 0, state: 'never', lastAttempt: null, lastSuccess: { read: null, publish: null }, history: [] };
    await this.repository.failStaleSyncAttempts(account.accountId);
    const history = (await this.repository.listSyncAttempts(account.accountId)).map(attemptView);
    // Stan sekcji synchronizacji wynika z odczytów; próby publikacji (G07) są w tej samej historii, ale mają własny wynik w widoku grafiku.
    const last = history.find((attempt) => attempt.direction === 'read') ?? null;
    return {
      connection: account.status, enabled: account.syncEnabled, sourcesSelected: await this.repository.countSourceCalendars(account.accountId),
      state: last ? (last.status === 'running' ? 'running' : last.status) : 'never',
      lastAttempt: last, lastSuccess: { read: account.lastSyncAt, publish: account.lastPublishAt }, history,
    };
  }

  /**
   * „Synchronizuj z Google” (krok 1 historyjki 17): odczyt listy kalendarzy z ograniczonymi ponowieniami.
   * Błędy Google nie są błędami HTTP – wynik próby (także nieudanej) wraca w odpowiedzi, a dane lokalne zostają bez zmian.
   */
  async runRead(scope: UserScope, options: { simulate?: SimulatedFailure } = {}): Promise<{ attempt: SyncAttemptView; status: SyncStatusView; summary: SyncSummary | null }> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new SyncFlowError('not_connected', 404);
    if (options.simulate && account.mode !== 'demo') throw new SyncFlowError('demo_only', 409);
    if (!account.syncEnabled) throw new SyncFlowError('sync_disabled', 409);
    // G04: synchronizacja dotyczy wybranych kalendarzy – bez wyboru nie rusza (konto i dane zostają).
    if (await this.repository.countSourceCalendars(account.accountId) === 0) throw new SyncFlowError('no_calendars_selected', 409);
    await this.repository.failStaleSyncAttempts(account.accountId);
    const started = await this.repository.startSyncAttempt(account, { direction: 'read', scope: 'events', operation: 'Pobieranie zmian z Google' });
    if (!started) throw new SyncFlowError('sync_in_progress', 409);

    const { attempt, summary } = await this.execute(scope, started, account, options.simulate);
    return { attempt: attemptView(attempt), status: await this.status(scope), summary };
  }

  /**
   * 1. lista kalendarzy (ponowienia błędów przejściowych), 2. zmiany wydarzeń z wybranych kalendarzy (G05).
   * Wynik częściowy: niepełna lista kalendarzy albo część kalendarzy bez powodzenia – to, co się udało, jest zapisane.
   */
  private async execute(scope: UserScope, attempt: SyncAttemptRecord, account: GoogleAccountRecord, simulate?: SimulatedFailure): Promise<{ attempt: SyncAttemptRecord; summary: SyncSummary | null }> {
    // Konto już wymaga ponownego logowania – nie pytamy Google, tylko zapisujemy wynik z przyczyną.
    if (account.status === 'reconnect_required') return { attempt: await this.fail(attempt, 1, 'reconnect_required'), summary: null };
    if (!accessFromScopes(account.grantedScopes).calendarsRead) return { attempt: await this.fail(attempt, 1, 'insufficient_permissions'), summary: null };
    const listSimulation = simulate && !EVENT_SIMULATIONS.has(simulate) ? simulate : undefined;
    let listed: { calendars: IntegrationCalendar[]; complete: boolean } | null = null;
    let tries = 1;
    for (; ; tries++) {
      try {
        listed = await this.readCalendars(account, listSimulation, tries);
        break;
      } catch (error) {
        const code: string = error instanceof GoogleIntegrationError ? error.code : 'google_error';
        if (isTransientCode(code) && tries < this.maxTries) {
          await this.repository.setSyncTries(attempt.id, tries + 1);
          await this.sleep(this.baseDelayMs * 2 ** (tries - 1));
          continue;
        }
        return { attempt: await this.fail(attempt, tries, code), summary: null };
      }
    }
    const events = await this.integration.events.syncSources(scope, account, {
      simulate: simulate && EVENT_SIMULATIONS.has(simulate) ? simulate as EventSyncSimulation : null,
      sleep: this.sleep, maxTries: this.maxTries, baseDelayMs: this.baseDelayMs, now: this.now(),
    });
    const summary = { calendars: events.calendars };
    const failed = events.calendars.filter((calendar) => calendar.errorCode);
    const changes = events.calendars.reduce((total, calendar) => total + calendar.created + calendar.updated + calendar.deleted, 0);
    const errorCode = !listed.complete ? 'incomplete_list' : failed[0]?.errorCode ?? null;
    const status = !errorCode ? 'success' : failed.length === events.calendars.length && listed.complete ? 'error' : 'partial';
    const message = !listed.complete ? `${messageFor('incomplete_list')} ${summaryMessage(events.calendars)}` : summaryMessage(events.calendars);
    return { attempt: await this.repository.finishSyncAttempt(attempt.id, { status, tries: Math.max(tries, events.tries), changes, errorCode, message }), summary };
  }

  private fail(attempt: SyncAttemptRecord, tries: number, code: string) {
    return this.repository.finishSyncAttempt(attempt.id, { status: 'error', tries, changes: 0, errorCode: code, message: messageFor(code) });
  }

  private async readCalendars(account: GoogleAccountRecord, simulate: SimulatedFailure | undefined, tries: number): Promise<{ calendars: IntegrationCalendar[]; complete: boolean }> {
    if (!simulate) return this.integration.readCalendars(account);
    const fail = (code: GoogleErrorCode) => { throw new GoogleIntegrationError(code); };
    switch (simulate) {
      case 'network': return fail('network_error');
      case 'flaky': if (tries === 1) fail('network_error'); return this.integration.readCalendars(account);
      case 'server': return fail('google_unavailable');
      case 'rate_limit': return fail('rate_limited');
      case 'permissions': return fail('insufficient_permissions');
      case 'auth':
        // Jak przy cofniętej zgodzie w Google: konto przechodzi w „Wymaga ponownego logowania”.
        await this.repository.markReconnectRequired(account);
        return fail('reconnect_required');
      case 'partial': {
        const all = demoIntegrationCalendars(account.email);
        const calendars = all.slice(0, Math.ceil(all.length / 2));
        await this.repository.saveCalendars(account, calendars, false);
        return { calendars, complete: false };
      }
      // Symulacje zmian wydarzeń (G05) nie dotyczą listy kalendarzy.
      default: return this.integration.readCalendars(account);
    }
  }
}
