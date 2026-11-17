// Symulowana publikacja zaakceptowanego grafiku w Google Calendar (S23KC2S1P2-30, G07 / S23KC2S1P2-291).
//
// Przebieg: podgląd (bez zmian) → potwierdzenie → publikacja przez adapter. Warunki wejścia: grafik zaakceptowany i co najmniej
// jedna zmiana, połączone konto i kalendarz z prawem zapisu (domyślnie kalendarz publikacji z G04).
// Dziś działa wyłącznie adapter demonstracyjny: nic nie trafia do Google, a wyniki są jawnie oznaczone jako symulacja.
// Przyszła publikacja rzeczywista podłącza się jako drugi PublicationAdapter i korzysta z tych samych pozycji t_publikacje
// (właściciel, lokalne ID i wersja, konto, kalendarz, zewnętrzne ID) oraz rejestru prób t_synchronizacje (G06).
import type { UserScope } from '../../api/scope.js';
import { accessFromScopes, GoogleIntegrationError, type GoogleErrorCode } from './oauth-client.js';
import type { GoogleAccountRecord, PostgresGoogleIntegrationRepository, PublicationShift, StoredCalendar } from './repository.js';
import { attemptView, isTransientCode, messageFor, type SyncAttemptView } from './sync.js';

export const PUBLICATION_SIMULATIONS = ['network', 'flaky', 'auth', 'server', 'rate_limit', 'partial', 'permissions'] as const;
export type PublicationSimulation = typeof PUBLICATION_SIMULATIONS[number];
export type PublicationAction = 'create' | 'update' | 'unchanged';

export type PublicationItem = PublicationShift & { action: PublicationAction; publishedAt: string | null };
export type PublicationPreview = {
  /** Zawsze true, dopóki nie ma publikacji rzeczywistej – interfejs musi to pokazać. */
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

export class PublicationError extends Error {
  constructor(readonly code: 'not_connected' | 'reconnect_required' | 'schedule_not_found' | 'schedule_version_conflict' | 'schedule_not_accepted'
    | 'schedule_empty' | 'no_publication_target' | 'unknown_calendar' | 'calendar_unavailable' | 'target_not_writable' | 'write_access_missing'
    | 'publication_in_progress', readonly status: number) { super(code); }
}

/** Adapter publikacji. tries – numer próby tej pozycji (1, 2, …), żeby atrapa mogła udawać chwilowy błąd. */
export interface PublicationAdapter {
  readonly mode: 'symulacja' | 'google';
  publish(input: { account: GoogleAccountRecord; calendarId: string; item: PublicationItem; index: number; total: number; tries: number }): Promise<{ externalId: string | null }>;
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

export type PublicationOptions = { sleep?: (ms: number) => Promise<void>; maxTries?: number; baseDelayMs?: number };

export class GooglePublicationService {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxTries: number;
  private readonly baseDelayMs: number;

  constructor(private readonly repository: PostgresGoogleIntegrationRepository, options: PublicationOptions = {}) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxTries = Math.max(1, options.maxTries ?? 3);
    this.baseDelayMs = options.baseDelayMs ?? 500;
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
    const { account, target, preview, scheduleId } = await this.prepare(scope, weekStart, input.calendarId);
    if (preview.scheduleVersion !== input.expectedVersion) throw new PublicationError('schedule_version_conflict', 409);
    await this.repository.failStaleSyncAttempts(account.accountId);
    const attempt = await this.repository.startSyncAttempt(account, { direction: 'publish', scope: `schedule:${weekStart}`, operation: 'Publikacja grafiku (symulacja)' });
    if (!attempt) throw new PublicationError('publication_in_progress', 409);

    const adapter: PublicationAdapter = new SimulatedPublicationAdapter(input.simulate);
    const pending = preview.items.filter((item) => item.action !== 'unchanged');
    const results = new Map<string, 'published' | 'failed' | 'skipped'>();
    let errorCode: string | null = null;
    let maxTries = 1;
    for (const [index, item] of pending.entries()) {
      if (errorCode) { results.set(item.shiftId, 'skipped'); continue; }
      for (let tries = 1; ; tries++) {
        maxTries = Math.max(maxTries, tries);
        try {
          const published = await adapter.publish({ account, calendarId: target.id, item, index, total: pending.length, tries });
          await this.repository.savePublication({ userId: scope.userId, accountId: account.accountId, targetRowId: target.rowId, scheduleId,
            shiftId: item.shiftId, eventId: item.eventId, eventVersion: item.eventVersion, syncId: attempt.id,
            operation: item.action === 'create' ? 'Utworzenie' : 'Aktualizacja', mode: adapter.mode, externalId: published.externalId });
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
      message: status === 'success'
        ? `Symulacja: opublikowano ${published} z ${pending.length} zmian (bez zmian: ${preview.summary.unchanged}). Nic nie trafiło do Google.`
        : status === 'partial'
          ? `Symulacja częściowa: opublikowano ${published} z ${pending.length} zmian. ${messageFor(errorCode!)}`
          : `Symulacja nieudana: ${messageFor(errorCode!)}`,
    });
    return {
      simulated: true, attempt: attemptView(finished),
      items: preview.items.map((item) => ({ ...item, result: item.action === 'unchanged' ? 'unchanged' : results.get(item.shiftId) ?? 'skipped' })),
      preview: (await this.prepare(scope, weekStart, target.id)).preview,
    };
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

    const published = await this.repository.listPublished(target.rowId, schedule.shifts.map((shift) => shift.shiftId));
    const items: PublicationItem[] = schedule.shifts.map((shift) => {
      const previous = published.get(shift.shiftId);
      const action: PublicationAction = !previous ? 'create' : previous.eventVersion === shift.eventVersion ? 'unchanged' : 'update';
      return { ...shift, action, publishedAt: previous?.publishedAt ?? null };
    });
    const preview: PublicationPreview = {
      simulated: true, weekStart, scheduleId: schedule.scheduleId, scheduleVersion: schedule.version,
      target: { id: target.id, name: target.name },
      targets: selection.calendars.filter(writable).map((calendar) => ({ id: calendar.id, name: calendar.name, primary: calendar.primary })),
      items,
      summary: { create: items.filter((item) => item.action === 'create').length, update: items.filter((item) => item.action === 'update').length,
        unchanged: items.filter((item) => item.action === 'unchanged').length },
    };
    return { account, target, preview, scheduleId: schedule.scheduleId };
  }
}
