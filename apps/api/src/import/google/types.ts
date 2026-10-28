// Jednorazowy import wydarzeń z Google Calendar (historyjka S23KC2S1P2-27) – wspólne typy.

export type GoogleCalendarInfo = { id: string; name: string; primary: boolean };

/** Wydarzenie w formacie Google Calendar API (events.list) – tylko pola potrzebne do importu. */
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
};

/**
 * Źródło danych Google: prawdziwe Google Calendar API (OAuth 2.0, tylko odczyt) albo konto demonstracyjne,
 * gdy serwer nie ma skonfigurowanego klienta Google (makieta – warunek wstępny historyjki).
 */
export interface GoogleCalendarSource {
  readonly mode: 'google' | 'demo';
  listCalendars(accessToken: string): Promise<GoogleCalendarInfo[]>;
  listEvents(accessToken: string, calendarId: string, from: Date, to: Date): Promise<GoogleEvent[]>;
}

export class GoogleApiError extends Error {
  constructor(readonly code: 'google-unauthorized' | 'google-unavailable' | 'calendar-not-found') { super(code); }
}
