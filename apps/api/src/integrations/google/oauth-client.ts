// Trwałe połączenie z Google (S23KC2S1P2-12, G01 / S23KC2S1P2-284): OAuth 2.0 „authorization code” z PKCE,
// tryb offline (token odświeżania) i kontrolowane odświeżanie tokenu dostępu.
// Jednorazowy import (S23KC2S1P2-27, import/google/oauth.ts) ma osobny kontrakt i zostaje bez zmian.
import type { FetchLike } from '../../import/google/oauth.js';

export type GoogleIntegrationOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

const CALENDAR_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const CALENDAR_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_FULL = 'https://www.googleapis.com/auth/calendar';

/** Zgodnie z historyjką 12: odczyt kalendarzy oraz odczyt i zapis wydarzeń. Użytkownik może w Google przyznać mniej – zapisujemy to, co przyznał. */
export const INTEGRATION_SCOPES = ['openid', 'email', CALENDAR_READ, CALENDAR_EVENTS];

/** Realnie przyznany dostęp na podstawie zakresów z odpowiedzi Google (a nie tych, o które prosiliśmy). */
export type GoogleAccess = { calendarsRead: boolean; eventsWrite: boolean };

export function accessFromScopes(scopes: string[]): GoogleAccess {
  const set = new Set(scopes);
  return {
    calendarsRead: set.has(CALENDAR_READ) || set.has(CALENDAR_FULL),
    eventsWrite: set.has(CALENDAR_EVENTS) || set.has(CALENDAR_FULL),
  };
}

export type GoogleErrorCode =
  | 'network_error' | 'google_unavailable' | 'reconnect_required' | 'insufficient_permissions' | 'rate_limited' | 'api_not_enabled'
  | 'authorization_code_invalid' | 'no_refresh_token' | 'missing_account_identity' | 'calendar_not_found' | 'calendar_not_writable' | 'google_error';

/** Błędy Google rozróżnione tak, żeby UI i ponowienia (G06) wiedziały, co dalej: ponowić, zalogować ponownie czy zmienić uprawnienia. */
export class GoogleIntegrationError extends Error {
  constructor(readonly code: GoogleErrorCode, readonly httpStatus?: number) { super(code); }
  /** Błąd przejściowy – ma sens automatyczne, ograniczone ponowienie (G06). */
  get transient() { return this.code === 'network_error' || this.code === 'google_unavailable' || this.code === 'rate_limited'; }
}

export type TokenGrant = {
  accessToken: string; expiresAt: Date; refreshToken: string | null; grantedScopes: string[];
};
export type ConnectedIdentity = TokenGrant & { sub: string; email: string };

export type IntegrationCalendar = { id: string; name: string; primary: boolean; accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader'; timeZone: string | null };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export function integrationAuthorizationUrl(config: GoogleIntegrationOAuthConfig, state: string, codeChallenge: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: INTEGRATION_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // token odświeżania – połączenie ma działać dłużej niż godzinę
    include_granted_scopes: 'true',
    prompt: 'select_account consent', // wybór konta (5b) i świadoma zgoda; consent wymusza też wydanie tokenu odświeżania
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function post(fetchImpl: FetchLike, body: Record<string, string>): Promise<{ status: number; ok: boolean; json: any }> {
  let response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Brak sieci albo przekroczony czas – odróżniamy od błędu po stronie Google (G06).
    throw new GoogleIntegrationError('network_error');
  }
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, json };
}

function grantFrom(json: any): TokenGrant {
  if (typeof json.access_token !== 'string' || !json.access_token) throw new GoogleIntegrationError('google_error');
  const expiresIn = Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : 3600;
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1000),
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
    grantedScopes: typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [],
  };
}

function tokenEndpointError(status: number, json: any, invalidGrant: GoogleErrorCode): GoogleIntegrationError {
  if (status >= 500) return new GoogleIntegrationError('google_unavailable', status);
  if (status === 429) return new GoogleIntegrationError('rate_limited', status);
  if (json?.error === 'invalid_grant') return new GoogleIntegrationError(invalidGrant, status);
  return new GoogleIntegrationError('google_error', status);
}

/** Wymiana kodu na tokeny i stabilną tożsamość konta (sub z id_token). Kod jest jednorazowy: ponowne użycie kończy się błędem 6a. */
export async function exchangeIntegrationCode(config: GoogleIntegrationOAuthConfig, code: string, codeVerifier: string, fetchImpl: FetchLike): Promise<ConnectedIdentity> {
  const response = await post(fetchImpl, {
    code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
    grant_type: 'authorization_code', code_verifier: codeVerifier,
  });
  if (!response.ok) throw tokenEndpointError(response.status, response.json, 'authorization_code_invalid');
  const grant = grantFrom(response.json);
  let payload: any = null;
  try {
    // id_token przychodzi bezpośrednio z serwera tokenów Google po TLS, w odpowiedzi na nasz kod – zamiast podpisu wystarcza
    // sprawdzenie wystawcy i odbiorcy (OpenID Connect Core 3.1.3.7).
    payload = JSON.parse(Buffer.from(String(response.json.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8'));
  } catch { /* brak id_token obsługujemy niżej */ }
  const audience = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  if (typeof payload?.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || payload.email_verified === false
    || !GOOGLE_ISSUERS.has(payload.iss) || !audience.includes(config.clientId))
    throw new GoogleIntegrationError('missing_account_identity');
  return { ...grant, sub: payload.sub, email: payload.email };
}

/** Odświeżenie tokenu dostępu. Google może pominąć refresh_token w odpowiedzi – wtedy wywołujący zachowuje dotychczasowy. */
export async function refreshAccessToken(config: GoogleIntegrationOAuthConfig, refreshToken: string, fetchImpl: FetchLike): Promise<TokenGrant> {
  const response = await post(fetchImpl, {
    client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken,
  });
  if (!response.ok) throw tokenEndpointError(response.status, response.json, 'reconnect_required');
  return grantFrom(response.json);
}

/** Cofnięcie zgody w Google (odłączenie i zmiana konta, G03). Unieważnia cały grant konta dla KAC. true = Google potwierdził albo token był już nieważny. */
export async function revokeToken(token: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    // Token w treści żądania, nie w adresie – adresy częściej trafiają do logów pośredników.
    const response = await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/** Błąd odpowiedzi Calendar API → kod integracji. 401: token nieważny; 403: brak uprawnień albo limit. */
export async function calendarApiError(response: { status: number; json(): Promise<any> }): Promise<GoogleIntegrationError> {
  const body = await response.json().catch(() => ({}));
  const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? '');
  if (response.status === 401) return new GoogleIntegrationError('reconnect_required', 401);
  if (response.status === 429 || /rateLimit|userRateLimit|quota/i.test(reason)) return new GoogleIntegrationError('rate_limited', response.status);
  // Calendar API wyłączone w projekcie Google Cloud – błąd konfiguracji, nie brak zgody użytkownika.
  if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(JSON.stringify(body ?? {}))) return new GoogleIntegrationError('api_not_enabled', 403);
  if (response.status === 403) return new GoogleIntegrationError('insufficient_permissions', 403);
  if (response.status === 404) return new GoogleIntegrationError('calendar_not_found', 404);
  if (response.status >= 500) return new GoogleIntegrationError('google_unavailable', response.status);
  return new GoogleIntegrationError('google_error', response.status);
}

const ROLES = new Set(['owner', 'writer', 'reader', 'freeBusyReader']);

/** Pełna lista kalendarzy (wszystkie strony) z rolą dostępu i strefą. Limit stron chroni przed zapętleniem. */
export async function listIntegrationCalendars(accessToken: string, fetchImpl: FetchLike, maxPages = 20): Promise<{ calendars: IntegrationCalendar[]; complete: boolean }> {
  const calendars: IntegrationCalendar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    let response;
    try {
      response = await fetchImpl(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new GoogleIntegrationError('network_error');
    }
    if (!response.ok) throw await calendarApiError(response);
    const body = await response.json();
    for (const item of body.items ?? []) {
      if (typeof item?.id !== 'string' || item.deleted) continue;
      calendars.push({ id: item.id, name: String(item.summaryOverride ?? item.summary ?? item.id), primary: Boolean(item.primary),
        accessRole: ROLES.has(item.accessRole) ? item.accessRole : 'reader', timeZone: typeof item.timeZone === 'string' ? item.timeZone : null });
    }
    pageToken = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
    if (!pageToken) return { calendars, complete: true };
  }
  return { calendars, complete: false };
}
