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
  /** Zgoda na synchronizację (tKontaGoogle.Zgoda_Synchronizacja). Odmowa przy ponownym logowaniu ją wyłącza (G06, 5a). */
  syncEnabled: boolean; lastPublishAt: string | null;
};
/** Kalendarz zapisany przy koncie wraz z wyborem użytkownika (G04). available = false: kalendarz zniknął z konta Google („Brak dostępu”). */
export type StoredCalendar = {
  rowId: string; id: string; name: string; primary: boolean; accessRole: IntegrationCalendar['accessRole'] | null; timeZone: string | null;
  available: boolean; source: boolean;
};
export type StoredSelection = { version: number; publicationTargetRowId: string | null; calendars: StoredCalendar[] };
export type PublicationShift = { shiftId: string; eventId: string; eventVersion: number; title: string; start: string; end: string };
export type PublicationSchedule = { scheduleId: string; version: number; accepted: boolean; shifts: PublicationShift[] };
export type SyncDirection = 'read' | 'publish';
export type SyncAttemptStatus = 'running' | 'success' | 'partial' | 'error';
export type SyncAttemptRecord = {
  id: string; accountId: string; direction: SyncDirection; scope: string | null; operation: string; status: SyncAttemptStatus;
  startedAt: string; finishedAt: string | null; tries: number; changes: number; errorCode: string | null; message: string | null;
};
export type AuthAttempt = {
  id: string; userId: string; calendarId: string; purpose: AttemptPurpose; mode: IntegrationMode; codeVerifierEnc: string | null;
  status: AttemptStatus; errorCode: string | null; createdAt: string; expiresAt: string;
};
export type EncryptedTokens = { refreshEnc: string | null; accessEnc: string | null; accessExpiresAt: Date | null; keyId: string };
export type StoredTokens = EncryptedTokens & { accountId: string; generation: number };

/** Konflikt przy zapisie połączenia – wynik jest kontrolowany, nic nie zostaje nadpisane. */
export class ConnectionConflictError extends Error {
  constructor(readonly code: 'already_connected' | 'reconnect_account_mismatch' | 'no_refresh_token' | 'not_connected' | 'attempt_cancelled') { super(code); }
}

const STATUS_DB: Record<AccountStatus, string> = { connected: 'Połączone', reconnect_required: 'Wymaga ponownego logowania' };
const ACCESS_LABEL: Record<IntegrationCalendar['accessRole'], string> = { owner: 'Właściciel', writer: 'Odczyt/Zapis', reader: 'Odczyt', freeBusyReader: 'Wolny/zajęty' };

const accountFrom = (row: any): GoogleAccountRecord => ({
  accountId: row.id_konta, userId: row.id_uzytkownika, email: row.adres_email, sub: row.google_sub, mode: row.tryb,
  status: row.status_polaczenia === STATUS_DB.reconnect_required ? 'reconnect_required' : 'connected',
  grantedScopes: row.uprawnienia ?? [], generation: Number(row.generacja),
  connectedAt: row.polaczono_at ? new Date(row.polaczono_at).toISOString() : null,
  lastSyncAt: row.ostatnia_sync ? new Date(row.ostatnia_sync).toISOString() : null,
  syncEnabled: row.zgoda_synchronizacja !== false,
  lastPublishAt: row.ostatnia_publikacja ? new Date(row.ostatnia_publikacja).toISOString() : null,
});

const DIRECTION_DB: Record<SyncDirection, string> = { read: 'Odczyt', publish: 'Publikacja' };
const SYNC_STATUS_DB: Record<SyncAttemptStatus, string> = { running: 'W trakcie', success: 'Sukces', partial: 'Częściowo', error: 'Błąd' };
const fromDb = <T extends string>(map: Record<T, string>, value: string) => (Object.keys(map) as T[]).find((key) => map[key] === value)!;
const syncAttemptFrom = (row: any): SyncAttemptRecord => ({
  id: row.id_sync, accountId: row.id_konta, direction: fromDb(DIRECTION_DB, row.kierunek), scope: row.zakres, operation: row.operacja,
  status: fromDb(SYNC_STATUS_DB, row.status), startedAt: new Date(row.data_proby).toISOString(),
  finishedAt: row.zakonczono_at ? new Date(row.zakonczono_at).toISOString() : null, tries: Number(row.proby), changes: Number(row.liczba_zmian),
  errorCode: row.kod_bledu, message: row.komunikat,
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
  async saveConnectionWith(scope: UserScope, input: { purpose: AttemptPurpose; mode: IntegrationMode; sub: string; email: string; grantedScopes: string[]; attemptId?: string },
    tokensFor: ((accountId: string) => EncryptedTokens) | null): Promise<{ account: GoogleAccountRecord; replaced: { account: GoogleAccountRecord; refreshEnc: string | null } | null }> {
    return this.transaction(async (client) => {
      // Blokada kont użytkownika – równoległe dokończenia logowania i odłączenie (G03) wykonują się po kolei.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`google-account:${scope.userId}`]);
      // G03: próba anulowana albo przerwana odłączeniem w trakcie powrotu z Google niczego już nie zapisze.
      if (input.attemptId) {
        const attempt = await client.query('select status from t_google_oauth_proby where id_proby = $1 for update', [input.attemptId]);
        if (attempt.rows[0]?.status !== 'processing') throw new ConnectionConflictError('attempt_cancelled');
      }
      const activeResult = await client.query(`select * from t_konta_google where id_uzytkownika = $1 and status_polaczenia <> 'Niepołączone' for update`, [scope.userId]);
      const active = activeResult.rows[0] ? accountFrom(activeResult.rows[0]) : null;
      const sameAccount = Boolean(active && active.sub === input.sub);
      let replaced: { account: GoogleAccountRecord; refreshEnc: string | null } | null = null;

      if (active && !sameAccount) {
        if (input.purpose === 'connect') throw new ConnectionConflictError('already_connected');
        if (input.purpose === 'reconnect') throw new ConnectionConflictError('reconnect_account_mismatch');
        // change_account: poprzednie konto przestaje być aktywne, jego tokeny znikają, a generacja rośnie (stare prace są odrzucane).
        // Szyfrogram tokenu odświeżania oddajemy wywołującemu, żeby po zapisie cofnął zgodę poprzedniego konta w Google (D03).
        const oldTokens = await client.query('select refresh_token_enc from t_google_tokeny where id_konta = $1', [active.accountId]);
        replaced = { account: active, refreshEnc: oldTokens.rows[0]?.refresh_token_enc ?? null };
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
      return { account: accountFrom(saved.rows[0]), replaced };
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

  /**
   * Lista kalendarzy konta (krok 7). Wybór użytkownika (wybrany) zostaje; kalendarze, których już nie ma, tracą dostęp.
   * Niepełna lista (limit stron, G06 „częściowo”) tylko dopisuje i aktualizuje – nie usuwa kalendarzy, których mogła nie objąć.
   */
  async saveCalendars(account: Pick<GoogleAccountRecord, 'accountId'>, calendars: IntegrationCalendar[], complete = true): Promise<void> {
    await this.transaction(async (client) => {
      for (const calendar of calendars) {
        await client.query(`insert into t_kalendarze_google (id_konta, nazwa, id_zewnetrzne, uprawnienia, rola_dostepu, strefa, glowny)
            values ($1, $2, $3, $4, $5, $6, $7)
          on conflict (id_konta, id_zewnetrzne) do update set nazwa = excluded.nazwa, uprawnienia = excluded.uprawnienia,
            rola_dostepu = excluded.rola_dostepu, strefa = excluded.strefa, glowny = excluded.glowny, updated_at = now()`,
        [account.accountId, calendar.name, calendar.id, ACCESS_LABEL[calendar.accessRole], calendar.accessRole, calendar.timeZone, calendar.primary]);
      }
      // G04: dopóki użytkownik nie zapisał własnego wyboru (wersja 1) i nic nie jest wybrane, źródłem jest kalendarz główny.
      // Obejmuje konta połączone przed migracją 019 i ponowne połączenie po odłączeniu. Zapisany wybór (także pusty) nie jest ruszany.
      await client.query(`update t_kalendarze_google g set wybrany = true, updated_at = now()
        where g.id_konta = $1 and g.glowny and (select k.wersja_wyboru = 1 from t_konta_google k where k.id_konta = $1)
          and not exists (select 1 from t_kalendarze_google w where w.id_konta = $1 and w.wybrany)`, [account.accountId]);
      if (!complete) return;
      const ids = calendars.map((calendar) => calendar.id);
      // Znikniętego kalendarza nie usuwamy, gdy użytkownik go wybrał albo opublikowano do niego grafik (historia publikacji, G07) –
      // zostaje z oznaczeniem „Brak dostępu”.
      await client.query(`delete from t_kalendarze_google g where g.id_konta = $1 and not (g.id_zewnetrzne = any($2::text[])) and not g.wybrany
        and not exists (select 1 from t_publikacje p where p.id_kal_google = g.id_kal_google)
        and not exists (select 1 from t_konta_google k where k.id_kal_publikacji = g.id_kal_google)`, [account.accountId, ids]);
      await client.query(`update t_kalendarze_google set uprawnienia = 'Brak dostępu', rola_dostepu = null, updated_at = now()
        where id_konta = $1 and not (id_zewnetrzne = any($2::text[]))`, [account.accountId, ids]);
    });
  }

  /** Odmowa zgody przy ponownym logowaniu (G06, 5a): synchronizacja wyłączona, konto i dane lokalne bez zmian. */
  async disableSync(userId: string): Promise<void> {
    await this.pool.query(`update t_konta_google set zgoda_synchronizacja = false, updated_at = now()
      where id_uzytkownika = $1 and status_polaczenia <> 'Niepołączone'`, [userId]);
  }

  // --- Rejestr prób synchronizacji (G06) ---

  /** Próba przerwana restartem serwera nie może wiecznie blokować kolejnych – po czasie jest kończona jako przerwana. */
  async failStaleSyncAttempts(accountId: string, olderThanMinutes = 5): Promise<void> {
    await this.pool.query(`update t_synchronizacje set status = 'Błąd', kod_bledu = 'sync_interrupted', zakonczono_at = now(),
        komunikat = 'Próba została przerwana (np. restart serwera).'
      where id_konta = $1 and status = 'W trakcie' and data_proby < now() - make_interval(mins => $2)`, [accountId, olderThanMinutes]);
  }

  /** Początek próby. null, gdy dla tego konta i kierunku trwa już inna (unikalny indeks „W trakcie”). */
  async startSyncAttempt(account: Pick<GoogleAccountRecord, 'accountId' | 'generation'>,
    input: { direction: SyncDirection; scope: string; operation: string }): Promise<SyncAttemptRecord | null> {
    try {
      const result = await this.pool.query(`insert into t_synchronizacje (id_konta, kierunek, operacja, status, zakres, proby, generacja)
        values ($1, $2, $3, 'W trakcie', $4, 1, $5) returning *`,
      [account.accountId, DIRECTION_DB[input.direction], input.operation, input.scope, account.generation]);
      return syncAttemptFrom(result.rows[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return null;
      throw error;
    }
  }

  async setSyncTries(id: string, tries: number): Promise<void> {
    await this.pool.query(`update t_synchronizacje set proby = $2 where id_sync = $1 and status = 'W trakcie'`, [id, tries]);
  }

  /**
   * Zakończenie próby. Sukces zapisuje też ostatni udany odczyt/publikację w koncie – w tej samej transakcji.
   * Błąd i wynik częściowy nie zmieniają ostatniego sukcesu.
   */
  async finishSyncAttempt(id: string, input: { status: Exclude<SyncAttemptStatus, 'running'>; tries: number; changes: number; errorCode: string | null; message: string }): Promise<SyncAttemptRecord> {
    return this.transaction(async (client) => {
      const result = await client.query(`update t_synchronizacje set status = $2, proby = $3, liczba_zmian = $4, kod_bledu = $5, komunikat = $6, zakonczono_at = now()
        where id_sync = $1 returning *`, [id, SYNC_STATUS_DB[input.status], input.tries, input.changes, input.errorCode, input.message]);
      const attempt = syncAttemptFrom(result.rows[0]);
      if (input.status === 'success') {
        const column = attempt.direction === 'read' ? 'ostatnia_sync' : 'ostatnia_publikacja';
        await client.query(`update t_konta_google set ${column} = now(), updated_at = now() where id_konta = $1`, [attempt.accountId]);
      }
      return attempt;
    });
  }

  async listSyncAttempts(accountId: string, limit = 10): Promise<SyncAttemptRecord[]> {
    const result = await this.pool.query(`select * from t_synchronizacje where id_konta = $1 order by data_proby desc, id_sync desc limit $2`, [accountId, limit]);
    return result.rows.map(syncAttemptFrom);
  }

  /**
   * Odłączenie konta (S23KC2S1P2-35, G03) w jednej transakcji: status „Niepołączone”, zgoda wyłączona, nowa generacja
   * (prace i odświeżenia ze starą generacją są odrzucane), tokeny usunięte, otwarte logowania anulowane (spóźniony powrót z Google
   * niczego nie zapisze), trwające synchronizacje zakończone, zaplanowane prace Google zatrzymane. Wydarzenia lokalne zostają.
   * Zwraca szyfrogramy tokenów, żeby wywołujący mógł po zatwierdzeniu cofnąć zgodę w Google. null – nic nie było połączone.
   */
  async disconnect(scope: UserScope): Promise<{ account: GoogleAccountRecord; refreshEnc: string | null; accessEnc: string | null } | null> {
    return this.transaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`google-account:${scope.userId}`]);
      await client.query(`update t_google_oauth_proby set status = 'cancelled', blad_kod = 'disconnected', code_verifier_enc = null, finished_at = now()
        where id_uzytkownika = $1 and status in ('pending', 'processing')`, [scope.userId]);
      const active = await client.query(`select * from t_konta_google where id_uzytkownika = $1 and status_polaczenia <> 'Niepołączone' for update`, [scope.userId]);
      if (!active.rows[0]) return null;
      const account = accountFrom(active.rows[0]);
      const tokens = await client.query('select refresh_token_enc, access_token_enc from t_google_tokeny where id_konta = $1 for update', [account.accountId]);
      await client.query('delete from t_google_tokeny where id_konta = $1', [account.accountId]);
      await client.query(`update t_konta_google set status_polaczenia = 'Niepołączone', zgoda_synchronizacja = false, generacja = generacja + 1,
        odlaczono_at = now(), updated_at = now() where id_konta = $1`, [account.accountId]);
      await client.query(`update t_synchronizacje set status = 'Błąd', kod_bledu = 'disconnected', zakonczono_at = now(), komunikat = 'Konto odłączono w trakcie synchronizacji.'
        where id_konta = $1 and status = 'W trakcie'`, [account.accountId]);
      // Zaplanowane prace dla Google (outbox W02) tego użytkownika nie zostaną wykonane – bez konta nie ma dokąd ich wysłać.
      await client.query(`update t_event_outbox_delivery d set status = 'dead', error_code = 'google_disconnected', lease_until = null, worker_id = null
        from t_event_outbox o where o.id_outbox = d.id_outbox and o.id_uzytkownika = $1 and d.consumer = 'google' and d.status in ('pending', 'blocked')`, [scope.userId]);
      return { account, refreshEnc: tokens.rows[0]?.refresh_token_enc ?? null, accessEnc: tokens.rows[0]?.access_token_enc ?? null };
    });
  }

  // --- Wybór kalendarzy (S23KC2S1P2-41, G04) ---

  async getSelection(accountId: string): Promise<StoredSelection> {
    const client = await this.pool.connect();
    try { return await this.getSelectionWith(client, accountId); } finally { client.release(); }
  }

  /**
   * Zapis wyboru w jednej transakcji z kontrolą wersji: albo cały zbiór i kalendarz publikacji, albo nic.
   * validate dostaje aktualny stan pod blokadą konta i rzuca błąd, gdy wybór jest niedozwolony.
   */
  async saveSelection(accountId: string, expectedVersion: number, apply: (current: StoredSelection) => { sourceRowIds: string[]; targetRowId: string | null }): Promise<StoredSelection | 'conflict'> {
    return this.transaction(async (client) => {
      const locked = await client.query('select wersja_wyboru from t_konta_google where id_konta = $1 for update', [accountId]);
      if (Number(locked.rows[0]?.wersja_wyboru) !== expectedVersion) return 'conflict';
      const next = apply(await this.getSelectionWith(client, accountId));
      await client.query(`update t_kalendarze_google set wybrany = (id_kal_google = any($2::text[])), updated_at = now() where id_konta = $1`, [accountId, next.sourceRowIds]);
      await client.query(`update t_konta_google set id_kal_publikacji = $2, wersja_wyboru = wersja_wyboru + 1, updated_at = now() where id_konta = $1`, [accountId, next.targetRowId]);
      return this.getSelectionWith(client, accountId);
    });
  }

  private async getSelectionWith(client: PoolClient, accountId: string): Promise<StoredSelection> {
    const account = await client.query('select wersja_wyboru, id_kal_publikacji from t_konta_google where id_konta = $1', [accountId]);
    const rows = await client.query(`select * from t_kalendarze_google where id_konta = $1 order by glowny desc, nazwa, id_zewnetrzne`, [accountId]);
    return {
      version: Number(account.rows[0]?.wersja_wyboru ?? 1), publicationTargetRowId: account.rows[0]?.id_kal_publikacji ?? null,
      calendars: rows.rows.map((row) => ({
        rowId: row.id_kal_google, id: row.id_zewnetrzne, name: row.nazwa, primary: Boolean(row.glowny), accessRole: row.rola_dostepu ?? null,
        timeZone: row.strefa ?? null, available: row.uprawnienia !== 'Brak dostępu' && row.rola_dostepu !== null, source: Boolean(row.wybrany),
      })),
    };
  }

  /** Liczba wybranych, wciąż dostępnych kalendarzy źródłowych – bez nich synchronizacja nie rusza (G04). */
  async countSourceCalendars(accountId: string): Promise<number> {
    const result = await this.pool.query(`select count(*)::int as n from t_kalendarze_google where id_konta = $1 and wybrany and uprawnienia <> 'Brak dostępu'`, [accountId]);
    return result.rows[0].n;
  }

  // --- Publikacja grafiku (G07) ---

  /**
   * Najnowsza nieodrzucona wersja grafiku tygodnia w kalendarzu właściciela i jej zatwierdzone zmiany z wydarzeniami
   * (lokalne ID i wersja wydarzenia). null – brak grafiku.
   */
  async getPublicationSchedule(calendarId: string, weekStart: string): Promise<PublicationSchedule | null> {
    const schedule = await this.pool.query(`select id_grafiku, version, status, approved_at from t_grafiki
      where generator_version <> 'work-profile-v1' and id_kalendarza = $1 and tydzien_od = $2::date and rejected_at is null
      order by version desc limit 1`, [calendarId, weekStart]);
    const row = schedule.rows[0];
    if (!row) return null;
    const shifts = await this.pool.query(`select z.id_zmiany, z.id_wydarzenia, e.event_version, e.tytul, e.rozpoczecie, e.zakonczenie
      from t_zmiany_pracy z join t_wydarzenia e on e.id_wydarzenia = z.id_wydarzenia
      where z.id_grafiku = $1 and e.status = 'Aktywne' order by e.rozpoczecie, z.id_zmiany`, [row.id_grafiku]);
    return {
      scheduleId: String(row.id_grafiku), version: Number(row.version), accepted: row.status === 'accepted' && row.approved_at !== null,
      shifts: shifts.rows.map((shift) => ({ shiftId: String(shift.id_zmiany), eventId: String(shift.id_wydarzenia), eventVersion: Number(shift.event_version),
        title: shift.tytul, start: new Date(shift.rozpoczecie).toISOString(), end: new Date(shift.zakonczenie).toISOString() })),
    };
  }

  /** Udane publikacje zmian do kalendarza Google (po ID wiersza t_kalendarze_google). */
  async listPublished(targetRowId: string, shiftIds: string[]): Promise<Map<string, { eventVersion: number; publishedAt: string; mode: 'symulacja' | 'google' }>> {
    const result = await this.pool.query(`select id_zmiany, wersja_wydarzenia, opublikowano, tryb from t_publikacje
      where id_kal_google = $1 and id_zmiany = any($2::text[]) and status = 'Opublikowano'`, [targetRowId, shiftIds]);
    return new Map(result.rows.map((row) => [String(row.id_zmiany),
      { eventVersion: Number(row.wersja_wydarzenia), publishedAt: new Date(row.opublikowano).toISOString(), mode: row.tryb }]));
  }

  /**
   * Zapis pozycji publikacji jednej zmiany. Wiersz jest jeden na zmianę i kalendarz – ponowienie albo aktualizacja
   * go nadpisuje, więc nie powstają duplikaty. Tryb „symulacja” nigdy nie ma zewnętrznego ID (pilnuje tego też ograniczenie w bazie).
   */
  async savePublication(input: { userId: string; accountId: string; targetRowId: string; scheduleId: string; shiftId: string; eventId: string;
    eventVersion: number; syncId: string; operation: 'Utworzenie' | 'Aktualizacja'; mode: 'symulacja' | 'google'; externalId: string | null }): Promise<void> {
    await this.pool.query(`insert into t_publikacje (id_grafiku, id_kal_google, id_sync, status, opublikowano, zewnetrzne_id, operacja,
        id_uzytkownika, id_konta, id_zmiany, id_wydarzenia, wersja_wydarzenia, tryb, zaktualizowano)
      values ($1, $2, $3, 'Opublikowano', now(), $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (id_zmiany, id_kal_google) where id_zmiany is not null do update set id_grafiku = excluded.id_grafiku, id_sync = excluded.id_sync,
        status = 'Opublikowano', opublikowano = now(), zewnetrzne_id = excluded.zewnetrzne_id, operacja = excluded.operacja, id_konta = excluded.id_konta,
        id_wydarzenia = excluded.id_wydarzenia, wersja_wydarzenia = excluded.wersja_wydarzenia, tryb = excluded.tryb, zaktualizowano = now()`,
    [input.scheduleId, input.targetRowId, input.syncId, input.mode === 'symulacja' ? null : input.externalId, input.operation, input.userId,
      input.accountId, input.shiftId, input.eventId, input.eventVersion, input.mode]);
  }
}
