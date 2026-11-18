
import type { FetchLike } from './persistent-oauth.ts';

// ============================================================
// Types
// ============================================================

export type GoogleCalendar = {
  id: string;
  summary: string;
  description: string | null;
  timeZone: string | null;
  primary: boolean;
  accessRole: string;
};

export type GoogleCalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink: string | null;
  updatedAt: string | null;
  recurringEventId: string | null;
};

export type GoogleCalendarSyncStatus =
  | 'idle'
  | 'syncing'
  | 'success'
  | 'partial'
  | 'error';

export type GoogleCalendarSyncResult = {
  calendarId: string;
  status: GoogleCalendarSyncStatus;
  imported: number;
  updated: number;
  deleted: number;
  total: number;
  synchronizedAt: number | null;
  error: string | null;
};

export type GoogleCalendarSyncState = {
  userId: string;
  calendarId: string;
  syncToken: string | null;
  lastSyncedAt: number | null;
  status: GoogleCalendarSyncStatus;
  lastError: string | null;
};

export type CalendarSyncChanges = {
  userId: string;
  calendarId: string;
  events: GoogleCalendarEvent[];
  deletedEventIds: string[];
  nextSyncToken: string;
  synchronizedAt: number;
};

export type CalendarSyncOptions = {
  maxResults?: number;
  signal?: AbortSignal;
};

export class GoogleCalendarSyncError extends Error {
  constructor(
    public readonly code:
      | 'unauthorized'
      | 'forbidden'
      | 'not_found'
      | 'network_error'
      | 'google_unavailable'
      | 'invalid_response'
      | 'sync_failed',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'GoogleCalendarSyncError';
  }
}

// ============================================================
// Repository contract
// ============================================================

/**
 * Abstrakcja przyszłej bazy danych.
 *
 * applyChanges powinno wykonywać zapis wydarzeń,
 * usunięć i syncToken w jednej transakcji.
 */
export interface GoogleCalendarSyncRepository {
  getSyncState(
    userId: string,
    calendarId: string,
  ): Promise<GoogleCalendarSyncState | null>;

  saveSyncState(
    state: GoogleCalendarSyncState,
  ): Promise<void>;

  applyChanges(
    changes: CalendarSyncChanges,
  ): Promise<void>;
}

// ============================================================
// Configuration
// ============================================================

const GOOGLE_CALENDAR_API =
  'https://www.googleapis.com/calendar/v3';

const DEFAULT_MAX_RESULTS = 2500;
const REQUEST_TIMEOUT_MS = 15_000;

export const GOOGLE_CALENDAR_READ_SCOPE =
  'https://www.googleapis.com/auth/calendar.readonly';

// ============================================================
// Helpers
// ============================================================

function mapGoogleError(status: number): GoogleCalendarSyncError {
  switch (status) {
    case 401:
      return new GoogleCalendarSyncError('unauthorized');
    case 403:
      return new GoogleCalendarSyncError('forbidden');
    case 404:
      return new GoogleCalendarSyncError('not_found');
    case 410:
      return new GoogleCalendarSyncError(
        'sync_failed',
        'Sync token expired',
      );
    default:
      return new GoogleCalendarSyncError(
        status >= 500
          ? 'google_unavailable'
          : 'sync_failed',
      );
  }
}

function mapEvent(
  event: any,
  calendarId: string,
): GoogleCalendarEvent | null {
  if (typeof event.id !== 'string') return null;

  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;

  if (typeof start !== 'string' || typeof end !== 'string') {
    return null;
  }

  return {
    id: event.id,
    calendarId,
    title: event.summary ?? '(Bez tytułu)',
    description: event.description ?? null,
    location: event.location ?? null,
    start,
    end,
    allDay: !event.start?.dateTime,
    status:
      event.status === 'cancelled'
        ? 'cancelled'
        : event.status === 'tentative'
          ? 'tentative'
          : 'confirmed',
    htmlLink: event.htmlLink ?? null,
    updatedAt: event.updated ?? null,
    recurringEventId: event.recurringEventId ?? null,
  };
}

// ============================================================
// Google Calendar API client
// ============================================================

export class GoogleCalendarClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  private async request(
    path: string,
    params?: Record<string, string>,
  ): Promise<any> {
    const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    let response;

    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleCalendarSyncError('network_error');
    }

    if (!response.ok) {
      throw mapGoogleError(response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new GoogleCalendarSyncError('invalid_response');
    }
  }

  // ----------------------------------------------------------
  // Calendar list
  // ----------------------------------------------------------

  async listCalendars(): Promise<GoogleCalendar[]> {
    const calendars: GoogleCalendar[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string> = {
        maxResults: '250',
      };

      if (pageToken) params.pageToken = pageToken;

      const body = await this.request('/users/me/calendarList', params);

      if (!Array.isArray(body.items)) {
        throw new GoogleCalendarSyncError('invalid_response');
      }

      for (const item of body.items) {
        if (typeof item.id !== 'string') continue;

        calendars.push({
          id: item.id,
          summary: item.summary ?? item.id,
          description: item.description ?? null,
          timeZone: item.timeZone ?? null,
          primary: item.primary === true,
          accessRole: item.accessRole ?? 'none',
        });
      }

      pageToken = body.nextPageToken;
    } while (pageToken);

    return calendars;
  }

  // ----------------------------------------------------------
  // Calendar details
  // ----------------------------------------------------------

  async getCalendar(calendarId: string): Promise<GoogleCalendar> {
    const body = await this.request(
      `/calendars/${encodeURIComponent(calendarId)}`,
    );

    if (typeof body.id !== 'string') {
      throw new GoogleCalendarSyncError('invalid_response');
    }

    return {
      id: body.id,
      summary: body.summary ?? body.id,
      description: body.description ?? null,
      timeZone: body.timeZone ?? null,
      primary: false,
      accessRole: 'reader',
    };
  }

  // ----------------------------------------------------------
  // Events
  // ----------------------------------------------------------

  async listEvents(
    calendarId: string,
    syncToken?: string | null,
    options: CalendarSyncOptions = {},
  ): Promise<{
    events: GoogleCalendarEvent[];
    deletedEventIds: string[];
    nextSyncToken: string;
  }> {
    const events: GoogleCalendarEvent[] = [];
    const deletedEventIds: string[] = [];

    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    do {
      const params: Record<string, string> = {
        maxResults: String(
          options.maxResults ?? DEFAULT_MAX_RESULTS,
        ),
        showDeleted: 'true',
        singleEvents: 'true',
      };

      if (syncToken) {
        params.syncToken = syncToken;
      }

      if (pageToken) {
        params.pageToken = pageToken;
      }

      const body = await this.request(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        params,
      );

      if (!Array.isArray(body.items)) {
        throw new GoogleCalendarSyncError('invalid_response');
      }

      for (const item of body.items) {
        if (item.status === 'cancelled') {
          if (typeof item.id === 'string') {
            deletedEventIds.push(item.id);
          }
          continue;
        }

        const mapped = mapEvent(item, calendarId);

        if (mapped) events.push(mapped);
      }

      pageToken = body.nextPageToken;
      nextSyncToken = body.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    if (!nextSyncToken) {
      throw new GoogleCalendarSyncError(
        'invalid_response',
        'Google did not return nextSyncToken',
      );
    }

    return {
      events,
      deletedEventIds,
      nextSyncToken,
    };
  }
}

// ============================================================
// Synchronization service
// ============================================================

export class PersistentGoogleCalendarSync {
  constructor(
    private readonly repository: GoogleCalendarSyncRepository,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Pobiera kalendarze dostępne dla połączonego konta Google.
   */
  async getAvailableCalendars(
    accessToken: string,
    fetchImpl: FetchLike,
  ): Promise<GoogleCalendar[]> {
    const client = new GoogleCalendarClient(
      accessToken,
      fetchImpl,
    );

    return client.listCalendars();
  }

  /**
   * Uruchamia synchronizację wybranego kalendarza.
   *
   * Przy pierwszym uruchomieniu pobiera wszystkie dostępne
   * wydarzenia. Kolejne uruchomienia wykorzystują syncToken.
   */
  async syncCalendar(
    userId: string,
    calendarId: string,
    accessToken: string,
    fetchImpl: FetchLike,
  ): Promise<GoogleCalendarSyncResult> {
    const timestamp = this.now();

    const previous = await this.repository.getSyncState(
      userId,
      calendarId,
    );

    const state: GoogleCalendarSyncState = {
      userId,
      calendarId,
      syncToken: previous?.syncToken ?? null,
      lastSyncedAt: previous?.lastSyncedAt ?? null,
      status: 'syncing',
      lastError: null,
    };

    await this.repository.saveSyncState(state);

    try {
      const client = new GoogleCalendarClient(
        accessToken,
        fetchImpl,
      );

      let result;

      try {
        result = await client.listEvents(
          calendarId,
          state.syncToken,
        );
      } catch (error) {
        // Google 410 oznacza wygaśnięcie syncToken.
        if (
          state.syncToken &&
          error instanceof GoogleCalendarSyncError &&
          error.message === 'Sync token expired'
        ) {
          result = await client.listEvents(calendarId, null);
        } else {
          throw error;
        }
      }

      const changes: CalendarSyncChanges = {
        userId,
        calendarId,
        events: result.events,
        deletedEventIds: result.deletedEventIds,
        nextSyncToken: result.nextSyncToken,
        synchronizedAt: this.now(),
      };

      // Zapis wydarzeń i tokenu powinien być atomowy.
      await this.repository.applyChanges(changes);

      const finalState: GoogleCalendarSyncState = {
        userId,
        calendarId,
        syncToken: result.nextSyncToken,
        lastSyncedAt: changes.synchronizedAt,
        status: 'success',
        lastError: null,
      };

      await this.repository.saveSyncState(finalState);

      return {
        calendarId,
        status: 'success',
        imported: result.events.length,
        updated: 0,
        deleted: result.deletedEventIds.length,
        total: result.events.length,
        synchronizedAt: changes.synchronizedAt,
        error: null,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown synchronization error';

      await this.repository.saveSyncState({
        ...state,
        status: 'error',
        lastError: message,
      });

      return {
        calendarId,
        status: 'error',
        imported: 0,
        updated: 0,
        deleted: 0,
        total: 0,
        synchronizedAt: null,
        error: message,
      };
    }
  }

  /**
   * Ponawia synchronizację po błędzie.
   */
  async retrySync(
    userId: string,
    calendarId: string,
    accessToken: string,
    fetchImpl: FetchLike,
  ): Promise<GoogleCalendarSyncResult> {
    return this.syncCalendar(
      userId,
      calendarId,
      accessToken,
      fetchImpl,
    );
  }

  /**
   * Pobiera ostatni status synchronizacji.
   */
  async getSyncStatus(
    userId: string,
    calendarId: string,
  ): Promise<GoogleCalendarSyncState | null> {
    return this.repository.getSyncState(userId, calendarId);
  }
}
