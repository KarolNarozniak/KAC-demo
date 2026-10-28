// Prawdziwe połączenie z Google (S23KC2S1P2-27): OAuth 2.0 „authorization code” z PKCE, zakres tylko do odczytu.
// Token dostępu zostaje na serwerze (nigdy nie trafia do aplikacji) i jest usuwany po jednorazowym imporcie.
// Wymaga klienta OAuth w Google Cloud Console (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI).

import { createHash, randomBytes } from 'node:crypto';
import { GoogleApiError, type GoogleCalendarInfo, type GoogleCalendarSource, type GoogleEvent } from './types.js';

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Tylko odczyt kalendarzy i wydarzeń + adres e-mail konta (do pokazania, które konto połączono). */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];

const base64url = (bytes: Buffer) => bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function createPkce() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function authorizationUrl(config: GoogleOAuthConfig, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online', // bez tokenu odświeżania – import jest jednorazowy
    include_granted_scopes: 'true',
    prompt: 'select_account consent', // użytkownik wybiera konto i świadomie zatwierdza dostęp
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Wymiana kodu z przekierowania na token dostępu i odczyt adresu e-mail z id_token. */
export async function exchangeCode(config: GoogleOAuthConfig, code: string, codeVerifier: string, fetchImpl: FetchLike): Promise<{ accessToken: string; email: string | null }> {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri,
      grant_type: 'authorization_code', code_verifier: codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new GoogleApiError('google-unauthorized');
  const body = await response.json();
  if (typeof body.access_token !== 'string') throw new GoogleApiError('google-unauthorized');
  let email: string | null = null;
  if (typeof body.id_token === 'string') {
    try {
      // id_token przychodzi bezpośrednio z serwera tokenów Google (TLS), więc wystarczy odczytać jego treść.
      const payload = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'));
      if (typeof payload.email === 'string') email = payload.email;
    } catch { /* adres e-mail jest tylko informacyjny */ }
  }
  return { accessToken: body.access_token, email };
}

/** Google Calendar API v3 – lista kalendarzy i wydarzeń (pojedyncze wystąpienia serii, posortowane). */
export class GoogleCalendarApi implements GoogleCalendarSource {
  readonly mode = 'google' as const;

  constructor(private readonly fetchImpl: FetchLike) {}

  private async get(url: string, accessToken: string): Promise<any> {
    let response;
    try {
      response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new GoogleApiError('google-unavailable');
    }
    if (response.status === 401 || response.status === 403) throw new GoogleApiError('google-unauthorized');
    if (response.status === 404) throw new GoogleApiError('calendar-not-found');
    if (!response.ok) throw new GoogleApiError('google-unavailable');
    return response.json();
  }

  async listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
    const body = await this.get('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250', accessToken);
    return (body.items ?? []).map((item: any) => ({ id: String(item.id), name: String(item.summaryOverride ?? item.summary ?? item.id), primary: Boolean(item.primary) }));
  }

  async listEvents(accessToken: string, calendarId: string, from: Date, to: Date): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      });
      const body = await this.get(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, accessToken);
      events.push(...(body.items ?? []));
      pageToken = typeof body.nextPageToken === 'string' ? body.nextPageToken : undefined;
    } while (pageToken && events.length < 2000);
    return events;
  }
}
