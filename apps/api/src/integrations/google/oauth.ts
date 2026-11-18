// Klient OAuth dla TRWAŁEJ integracji Google (US6/UC4). Celowo osobny od import/google/oauth.ts
// (jednorazowy import S23KC2S1P2-27) — ten kontrakt pozostaje nietknięty, zgodnie z taskiem.
import { createHash, randomBytes } from 'node:crypto';

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class GoogleTokenError extends Error {
  constructor(public code: 'invalid_grant' | 'google-unavailable' | 'google-unauthorized') { super(code); }
}

/**
 * TYMCZASOWE — decyzje D01 (realny zakres) i D02 (read/write) jeszcze nie zapadły. Zakładam docelowo
 * odczyt/zapis (calendar, nie calendar.readonly), bo postcondition historyjki mówi o "publikacji
 * zaakceptowanego grafiku". Zmień to w jednym miejscu, gdy D01/D02 zostaną podjęte.
 */
export const PERSISTENT_GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar'];

const base64url = (bytes: Buffer) => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkce() {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authorizationUrl(config: GoogleOAuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: PERSISTENT_GOOGLE_SCOPES.join(' '), state,
    code_challenge: codeChallenge, code_challenge_method: 'S256',
    access_type: 'offline', // trwała integracja - potrzebujemy refresh tokenu
    include_granted_scopes: 'true',
    prompt: 'select_account consent', // consent wymuszony, żeby Google ZAWSZE wydał refresh_token
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type ExchangedTokens = { accessToken: string; refreshToken: string | null; expiresInSeconds: number; email: string | null; googleSub: string | null; grantedScopes: string[] };

function decodeTokenResponse(body: any): ExchangedTokens {
  let email: string | null = null;
  let googleSub: string | null = null;
  if (typeof body.id_token === 'string') {
    try {
      const payload = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'));
      if (typeof payload.email === 'string') email = payload.email;
      if (typeof payload.sub === 'string') googleSub = payload.sub;
    } catch { /* e-mail/sub są tylko informacyjne */ }
  }
  return { accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresInSeconds: typeof body.expires_in === 'number' ? body.expires_in : 3600, email, googleSub,
    grantedScopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [] };
}

export async function exchangeCode(config: GoogleOAuthConfig, code: string, codeVerifier: string, fetchImpl: FetchLike): Promise<ExchangedTokens> {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new GoogleTokenError('google-unauthorized');
  const body = await response.json();
  if (typeof body.access_token !== 'string') throw new GoogleTokenError('google-unauthorized');
  return decodeTokenResponse(body);
}

/** Google czasem NIE zwraca nowego refresh_token przy odświeżeniu — caller musi zachować poprzedni. */
export async function refreshAccessToken(config: GoogleOAuthConfig, refreshToken: string, fetchImpl: FetchLike): Promise<ExchangedTokens> {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 400 || response.status === 401) {
    const body = await response.json().catch(() => ({}));
    throw new GoogleTokenError(body.error === 'invalid_grant' ? 'invalid_grant' : 'google-unauthorized');
  }
  if (!response.ok) throw new GoogleTokenError('google-unavailable');
  const body = await response.json();
  if (typeof body.access_token !== 'string') throw new GoogleTokenError('google-unauthorized');
  return decodeTokenResponse(body);
}