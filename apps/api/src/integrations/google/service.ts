// Trwała integracja z Google Calendar – przebieg połączenia (S23KC2S1P2-12, G01 / S23KC2S1P2-284).
// Kroki historyjki: 1–2 stan i zakres dostępu, 3–5 logowanie i zgoda w Google (albo makieta), 6 bezpieczny zapis,
// 7 lista kalendarzy. Samo połączenie nie tworzy, nie zmienia i nie usuwa żadnych wydarzeń.
import { createHash, randomBytes } from 'node:crypto';
import type { UserScope } from '../../api/scope.js';
import { createPkce, type FetchLike } from '../../import/google/oauth.js';
import { DEMO_GRANTED_SCOPES, DEMO_INTEGRATION_ACCOUNTS, demoIntegrationCalendars, demoSub, isDemoAccount } from './demo.js';
import {
  accessFromScopes, exchangeIntegrationCode, GoogleIntegrationError, INTEGRATION_SCOPES, integrationAuthorizationUrl, listIntegrationCalendars,
  type GoogleAccess, type GoogleIntegrationOAuthConfig, type IntegrationCalendar,
} from './oauth-client.js';
import type { Pool } from 'pg';
import { ConnectionConflictError, PostgresGoogleIntegrationRepository, type AttemptPurpose, type AuthAttempt, type GoogleAccountRecord } from './repository.js';
import { TokenCipher } from './token-cipher.js';
import { GoogleTokenService } from './token-service.js';

export type KeyProblem = 'token_key_missing' | 'token_key_invalid' | null;
export type IntegrationOptions = {
  oauth: GoogleIntegrationOAuthConfig | null; cipher: TokenCipher | null; keyProblem?: KeyProblem; fetch?: FetchLike; attemptTtlMinutes?: number;
};

/** Błędy przebiegu połączenia zwracane przez API (kod → status HTTP w trasach). */
export class IntegrationFlowError extends Error {
  constructor(readonly code: 'already_connected' | 'not_connected' | 'attempt_not_found' | 'token_key_missing' | 'token_key_invalid' | 'invalid_demo_account' | 'demo_only', readonly status: number) { super(code); }
}

export type AccountView = { email: string; connectedAt: string | null; grantedScopes: string[]; access: GoogleAccess };
export type IntegrationStatus = {
  mode: 'google' | 'demo'; ready: boolean; problem: KeyProblem;
  status: 'not_connected' | 'connected' | 'reconnect_required';
  account: AccountView | null; requestedAccess: GoogleAccess; demoAccounts: string[];
};
export type CallbackPage = { httpStatus: number; title: string; message: string };

const hashState = (state: string) => createHash('sha256').update(state).digest('hex');
const accountView = (account: GoogleAccountRecord): AccountView => ({
  email: account.email, connectedAt: account.connectedAt, grantedScopes: account.grantedScopes, access: accessFromScopes(account.grantedScopes),
});

export class GoogleIntegrationService {
  readonly tokens: GoogleTokenService;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly repository: PostgresGoogleIntegrationRepository, private readonly options: IntegrationOptions) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.tokens = new GoogleTokenService(repository, options.cipher, options.oauth, this.fetchImpl);
  }

  get mode(): 'google' | 'demo' { return this.options.oauth ? 'google' : 'demo'; }
  private get keyProblem(): KeyProblem {
    if (this.mode === 'demo') return null;
    return this.options.cipher ? null : this.options.keyProblem ?? 'token_key_missing';
  }

  async status(scope: UserScope): Promise<IntegrationStatus> {
    const account = await this.repository.getActiveAccount(scope.userId);
    return {
      mode: this.mode, ready: !this.keyProblem, problem: this.keyProblem,
      status: account ? account.status : 'not_connected',
      account: account ? accountView(account) : null,
      requestedAccess: accessFromScopes(INTEGRATION_SCOPES),
      demoAccounts: this.mode === 'demo' ? [...DEMO_INTEGRATION_ACCOUNTS] : [],
    };
  }

  /** Krok 3: początek logowania. Przy połączonym koncie zwykłe „Połącz” jest odrzucane (1a) – służą do tego „Zmień konto” i „Połącz ponownie”. */
  async start(scope: UserScope, purpose: AttemptPurpose): Promise<{ attempt: AuthAttempt; authUrl: string | null }> {
    if (this.keyProblem) throw new IntegrationFlowError(this.keyProblem, 503);
    const active = await this.repository.getActiveAccount(scope.userId);
    if (purpose === 'connect' && active) throw new IntegrationFlowError('already_connected', 409);
    if (purpose === 'reconnect' && !active) throw new IntegrationFlowError('not_connected', 404);
    const effective: AttemptPurpose = purpose === 'change_account' && !active ? 'connect' : purpose;
    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    if (this.mode === 'demo') {
      const attempt = await this.repository.createAttempt(scope, { stateHash, purpose: effective, mode: 'demo', codeVerifierEnc: null, ttlMinutes: this.options.attemptTtlMinutes ?? 10 });
      return { attempt, authUrl: null };
    }
    const pkce = createPkce();
    const attempt = await this.repository.createAttempt(scope, {
      stateHash, purpose: effective, mode: 'google', ttlMinutes: this.options.attemptTtlMinutes ?? 10,
      codeVerifierEnc: this.options.cipher!.encrypt(pkce.verifier, `oauth-attempt:${stateHash}`),
    });
    // Przy ponownym logowaniu podpowiadamy to samo konto; przy zmianie konta – nie.
    const hint = effective === 'reconnect' && active ? active.email : undefined;
    return { attempt, authUrl: integrationAuthorizationUrl(this.options.oauth!, state, pkce.challenge, hint) };
  }

  async attempt(scope: UserScope, id: string): Promise<AuthAttempt> {
    const attempt = await this.repository.getAttempt(scope, id);
    if (!attempt) throw new IntegrationFlowError('attempt_not_found', 404);
    return attempt;
  }

  async cancel(scope: UserScope, id: string): Promise<AuthAttempt> {
    const attempt = await this.repository.cancelAttempt(scope, id);
    if (!attempt) throw new IntegrationFlowError('attempt_not_found', 404);
    return attempt;
  }

  /** Makieta zgody Google (bez klienta OAuth): wybór konta (5b), zgoda albo odmowa (5a). */
  async demoConsent(scope: UserScope, id: string, allow: boolean, email?: string): Promise<AuthAttempt> {
    if (this.mode !== 'demo') throw new IntegrationFlowError('demo_only', 409);
    if (allow && !isDemoAccount(email)) throw new IntegrationFlowError('invalid_demo_account', 400);
    const attempt = await this.repository.claimDemoAttempt(scope, id);
    if (!attempt) return this.attempt(scope, id);
    if (!allow) {
      await this.repository.finishAttempt(attempt.id, 'denied', 'access_denied');
      return this.attempt(scope, id);
    }
    await this.finishConnection(scope, attempt, { mode: 'demo', sub: demoSub(email!), email: email!, grantedScopes: DEMO_GRANTED_SCOPES });
    return this.attempt(scope, id);
  }

  /** Kroki 5–7 po powrocie z Google. Zwraca stronę HTML dla przeglądarki; szczegóły błędu nie zawierają tokenów. */
  async callback(scope: UserScope, query: { state?: string; code?: string; error?: string }, log: (code: string) => void): Promise<CallbackPage> {
    if (!query.state) return { httpStatus: 400, title: 'Połączenie wygasło', message: 'Rozpocznij łączenie z Google Calendar ponownie w aplikacji.' };
    const stateHash = hashState(query.state);
    const attempt = await this.repository.claimAttempt(stateHash, scope, 'google');
    // Wygasły, nieznany, cudzy albo już użyty state (np. odświeżenie strony powrotu) – nic nie zapisujemy.
    if (!attempt)
      return { httpStatus: 400, title: 'Połączenie wygasło', message: 'Ten link logowania wygasł albo został już użyty. Rozpocznij łączenie ponownie w aplikacji.' };
    if (query.error || !query.code) {
      await this.repository.finishAttempt(attempt.id, 'denied', query.error === 'access_denied' || !query.error ? 'access_denied' : 'google_error');
      return { httpStatus: 200, title: 'Brak zgody', message: 'Bez zgody na dostęp nie można połączyć kalendarza Google. Twoje wydarzenia w KAC pozostały bez zmian.' };
    }
    try {
      const cipher = this.options.cipher!;
      const verifier = cipher.decrypt(attempt.codeVerifierEnc ?? '', `oauth-attempt:${stateHash}`);
      const identity = await exchangeIntegrationCode(this.options.oauth!, query.code, verifier, this.fetchImpl);
      if (!accessFromScopes(identity.grantedScopes).calendarsRead) {
        await this.repository.finishAttempt(attempt.id, 'denied', 'calendar_scope_missing');
        return { httpStatus: 200, title: 'Brak dostępu do kalendarza', message: 'Zgoda nie obejmuje dostępu do kalendarza, więc konto nie zostało połączone. Spróbuj ponownie i zaznacz dostęp do kalendarza.' };
      }
      const owner = { userId: attempt.userId, calendarId: attempt.calendarId };
      const account = await this.finishConnection(owner, attempt, {
        mode: 'google', sub: identity.sub, email: identity.email, grantedScopes: identity.grantedScopes, identity,
      });
      if (!account) {
        const current = await this.repository.getAttempt(owner, attempt.id);
        return { httpStatus: 409, title: 'Nie połączono konta', message: callbackConflictMessage(current?.errorCode) };
      }
      return { httpStatus: 200, title: 'Połączono z Google', message: `Konto ${account.email} jest połączone z KAC. Możesz wrócić do aplikacji.` };
    } catch (error) {
      const code = error instanceof GoogleIntegrationError ? error.code : 'google_error';
      log(code);
      await this.repository.finishAttempt(attempt.id, 'error', code);
      return { httpStatus: 502, title: 'Nie udało się połączyć', message: code === 'authorization_code_invalid'
        ? 'Kod logowania wygasł albo został już użyty. Spróbuj połączyć konto ponownie.'
        : 'Google nie potwierdził połączenia. Dane dostępu nie zostały zapisane – spróbuj ponownie w aplikacji.' };
    }
  }

  /**
   * Zapis połączenia i lista kalendarzy (krok 7). Konflikt (np. połączone inne konto) kończy próbę błędem, bez zmian w danych.
   * Szyfrogramy tokenów są wiązane z id konta, które znamy dopiero przy zapisie – dlatego szyfrujemy jawne tokeny tutaj.
   */
  private async finishConnection(scope: UserScope, attempt: AuthAttempt, input: {
    mode: 'google' | 'demo'; sub: string; email: string; grantedScopes: string[];
    identity?: { refreshToken: string | null; accessToken: string; expiresAt: Date };
  }): Promise<GoogleAccountRecord | null> {
    let account: GoogleAccountRecord;
    try {
      account = await this.repository.saveConnectionWith(scope, { purpose: attempt.purpose, mode: input.mode, sub: input.sub, email: input.email, grantedScopes: input.grantedScopes },
        input.identity && this.options.cipher ? (accountId) => ({
          refreshEnc: input.identity!.refreshToken ? this.options.cipher!.encrypt(input.identity!.refreshToken, `${accountId}:refresh`) : null,
          accessEnc: this.options.cipher!.encrypt(input.identity!.accessToken, `${accountId}:access`),
          accessExpiresAt: input.identity!.expiresAt, keyId: this.options.cipher!.keyId,
        }) : null);
    } catch (error) {
      if (error instanceof ConnectionConflictError) {
        await this.repository.finishAttempt(attempt.id, 'error', error.code);
        return null;
      }
      throw error;
    }
    // Lista kalendarzy nie decyduje o połączeniu: pusta lista (7a) albo chwilowy błąd Google nie rozłącza konta.
    await this.refreshCalendars(account).catch(() => undefined);
    await this.repository.finishAttempt(attempt.id, 'connected');
    return account;
  }

  private async refreshCalendars(account: GoogleAccountRecord): Promise<{ calendars: IntegrationCalendar[]; complete: boolean }> {
    if (account.mode === 'demo') {
      const calendars = demoIntegrationCalendars(account.email);
      await this.repository.saveCalendars(account, calendars);
      return { calendars, complete: true };
    }
    let token = await this.tokens.accessToken(account);
    let listed;
    try {
      listed = await listIntegrationCalendars(token, this.fetchImpl);
    } catch (error) {
      // 401 przy tokenie uznanym za ważny: jedno wymuszone odświeżenie, potem dopiero „wymagane ponowne logowanie”.
      if (!(error instanceof GoogleIntegrationError) || error.code !== 'reconnect_required') throw error;
      await this.repository.expireAccessToken(account);
      token = await this.tokens.accessToken(account);
      listed = await listIntegrationCalendars(token, this.fetchImpl).catch(async (retryError) => {
        if (retryError instanceof GoogleIntegrationError && retryError.code === 'reconnect_required') await this.repository.markReconnectRequired(account);
        throw retryError;
      });
    }
    await this.repository.saveCalendars(account, listed.calendars);
    return listed;
  }

  /** Krok 7 / panel G02: aktualna lista kalendarzy połączonego konta. */
  async calendars(scope: UserScope): Promise<{ account: AccountView; calendars: IntegrationCalendar[]; complete: boolean }> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new IntegrationFlowError('not_connected', 404);
    if (account.status === 'reconnect_required') throw new GoogleIntegrationError('reconnect_required');
    if (!accessFromScopes(account.grantedScopes).calendarsRead) throw new GoogleIntegrationError('insufficient_permissions');
    const listed = await this.refreshCalendars(account);
    return { account: accountView(account), ...listed };
  }
}

/**
 * Usługa z konfiguracji serwera. Zły klucz szyfrowania nie zatrzymuje API (reszta aplikacji działa),
 * ale integracja zgłasza problem i nie rozpoczyna logowania, dopóki tokenów nie da się bezpiecznie zapisać.
 */
export function createGoogleIntegrationService(pool: Pool, settings: { oauth: GoogleIntegrationOAuthConfig | null; tokenKey: string }, fetchImpl?: FetchLike) {
  let cipher: TokenCipher | null = null;
  let keyProblem: KeyProblem = null;
  try {
    cipher = TokenCipher.fromBase64(settings.tokenKey);
    if (!cipher) keyProblem = 'token_key_missing';
  } catch {
    keyProblem = 'token_key_invalid';
  }
  return new GoogleIntegrationService(new PostgresGoogleIntegrationRepository(pool), { oauth: settings.oauth, cipher, keyProblem, fetch: fetchImpl });
}

function callbackConflictMessage(code: string | null | undefined): string {
  if (code === 'already_connected') return 'Masz już połączone konto Google. Żeby połączyć inne, użyj w aplikacji „Zmień konto”.';
  if (code === 'reconnect_account_mismatch') return 'Wybrano inne konto Google niż połączone. Żeby je zmienić, użyj w aplikacji „Zmień konto”.';
  if (code === 'no_refresh_token') return 'Google nie wydał trwałego dostępu. Usuń dostęp KAC w ustawieniach konta Google (Bezpieczeństwo → Aplikacje innych firm) i połącz ponownie.';
  return 'Nie udało się zapisać połączenia. Spróbuj ponownie w aplikacji.';
}
