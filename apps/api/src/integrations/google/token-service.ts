// Token dostępu Google dla połączonego konta (S23KC2S1P2-284, G01).
// Ważny token jest używany ponownie; wygasły – odświeżany pod blokadą (jedno odświeżenie naraz, także między procesami).
// Odpowiedź bez refresh_token nie usuwa zapisanego. invalid_grant oznacza „wymagane ponowne logowanie”.
// Tokeny nigdy nie trafiają do odpowiedzi API ani do logów.
import type { FetchLike } from '../../import/google/oauth.js';
import { GoogleIntegrationError, refreshAccessToken, type GoogleIntegrationOAuthConfig } from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository } from './repository.js';
import { TokenKeyError, type TokenCipher } from './token-cipher.js';

const EXPIRY_MARGIN_MS = 60_000;

export class GoogleTokenService {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly repository: Pick<PostgresGoogleIntegrationRepository, 'withTokenLock' | 'markReconnectRequired'>,
    private readonly cipher: TokenCipher | null,
    private readonly oauth: GoogleIntegrationOAuthConfig | null,
    private readonly fetchImpl: FetchLike,
    private readonly now: () => number = Date.now,
  ) {}

  /** Token dostępu do Calendar API. Konto demonstracyjne nie ma tokenów – zwraca znacznik „demo”. */
  async accessToken(account: GoogleAccountRecord): Promise<string> {
    if (account.mode === 'demo') return 'demo';
    if (account.status === 'reconnect_required') throw new GoogleIntegrationError('reconnect_required');
    if (!this.cipher || !this.oauth) throw new GoogleIntegrationError('google_error');
    const key = `${account.accountId}:${account.generation}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.obtain(account).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async obtain(account: GoogleAccountRecord): Promise<string> {
    const cipher = this.cipher!, oauth = this.oauth!;
    try {
      const token = await this.repository.withTokenLock(account, async (tokens) => {
        if (tokens.accessEnc && tokens.accessExpiresAt && tokens.accessExpiresAt.getTime() - EXPIRY_MARGIN_MS > this.now())
          return { result: cipher.decrypt(tokens.accessEnc, `${account.accountId}:access`) };
        if (!tokens.refreshEnc) throw new GoogleIntegrationError('reconnect_required');
        const grant = await refreshAccessToken(oauth, cipher.decrypt(tokens.refreshEnc, `${account.accountId}:refresh`), this.fetchImpl);
        return {
          result: grant.accessToken,
          update: {
            accessEnc: cipher.encrypt(grant.accessToken, `${account.accountId}:access`),
            accessExpiresAt: grant.expiresAt,
            // Rotacja: nowy token odświeżania zastępuje stary tylko wtedy, gdy Google go przysłał.
            ...(grant.refreshToken ? { refreshEnc: cipher.encrypt(grant.refreshToken, `${account.accountId}:refresh`) } : {}),
            keyId: cipher.keyId,
          },
        };
      });
      // null: konto odłączono albo zmieniono między odczytem a blokadą – stara generacja nie dostaje tokenu.
      if (token === null) throw new GoogleIntegrationError('reconnect_required');
      return token;
    } catch (error) {
      const failure = error instanceof TokenKeyError ? new GoogleIntegrationError('reconnect_required') : error;
      if (failure instanceof GoogleIntegrationError && failure.code === 'reconnect_required') await this.repository.markReconnectRequired(account);
      throw failure;
    }
  }
}
