// Synchronizacja z Google: rejestr prób, ostatni sukces i kontrolowane ponowienia (S23KC2S1P2-17, G06 / S23KC2S1P2-290).
//
// Każda próba trafia do t_synchronizacje (kierunek, zakres, operacja, liczba prób, wynik, kod błędu, czas). Ostatni sukces odczytu
// i publikacji jest w koncie osobno, więc nieudana próba go nie nadpisuje. Błędy przejściowe (sieć, limit, błąd serwera Google)
// są ponawiane najwyżej kilka razy z rosnącą przerwą; brak zgody nie jest ponawiany, tylko prowadzi do „Połącz ponownie”.
// Dziś synchronizacja odczytuje listę kalendarzy. Pobieranie wydarzeń (G05), publikacja (G07) i korekty (G09) mają korzystać
// z tego samego rejestru (operation/scope), zamiast budować własne mechanizmy ponowień.
import type { UserScope } from '../../api/scope.js';
import { demoIntegrationCalendars } from './demo.js';
import { accessFromScopes, GoogleIntegrationError, type GoogleErrorCode, type IntegrationCalendar } from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository, SyncAttemptRecord, SyncDirection } from './repository.js';
import type { GoogleIntegrationService } from './service.js';

/** Klasa błędu widoczna dla użytkownika – zgodna z potrzebami informacyjnymi historyjek 17 i 47. */
export type SyncErrorClass = 'network' | 'reconnect' | 'permissions' | 'rate_limit' | 'server' | 'other';
export type SyncState = 'never' | 'running' | 'success' | 'partial' | 'error';
/** Makieta: wymuszony wynik, żeby pokazać przebiegi błędów bez prawdziwego Google. */
export const SIMULATED_FAILURES = ['network', 'flaky', 'auth', 'server', 'rate_limit', 'partial', 'permissions'] as const;
export type SimulatedFailure = typeof SIMULATED_FAILURES[number];

export type SyncAttemptView = Omit<SyncAttemptRecord, 'accountId'> & { errorClass: SyncErrorClass | null; retryable: boolean };
export type SyncStatusView = {
  connection: 'not_connected' | 'connected' | 'reconnect_required';
  enabled: boolean;
  state: SyncState;
  lastAttempt: SyncAttemptView | null;
  lastSuccess: { read: string | null; publish: string | null };
  history: SyncAttemptView[];
};

export class SyncFlowError extends Error {
  constructor(readonly code: 'not_connected' | 'sync_disabled' | 'sync_in_progress' | 'demo_only', readonly status: number) { super(code); }
}

const TRANSIENT = new Set<string>(['network_error', 'google_unavailable', 'rate_limited']);
export const isTransientCode = (code: string | null | undefined) => Boolean(code && TRANSIENT.has(code));

export function classifySyncError(code: string | null | undefined): SyncErrorClass | null {
  if (!code) return null;
  switch (code) {
    case 'network_error': return 'network';
    case 'reconnect_required': return 'reconnect';
    case 'insufficient_permissions':
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
  rate_limited: 'Google chwilowo ogranicza liczbę zapytań.',
  google_unavailable: 'Google zwrócił błąd serwera.',
  google_error: 'Google odrzucił zapytanie.',
  api_not_enabled: 'W projekcie Google Cloud nie jest włączone Google Calendar API.',
  sync_interrupted: 'Próba została przerwana (np. restart serwera).',
};
const messageFor = (code: string) => MESSAGES[code] ?? 'Synchronizacja nie powiodła się.';

const view = ({ accountId: _accountId, ...attempt }: SyncAttemptRecord): SyncAttemptView => ({
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
};

export class GoogleSyncService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly baseDelayMs: number;

  constructor(private readonly repository: PostgresGoogleIntegrationRepository, private readonly integration: GoogleIntegrationService, options: SyncOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxTries = Math.max(1, options.maxTries ?? 3);
    this.baseDelayMs = options.baseDelayMs ?? 500;
  }

  async status(scope: UserScope): Promise<SyncStatusView> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) return { connection: 'not_connected', enabled: false, state: 'never', lastAttempt: null, lastSuccess: { read: null, publish: null }, history: [] };
    await this.repository.failStaleSyncAttempts(account.accountId);
    const history = (await this.repository.listSyncAttempts(account.accountId)).map(view);
    const last = history[0] ?? null;
    return {
      connection: account.status, enabled: account.syncEnabled,
      state: last ? (last.status === 'running' ? 'running' : last.status) : 'never',
      lastAttempt: last, lastSuccess: { read: account.lastSyncAt, publish: account.lastPublishAt }, history,
    };
  }

  /**
   * „Synchronizuj z Google” (krok 1 historyjki 17): odczyt listy kalendarzy z ograniczonymi ponowieniami.
   * Błędy Google nie są błędami HTTP – wynik próby (także nieudanej) wraca w odpowiedzi, a dane lokalne zostają bez zmian.
   */
  async runRead(scope: UserScope, options: { simulate?: SimulatedFailure } = {}): Promise<{ attempt: SyncAttemptView; status: SyncStatusView }> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new SyncFlowError('not_connected', 404);
    if (options.simulate && account.mode !== 'demo') throw new SyncFlowError('demo_only', 409);
    if (!account.syncEnabled) throw new SyncFlowError('sync_disabled', 409);
    await this.repository.failStaleSyncAttempts(account.accountId);
    const started = await this.repository.startSyncAttempt(account, { direction: 'read', scope: 'calendar_list', operation: 'Lista kalendarzy' });
    if (!started) throw new SyncFlowError('sync_in_progress', 409);

    const finished = await this.execute(started, account, options.simulate);
    return { attempt: view(finished), status: await this.status(scope) };
  }

  private async execute(attempt: SyncAttemptRecord, account: GoogleAccountRecord, simulate?: SimulatedFailure): Promise<SyncAttemptRecord> {
    // Konto już wymaga ponownego logowania – nie pytamy Google, tylko zapisujemy wynik z przyczyną.
    if (account.status === 'reconnect_required') return this.fail(attempt, 1, 'reconnect_required');
    if (!accessFromScopes(account.grantedScopes).calendarsRead) return this.fail(attempt, 1, 'insufficient_permissions');
    for (let tries = 1; ; tries++) {
      try {
        const listed = await this.readCalendars(account, simulate, tries);
        return this.repository.finishSyncAttempt(attempt.id, listed.complete
          ? { status: 'success', tries, changes: listed.calendars.length, errorCode: null, message: `Odczytane kalendarze: ${listed.calendars.length}.` }
          : { status: 'partial', tries, changes: listed.calendars.length, errorCode: 'incomplete_list',
            message: `Odczytane kalendarze: ${listed.calendars.length}, ale Google zwrócił więcej, niż mieści jedna synchronizacja.` });
      } catch (error) {
        const code: string = error instanceof GoogleIntegrationError ? error.code : 'google_error';
        if (isTransientCode(code) && tries < this.maxTries) {
          await this.repository.setSyncTries(attempt.id, tries + 1);
          await this.sleep(this.baseDelayMs * 2 ** (tries - 1));
          continue;
        }
        return this.fail(attempt, tries, code);
      }
    }
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
    }
  }
}
