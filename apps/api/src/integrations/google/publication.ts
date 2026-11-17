// Publikacja zaakceptowanego grafiku w Google Calendar (S23KC2S1P2-30, G07 / S23KC2S1P2-291).
//
// Przebieg: podgląd (bez zmian) → potwierdzenie → publikacja przez adapter. Warunki wejścia: grafik zaakceptowany i co najmniej
// jedna zmiana, połączone konto i kalendarz z prawem zapisu (domyślnie kalendarz publikacji z G04).
// Konto połączone przez Google: prawdziwy zapis (GooglePublicationWriter). Konto demonstracyjne albo wyłączony zapis
// (GOOGLE_PUBLICATION_MODE=simulation): symulacja – nic nie trafia do Google, a wyniki są jawnie tak oznaczone.
// Oba tryby korzystają z tych samych pozycji t_publikacje i rejestru prób t_synchronizacje (G06).
import type { UserScope } from '../../api/scope.js';
import { toInstant } from '../../import/rules.js';
import type { FetchLike } from '../../import/google/oauth.js';
import { demoIntegrationEvents } from './demo.js';
import { GooglePublicationWriter } from './google-writer.js';
import { accessFromScopes, GoogleIntegrationError, listIntegrationEventsPage, type GoogleErrorCode, type GoogleEventItem } from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository, PublicationShift, StoredCalendar } from './repository.js';
import { attemptView, isTransientCode, messageFor, type SyncAttemptView } from './sync.js';

export const PUBLICATION_SIMULATIONS = ['network', 'flaky', 'auth', 'server', 'rate_limit', 'partial', 'permissions'] as const;
export type PublicationSimulation = typeof PUBLICATION_SIMULATIONS[number];
export type PublicationAction = 'create' | 'update' | 'unchanged';

export type PublicationItem = PublicationShift & { action: PublicationAction; publishedAt: string | null };
export type PublicationPreview = {
  /** true – symulacja (konto demonstracyjne albo wyłączony zapis); interfejs musi to pokazać. */
  simulated: boolean;
  weekStart: string; scheduleId: string; scheduleVersion: number;
  target: { id: string; name: string };
  /** Kalendarze, które można wybrać jako cel tej publikacji (dostępne, z prawem zapisu). */
  targets: { id: string; name: string; primary: boolean }[];
  items: PublicationItem[];
  summary: { create: number; update: number; unchanged: number };
};
export type PublicationResult = {
  simulated: boolean;
  attempt: SyncAttemptView;
  items: (PublicationItem & { result: 'published' | 'unchanged' | 'failed' | 'skipped' })[];
  preview: PublicationPreview;
};

/** Widok kalendarza Google po publikacji (krok 10 historyjki 30): opublikowane zmiany razem z pozostałymi wydarzeniami tygodnia. */
export type CalendarViewEvent = { id: string; title: string; start: string; end: string; published: boolean };
export type PublicationCalendarView = {
  simulated: boolean; calendar: { id: string; name: string }; weekStart: string; events: CalendarViewEvent[];
  /** Pozostałych wydarzeń nie udało się odczytać z Google (np. brak sieci) – widok pokazuje wtedy tylko opublikowane zmiany. */
  othersError: string | null;
};

export class PublicationError extends Error {
  constructor(readonly code: 'not_connected' | 'reconnect_required' | 'schedule_not_found' | 'schedule_version_conflict' | 'schedule_not_accepted'
    | 'schedule_empty' | 'no_publication_target' | 'unknown_calendar' | 'calendar_unavailable' | 'target_not_writable' | 'write_access_missing'
    | 'publication_in_progress', readonly status: number) { super(code); }
}

/** Adapter publikacji. tries – numer próby tej pozycji (1, 2, …), żeby atrapa mogła udawać chwilowy błąd. */
export interface PublicationAdapter {
  readonly mode: 'symulacja' | 'google';
  /** previousExternalId – wydarzenie z wcześniejszej publikacji tej zmiany (aktualizacja zamiast nowego). */
  publish(input: { account: GoogleAccountRecord; calendarId: string; item: PublicationItem; index: number; total: number; tries: number;
    previousExternalId?: string | null }): Promise<{ externalId: string | null }>;
}

/** Adapter demonstracyjny: niczego nie wysyła i nie wymyśla identyfikatorów Google. simulate wymusza wynik do prezentacji przebiegów błędów. */
export class SimulatedPublicationAdapter implements PublicationAdapter {
  readonly mode = 'symulacja' as const;
  constructor(private readonly simulate?: PublicationSimulation) {}

  async publish({ index, total, tries }: { index: number; total: number; tries: number }): Promise<{ externalId: null }> {
    const fail = (code: GoogleErrorCode): never => { throw new GoogleIntegrationError(code); };
    switch (this.simulate) {
      case 'network': fail('network_error'); break;
      case 'flaky': if (tries === 1) fail('network_error'); break;
      case 'server': fail('google_unavailable'); break;
      case 'rate_limit': fail('rate_limited'); break;
      case 'auth': fail('reconnect_required'); break;
      case 'permissions': fail('calendar_not_writable'); break;
      // Połowa pozycji przechodzi, potem Google odmawia – wynik częściowy; ponowienie publikuje tylko resztę.
      case 'partial': if (index >= Math.ceil(total / 2)) fail('google_error'); break;
      default: break;
    }
    return { externalId: null };
  }
}

const WRITE_ROLES = new Set(['owner', 'writer']);
const writable = (calendar: StoredCalendar) => calendar.available && Boolean(calendar.accessRole && WRITE_ROLES.has(calendar.accessRole));

export type PublicationOptions = {
  sleep?: (ms: number) => Promise<void>; maxTries?: number; baseDelayMs?: number;
  /** false wymusza symulację także dla kont Google (GOOGLE_PUBLICATION_MODE=simulation). Domyślnie prawdziwy zapis. */
  realWrites?: boolean;
};

export class GooglePublicationService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly baseDelayMs: number;
  private readonly realWrites: boolean;

  constructor(private readonly repository: PostgresGoogleIntegrationRepository, options: PublicationOptions = {},
    private readonly call?: <T>(account: GoogleAccountRecord, work: (token: string) => Promise<T>) => Promise<T>, private readonly fetchImpl?: FetchLike) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxTries = Math.max(1, options.maxTries ?? 3);
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.realWrites = options.realWrites ?? true;
  }

  /** Prawdziwy zapis tylko dla konta połączonego przez Google, gdy zapis nie jest wyłączony w konfiguracji. */
  private writesToGoogle(account: GoogleAccountRecord) {
    return account.mode === 'google' && this.realWrites && Boolean(this.call && this.fetchImpl);
  }

  /** Podgląd konkretnych zmian (krok przed potwierdzeniem). Niczego nie zapisuje ani nie wysyła. */
  async preview(scope: UserScope, weekStart: string, calendarId?: string | null): Promise<PublicationPreview> {
    return (await this.prepare(scope, weekStart, calendarId)).preview;
  }

  /**
   * Potwierdzona publikacja. expectedVersion chroni przed publikacją innej wersji niż ta z podglądu. Pozycje bez zmian są pomijane,
   * a zapis jest per zmiana i kalendarz, więc ponowienie po błędzie nie dubluje wydarzeń.
   */
  async publish(scope: UserScope, weekStart: string, input: { expectedVersion: number; calendarId?: string | null; simulate?: PublicationSimulation }): Promise<PublicationResult> {
    const { account, target, preview, scheduleId, published: previous } = await this.prepare(scope, weekStart, input.calendarId);
    if (preview.scheduleVersion !== input.expectedVersion) throw new PublicationError('schedule_version_conflict', 409);
    const simulated = preview.simulated;
    await this.repository.failStaleSyncAttempts(account.accountId);
    const attempt = await this.repository.startSyncAttempt(account, { direction: 'publish', scope: `schedule:${weekStart}`,
      operation: simulated ? 'Publikacja grafiku (symulacja)' : 'Publikacja grafiku' });
    if (!attempt) throw new PublicationError('publication_in_progress', 409);

    // Wymuszony wynik (simulate) dotyczy tylko symulacji – prawdziwej publikacji nie da się „udawać”.
    const adapter: PublicationAdapter = simulated ? new SimulatedPublicationAdapter(input.simulate) : new GooglePublicationWriter(this.call!, this.fetchImpl!);
    const pending = preview.items.filter((item) => item.action !== 'unchanged');
    const results = new Map<string, 'published' | 'failed' | 'skipped'>();
    let errorCode: string | null = null;
    let maxTries = 1;
    for (const [index, item] of pending.entries()) {
      if (errorCode) { results.set(item.shiftId, 'skipped'); continue; }
      for (let tries = 1; ; tries++) {
        maxTries = Math.max(maxTries, tries);
        try {
          const before = previous.get(item.shiftId);
          const published = await adapter.publish({ account, calendarId: target.id, item, index, total: pending.length, tries,
            previousExternalId: before?.mode === 'google' ? before.externalId : null });
          await this.repository.savePublication({ userId: scope.userId, accountId: account.accountId, targetRowId: target.rowId, scheduleId,
            shiftId: item.shiftId, eventId: item.eventId, eventVersion: item.eventVersion, syncId: attempt.id,
            operation: item.action === 'create' ? 'Utworzenie' : 'Aktualizacja', mode: adapter.mode, externalId: published.externalId,
            snapshot: { title: item.title, start: item.start, end: item.end } });
          results.set(item.shiftId, 'published');
          break;
        } catch (error) {
          const code: string = error instanceof GoogleIntegrationError ? error.code : 'google_error';
          if (isTransientCode(code) && tries < this.maxTries) {
            await this.repository.setSyncTries(attempt.id, tries + 1);
            await this.sleep(this.baseDelayMs * 2 ** (tries - 1));
            continue;
          }
          // Kolejne pozycje i tak trafiłyby na tę samą przyczynę – zatrzymujemy się, reszta czeka na ponowienie.
          results.set(item.shiftId, 'failed');
          errorCode = code;
          break;
        }
      }
    }
    const published = [...results.values()].filter((result) => result === 'published').length;
    const status = !errorCode ? 'success' : published > 0 ? 'partial' : 'error';
    const finished = await this.repository.finishSyncAttempt(attempt.id, {
      status, tries: maxTries, changes: published, errorCode,
      message: simulated
        ? status === 'success'
          ? `Symulacja: opublikowano ${published} z ${pending.length} zmian (bez zmian: ${preview.summary.unchanged}). Nic nie trafiło do Google.`
          : status === 'partial'
            ? `Symulacja częściowa: opublikowano ${published} z ${pending.length} zmian. ${messageFor(errorCode!)}`
            : `Symulacja nieudana: ${messageFor(errorCode!)}`
        : status === 'success'
          ? `Opublikowano w Google Calendar ${published} z ${pending.length} zmian (bez zmian: ${preview.summary.unchanged}).`
          : status === 'partial'
            ? `Opublikowano częściowo: ${published} z ${pending.length} zmian. ${messageFor(errorCode!)}`
            : `Publikacja nieudana: ${messageFor(errorCode!)}`,
    });
    return {
      simulated, attempt: attemptView(finished),
      items: preview.items.map((item) => ({ ...item, result: item.action === 'unchanged' ? 'unchanged' : results.get(item.shiftId) ?? 'skipped' })),
      preview: (await this.prepare(scope, weekStart, target.id)).preview,
    };
  }

  /**
   * Krok 10 historyjki 30: widok kalendarza Google – wydarzenia tygodnia w kalendarzu docelowym razem z opublikowanymi zmianami.
   * Prawdziwa publikacja: wszystko czytane z Google (zmiany KAC rozpoznawane po kacEventId). Symulacja albo brak odczytu z Google:
   * opublikowane zmiany pochodzą z zapisanych pozycji publikacji.
   */
  async calendarView(scope: UserScope, weekStart: string, calendarId?: string | null): Promise<PublicationCalendarView> {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new PublicationError('not_connected', 404);
    const selection = await this.repository.getSelection(account.accountId);
    const target = calendarId
      ? selection.calendars.find((calendar) => calendar.id === calendarId)
      : selection.calendars.find((calendar) => calendar.rowId === selection.publicationTargetRowId);
    if (!target) throw new PublicationError(calendarId ? 'unknown_calendar' : 'no_publication_target', calendarId ? 400 : 409);
    const zone = await this.repository.userTimeZone(scope.userId);
    const from = toInstant(weekStart, '00:00', zone);
    const nextWeek = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const to = toInstant(nextWeek, '00:00', zone);
    if (!from || !to) throw new PublicationError('schedule_not_found', 404);

    const schedule = await this.repository.getPublicationSchedule(scope.calendarId, weekStart);
    const real = this.writesToGoogle(account);
    let published = schedule ? await this.repository.listPublishedSnapshots(target.rowId, schedule.scheduleId) : [];
    let others: GoogleEventItem[] = [];
    let othersError: string | null = null;
    try {
      if (account.mode === 'demo') {
        // Te same przykładowe dane co w synchronizacji (G05): okno liczone od dziś, potem tylko wybrany tydzień.
        const now = Date.now();
        const revision = await this.repository.demoRevision(account.accountId, target.rowId);
        others = demoIntegrationEvents(account.email, target.id, revision, { from: new Date(now - 28 * 86_400_000), to: new Date(now + 182 * 86_400_000) });
      } else if (this.call && this.fetchImpl) {
        const fetchImpl = this.fetchImpl;
        for (let page = 0, pageToken: string | null = null; page < 5; page++) {
          const result = await this.call(account, (token) => listIntegrationEventsPage(token, fetchImpl, target.id, { syncToken: null, window: { from, to }, pageToken }));
          others.push(...result.items);
          if (!result.nextPageToken) break;
          pageToken = result.nextPageToken;
        }
      }
    } catch (error) {
      othersError = error instanceof GoogleIntegrationError ? error.code : 'google_error';
      others = [];
    }
    const inWeek = (start: string, end: string) => Date.parse(end) > from.getTime() && Date.parse(start) < to.getTime();
    const timed = others.filter((item) => item.status !== 'cancelled' && item.start?.dateTime && item.end?.dateTime && inWeek(item.start.dateTime, item.end.dateTime));
    const ownInGoogle = real && !othersError;
    // Symulacja: wydarzenia KAC w Google (np. z innej publikacji) pomijamy, żeby nie dublowały zapisanych pozycji.
    if (ownInGoogle) published = [];
    const events: CalendarViewEvent[] = [
      ...timed.filter((item) => ownInGoogle || !item.extendedProperties?.private?.kacEventId)
        .map((item) => ({ id: item.id, title: (item.summary ?? '').trim() || 'Wydarzenie', start: new Date(item.start!.dateTime!).toISOString(),
          end: new Date(item.end!.dateTime!).toISOString(), published: Boolean(item.extendedProperties?.private?.kacEventId) })),
      ...published.map((item) => ({ id: `kac-${item.shiftId}`, title: item.title, start: item.start, end: item.end, published: true })),
    ].sort((a, b) => a.start.localeCompare(b.start) || Number(a.published) - Number(b.published));
    return { simulated: !real, calendar: { id: target.id, name: target.name }, weekStart, events, othersError };
  }

  private async prepare(scope: UserScope, weekStart: string, calendarId?: string | null) {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new PublicationError('not_connected', 404);
    if (account.status === 'reconnect_required') throw new PublicationError('reconnect_required', 409);
    // Grafik zawsze z kalendarza właściciela żądania (W01) – nie da się podglądać ani publikować cudzego.
    const schedule = await this.repository.getPublicationSchedule(scope.calendarId, weekStart);
    if (!schedule) throw new PublicationError('schedule_not_found', 404);
    if (!schedule.accepted) throw new PublicationError('schedule_not_accepted', 409);
    if (schedule.shifts.length === 0) throw new PublicationError('schedule_empty', 409);

    const selection = await this.repository.getSelection(account.accountId);
    const target = calendarId
      ? selection.calendars.find((calendar) => calendar.id === calendarId)
      : selection.calendars.find((calendar) => calendar.rowId === selection.publicationTargetRowId);
    if (!target) throw new PublicationError(calendarId ? 'unknown_calendar' : 'no_publication_target', calendarId ? 400 : 409);
    if (!target.available) throw new PublicationError('calendar_unavailable', 409);
    if (!writable(target)) throw new PublicationError('target_not_writable', 422);
    if (!accessFromScopes(account.grantedScopes).eventsWrite) throw new PublicationError('write_access_missing', 422);

    const real = this.writesToGoogle(account);
    const published = await this.repository.listPublished(target.rowId, schedule.shifts.map((shift) => shift.shiftId));
    const items: PublicationItem[] = schedule.shifts.map((shift) => {
      const previous = published.get(shift.shiftId);
      // Zmiana opublikowana tylko w symulacji albo usunięta ręcznie w Google trafia do Google jako nowa.
      const fresh = !previous || previous.missing || (real && previous.mode === 'symulacja');
      const action: PublicationAction = fresh ? 'create' : previous.eventVersion === shift.eventVersion ? 'unchanged' : 'update';
      return { ...shift, action, publishedAt: fresh ? null : previous.publishedAt };
    });
    const preview: PublicationPreview = {
      simulated: !real, weekStart, scheduleId: schedule.scheduleId, scheduleVersion: schedule.version,
      target: { id: target.id, name: target.name },
      targets: selection.calendars.filter(writable).map((calendar) => ({ id: calendar.id, name: calendar.name, primary: calendar.primary })),
      items,
      summary: { create: items.filter((item) => item.action === 'create').length, update: items.filter((item) => item.action === 'update').length,
        unchanged: items.filter((item) => item.action === 'unchanged').length },
    };
    return { account, target, preview, scheduleId: schedule.scheduleId, published };
  }
}
