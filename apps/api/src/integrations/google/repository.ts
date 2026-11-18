import type { Pool } from 'pg';
import { encryptRefreshToken, decryptRefreshToken } from './crypto.js';

export type GoogleAccountStatus = 'connected' | 'disconnected' | 'error';
export type GoogleAccount = { id: string; email: string | null; status: GoogleAccountStatus; scopes: string[]; connectedAt: string; lastSyncAt: string | null };
export type StoredTokens = { accessToken: string; refreshToken: string; expiresAt: Date; email: string | null; googleSub: string; scopes: string[] };
export type RefreshedTokens = { accessToken: string; refreshToken: string | null; expiresAt: Date };

export class NoRefreshTokenError extends Error { constructor() { super('no-refresh-token'); } }

export interface IntegrationsRepository {
  getGoogleAccount(userId: string): Promise<GoogleAccount | null>;
  saveGoogleAccount(userId: string, tokens: StoredTokens): Promise<GoogleAccount>;
  disconnectGoogleAccount(userId: string): Promise<boolean>;
  getValidAccessToken(userId: string, refresh: (refreshToken: string) => Promise<RefreshedTokens>): Promise<string>;
}

/** Trwałe konto Google (US6/UC4) — osobna tabela i repozytorium od jednorazowego importu (-27). */
export class PostgresIntegrationsRepository implements IntegrationsRepository {
  constructor(private readonly pool: Pool) {}

  private toAccount(row: any): GoogleAccount {
    return { id: row.id_konta, email: row.adres_email, status: row.status, scopes: row.zakresy ?? [],
      connectedAt: row.created_at.toISOString(), lastSyncAt: row.ostatnia_sync?.toISOString() ?? null };
  }

  async getGoogleAccount(userId: string): Promise<GoogleAccount | null> {
    const result = await this.pool.query(
      `select id_konta, adres_email, status, zakresy, created_at, ostatnia_sync from t_konta_google where id_uzytkownika = $1`, [userId]);
    return result.rows[0] ? this.toAccount(result.rows[0]) : null;
  }

  /** "Zmień konto" = ponowne wywołanie nadpisuje istniejący wiersz (unique po id_uzytkownika). */
  async saveGoogleAccount(userId: string, tokens: StoredTokens): Promise<GoogleAccount> {
    const encrypted = encryptRefreshToken(tokens.refreshToken);
    const result = await this.pool.query(
      `insert into t_konta_google (id_uzytkownika, google_sub, adres_email, status, zakresy, token_dostepu, token_dostepu_wygasa, token_odswiezania_zaszyfrowany, ostatnia_sync)
       values ($1, $2, $3, 'connected', $4, $5, $6, $7, now())
       on conflict (id_uzytkownika) do update set
         google_sub = excluded.google_sub, adres_email = excluded.adres_email, status = 'connected', zakresy = excluded.zakresy,
         token_dostepu = excluded.token_dostepu, token_dostepu_wygasa = excluded.token_dostepu_wygasa,
         token_odswiezania_zaszyfrowany = excluded.token_odswiezania_zaszyfrowany, ostatnia_sync = now(), updated_at = now()
       returning id_konta, adres_email, status, zakresy, created_at, ostatnia_sync`,
      [userId, tokens.googleSub, tokens.email, tokens.scopes, tokens.accessToken, tokens.expiresAt.toISOString(), encrypted]);
    return this.toAccount(result.rows[0]);
  }

  async disconnectGoogleAccount(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `update t_konta_google set status = 'disconnected', token_dostepu = null, token_dostepu_wygasa = null, token_odswiezania_zaszyfrowany = null, updated_at = now()
       where id_uzytkownika = $1 and status = 'connected'`, [userId]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * FOR UPDATE blokuje wiersz na czas sprawdzenia/odświeżenia — dwa równoległe żądania o token
   * serializują się na tej blokadzie (drugie czeka, potem widzi już odświeżony token, nie odświeża drugi raz).
   */
  async getValidAccessToken(userId: string, refresh: (refreshToken: string) => Promise<RefreshedTokens>): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(
        `select token_dostepu, token_dostepu_wygasa, token_odswiezania_zaszyfrowany, status from t_konta_google where id_uzytkownika = $1 for update`, [userId]);
      const row = result.rows[0];
      if (!row || row.status !== 'connected') { await client.query('rollback'); throw new NoRefreshTokenError(); }
      const expiresAt: Date | null = row.token_dostepu_wygasa;
      if (expiresAt && expiresAt.getTime() - Date.now() > 60_000 && row.token_dostepu) {
        await client.query('commit');
        return row.token_dostepu;
      }
      if (!row.token_odswiezania_zaszyfrowany) { await client.query('rollback'); throw new NoRefreshTokenError(); }
      const refreshToken = decryptRefreshToken(row.token_odswiezania_zaszyfrowany);
      let refreshed: RefreshedTokens;
      try {
        refreshed = await refresh(refreshToken);
      } catch (error) {
        await client.query(`update t_konta_google set status = 'error', updated_at = now() where id_uzytkownika = $1`, [userId]);
        await client.query('commit');
        throw error;
      }
      // Nie gubimy refresh tokenu, gdy odświeżona odpowiedź go pomija.
      const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
      await client.query(
        `update t_konta_google set token_dostepu = $2, token_dostepu_wygasa = $3, token_odswiezania_zaszyfrowany = $4, updated_at = now() where id_uzytkownika = $1`,
        [userId, refreshed.accessToken, refreshed.expiresAt.toISOString(), encryptRefreshToken(nextRefreshToken)]);
      await client.query('commit');
      return refreshed.accessToken;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}