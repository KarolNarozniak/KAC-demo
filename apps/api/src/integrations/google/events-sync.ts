// Pobieranie i stosowanie zmian z Google według trwałej tożsamości (S23KC2S1P2-23, G05 / S23KC2S1P2-289).
//
// Dla każdego wybranego kalendarza źródłowego (G04):
//  1. odczyt wszystkich stron: pełny w oknie czasu (pierwszy raz, po wygaśnięciu kursora – 410, albo gdy okno trzeba przesunąć)
//     lub przyrostowy kursorem syncToken; błąd strony kończy kalendarz błędem i niczego nie zapisuje,
//  2. zastosowanie kompletnej serii stron w JEDNEJ transakcji razem z nowym kursorem – kursor przesuwa się tylko po sukcesie,
//  3. zmieniane i usuwane są wyłącznie wydarzenia KAC wskazane w mapowaniu t_google_wydarzenia; ręczne wpisy nie mają mapowania.
// Każda zmiana wydarzenia trafia do outboxa (W02) jak każda inna zmiana kalendarza.
//
// Założenie D05 (do potwierdzenia w zespole):
//  - instancje serii są osobnymi wydarzeniami KAC (klucz: konto + kalendarz + id instancji), bez przenoszenia reguły powtarzania,
//  - wydarzenia całodniowe i odrzucone zaproszenia są pomijane – nie blokują planowania (tak jak w jednorazowym imporcie),
//  - edycja pobranego wydarzenia w KAC wygrywa: Google go nie nadpisuje (konflikt), a usunięcie w Google zostawia lokalną kopię
//    jako zwykłe wydarzenie; „Przywróć wersję z Google” przywraca ostatnią wersję z Google,
//  - usunięcie pobranego wydarzenia w KAC jest trwałe – kolejne synchronizacje go nie odtwarzają,
//  - pobrane wydarzenia mają kategorię „Prywatne” i źródło „Google (synchronizacja)”,
//  - wydarzenia opublikowane przez KAC (extendedProperties.private.kacEventId albo zewnętrzne ID z t_publikacje) nie wracają jako nowe.
import type { PoolClient } from 'pg';
import type { UserScope } from '../../api/scope.js';
import { enqueueDomainEvent } from '../../events/outbox.js';
import { demoEventDelta, demoIntegrationEvents } from './demo.js';
import {
  GoogleIntegrationError, listIntegrationEventsPage, type GoogleErrorCode, type GoogleEventItem, type GoogleEventPage,
} from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository } from './repository.js';
import { isTransientCode } from './sync.js';

export const SYNC_SOURCE = 'Google (synchronizacja)';
const DAY_MS = 86_400_000;
/** Okno pełnego odczytu: 4 tygodnie wstecz (widok tygodnia i historia), 26 tygodni naprzód (planowanie). */
export const WINDOW_PAST_DAYS = 28;
export const WINDOW_FUTURE_DAYS = 182;
/** Kursor nie dociąga nowych instancji serii wchodzących w okno – co 4 tygodnie okno jest przesuwane pełnym odczytem. */
export const WINDOW_REFRESH_DAYS = 28;
/** Jawny limit zamiast cichego obcinania: kalendarz większy niż to kończy się błędem, nie „pełną synchronizacją”. */
export const MAX_EVENTS_PER_CALENDAR = 25_000;
const MAX_PAGES = 200;

export type EventSyncSimulation = 'remote_changes' | 'page_error' | 'token_expired';
type Window = { from: Date; to: Date };
type EventData = { title: string; start: string; end: string; location: string };

export type CalendarSyncResult = {
  calendarId: string; name: string;
  mode: 'full' | 'incremental';
  /** Powód pełnego odczytu: first – pierwszy raz, window – przesunięcie okna, token_expired – kursor wygasł (410). */
  reason: 'first' | 'window' | 'token_expired' | null;
  created: number; updated: number; deleted: number; unchanged: number; conflicts: number;
  skippedAllDay: number; skippedDeclined: number; skippedOwn: number;
  errorCode: string | null;
};
export type EventSyncOutcome = { calendars: CalendarSyncResult[]; tries: number };

// --- Źródło danych: prawdziwe Google albo makieta ---

type PageRequest = { calendarId: string; syncToken: string | null; window: Window | null; pageToken: string | null; pageIndex: number };
interface EventSource { page(request: PageRequest): Promise<GoogleEventPage> }

class GoogleApiSource implements EventSource {
  constructor(private readonly call: <T>(work: (token: string) => Promise<T>) => Promise<T>, private readonly fetchImpl: Parameters<typeof listIntegrationEventsPage>[1]) {}
  page(request: PageRequest) {
    return this.call((token) => listIntegrationEventsPage(token, this.fetchImpl, request.calendarId,
      { syncToken: request.syncToken, window: request.window, pageToken: request.pageToken }));
  }
}

/** Makieta „serwera Google”: kursor zawiera rewizję i okno, więc odczyt przyrostowy zwraca dokładnie różnicę od poprzedniego stanu. */
class DemoSource implements EventSource {
  constructor(private readonly email: string, private readonly revision: number, private readonly simulate: EventSyncSimulation | null) {}
  async page(request: PageRequest): Promise<GoogleEventPage> {
    if (this.simulate === 'token_expired' && request.syncToken) throw new GoogleIntegrationError('sync_token_expired', 410);
    let items: GoogleEventItem[];
    let window: Window;
    if (request.syncToken) {
      const [, revision, from, to] = request.syncToken.split('|');
      window = { from: new Date(from!), to: new Date(to!) };
      items = demoEventDelta(demoIntegrationEvents(this.email, request.calendarId, Number(revision), window),
        demoIntegrationEvents(this.email, request.calendarId, this.revision, window));
    } else {
      window = request.window!;
      items = demoIntegrationEvents(this.email, request.calendarId, this.revision, window);
    }
    // Przy symulacji błędu strony dzielimy wynik na strony po 3, żeby druga strona istniała.
    const size = this.simulate === 'page_error' ? 3 : Number.MAX_SAFE_INTEGER;
    const offset = request.pageToken ? Number(request.pageToken) : 0;
    const slice = items.slice(offset, offset + size);
    const more = offset + size < items.length;
    // Makieta błędu strony: ostatnia strona serii nie odpowiada (przy jednej stronie – ta jedyna), więc kursor nie może się przesunąć.
    if (this.simulate === 'page_error' && !more) throw new GoogleIntegrationError('google_unavailable', 503);
    return { items: slice, nextPageToken: more ? String(offset + size) : null,
      nextSyncToken: more ? null : `demo|${this.revision}|${window.from.toISOString()}|${window.to.toISOString()}` };
  }
}

// --- Reguły D05 ---

function timedData(item: GoogleEventItem): EventData | null {
  if (!item.start?.dateTime || !item.end?.dateTime) return null;
  const start = new Date(item.start.dateTime); const end = new Date(item.end.dateTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { title: (item.summary ?? '').trim().slice(0, 200) || 'Wydarzenie z Google', start: start.toISOString(), end: end.toISOString(),
    location: (item.location ?? '').trim().slice(0, 200) };
}
const declined = (item: GoogleEventItem) => Boolean(item.attendees?.some((attendee) => attendee.self && attendee.responseStatus === 'declined'));
const ownPublication = (item: GoogleEventItem, ownIds: Set<string>) =>
  Boolean(item.extendedProperties?.private?.kacEventId || item.extendedProperties?.private?.kacPublicationId) || ownIds.has(item.id);
const overlaps = (data: EventData, window: Window | null) => !window || (Date.parse(data.end) > window.from.getTime() && Date.parse(data.start) < window.to.getTime());
const sameData = (a: EventData, b: EventData) => a.title === b.title && a.start === b.start && a.end === b.end && a.location === b.location;

type Mapping = {
  id_powiazania: string; id_wydarzenia: string | null; wersja_lokalna: number | null; stan: string; dane_google: EventData | null;
};
type Context = {
  client: PoolClient; scope: UserScope; account: GoogleAccountRecord; calendarRowId: string; calendarName: string; timeZone: string;
  result: CalendarSyncResult;
};

export class GoogleEventSync {
  constructor(
    private readonly repository: PostgresGoogleIntegrationRepository,
    private readonly call: <T>(account: GoogleAccountRecord, work: (token: string) => Promise<T>) => Promise<T>,
    private readonly fetchImpl: Parameters<typeof listIntegrationEventsPage>[1],
  ) {}

  /** Synchronizacja wszystkich wybranych kalendarzy źródłowych. Błąd jednego kalendarza nie zatrzymuje pozostałych (wynik częściowy). */
  async syncSources(scope: UserScope, account: GoogleAccountRecord, options: {
    simulate: EventSyncSimulation | null; sleep: (ms: number) => Promise<void>; maxTries: number; baseDelayMs: number; now?: Date;
  }): Promise<EventSyncOutcome> {
    const sources = await this.repository.runInTransaction(async (client) => (await client.query(`select id_kal_google, id_zewnetrzne, nazwa
      from t_kalendarze_google where id_konta = $1 and wybrany and uprawnienia <> 'Brak dostępu' order by glowny desc, nazwa, id_kal_google`,
    [account.accountId])).rows);
    if (options.simulate === 'remote_changes' && account.mode === 'demo') {
      // Makieta: „ktoś zmienił wydarzenia w Google” – następna rewizja każdego źródła.
      await this.repository.runInTransaction(async (client) => {
        for (const source of sources) await client.query(`insert into t_google_sync_stan (id_konta, id_kal_google, demo_rewizja) values ($1, $2, 1)
          on conflict (id_konta, id_kal_google) do update set demo_rewizja = t_google_sync_stan.demo_rewizja + 1, updated_at = now()`,
        [account.accountId, source.id_kal_google]);
      });
    }
    const calendars: CalendarSyncResult[] = [];
    let tries = 1;
    for (const source of sources) {
      const result: CalendarSyncResult = { calendarId: source.id_zewnetrzne, name: source.nazwa, mode: 'incremental', reason: null,
        created: 0, updated: 0, deleted: 0, unchanged: 0, conflicts: 0, skippedAllDay: 0, skippedDeclined: 0, skippedOwn: 0, errorCode: null };
      try {
        const fetched = await this.fetch(account, source, options, result);
        tries = Math.max(tries, fetched.tries);
        await this.apply(scope, account, source, fetched, result, options.now ?? new Date());
      } catch (error) {
        result.errorCode = error instanceof GoogleIntegrationError ? error.code : 'sync_apply_failed';
        // Wygasłe logowanie dotyczy całego konta – kolejne kalendarze i tak by się nie udały.
        if (result.errorCode === 'reconnect_required') { calendars.push(result); break; }
      }
      calendars.push(result);
    }
    return { calendars, tries };
  }

  /** Etap 1: wszystkie strony serii (z ponowieniami błędów przejściowych) – jeszcze bez żadnych zmian w bazie. */
  private async fetch(account: GoogleAccountRecord, source: { id_kal_google: string; id_zewnetrzne: string },
    options: { simulate: EventSyncSimulation | null; sleep: (ms: number) => Promise<void>; maxTries: number; baseDelayMs: number; now?: Date },
    result: CalendarSyncResult) {
    const checkpoint = (await this.repository.runInTransaction((client) => client.query(`select sync_token, pelny_odczyt_at, demo_rewizja
      from t_google_sync_stan where id_konta = $1 and id_kal_google = $2`, [account.accountId, source.id_kal_google]))).rows[0];
    const now = options.now ?? new Date();
    const src: EventSource = account.mode === 'demo'
      ? new DemoSource(account.email, Number(checkpoint?.demo_rewizja ?? 0), options.simulate)
      : new GoogleApiSource((work) => this.call(account, work), this.fetchImpl);
    let tries = 1;
    const readSeries = async (syncToken: string | null, window: Window | null) => {
      const items: GoogleEventItem[] = [];
      let pageToken: string | null = null;
      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
        let page: GoogleEventPage | null = null;
        for (let attempt = 1; ; attempt++) {
          tries = Math.max(tries, attempt);
          try { page = await src.page({ calendarId: source.id_zewnetrzne, syncToken, window, pageToken, pageIndex }); break; }
          catch (error) {
            const code = error instanceof GoogleIntegrationError ? error.code : 'google_error';
            if (isTransientCode(code) && attempt < options.maxTries) { await options.sleep(options.baseDelayMs * 2 ** (attempt - 1)); continue; }
            throw error;
          }
        }
        items.push(...page.items);
        if (items.length > MAX_EVENTS_PER_CALENDAR) throw new GoogleIntegrationError('calendar_too_large' as GoogleErrorCode);
        if (!page.nextPageToken) return { items, nextSyncToken: page.nextSyncToken };
        pageToken = page.nextPageToken;
      }
      throw new GoogleIntegrationError('google_error');
    };

    const windowStale = !checkpoint?.pelny_odczyt_at || new Date(checkpoint.pelny_odczyt_at).getTime() < now.getTime() - WINDOW_REFRESH_DAYS * DAY_MS;
    if (checkpoint?.sync_token && !windowStale) {
      try {
        const series = await readSeries(checkpoint.sync_token, null);
        return { mode: 'incremental' as const, window: null, ...series, tries };
      } catch (error) {
        if (!(error instanceof GoogleIntegrationError) || error.code !== 'sync_token_expired') throw error;
        result.reason = 'token_expired';
      }
    }
    // Pełny odczyt: tylko przestrzeń Google tego kalendarza zostanie potem uzgodniona z mapowaniem.
    result.mode = 'full';
    result.reason ??= checkpoint?.sync_token ? 'window' : 'first';
    const window = { from: new Date(now.getTime() - WINDOW_PAST_DAYS * DAY_MS), to: new Date(now.getTime() + WINDOW_FUTURE_DAYS * DAY_MS) };
    const series = await readSeries(null, window);
    return { mode: 'full' as const, window, ...series, tries };
  }

  /** Etap 2: kompletna seria w jednej transakcji z kursorem. Błąd (np. bazy) cofa wszystko – kursor zostaje stary. */
  private async apply(scope: UserScope, account: GoogleAccountRecord, source: { id_kal_google: string; nazwa: string },
    fetched: { mode: 'full' | 'incremental'; window: Window | null; items: GoogleEventItem[]; nextSyncToken: string | null }, result: CalendarSyncResult, now: Date) {
    await this.repository.runInTransaction(async (client) => {
      await client.query(`insert into t_google_sync_stan (id_konta, id_kal_google) values ($1, $2) on conflict do nothing`, [account.accountId, source.id_kal_google]);
      const checkpoint = (await client.query(`select okno_od, okno_do from t_google_sync_stan where id_konta = $1 and id_kal_google = $2 for update`,
        [account.accountId, source.id_kal_google])).rows[0];
      const zone = (await client.query(`select strefa_czasowa from t_uzytkownicy where id_uzytkownika = $1`, [scope.userId])).rows[0]?.strefa_czasowa ?? 'Europe/Warsaw';
      const ctx: Context = { client, scope, account, calendarRowId: source.id_kal_google, calendarName: source.nazwa, timeZone: zone, result };
      const window = fetched.window ?? (checkpoint.okno_od && checkpoint.okno_do ? { from: new Date(checkpoint.okno_od), to: new Date(checkpoint.okno_do) } : null);
      const ownIds = new Set((await client.query(`select zewnetrzne_id from t_publikacje where id_kal_google = $1 and zewnetrzne_id is not null`,
        [source.id_kal_google])).rows.map((row) => String(row.zewnetrzne_id)));

      // Ostatnia wersja danego id wygrywa (strony mogą zawierać to samo wydarzenie więcej niż raz).
      const latest = new Map<string, GoogleEventItem>();
      for (const item of fetched.items) latest.set(item.id, item);
      for (const item of latest.values()) await this.applyItem(ctx, item, window, ownIds);

      if (fetched.mode === 'full' && fetched.window) {
        // Uzgodnienie pełnego odczytu: wydarzenia z mapowania w oknie, których Google już nie zwrócił, zniknęły z Google.
        // Starsze niż okno zostają jako historia. Dotyczy wyłącznie wierszy mapowania tego konta i kalendarza.
        const missing = await client.query(`select m.id_powiazania, m.id_wydarzenia, m.wersja_lokalna, m.stan, m.dane_google
          from t_google_wydarzenia m join t_wydarzenia e on e.id_wydarzenia = m.id_wydarzenia
          where m.id_konta = $1 and m.id_kal_google = $2 and m.stan in ('aktywne', 'konflikt') and not (m.google_id = any($3::text[]))
            and e.zakonczenie > $4 and e.rozpoczecie < $5
          for update of m`, [account.accountId, source.id_kal_google, [...latest.keys()], fetched.window.from, fetched.window.to]);
        for (const mapping of missing.rows as Mapping[]) await this.removeMapped(ctx, mapping);
      }
      // Czas odczytu z tego samego zegara co okno – od niego liczy się kolejne przesunięcie okna.
      await client.query(`update t_google_sync_stan set sync_token = $3, ostatni_odczyt_at = $7, updated_at = now(),
          okno_od = coalesce($4, okno_od), okno_do = coalesce($5, okno_do), pelny_odczyt_at = case when $6 then $7 else pelny_odczyt_at end
        where id_konta = $1 and id_kal_google = $2`, [account.accountId, source.id_kal_google, fetched.nextSyncToken,
        fetched.window?.from ?? null, fetched.window?.to ?? null, fetched.mode === 'full', now]);
    });
  }

  private async applyItem(ctx: Context, item: GoogleEventItem, window: Window | null, ownIds: Set<string>) {
    const { client, account, calendarRowId, result } = ctx;
    if (ownPublication(item, ownIds)) { result.skippedOwn++; return; }
    const mapping = (await client.query(`select id_powiazania, id_wydarzenia, wersja_lokalna, stan, dane_google from t_google_wydarzenia
      where id_konta = $1 and id_kal_google = $2 and google_id = $3 for update`, [account.accountId, calendarRowId, item.id])).rows[0] as Mapping | undefined;
    const data = item.status === 'cancelled' ? null : timedData(item);
    if (!data || declined(item)) {
      if (item.status !== 'cancelled') { if (declined(item) && data) result.skippedDeclined++; else result.skippedAllDay++; }
      // Odwołane, zmienione na całodniowe albo odrzucone – znika z planu (o ile nie było edytowane w KAC).
      if (mapping) await this.removeMapped(ctx, mapping);
      return;
    }
    if (!mapping) {
      // Nowe wydarzenie spoza okna (np. odległa zmiana z kursora) nie jest importowane – okno pilnuje rozmiaru planu.
      if (!overlaps(data, window)) return;
      const eventId = await this.insertEvent(ctx, data);
      await client.query(`insert into t_google_wydarzenia (id_uzytkownika, id_konta, id_kal_google, google_id, google_seria_id, google_updated,
          id_wydarzenia, wersja_lokalna, dane_google, stan) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'aktywne')`,
      [ctx.scope.userId, account.accountId, calendarRowId, item.id, item.recurringEventId ?? null, item.updated ?? null, eventId.id, eventId.version, JSON.stringify(data)]);
      result.created++;
      return;
    }
    const remember = (stan: string, extra: { id?: string | null; version?: number | null } = {}) => client.query(`update t_google_wydarzenia set
        dane_google = $2::jsonb, google_updated = coalesce($3, google_updated), google_seria_id = coalesce($4, google_seria_id), stan = $5,
        id_wydarzenia = case when $6 then $7 else id_wydarzenia end, wersja_lokalna = case when $8 then $9 else wersja_lokalna end, updated_at = now()
      where id_powiazania = $1`, [mapping.id_powiazania, JSON.stringify(data), item.updated ?? null, item.recurringEventId ?? null, stan,
      'id' in extra, extra.id ?? null, 'version' in extra, extra.version ?? null]);

    if (!mapping.id_wydarzenia) {
      if (mapping.stan === 'usuniete_w_google' || mapping.stan === 'odlaczone') {
        // Wydarzenie wróciło w Google (przywrócone albo ponowny wybór kalendarza) – odtwarzamy je w KAC.
        const created = await this.insertEvent(ctx, data);
        await remember('aktywne', { id: created.id, version: created.version });
        result.created++;
      } else {
        // Usunięte w KAC – decyzja użytkownika jest trwała; zapamiętujemy tylko wersję z Google.
        await remember(mapping.stan);
      }
      return;
    }
    const event = (await client.query(`select event_version, tytul, rozpoczecie, zakonczenie, miejsce from t_wydarzenia where id_wydarzenia = $1 for update`,
      [mapping.id_wydarzenia])).rows[0];
    if (!event) { await remember(mapping.stan, { id: null }); return; }
    const local: EventData = { title: event.tytul, start: new Date(event.rozpoczecie).toISOString(), end: new Date(event.zakonczenie).toISOString(), location: event.miejsce ?? '' };
    const editedLocally = mapping.stan !== 'aktywne' || Number(event.event_version) > Number(mapping.wersja_lokalna ?? event.event_version);
    if (editedLocally) {
      // Edycja w KAC wygrywa: zmiana z Google nie nadpisuje lokalnej (konflikt widoczny w szczegółach wydarzenia).
      if (!mapping.dane_google || !sameData(mapping.dane_google, data) || mapping.stan === 'odlaczone') result.conflicts++;
      await remember('konflikt');
      return;
    }
    if (sameData(local, data)) { result.unchanged++; await remember('aktywne'); return; }
    const version = await this.updateEvent(ctx, mapping.id_wydarzenia, local, data, Number(event.event_version));
    await remember('aktywne', { version });
    result.updated++;
  }

  /** Usunięcie w Google (albo zniknięcie z okna pełnego odczytu): wydarzenie z KAC znika, chyba że było edytowane lokalnie. */
  private async removeMapped(ctx: Context, mapping: Mapping) {
    const { client, result } = ctx;
    if (!mapping.id_wydarzenia) {
      await client.query(`update t_google_wydarzenia set stan = 'usuniete_w_google', updated_at = now() where id_powiazania = $1`, [mapping.id_powiazania]);
      return;
    }
    const event = (await client.query(`select event_version, tytul, rozpoczecie, zakonczenie, miejsce from t_wydarzenia where id_wydarzenia = $1 for update`,
      [mapping.id_wydarzenia])).rows[0];
    if (!event) {
      await client.query(`update t_google_wydarzenia set stan = 'usuniete_w_google', id_wydarzenia = null, updated_at = now() where id_powiazania = $1`, [mapping.id_powiazania]);
      return;
    }
    const editedLocally = mapping.stan !== 'aktywne' || Number(event.event_version) > Number(mapping.wersja_lokalna ?? event.event_version);
    if (editedLocally) {
      // Lokalna kopia zostaje jako zwykłe wydarzenie – nie kasujemy pracy użytkownika.
      await client.query(`update t_google_wydarzenia set stan = 'odlaczone', dane_google = null, updated_at = now() where id_powiazania = $1`, [mapping.id_powiazania]);
      result.conflicts++;
      return;
    }
    await enqueueDomainEvent(client, { userId: ctx.scope.userId, calendarId: ctx.scope.calendarId }, 'calendar_event', mapping.id_wydarzenia, 'calendar_event.deleted', {
      origin: 'google_sync', timeZone: ctx.timeZone,
      before: { title: event.tytul, start: new Date(event.rozpoczecie).toISOString(), end: new Date(event.zakonczenie).toISOString(), category: 'Personal', version: Number(event.event_version) },
    });
    await client.query(`delete from t_wydarzenia where id_wydarzenia = $1`, [mapping.id_wydarzenia]);
    await client.query(`update t_google_wydarzenia set stan = 'usuniete_w_google', id_wydarzenia = null, dane_google = null, updated_at = now()
      where id_powiazania = $1`, [mapping.id_powiazania]);
    result.deleted++;
  }

  private async insertEvent(ctx: Context, data: EventData): Promise<{ id: string; version: number }> {
    const inserted = await ctx.client.query(`insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo, opis, miejsce)
      values ($1, coalesce((select id_kategorii from t_kategorie where nazwa = 'Prywatne' limit 1), 'CAT03'), $2, $3, $4, $5, $6, $7)
      returning id_wydarzenia, event_version`, [ctx.scope.calendarId, data.title, data.start, data.end, SYNC_SOURCE,
      `Z Google Calendar: ${ctx.calendarName}`.slice(0, 500), data.location]);
    const id = String(inserted.rows[0].id_wydarzenia);
    await enqueueDomainEvent(ctx.client, ctx.scope, 'calendar_event', id, 'calendar_event.created', {
      origin: 'google_sync', timeZone: ctx.timeZone, eventVersion: inserted.rows[0].event_version,
      after: { title: data.title, start: data.start, end: data.end, category: 'Personal', location: data.location },
    });
    return { id, version: Number(inserted.rows[0].event_version) };
  }

  private async updateEvent(ctx: Context, eventId: string, before: EventData, data: EventData, previousVersion: number): Promise<number> {
    const updated = await ctx.client.query(`update t_wydarzenia set tytul = $2, rozpoczecie = $3, zakonczenie = $4, miejsce = $5,
        event_version = event_version + 1, updated_at = now() where id_wydarzenia = $1 returning event_version`,
    [eventId, data.title, data.start, data.end, data.location]);
    await enqueueDomainEvent(ctx.client, ctx.scope, 'calendar_event', eventId, 'calendar_event.updated', {
      origin: 'google_sync', timeZone: ctx.timeZone, eventVersion: updated.rows[0].event_version,
      before: { ...before, category: 'Personal', version: previousVersion },
      after: { ...data, category: 'Personal' },
    });
    return Number(updated.rows[0].event_version);
  }
}

// --- Odznaczenie kalendarza (D04) i pobrane wydarzenie w szczegółach (D05) ---

/**
 * Założenie D04: kalendarz odznaczony w G04 przestaje być brany pod uwagę – pobrane z niego wydarzenia znikają z KAC w tej samej
 * transakcji co zapis wyboru. Edytowane w KAC zostają (jako odłączone), kursor jest kasowany, więc ponowny wybór zaczyna od pełnego odczytu.
 */
export async function releaseCalendars(client: PoolClient, input: { userId: string; accountId: string; calendarRowIds: string[] }): Promise<{ removed: number; kept: number }> {
  if (!input.calendarRowIds.length) return { removed: 0, kept: 0 };
  const rows = (await client.query(`select m.id_powiazania, m.id_wydarzenia, m.wersja_lokalna, m.stan, e.event_version, e.id_kalendarza, e.tytul,
      e.rozpoczecie, e.zakonczenie, u.strefa_czasowa
    from t_google_wydarzenia m left join t_wydarzenia e on e.id_wydarzenia = m.id_wydarzenia join t_uzytkownicy u on u.id_uzytkownika = m.id_uzytkownika
    where m.id_konta = $1 and m.id_kal_google = any($2::text[]) for update of m`, [input.accountId, input.calendarRowIds])).rows;
  let removed = 0; let kept = 0;
  for (const row of rows) {
    if (!row.id_wydarzenia || !row.event_version) { await client.query(`delete from t_google_wydarzenia where id_powiazania = $1`, [row.id_powiazania]); continue; }
    const editedLocally = row.stan !== 'aktywne' || Number(row.event_version) > Number(row.wersja_lokalna ?? row.event_version);
    if (editedLocally) {
      await client.query(`update t_google_wydarzenia set stan = 'odlaczone', updated_at = now() where id_powiazania = $1`, [row.id_powiazania]);
      kept++;
      continue;
    }
    await enqueueDomainEvent(client, { userId: input.userId, calendarId: String(row.id_kalendarza) }, 'calendar_event', row.id_wydarzenia, 'calendar_event.deleted', {
      origin: 'google_calendar_unselected', timeZone: row.strefa_czasowa,
      before: { title: row.tytul, start: new Date(row.rozpoczecie).toISOString(), end: new Date(row.zakonczenie).toISOString(), category: 'Personal', version: Number(row.event_version) },
    });
    await client.query(`delete from t_wydarzenia where id_wydarzenia = $1`, [row.id_wydarzenia]);
    await client.query(`delete from t_google_wydarzenia where id_powiazania = $1`, [row.id_powiazania]);
    removed++;
  }
  await client.query(`delete from t_google_sync_stan where id_konta = $1 and id_kal_google = any($2::text[])`, [input.accountId, input.calendarRowIds]);
  return { removed, kept };
}

export type ImportedEventView = {
  eventId: string; calendar: { id: string; name: string }; account: string;
  /** synced – zgodne z Google; conflict – edytowane w KAC (Google nie nadpisuje); detached – usunięte w Google, lokalna kopia została. */
  state: 'synced' | 'conflict' | 'detached';
  googleVersion: EventData | null; lastSyncAt: string | null; connected: boolean;
};

export class ImportedEventError extends Error {
  constructor(readonly code: 'not_imported' | 'google_version_missing' | 'restore_series', readonly status: number) { super(code); }
}

export class GoogleImportedEventService {
  constructor(private readonly repository: PostgresGoogleIntegrationRepository) {}

  private async load(client: PoolClient, scope: UserScope, eventId: string, lock = false) {
    const row = (await client.query(`select m.id_powiazania, m.stan, m.wersja_lokalna, m.dane_google, k.id_zewnetrzne, k.nazwa, a.adres_email,
        a.status_polaczenia, s.ostatni_odczyt_at, e.event_version, e.id_serii, e.tytul, e.rozpoczecie, e.zakonczenie, e.miejsce
      from t_google_wydarzenia m join t_wydarzenia e on e.id_wydarzenia = m.id_wydarzenia
      join t_kalendarze_google k on k.id_kal_google = m.id_kal_google join t_konta_google a on a.id_konta = m.id_konta
      left join t_google_sync_stan s on s.id_konta = m.id_konta and s.id_kal_google = m.id_kal_google
      where m.id_wydarzenia = $1 and m.id_uzytkownika = $2 and e.id_kalendarza = $3 ${lock ? 'for update of m, e' : ''}`,
    [eventId, scope.userId, scope.calendarId])).rows[0];
    if (!row) throw new ImportedEventError('not_imported', 404);
    return row;
  }

  private view(eventId: string, row: Record<string, any>): ImportedEventView {
    const editedLocally = row.stan === 'konflikt' || Number(row.event_version) > Number(row.wersja_lokalna ?? row.event_version);
    return {
      eventId, calendar: { id: row.id_zewnetrzne, name: row.nazwa }, account: row.adres_email,
      state: row.stan === 'odlaczone' ? 'detached' : editedLocally ? 'conflict' : 'synced',
      googleVersion: row.dane_google ?? null, lastSyncAt: row.ostatni_odczyt_at ? new Date(row.ostatni_odczyt_at).toISOString() : null,
      connected: row.status_polaczenia === 'Połączone',
    };
  }

  async get(scope: UserScope, eventId: string): Promise<ImportedEventView> {
    return this.repository.runInTransaction(async (client) => this.view(eventId, await this.load(client, scope, eventId)));
  }

  /** „Przywróć wersję z Google”: lokalna edycja zostaje zastąpiona ostatnią wersją z Google, a kolejne zmiany z Google znowu się stosują. */
  async restore(scope: UserScope, eventId: string): Promise<ImportedEventView> {
    return this.repository.runInTransaction(async (client) => {
      const row = await this.load(client, scope, eventId, true);
      const google = row.dane_google as EventData | null;
      if (!google || row.stan === 'odlaczone') throw new ImportedEventError('google_version_missing', 409);
      if (row.id_serii) throw new ImportedEventError('restore_series', 409);
      const zone = (await client.query(`select strefa_czasowa from t_uzytkownicy where id_uzytkownika = $1`, [scope.userId])).rows[0]?.strefa_czasowa ?? 'Europe/Warsaw';
      const updated = await client.query(`update t_wydarzenia set tytul = $2, rozpoczecie = $3, zakonczenie = $4, miejsce = $5,
          id_kategorii = coalesce((select id_kategorii from t_kategorie where nazwa = 'Prywatne' limit 1), id_kategorii), obowiazkowe = false,
          event_version = event_version + 1, updated_at = now() where id_wydarzenia = $1 returning event_version`,
      [eventId, google.title, google.start, google.end, google.location]);
      await enqueueDomainEvent(client, scope, 'calendar_event', eventId, 'calendar_event.updated', {
        origin: 'google_sync_restore', timeZone: zone, eventVersion: updated.rows[0].event_version,
        before: { title: row.tytul, start: new Date(row.rozpoczecie).toISOString(), end: new Date(row.zakonczenie).toISOString(), location: row.miejsce ?? '', version: Number(row.event_version) },
        after: { ...google, category: 'Personal' },
      });
      await client.query(`update t_google_wydarzenia set stan = 'aktywne', wersja_lokalna = $2, updated_at = now() where id_powiazania = $1`,
        [row.id_powiazania, updated.rows[0].event_version]);
      return this.view(eventId, { ...row, stan: 'aktywne', event_version: updated.rows[0].event_version, wersja_lokalna: updated.rows[0].event_version });
    });
  }
}
