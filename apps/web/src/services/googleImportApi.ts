// Klient API jednorazowego importu z Google Calendar (historyjka S23KC2S1P2-27).
// Zatwierdzenie i anulowanie korzysta ze wspólnych funkcji sesji importu (confirmImport, cancelImport).

import { apiBaseUrl, type ImportCategory, type ImportCollision, type ImportPreviewRow, type ImportRowInput } from './importApi';

export type GoogleConnectionStart =
  | { connectionId: string; mode: 'google'; authUrl: string }
  | { connectionId: string; mode: 'demo'; demoAccount: string };
export type GoogleConnectionStatus = { status: 'pending' | 'connected' | 'denied' | 'error' | 'used'; email: string | null; mode: 'google' | 'demo' };
export type GoogleCalendar = { id: string; name: string; primary: boolean };
export type GoogleRow = ImportRowInput & { endDate?: string; externalId: string };
export type GoogleReadResult = {
  importSessionId: string; expiresAt: string; email: string | null; calendarName: string; from: string; to: string;
  rows: GoogleRow[]; preview: ImportPreviewRow[]; skippedAllDay: number; collisions: Record<string, ImportCollision[]>;
};

const messages: Record<string, string> = {
  'access-denied': 'Bez zgody na odczyt wydarzeń import z Google Calendar nie jest możliwy.',
  'not-connected': 'Konto Google nie jest jeszcze połączone.',
  'connection-not-found': 'Połączenie z Google wygasło (15 minut). Połącz konto ponownie.',
  'connection-used': 'To połączenie zostało już użyte – import jest jednorazowy. Połącz konto ponownie.',
  'google-unauthorized': 'Google odrzucił dostęp. Połącz konto ponownie.',
  'google-unavailable': 'Nie udało się połączyć z Google. Sprawdź internet i spróbuj ponownie.',
  'calendar-not-found': 'Nie znaleziono wybranego kalendarza.',
  'invalid-range': 'Wybierz poprawny zakres dat (od ≤ do, najwyżej rok).',
  'database_unavailable': 'Nie można połączyć się z bazą danych. Nic nie zostało zapisane.',
  'database_not_configured': 'Serwer nie ma skonfigurowanej bazy danych.',
};

export class GoogleImportError extends Error {
  constructor(readonly code: string, readonly details: Record<string, unknown> = {}) {
    super(messages[code] ?? `Import z Google nie powiódł się (${code}).`);
  }
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new GoogleImportError('network');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new GoogleImportError(typeof data.error === 'string' ? data.error : `http-${response.status}`, data);
  return data as T;
}

const id = (connectionId: string) => encodeURIComponent(connectionId);

export const startGoogleConnection = () => call<GoogleConnectionStart>('POST', '/api/import/google/connections', {});
export const giveDemoConsent = (connectionId: string, allow: boolean) =>
  call<{ status: GoogleConnectionStatus['status']; email: string | null }>('POST', `/api/import/google/connections/${id(connectionId)}/consent`, { allow });
export const googleConnectionStatus = (connectionId: string) => call<GoogleConnectionStatus>('GET', `/api/import/google/connections/${id(connectionId)}`);
export const listGoogleCalendars = (connectionId: string) =>
  call<{ email: string | null; calendars: GoogleCalendar[] }>('GET', `/api/import/google/connections/${id(connectionId)}/calendars`);
export const readGoogleEvents = (connectionId: string, calendarId: string, from: string, to: string, category: ImportCategory) =>
  call<GoogleReadResult>('POST', `/api/import/google/connections/${id(connectionId)}/read`, { calendarId, from, to, category });
export const forgetGoogleConnection = (connectionId: string) => call<void>('DELETE', `/api/import/google/connections/${id(connectionId)}`).catch(() => undefined);
