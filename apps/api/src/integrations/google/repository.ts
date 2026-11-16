// Repozytorium trwałej integracji Google (S23KC2S1P2-12, G01 / S23KC2S1P2-284).
// Konto należy do użytkownika ustalonego po stronie serwera (W01); każde zapytanie filtruje po id_uzytkownika.
// Tokeny są tu wyłącznie szyfrogramami – odszyfrowanie i odświeżanie robi GoogleTokenService.
import type { Pool, PoolClient } from 'pg';
import type { UserScope } from '../../api/scope.js';
import type { IntegrationCalendar } from './oauth-client.js';

export type IntegrationMode = 'google' | 'demo';
export type AccountStatus = 'connected' | 'reconnect_required';
export type AttemptPurpose = 'connect' | 'change_account' | 'reconnect';
export type AttemptStatus = 'pending' | 'processing' | 'connected' | 'denied' | 'error' | 'cancelled' | 'expired';

export type GoogleAccountRecord = {
  accountId: string; userId: string; email: string; sub: string | null; mode: IntegrationMode; status: AccountStatus;
  grantedScopes: string[]; generation: number; connectedAt: string | null; lastSyncAt: string | null;
};
export type AuthAttempt = {
  id: string; userId: string; calendarId: string; purpose: AttemptPurpose; mode: IntegrationMode; codeVerifierEnc: string | null;
  status: AttemptStatus; errorCode: string | null; createdAt: string; expiresAt: string;
};
export type EncryptedTokens = { refreshEnc: string | null; accessEnc: string | null; accessExpiresAt: Date | null; keyId: string };
export type StoredTokens = EncryptedTokens & { accountId: string; generation: number };

/** Konflikt przy zapisie połączenia – wynik jest kontrolowany, nic nie zostaje nadpisane. */
export class ConnectionConflictError extends Error {
  constructor(readonly code: 'already_connected' | 'reconnect_account_mismatch' | 'no_refresh_token' | 'not_connected') { super(code); }
}

const STATUS_DB: Record<AccountStatus, string> = { connected: 'Połączone', reconnect_required: 'Wymaga ponownego logowania' };
const ACCESS_LABEL: Record<IntegrationCalendar['accessRole'], string> = { owner: 'Właściciel', writer: 'Odczyt/Zapis', reader: 'Odczyt', freeBusyReader: 'Wolny/zajęty' };

const accountFrom = (row: any): GoogleAccountRecord => ({
  accountId: row.id_konta, userId: row.id_uzytkownika, email: row.adres_email, sub: row.google_sub, mode: row.tryb,
  status: row.status_polaczenia === STATUS_DB.reconnect_required ? 'reconnect_required' : 'connected',
  grantedScopes: row.uprawnienia ?? [], generation: Number(row.generacja),
  connectedAt: row.polaczono_at ? new Date(row.polaczono_at).toISOString() : null,
  lastSyncAt: row.ostatnia_sync ? new Date(row.ostatnia_sync).toISOString() : null,
});

const attemptFrom = (row: any): AuthAttempt => ({
  id: row.id_proby, userId: row.id_uzytkownika, calendarId: row.id_kalendarza, purpose: row.cel, mode: row.tryb,
  codeVerifierEnc: row.code_verifier_enc,
  // Próba, która nie doczekała się decyzji przed terminem, jest dla użytkownika „wygasła” (bez osobnego zadania sprzątającego).
  status: row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status,
  errorCode: row.blad_kod, createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
});

export class PostgresGoogleIntegrationRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async createAttempt(scope: UserScope, input: { stateHash: string; purpose: AttemptPurpose; mode: IntegrationMode; codeVerifierEnc: string | null; ttlMinutes: number }): Promise<AuthAttempt> {
    // Stare próby nie są już potrzebne (wynik widać w stanie konta) – sprzątamy je przy okazji, żeby tabela nie rosła.
    await this.pool.query(`delete from t_google_oauth_proby where id_uzytkownika = $1 and created_at < now() - interval '1 day'`, [scope.userId]);
    const result = await this.pool.query(`insert into t_google_oauth_proby (id_uzytkownika, id_kalendarza, state_hash, cel, tryb, code_verifier_enc, expires_at)
      values ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) returning *`,
    [scope.userId, scope.calendarId, input.stateHash, input.purpose, input.mode, input.codeVerifierEnc, input.ttlMinutes]);
    return attemptFrom(result.rows[0]);
  }

  async getAttempt(scope: UserScope, id: string): Promise<AuthAttempt | null> {
    const result = await this.pool.query('select * from t_google_oauth_proby where id_proby = $1 and id_uzytkownika = $2 and id_kalendarza = $3',
      [id, scope.userId, scope.calendarId]);
    return result.rows[0] ? attemptFrom(result.rows[0]) : null;
  }

  /**
   * Jednorazowe przejęcie próby: tylko oczekująca, nieprzeterminowana i należąca do użytkownika, który wrócił z Google.
   * Ponowne użycie tego samego state zwraca null; cudzy powrót nie „spala” próby właściciela.
   */
  async claimAttempt(stateHash: string, scope: UserScope, mode: IntegrationMode): Promise<AuthAttempt | null> {
    const result = await this.pool.query(`update t_google_oauth_proby set status = 'processing'
      where state_hash = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and tryb = $4 and status = 'pending' and expires_at > now() returning *`,
    [stateHash, scope.userId, scope.calendarId, mode]);
    return result.rows[0] ? attemptFrom(result.rows[0]) : null;
  }

  /** Przejęcie próby demonstracyjnej po jej id (zgoda w makiecie zamiast strony Google). */
  async claimDemoAttempt(scope: UserScope, id: string): Promise<AuthAttempt | null> {
    const result = await this.pool.query(`update t_google_oauth_proby set status = 'processing'
      where id_proby = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and tryb = 'demo' and status = 'pending' and expires_at > now() returning *`,
    [id, scope.userId, scope.calendarId]);
    return result.rows[0] ? attemptFrom(result.rows[0]) : null;
  }

  async finishAttempt(id: string, status: 'connected' | 'denied' | 'error', errorCode: string | null = null): Promise<void> {
    await this.pool.query(`update t_google_oauth_proby set status = $2, blad_kod = $3, code_verifier_enc = null, finished_at = now()
      where id_proby = $1 and status = 'processing'`, [id, status, errorCode]);
  }

  /** Anulowanie przez użytkownika: późniejszy powrót z Google dla tej próby niczego nie zapisze. */
  async cancelAttempt(scope: UserScope, id: string): Promise<AuthAttempt | null> {
    await this.pool.query(`update t_google_oauth_proby set status = 'cancelled', code_verifier_enc = null, finished_at = now()
      where id_proby = $1 and id_uzytkownika = $2 and id_kalendarza = $3 and status = 'pending'`, [id, scope.userId, scope.calendarId]);
    return this.getAttempt(scope, id);
  }

  async getActiveAccount(userId: string): Promise<GoogleAccountRecord | null> {
    const result = await this.pool.query(`select * from t_konta_google where id_uzytkownika = $1 and status_polaczenia <> 'Niepołączone'`, [userId]);
    return result.rows[0] ? accountFrom(result.rows[0]) : null;
  }

  /**
   * Zapis udanego połączenia w jednej transakcji: konto, zgoda, przyznane zakresy i szyfrogramy tokenów.
   * Zmiana konta zastępuje poprzednie dopiero teraz – po udanym powrocie z Google – więc anulowanie zachowuje stare połączenie.
   */
  async saveConnectionWith(scope: UserScope, input: { purpose: AttemptPurpose; mode: IntegrationMode; sub: string; email: string; grantedScopes: string[] },
    tokensFor: ((accountId: string) => EncryptedTokens) | null): Promise<GoogleAccountRecord> {
    return this.transaction(async (client) => {
      // Blokada kont użytkownika – równoległe dokończenia logowania wykonują się po kolei.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`google-account:${scope.userId}`]);
      const activeResult = await client.query(`select * from t_konta_google where id_uzytkownika = $1 and status_polaczenia <> 'Niepołączone' for update`, [scope.userId]);
      const active = activeResult.rows[0] ? accountFrom(activeResult.rows[0]) : null;
      const sameAccount = Boolean(active && active.sub === input.sub);

      if (active && !sameAccount) {
        if (input.purpose === 'connect') throw new ConnectionConflictError('already_connected');
        if (input.purpose === 'reconnect') throw new ConnectionConflictError('reconnect_account_mismatch');
        // change_account: poprzednie konto przestaje być aktywne, jego tokeny znikają, a generacja rośnie (stare prace są odrzucane).
        await client.query(`update t_konta_google set status_polaczenia = 'Niepołączone', zgoda_synchronizacja = false, generacja = generacja + 1,
          odlaczono_at = now(), updated_at = now() where id_konta = $1`, [active.accountId]);
        await client.query('delete from t_google_tokeny where id_konta = $1', [active.accountId]);
      }
      if (!active && input.purpose === 'reconnect') throw new ConnectionConflictError('not_connected');

      let accountId: string;
      if (active && sameAccount) {
        accountId = active.accountId;
        await client.query(`update t_konta_google set adres_email = $2, uprawnienia = $3, status_polaczenia = 'Połączone', zgoda_synchronizacja = true,
          updated_at = now() where id_konta = $1`, [accountId, input.email, input.grantedScopes]);
      } else {
        const upsert = await client.query(`insert into t_konta_google (id_uzytkownika, adres_email, status_polaczenia, zgoda_synchronizacja, google_sub, tryb, uprawnienia, polaczono_at)
            values ($1, $2, 'Połączone', true, $3, $4, $5, now())
          on conflict (id_uzytkownika, adres_email) do update set status_polaczenia = 'Połączone', zgoda_synchronizacja = true,
            google_sub = excluded.google_sub, tryb = excluded.tryb, uprawnienia = excluded.uprawnienia, generacja = t_konta_google.generacja + 1,
            polaczono_at = now(), odlaczono_at = null, updated_at = now()
          returning id_konta`, [scope.userId, input.email, input.sub, input.mode, input.grantedScopes]);
        accountId = upsert.rows[0].id_konta;
      }

      if (input.mode === 'demo') {
        await client.query('delete from t_google_tokeny where id_konta = $1', [accountId]);
      } else {
        const existing = await client.query('select refresh_token_enc from t_google_tokeny where id_konta = $1 for update', [accountId]);
        // Szyfrogram wiążemy z id konta (AAD), dlatego tokeny szyfruje dopiero wywołujący, gdy id jest znane.
        const tokens = tokensFor?.(accountId) ?? null;
        // Google pomija refresh_token przy ponownej zgodzie na to samo konto – zachowujemy dotychczasowy.
        const refreshEnc = tokens?.refreshEnc ?? (sameAccount ? existing.rows[0]?.refresh_token_enc ?? null : null);
        // Bez tokenu odświeżania połączenie przestałoby działać po godzinie – lepiej jawny błąd niż „połączone” na chwilę.
        if (!refreshEnc) throw new ConnectionConflictError('no_refresh_token');
        await client.query(`insert into t_google_tokeny (id_konta, refresh_token_enc, access_token_enc, access_expires_at, klucz_id)
            values ($1, $2, $3, $4, $5)
          on conflict (id_konta) do update set refresh_token_enc = excluded.refresh_token_enc, access_token_enc = excluded.access_token_enc,
            access_expires_at = excluded.access_expires_at, klucz_id = excluded.klucz_id, updated_at = now()`,
        [accountId, refreshEnc, tokens?.accessEnc ?? null, tokens?.accessExpiresAt ?? null, tokens?.keyId ?? '']);
      }
      const saved = await client.query('select * from t_konta_google where id_konta = $1', [accountId]);
      return accountFrom(saved.rows[0]);
    });
  }

  /**
   * Odświeżanie pod blokadą wiersza tokenów: dwa równoległe żądania (także z dwóch procesów) nie odświeżają naraz.
   * Blokada obejmuje tylko połączone konto o podanej generacji – po odłączeniu albo zmianie konta stare żądanie nic nie zapisze.
   */
  async withTokenLock<T>(account: Pick<GoogleAccountRecord, 'accountId' | 'generation'>,
    work: (tokens: StoredTokens) => Promise<{ result: T; update?: Partial<EncryptedTokens> }>): Promise<T | null> {
    return this.transaction(async (client) => {
      // Kolejność blokad jak w saveConnectionWith (najpierw konto, potem tokeny) – równoległe logowanie i odświeżenie się nie zakleszczą.
      const owner = await client.query(`select generacja from t_konta_google where id_konta = $1 and generacja = $2 and status_polaczenia = 'Połączone' for update`,
        [account.accountId, account.generation]);
      if (!owner.rows[0]) return null;
      const row = await client.query('select * from t_google_tokeny where id_konta = $1 for update', [account.accountId]);
      if (!row.rows[0]) return null;
      const current = { ...row.rows[0], generacja: owner.rows[0].generacja };
      const outcome = await work({ accountId: current.id_konta, generation: Number(current.generacja), refreshEnc: current.refresh_token_enc,
        accessEnc: current.access_token_enc, accessExpiresAt: current.access_expires_at ? new Date(current.access_expires_at) : null, keyId: current.klucz_id });
      if (outcome.update) {
        const next = { refreshEnc: current.refresh_token_enc, accessEnc: current.access_token_enc, accessExpiresAt: current.access_expires_at, keyId: current.klucz_id, ...outcome.update };
        await client.query(`update t_google_tokeny set refresh_token_enc = $2, access_token_enc = $3, access_expires_at = $4, klucz_id = $5, updated_at = now()
          where id_konta = $1`, [account.accountId, next.refreshEnc, next.accessEnc, next.accessExpiresAt, next.keyId]);
      }
      return outcome.result;
    });
  }

  /** Token dostępu odrzucony przez Google mimo terminu ważności – następne użycie wymusi odświeżenie. */
  async expireAccessToken(account: Pick<GoogleAccountRecord, 'accountId'>): Promise<void> {
    await this.pool.query('update t_google_tokeny set access_token_enc = null, access_expires_at = null, updated_at = now() where id_konta = $1', [account.accountId]);
  }

  /** Google odrzucił token odświeżania: konto zostaje, ale wymaga ponownego logowania (dane lokalne bez zmian). */
  async markReconnectRequired(account: Pick<GoogleAccountRecord, 'accountId' | 'generation'>): Promise<void> {
    await this.pool.query(`update t_konta_google set status_polaczenia = 'Wymaga ponownego logowania', updated_at = now()
      where id_konta = $1 and generacja = $2 and status_polaczenia = 'Połączone'`, [account.accountId, account.generation]);
    await this.pool.query('update t_google_tokeny set access_token_enc = null, access_expires_at = null where id_konta = $1', [account.accountId]);
  }

  /** Lista kalendarzy konta (krok 7). Wybór użytkownika (wybrany) zostaje; kalendarze, których już nie ma, tracą dostęp. */
  async saveCalendars(account: Pick<GoogleAccountRecord, 'accountId'>, calendars: IntegrationCalendar[]): Promise<void> {
    await this.transaction(async (client) => {
      for (const calendar of calendars) {
        await client.query(`insert into t_kalendarze_google (id_konta, nazwa, id_zewnetrzne, uprawnienia, rola_dostepu, strefa, glowny)
            values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (id_konta, id_zewnetrzne) do update set nazwa = excluded.nazwa, uprawnienia = excluded.uprawnienia,
            rola_dostepu = excluded.rola_dostepu, strefa = excluded.strefa, glowny = excluded.glowny, updated_at = now()`,
        [account.accountId, calendar.name, calendar.id, ACCESS_LABEL[calendar.accessRole], calendar.accessRole, calendar.timeZone, calendar.primary]);
      }
      const ids = calendars.map((calendar) => calendar.id);
      // Znikniętego kalendarza nie usuwamy, gdy użytkownik go wybrał albo opublikowano do niego grafik (historia publikacji, G07) –
      // zostaje z oznaczeniem „Brak dostępu”.
      await client.query(`delete from t_kalendarze_google g where g.id_konta = $1 and not (g.id_zewnetrzne = any($2::text[])) and not g.wybrany
        and not exists (select 1 from t_publikacje p where p.id_kal_google = g.id_kal_google)`, [account.accountId, ids]);
      await client.query(`update t_kalendarze_google set uprawnienia = 'Brak dostępu', rola_dostepu = null, updated_at = now()
        where id_konta = $1 and not (id_zewnetrzne = any($2::text[]))`, [account.accountId, ids]);
    });
  }
}
