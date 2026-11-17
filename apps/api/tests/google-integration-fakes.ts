// Udawany Google dla testów trwałej integracji (S23KC2S1P2-12, G01): serwer tokenów, cofanie zgody i lista kalendarzy.
// Testy nie łączą się z prawdziwym Google; każda odpowiedź jest tu jawnie ustawiona.
import type { FetchLike } from '../src/import/google/oauth.js';

export const READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const FULL_GRANT = `openid email ${READ_SCOPE} ${EVENTS_SCOPE}`;
export const OAUTH = { clientId: 'kac-test-client', clientSecret: 'kac-test-secret', redirectUri: 'http://localhost:4000/api/v1/integrations/google/callback' };

type Reply = { status?: number; body: Record<string, unknown> };
const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** id_token w formacie JWT (nagłówek.treść.podpis). Aplikacja czyta tylko treść – token przychodzi wprost z serwera tokenów. */
export function idToken(claims: Record<string, unknown>) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.test-signature`;
}

/**
 * Wydarzenia jednego kalendarza udawanego Google (G05): stan, dziennik zmian (kursor = numer ostatniej zmiany),
 * podział na strony, wygasłe kursory (410) i wymuszone błędy wybranych stron.
 */
export class FakeCalendarEvents {
  private seq = 0;
  private readonly entries = new Map<string, { item: Record<string, any>; seq: number }>();
  pageSize = 2500;
  readonly expiredTokens = new Set<string>();
  /** Błąd wymuszony dla strony o danym numerze (od 0) – zużywany po jednym. */
  pageFailures: Array<{ page: number; reply: number | 'network' }> = [];
  readonly requests: URLSearchParams[] = [];

  put(item: Record<string, any>) {
    this.entries.set(item.id, { item: { status: 'confirmed', ...item, updated: new Date(Date.UTC(2035, 0, 1) + (this.seq + 1) * 1000).toISOString() }, seq: ++this.seq });
  }
  cancel(id: string) {
    const previous = this.entries.get(id)?.item;
    this.entries.set(id, { item: { id, status: 'cancelled', ...(previous?.recurringEventId ? { recurringEventId: previous.recurringEventId } : {}) }, seq: ++this.seq });
  }
  get cursor() { return `fake-${this.seq}`; }

  handle(params: URLSearchParams): { status: number; body: Record<string, unknown> } | 'network' {
    this.requests.push(params);
    const syncToken = params.get('syncToken');
    if (syncToken && this.expiredTokens.has(syncToken)) return { status: 410, body: { error: { code: 410, message: 'Sync token is no longer valid, a full sync is required.' } } };
    const offset = Number(params.get('pageToken') ?? 0);
    const page = Math.floor(offset / this.pageSize);
    const failure = this.pageFailures.findIndex((entry) => entry.page === page);
    if (failure >= 0) {
      const [entry] = this.pageFailures.splice(failure, 1);
      if (entry!.reply === 'network') return 'network';
      return { status: entry!.reply as number, body: { error: { code: entry!.reply } } };
    }
    let items: Record<string, any>[];
    if (syncToken) {
      const since = Number(syncToken.replace('fake-', ''));
      items = [...this.entries.values()].filter((entry) => entry.seq > since).sort((a, b) => a.seq - b.seq).map((entry) => entry.item);
    } else {
      const from = Date.parse(params.get('timeMin') ?? '1970-01-01T00:00:00Z'); const to = Date.parse(params.get('timeMax') ?? '9999-12-31T00:00:00Z');
      items = [...this.entries.values()].map((entry) => entry.item).filter((item) => item.status !== 'cancelled').filter((item) => {
        const start = Date.parse(item.start?.dateTime ?? `${item.start?.date}T00:00:00Z`); const end = Date.parse(item.end?.dateTime ?? `${item.end?.date}T00:00:00Z`);
        return end > from && start < to;
      }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }
    const slice = items.slice(offset, offset + this.pageSize);
    const more = offset + this.pageSize < items.length;
    return { status: 200, body: { kind: 'calendar#events', items: slice, ...(more ? { nextPageToken: String(offset + this.pageSize) } : { nextSyncToken: this.cursor }) } };
  }
}

export class FakeGoogle {
  readonly tokenRequests: URLSearchParams[] = [];
  /** Wydarzenia kalendarzy (G05) – brak wpisu oznacza pusty kalendarz. */
  readonly calendarEvents = new Map<string, FakeCalendarEvents>();
  events(calendarId: string) {
    if (!this.calendarEvents.has(calendarId)) this.calendarEvents.set(calendarId, new FakeCalendarEvents());
    return this.calendarEvents.get(calendarId)!;
  }
  readonly calendarTokens: string[] = [];
  readonly revoked: string[] = [];
  readonly rejectedAccessTokens = new Set<string>();
  /** Strony listy kalendarzy (calendarList), po kolei. */
  calendarPages: Record<string, unknown>[][] = [[{ id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' }]];
  calendarFailure: Reply | null = null;
  /** Odpowiedź endpointu revoke: null – sukces, liczba – status błędu, 'network' – zerwane połączenie. */
  revokeFailure: number | 'network' | null = null;
  /** Kolejne odpowiedzi listy kalendarzy przed zwykłą: błąd HTTP albo 'network' (zerwane połączenie). Zużywane po jednej. */
  calendarScript: Array<Reply | 'network'> = [];
  delayMs = 0;
  private issued = 0;
  private readonly codes = new Map<string, Reply>();
  /** Odpowiedź na odświeżenie tokenu. Domyślnie nowy token dostępu bez nowego tokenu odświeżania (tak zwykle robi Google). */
  refresh: (refreshToken: string) => Reply = () => ({ body: { access_token: this.nextAccessToken(), expires_in: 3600, scope: FULL_GRANT, token_type: 'Bearer' } });

  nextAccessToken() { return `ya29.fake-access-${++this.issued}`; }

  /** Kod autoryzacji, który Google wyda po zgodzie. Kod jest jednorazowy – druga wymiana kończy się invalid_grant. */
  grantCode(code: string, input: { sub: string; email: string; refreshToken?: string | null; accessToken?: string; scope?: string; emailVerified?: boolean; audience?: string }) {
    this.codes.set(code, { body: {
      access_token: input.accessToken ?? this.nextAccessToken(), expires_in: 3599, token_type: 'Bearer', scope: input.scope ?? FULL_GRANT,
      ...(input.refreshToken === null ? {} : { refresh_token: input.refreshToken ?? `1//fake-refresh-${this.issued}` }),
      id_token: idToken({ iss: 'https://accounts.google.com', aud: input.audience ?? OAUTH.clientId, sub: input.sub, email: input.email,
        email_verified: input.emailVerified ?? true }),
    } });
  }

  failCode(code: string, reply: Reply) { this.codes.set(code, reply); }

  refreshCount() { return this.tokenRequests.filter((request) => request.get('grant_type') === 'refresh_token').length; }

  readonly fetch: FetchLike = async (url, init) => {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init?.body ?? '');
      this.tokenRequests.push(form);
      if (form.get('grant_type') === 'refresh_token') {
        const reply = this.refresh(form.get('refresh_token') ?? '');
        return respond(reply.status ?? 200, reply.body);
      }
      const code = form.get('code') ?? '';
      const reply = this.codes.get(code) ?? { status: 400, body: { error: 'invalid_grant', error_description: 'Malformed auth code.' } };
      this.codes.delete(code);
      return respond(reply.status ?? 200, reply.body);
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      if (this.revokeFailure === 'network') throw new TypeError('fetch failed');
      this.revoked.push(new URLSearchParams(init?.body ?? '').get('token') ?? '');
      return this.revokeFailure ? respond(this.revokeFailure, { error: 'server_error' }) : respond(200, {});
    }
    if (url.startsWith('https://www.googleapis.com/calendar/v3/users/me/calendarList')) {
      const token = String(init?.headers?.Authorization ?? '').replace(/^Bearer /, '');
      this.calendarTokens.push(token);
      if (this.rejectedAccessTokens.has(token)) return respond(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
      const scripted = this.calendarScript.shift();
      if (scripted === 'network') throw new TypeError('fetch failed');
      if (scripted) return respond(scripted.status ?? 500, scripted.body);
      if (this.calendarFailure) return respond(this.calendarFailure.status ?? 500, this.calendarFailure.body);
      const pageToken = new URL(url).searchParams.get('pageToken');
      const index = pageToken ? Number(pageToken.replace('page-', '')) : 0;
      return respond(200, { kind: 'calendar#calendarList', items: this.calendarPages[index] ?? [],
        ...(index + 1 < this.calendarPages.length ? { nextPageToken: `page-${index + 1}` } : {}) });
    }
    const eventsMatch = url.match(/^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/([^/]+)\/events\?(.*)$/);
    if (eventsMatch) {
      const token = String(init?.headers?.Authorization ?? '').replace(/^Bearer /, '');
      this.calendarTokens.push(token);
      if (this.rejectedAccessTokens.has(token)) return respond(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
      const reply = this.events(decodeURIComponent(eventsMatch[1]!)).handle(new URLSearchParams(eventsMatch[2]));
      if (reply === 'network') throw new TypeError('fetch failed');
      return respond(reply.status, reply.body);
    }
    throw new Error(`Nieoczekiwane żądanie do ${new URL(url).host}`);
  };
}
