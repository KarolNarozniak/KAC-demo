
import { createHash, randomBytes } from 'node:crypto';

// ============================================================
// Types & configuration
// ============================================================

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export type GoogleTokenErrorCode =
  | 'invalid_grant'
  | 'google-unavailable'
  | 'google-unauthorized'
  | 'invalid-response'
  | 'network-error';

export class GoogleTokenError extends Error {
  constructor(
    public readonly code: GoogleTokenErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GoogleTokenError';
  }
}

export type ExchangedTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  email: string | null;
  googleSub: string | null;
  grantedScopes: string[];
};

export type StoredGoogleTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  email: string | null;
  googleSub: string | null;
  grantedScopes: string[];
};

export type OAuthSession = {
  state: string;
  codeVerifier: string;
  createdAt: Date;
  redirectUri: string;
};

export type GoogleAccountInfo = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

// ============================================================
// Scopes
// ============================================================

/**
 * Zakresy tymczasowe.
 *
 * D01: docelowy zakres integracji.
 * D02: decyzja dotycząca read/write.
 *
 * Obecnie zakładamy możliwość odczytu i zapisu Google Calendar.
 * Zmiana zakresów powinna odbywać się tylko tutaj.
 */
export const PERSISTENT_GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar',
] as const;

// ============================================================
// Constants
// ============================================================

const GOOGLE_AUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth';

const GOOGLE_TOKEN_URL =
  'https://oauth2.googleapis.com/token';

const GOOGLE_USERINFO_URL =
  'https://openidconnect.googleapis.com/v1/userinfo';

const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TOKEN_EXPIRY_SECONDS = 3600;

// ============================================================
// Helpers
// ============================================================

function base64url(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const payload = token.split('.')[1];

    if (!payload) return null;

    return JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
  } catch {
    return null;
  }
}

function decodeTokenResponse(body: any): ExchangedTokens {
  if (typeof body?.access_token !== 'string') {
    throw new GoogleTokenError('invalid-response');
  }

  const payload =
    typeof body.id_token === 'string'
      ? parseJwtPayload(body.id_token)
      : null;

  return {
    accessToken: body.access_token,

    refreshToken:
      typeof body.refresh_token === 'string'
        ? body.refresh_token
        : null,

    expiresInSeconds:
      typeof body.expires_in === 'number'
        ? body.expires_in
        : DEFAULT_TOKEN_EXPIRY_SECONDS,

    email:
      typeof payload?.email === 'string'
        ? payload.email
        : null,

    googleSub:
      typeof payload?.sub === 'string'
        ? payload.sub
        : null,

    grantedScopes:
      typeof body.scope === 'string'
        ? body.scope.split(' ').filter(Boolean)
        : [],
  };
}

function assertConfig(config: GoogleOAuthConfig): void {
  if (
    !config.clientId ||
    !config.clientSecret ||
    !config.redirectUri
  ) {
    throw new Error('Missing Google OAuth configuration');
  }
}

async function fetchGoogle(
  fetchImpl: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
): Promise<any> {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: createTimeoutSignal(),
    });
  } catch (error) {
    if (error instanceof GoogleTokenError) throw error;

    throw new GoogleTokenError(
      'network-error',
      'Google OAuth network request failed',
    );
  }
}

// ============================================================
// PKCE & OAuth session
// ============================================================

/**
 * Generuje PKCE zgodnie z RFC 7636.
 */
export function createPkce(): {
  verifier: string;
  challenge: string;
} {
  const verifier = base64url(randomBytes(48));

  const challenge = base64url(
    createHash('sha256')
      .update(verifier)
      .digest(),
  );

  return { verifier, challenge };
}

/**
 * Generuje kryptograficznie bezpieczny state.
 *
 * State musi zostać zapisany po stronie backendu
 * i zweryfikowany przy callbacku OAuth.
 */
export function createOAuthState(): string {
  return base64url(randomBytes(32));
}

/**
 * Przygotowuje dane sesji OAuth.
 *
 * Samo utworzenie sesji nie zapisuje jej w bazie.
 * Przechowywanie i TTL pozostają odpowiedzialnością
 * warstwy wyższej.
 */
export function createOAuthSession(
  redirectUri: string,
): OAuthSession & { codeChallenge: string } {
  const pkce = createPkce();

  return {
    state: createOAuthState(),
    codeVerifier: pkce.verifier,
    codeChallenge: pkce.challenge,
    createdAt: new Date(),
    redirectUri,
  };
}

// ============================================================
// Authorization URL
// ============================================================

export function authorizationUrl(
  config: GoogleOAuthConfig,
  state: string,
  codeChallenge: string,
): string {
  assertConfig(config);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: PERSISTENT_GOOGLE_SCOPES.join(' '),
    state,

    code_challenge: codeChallenge,
    code_challenge_method: 'S256',

    access_type: 'offline',
    include_granted_scopes: 'true',

    // Wymuszenie ekranu zgody.
    prompt: 'select_account consent',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ============================================================
// Authorization code exchange
// ============================================================

export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike,
): Promise<ExchangedTokens> {
  assertConfig(config);

  const response = await fetchGoogle(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }).toString(),
    },
  );

  if (!response.ok) {
    throw new GoogleTokenError('google-unauthorized');
  }

  return decodeTokenResponse(await response.json());
}

// ============================================================
// Refresh access token
// ============================================================

/**
 * Odświeża access token.
 *
 * UWAGA:
 * Google nie zawsze zwraca nowy refresh_token.
 * Caller MUSI zachować poprzedni refresh token,
 * jeżeli refreshToken w odpowiedzi jest null.
 */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchLike,
): Promise<ExchangedTokens> {
  assertConfig(config);

  const response = await fetchGoogle(
    fetchImpl,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }).toString(),
    },
  );

  if (response.status === 400 || response.status === 401) {
    const body = await response.json().catch(() => ({}));

    throw new GoogleTokenError(
      body.error === 'invalid_grant'
        ? 'invalid_grant'
        : 'google-unauthorized',
    );
  }

  if (!response.ok) {
    throw new GoogleTokenError('google-unavailable');
  }

  return decodeTokenResponse(await response.json());
}

// ============================================================
// Token utilities
// ============================================================

/**
 * Konwertuje odpowiedź OAuth do modelu przeznaczonego
 * do przekazania warstwie persistence.
 */
export function toStoredTokens(
  tokens: ExchangedTokens,
  previousRefreshToken?: string | null,
): StoredGoogleTokens {
  const refreshToken =
    tokens.refreshToken ?? previousRefreshToken;

  if (!refreshToken) {
    throw new GoogleTokenError(
      'invalid-response',
      'Google did not provide a refresh token',
    );
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken,

    expiresAt: new Date(
      Date.now() + tokens.expiresInSeconds * 1000,
    ),

    email: tokens.email,
    googleSub: tokens.googleSub,
    grantedScopes: tokens.grantedScopes,
  };
}

/**
 * Sprawdza, czy access token powinien zostać odświeżony.
 *
 * Domyślnie przyjmujemy 60 sekund marginesu.
 */
export function isAccessTokenExpired(
  expiresAt: Date,
  marginSeconds = 60,
): boolean {
  return (
    expiresAt.getTime() <=
    Date.now() + marginSeconds * 1000
  );
}

// ============================================================
// Google account information
// ============================================================

/**
 * Pobiera podstawowe dane użytkownika Google.
 *
 * Przydatne do powiązania konta Google z użytkownikiem
 * aplikacji po zakończeniu OAuth.
 */
export async function getGoogleAccountInfo(
  accessToken: string,
  fetchImpl: FetchLike,
): Promise<GoogleAccountInfo> {
  const response = await fetchGoogle(
    fetchImpl,
    GOOGLE_USERINFO_URL,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status === 401) {
    throw new GoogleTokenError('google-unauthorized');
  }

  if (!response.ok) {
    throw new GoogleTokenError('google-unavailable');
  }

  const body = await response.json();

  if (
    typeof body.sub !== 'string' ||
    typeof body.email !== 'string'
  ) {
    throw new GoogleTokenError('invalid-response');
  }

  return {
    sub: body.sub,
    email: body.email,
    emailVerified: body.email_verified === true,

    ...(typeof body.name === 'string'
      ? { name: body.name }
      : {}),

    ...(typeof body.picture === 'string'
      ? { picture: body.picture }
      : {}),
  };
}

// ============================================================
// OAuth callback helpers
// ============================================================

/**
 * Weryfikuje podstawową poprawność state.
 *
 * Porównanie z oczekiwanym state i jego jednorazowe
 * unieważnienie musi wykonać warstwa obsługująca callback.
 */
export function validateOAuthState(
  receivedState: string,
  expectedState: string,
): boolean {
  if (!receivedState || !expectedState) return false;

  const received = Buffer.from(receivedState);
  const expected = Buffer.from(expectedState);

  return (
    received.length === expected.length &&
    createHash('sha256').update(received).digest()
      .equals(createHash('sha256').update(expected).digest())
  );
}

/**
 * Sprawdza, czy sesja OAuth nie wygasła.
 */
export function isOAuthSessionExpired(
  session: OAuthSession,
  maxAgeSeconds = 600,
): boolean {
  return (
    Date.now() - session.createdAt.getTime() >
    maxAgeSeconds * 1000
  );
}
