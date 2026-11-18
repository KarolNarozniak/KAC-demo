import { apiBaseUrl } from './importApi';

export type GoogleAccount = { id: string; email: string | null; status: 'connected' | 'error'; scopes: string[]; connectedAt: string; lastSyncAt: string | null };
export type GoogleAccountState = GoogleAccount | { status: 'disconnected' };
export type GoogleConnectionStart = { connectionId: string; authUrl: string };
export type GoogleConnectionStatus = { status: 'pending' | 'connected' | 'denied' | 'error'; email: string | null };
export type GoogleCalendarInfo = { id: string; name: string; primary: boolean };

const messages: Record<string, string> = {
  'connection-not-found': 'Połączenie wygasło. Spróbuj połączyć konto ponownie.',
  google_not_configured: 'Integracja z Google nie jest skonfigurowana na serwerze.',
  database_not_configured: 'Serwer nie ma skonfigurowanej bazy danych.',
  'not-connected': 'Konto Google nie jest połączone.',
  'google-unauthorized': 'Google odrzucił dostęp. Połącz konto ponownie.',
  'google-unavailable': 'Nie udało się połączyć z Google. Sprawdź internet i spróbuj ponownie.',
  network: 'Brak połączenia z internetem. Spróbuj ponownie, gdy wróci.',
};

export class GoogleIntegrationError extends Error {
  constructor(readonly code: string) { super(messages[code] ?? `Operacja nie powiodła się (${code}).`); }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method, headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
  } catch { throw new GoogleIntegrationError('network'); }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleIntegrationError(typeof data.error === 'string' ? data.error : `http-${response.status}`);
  return data as T;
}

export const getGoogleAccount = () => call<GoogleAccountState>('GET', '/api/v1/integrations/google');
export const startGoogleConnection = () => call<GoogleConnectionStart>('POST', '/api/v1/integrations/google/connections', {});
export const getGoogleConnectionStatus = (id: string) => call<GoogleConnectionStatus>('GET', `/api/v1/integrations/google/connections/${encodeURIComponent(id)}`);
export const listGoogleIntegrationCalendars = () => call<{ calendars: GoogleCalendarInfo[] }>('GET', '/api/v1/integrations/google/calendars');
export const disconnectGoogleAccount = () => call<void>('DELETE', '/api/v1/integrations/google');