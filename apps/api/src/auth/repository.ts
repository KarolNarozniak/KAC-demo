// Konta i sesje logowania w PostgreSQL (migracje 024 i 025).
import type { Pool, PoolClient } from 'pg';

export type AuthUser = { id: string; email: string; firstName: string; lastName: string; timeZone: string; hasRecoveryCode: boolean; isPremium: boolean; premiumExpiresAt: string | null };
export type LoginRecord = { userId: string; passwordHash: string; lockedUntil: Date | null };
export type RecoveryRecord = { userId: string; recoveryCodeHash: string | null; passwordHash: string };
export type SessionRecord = { sessionId: string; userId: string; calendarId: string | null; lastUsedAt: Date; isPremium: boolean; premiumExpiresAt: string | null };
export type PremiumRedemptionResult = { kind: 'redeemed'; user: AuthUser } | { kind: 'account_not_found' } | { kind: 'already_redeemed' };
export type RevokeReason = 'wylogowanie' | 'zmiana_hasla' | 'reset_hasla' | 'usuniecie_konta';

/** Adres e-mail jest loginem – zawsze porównujemy i zapisujemy go małymi literami, bez spacji na brzegach. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const userFrom = (row: any): AuthUser => ({ id: row.id_uzytkownika, email: row.email, firstName: row.imie, lastName: row.nazwisko, timeZone: row.strefa_czasowa,
  hasRecoveryCode: Boolean(row.ma_kod_odzyskiwania), isPremium: Boolean(row.is_premium),
  premiumExpiresAt: row.premium_expires_at ? new Date(row.premium_expires_at).toISOString() : null });
const USER_COLUMNS = `u.id_uzytkownika, u.imie, u.nazwisko, u.email, u.strefa_czasowa, d.kod_odzyskiwania_hash is not null as ma_kod_odzyskiwania
  , p.wygasa_at as premium_expires_at, coalesce(p.wygasa_at > now(), false) as is_premium
  from t_uzytkownicy u left join t_dane_logowania d using (id_uzytkownika)
  left join t_premium_entitlements p using (id_uzytkownika)`;

export class EmailTakenError extends Error { constructor() { super('email_taken'); } }

/** Nazwa kalendarza zakładanego przy rejestracji – taka sama jak w danych demonstracyjnych. */
export const DEFAULT_CALENDAR = { name: 'Mój kalendarz', type: 'Wewnetrzny' } as const;

export class PostgresAuthRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  /**
   * Nowe konto: użytkownik, skrót hasła, skrót kodu odzyskiwania, własny kalendarz i pusty profil pracy – razem albo wcale.
   * Zajęty adres → EmailTakenError. Profil pracy (godziny, dostępność, stawka) użytkownik uzupełnia w aplikacji – bez wiersza profilu
   * formularz, blokady i grafik nie miałyby czego zapisać.
   */
  async createAccount(input: { email: string; firstName: string; lastName: string; timeZone: string; passwordHash: string; recoveryCodeHash: string }): Promise<AuthUser> {
    try {
      return await this.transaction(async (client) => {
        const user = await client.query(`insert into t_uzytkownicy (imie, nazwisko, email, strefa_czasowa) values ($1, $2, $3, $4)
          returning id_uzytkownika, imie, nazwisko, email, strefa_czasowa`, [input.firstName, input.lastName, normalizeEmail(input.email), input.timeZone]);
        const id = user.rows[0].id_uzytkownika;
        await client.query('insert into t_dane_logowania (id_uzytkownika, haslo_hash, kod_odzyskiwania_hash) values ($1, $2, $3)', [id, input.passwordHash, input.recoveryCodeHash]);
        await client.query('insert into t_kalendarze (id_uzytkownika, nazwa, typ, aktywny) values ($1, $2, $3, true)', [id, DEFAULT_CALENDAR.name, DEFAULT_CALENDAR.type]);
        await client.query('insert into t_profile_pracy (id_uzytkownika, czas_dojazdu_min) values ($1, 0)', [id]);
        return { ...userFrom(user.rows[0]), hasRecoveryCode: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new EmailTakenError();
      throw error;
    }
  }

  async findLogin(email: string): Promise<LoginRecord | null> {
    const result = await this.pool.query(`select u.id_uzytkownika, d.haslo_hash, d.zablokowane_do from t_uzytkownicy u
      join t_dane_logowania d using (id_uzytkownika) where lower(u.email) = $1`, [normalizeEmail(email)]);
    const row = result.rows[0];
    return row ? { userId: row.id_uzytkownika, passwordHash: row.haslo_hash, lockedUntil: row.zablokowane_do ? new Date(row.zablokowane_do) : null } : null;
  }

  /**
   * Nieudana próba. Po `lockAfter` kolejnych błędach konto jest blokowane na `lockMinutes`; po wygaśnięciu blokady licznik startuje od nowa.
   * Zwraca true, gdy ta próba założyła blokadę.
   */
  async recordFailure(userId: string, lockAfter: number, lockMinutes: number): Promise<boolean> {
    const result = await this.pool.query(`with current as (
        select id_uzytkownika, case when zablokowane_do is not null and zablokowane_do <= now() then 0 else nieudane_proby end as base
        from t_dane_logowania where id_uzytkownika = $1 for update)
      update t_dane_logowania d set nieudane_proby = current.base + 1,
        zablokowane_do = case when current.base + 1 >= $2 then now() + make_interval(mins => $3) else null end, updated_at = now()
      from current where d.id_uzytkownika = current.id_uzytkownika returning d.zablokowane_do is not null as locked`, [userId, lockAfter, lockMinutes]);
    return Boolean(result.rows[0]?.locked);
  }

  async recordSuccess(userId: string): Promise<void> {
    await this.pool.query(`update t_dane_logowania set nieudane_proby = 0, zablokowane_do = null, ostatnie_logowanie_at = now(), updated_at = now()
      where id_uzytkownika = $1`, [userId]);
  }

  async createSession(userId: string, tokenHash: string, device: string | null, maxDays: number): Promise<{ sessionId: string; expiresAt: Date }> {
    const result = await this.pool.query(`insert into t_sesje (id_uzytkownika, token_hash, urzadzenie, wygasa_at)
      values ($1, $2, $3, now() + make_interval(days => $4)) returning id_sesji, wygasa_at`, [userId, tokenHash, device, maxDays]);
    return { sessionId: result.rows[0].id_sesji, expiresAt: new Date(result.rows[0].wygasa_at) };
  }

  /** Ważna sesja: nieunieważniona, przed terminem i używana w ostatnich `idleDays` dniach. Razem z aktywnym kalendarzem użytkownika. */
  async findSession(tokenHash: string, idleDays: number): Promise<SessionRecord | null> {
    const result = await this.pool.query(`select s.id_sesji, s.id_uzytkownika, s.ostatnio_uzyto_at, k.id_kalendarza,
        p.wygasa_at as premium_expires_at, coalesce(p.wygasa_at > now(), false) as is_premium
      from t_sesje s
      left join t_premium_entitlements p using (id_uzytkownika)
      left join lateral (select id_kalendarza from t_kalendarze where id_uzytkownika = s.id_uzytkownika and aktywny
        order by created_at, id_kalendarza limit 1) k on true
      where s.token_hash = $1 and s.uniewazniono_at is null and s.wygasa_at > now() and s.ostatnio_uzyto_at > now() - make_interval(days => $2)`,
    [tokenHash, idleDays]);
    const row = result.rows[0];
    return row ? { sessionId: row.id_sesji, userId: row.id_uzytkownika, calendarId: row.id_kalendarza ?? null, lastUsedAt: new Date(row.ostatnio_uzyto_at),
      isPremium: Boolean(row.is_premium), premiumExpiresAt: row.premium_expires_at ? new Date(row.premium_expires_at).toISOString() : null } : null;
  }

  async redeemPremiumCode(userId: string, campaignId: string, durationDays: number): Promise<PremiumRedemptionResult> {
    return this.transaction(async (client) => {
      const user = await client.query('select id_uzytkownika from t_uzytkownicy where id_uzytkownika = $1 for update', [userId]);
      if (!user.rowCount) return { kind: 'account_not_found' };
      const claimed = await client.query(`insert into t_premium_redemptions (id_uzytkownika, campaign_id, zrodlo, premium_until)
        values ($1, $2, 'code', now() + make_interval(days => $3)) on conflict (id_uzytkownika, campaign_id) do nothing returning id_redemption`,
      [userId, campaignId, durationDays]);
      if (!claimed.rowCount) return { kind: 'already_redeemed' };
      const entitlement = await client.query(`insert into t_premium_entitlements (id_uzytkownika, wygasa_at, zrodlo, campaign_id)
        values ($1, now() + make_interval(days => $2), 'code', $3)
        on conflict (id_uzytkownika) do update set wygasa_at = greatest(t_premium_entitlements.wygasa_at, now()) + make_interval(days => $2),
          zrodlo = 'code', campaign_id = excluded.campaign_id, updated_at = now()
        returning wygasa_at`, [userId, durationDays, campaignId]);
      await client.query(`update t_premium_redemptions set premium_until = $2 where id_redemption = $1`,
        [claimed.rows[0].id_redemption, entitlement.rows[0].wygasa_at]);
      const updated = await client.query(`select ${USER_COLUMNS} where u.id_uzytkownika = $1`, [userId]);
      return { kind: 'redeemed', user: userFrom(updated.rows[0]) };
    });
  }

  async grantPremiumByEmail(email: string, durationDays: number, campaignId = 'black-friday-2026') {
    return this.transaction(async (client) => {
      const target = await client.query('select id_uzytkownika from t_uzytkownicy where lower(email) = $1 for update', [normalizeEmail(email)]);
      if (!target.rowCount) return null;
      const userId = String(target.rows[0].id_uzytkownika);
      const entitlement = await client.query(`insert into t_premium_entitlements (id_uzytkownika, wygasa_at, zrodlo, campaign_id)
        values ($1, now() + make_interval(days => $2), 'manual', null)
        on conflict (id_uzytkownika) do update set wygasa_at = case when t_premium_entitlements.wygasa_at > now()
          then t_premium_entitlements.wygasa_at else now() + make_interval(days => $2) end,
          zrodlo = 'manual', campaign_id = null, updated_at = now() returning wygasa_at`, [userId, durationDays]);
      await client.query(`insert into t_premium_redemptions (id_uzytkownika, campaign_id, zrodlo, premium_until)
        values ($1, $2, 'manual', $3) on conflict (id_uzytkownika, campaign_id) do nothing`,
      [userId, campaignId, entitlement.rows[0].wygasa_at]);
      const updated = await client.query(`select ${USER_COLUMNS} where u.id_uzytkownika = $1`, [userId]);
      return userFrom(updated.rows[0]);
    });
  }

  async touchSession(sessionId: string): Promise<void> {
    await this.pool.query('update t_sesje set ostatnio_uzyto_at = now() where id_sesji = $1 and uniewazniono_at is null', [sessionId]);
  }

  async revokeSession(sessionId: string, reason: RevokeReason): Promise<void> {
    await this.pool.query('update t_sesje set uniewazniono_at = now(), powod_uniewaznienia = $2 where id_sesji = $1 and uniewazniono_at is null', [sessionId, reason]);
  }

  /** Unieważnia wszystkie sesje użytkownika poza `keepSessionId` (null – wszystkie). Zwraca liczbę unieważnionych. */
  async revokeSessions(userId: string, reason: RevokeReason, keepSessionId: string | null): Promise<number> {
    const result = await this.pool.query(`update t_sesje set uniewazniono_at = now(), powod_uniewaznienia = $2
      where id_uzytkownika = $1 and uniewazniono_at is null and ($3::text is null or id_sesji <> $3)`, [userId, reason, keepSessionId]);
    return result.rowCount ?? 0;
  }

  async getUser(userId: string): Promise<AuthUser | null> {
    const result = await this.pool.query(`select ${USER_COLUMNS} where u.id_uzytkownika = $1`, [userId]);
    return result.rows[0] ? userFrom(result.rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const result = await this.pool.query(`select ${USER_COLUMNS} where lower(u.email) = $1`, [normalizeEmail(email)]);
    return result.rows[0] ? userFrom(result.rows[0]) : null;
  }

  async hasRedeemedPremiumCampaign(userId: string, campaignId: string) {
    const result = await this.pool.query(`select 1 from t_premium_redemptions where id_uzytkownika = $1 and campaign_id = $2`, [userId, campaignId]);
    return Boolean(result.rowCount);
  }

  /** Konto do resetu kodem odzyskiwania: null – nie ma konta z hasłem; recoveryCodeHash null – konto nie ma kodu. */
  async findRecovery(email: string): Promise<RecoveryRecord | null> {
    const result = await this.pool.query(`select u.id_uzytkownika, d.kod_odzyskiwania_hash, d.haslo_hash from t_uzytkownicy u
      join t_dane_logowania d using (id_uzytkownika) where lower(u.email) = $1`, [normalizeEmail(email)]);
    const row = result.rows[0];
    return row ? { userId: row.id_uzytkownika, recoveryCodeHash: row.kod_odzyskiwania_hash ?? null, passwordHash: row.haslo_hash } : null;
  }

  /**
   * Reset hasła kodem odzyskiwania – w jednej transakcji: nowe hasło i nowy kod tylko wtedy, gdy w bazie nadal jest użyty kod
   * (dwa równoczesne użycia tego samego kodu: wygrywa jedno), zdjęcie blokady, wylogowanie wszystkich urządzeń i nowa sesja tego urządzenia.
   * null – kod został już użyty albo zmieniony.
   */
  async recoverAccount(input: { userId: string; usedCodeHash: string; passwordHash: string; newCodeHash: string; tokenHash: string; device: string | null; maxDays: number }):
    Promise<{ expiresAt: Date; revokedSessions: number } | null> {
    return this.transaction(async (client) => {
      const updated = await client.query(`update t_dane_logowania set haslo_hash = $3, haslo_zmieniono_at = now(), kod_odzyskiwania_hash = $4,
          nieudane_proby = 0, zablokowane_do = null, ostatnie_logowanie_at = now(), updated_at = now()
        where id_uzytkownika = $1 and kod_odzyskiwania_hash = $2`, [input.userId, input.usedCodeHash, input.passwordHash, input.newCodeHash]);
      if (!updated.rowCount) return null;
      const revoked = await client.query(`update t_sesje set uniewazniono_at = now(), powod_uniewaznienia = 'reset_hasla'
        where id_uzytkownika = $1 and uniewazniono_at is null`, [input.userId]);
      const session = await client.query(`insert into t_sesje (id_uzytkownika, token_hash, urzadzenie, wygasa_at)
        values ($1, $2, $3, now() + make_interval(days => $4)) returning wygasa_at`, [input.userId, input.tokenHash, input.device, input.maxDays]);
      return { expiresAt: new Date(session.rows[0].wygasa_at), revokedSessions: revoked.rowCount ?? 0 };
    });
  }

  /** Nowy kod odzyskiwania (stary przestaje działać) albo null – konto bez kodu (np. po ustawieniu hasła przez administratora). */
  async setRecoveryCode(userId: string, codeHash: string | null): Promise<void> {
    await this.pool.query('update t_dane_logowania set kod_odzyskiwania_hash = $2, updated_at = now() where id_uzytkownika = $1', [userId, codeHash]);
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const result = await this.pool.query('select haslo_hash from t_dane_logowania where id_uzytkownika = $1', [userId]);
    return result.rows[0]?.haslo_hash ?? null;
  }

  /** Nowe hasło (zmiana przez użytkownika albo ustawienie przez administratora) zdejmuje też blokadę po nieudanych próbach. */
  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(`insert into t_dane_logowania (id_uzytkownika, haslo_hash) values ($1, $2)
      on conflict (id_uzytkownika) do update set haslo_hash = excluded.haslo_hash, haslo_zmieniono_at = now(), nieudane_proby = 0,
        zablokowane_do = null, updated_at = now()`, [userId, passwordHash]);
  }

  /**
   * Konto bez kalendarza albo profilu pracy (np. utworzone przed logowaniem albo skryptem administratora) dostaje domyślne –
   * inaczej żaden ekran nie miałby gdzie zapisywać. Profil jest pusty (bez godzin i stawki, dojazd 0 min); użytkownik uzupełnia go w aplikacji.
   */
  async ensureAccountDefaults(userId: string): Promise<void> {
    await this.pool.query(`insert into t_kalendarze (id_uzytkownika, nazwa, typ, aktywny)
      select $1, $2, $3, true where not exists (select 1 from t_kalendarze where id_uzytkownika = $1 and aktywny)`, [userId, DEFAULT_CALENDAR.name, DEFAULT_CALENDAR.type]);
    await this.pool.query(`insert into t_profile_pracy (id_uzytkownika, czas_dojazdu_min)
      select $1, 0 where not exists (select 1 from t_profile_pracy where id_uzytkownika = $1 and aktywny)
      on conflict (id_uzytkownika) where aktywny do nothing`, [userId]);
  }

  async createUser(input: { email: string; firstName: string; lastName: string; timeZone: string }): Promise<AuthUser> {
    const result = await this.pool.query(`insert into t_uzytkownicy (imie, nazwisko, email, strefa_czasowa) values ($1, $2, $3, $4)
      returning id_uzytkownika, imie, nazwisko, email, strefa_czasowa`, [input.firstName, input.lastName, normalizeEmail(input.email), input.timeZone]);
    return userFrom(result.rows[0]);
  }

  /**
   * Usunięcie konta (RODO): wszystkie dane użytkownika. Publikacje i zlecenia outboxa usuwamy jawnie – publikacje blokują
   * usunięcie kalendarzy Google (ON DELETE RESTRICT), a zlecenia nie mają klucza obcego, choć niosą treść wydarzeń.
   * Reszta znika kaskadowo razem z t_uzytkownicy; statystyki użycia AI zostają bez powiązania z osobą (ON DELETE SET NULL).
   */
  async deleteAccount(userId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query('select 1 from t_uzytkownicy where id_uzytkownika = $1 for update', [userId]);
      await client.query(`delete from t_publikacje where id_uzytkownika = $1
        or id_konta in (select id_konta from t_konta_google where id_uzytkownika = $1)
        or id_kal_google in (select c.id_kal_google from t_kalendarze_google c join t_konta_google a using (id_konta) where a.id_uzytkownika = $1)`, [userId]);
      await client.query('delete from t_event_outbox where id_uzytkownika = $1', [userId]);
      await client.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
    });
  }
}
