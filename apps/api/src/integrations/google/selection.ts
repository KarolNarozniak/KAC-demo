// Trwały wybór kalendarzy Google (S23KC2S1P2-41, G04 / S23KC2S1P2-288).
//
// Dwa osobne ustawienia tego samego zbioru kalendarzy konta:
//  - sourceCalendarIds – kalendarze uwzględniane przy planowaniu i synchronizacji (historyjka 23 wybiera z tego samego zbioru),
//  - publicationTargetCalendarId – jeden kalendarz z prawem zapisu, do którego trafi publikacja grafiku (G07).
// Zapis jest atomowy i ma kontrolę wersji. Prawo zapisu sprawdza serwer, nie tylko filtr w interfejsie.
// Założenie D04 (do potwierdzenia w zespole): odznaczony kalendarz przestaje być brany pod uwagę – wydarzenia pobrane z niego
// przez synchronizację (G05) znikają z KAC w tej samej transakcji co zapis wyboru; edytowane w KAC zostają jako zwykłe wydarzenia.
// Ręczne wpisy i jednorazowy import (27) nie są dotykane. Ponowne zaznaczenie zaczyna od pełnego odczytu.
import type { UserScope } from '../../api/scope.js';
import { accessFromScopes, type IntegrationCalendar } from './oauth-client.js';
import type { PostgresGoogleIntegrationRepository, StoredSelection } from './repository.js';
import { releaseCalendars } from './events-sync.js';

export type SelectionCalendar = {
  id: string; name: string; primary: boolean; accessRole: IntegrationCalendar['accessRole'] | null; timeZone: string | null;
  available: boolean; writable: boolean; source: boolean; publicationTarget: boolean;
};
export type SelectionView = {
  version: number;
  calendars: SelectionCalendar[];
  sourceCalendarIds: string[];
  publicationTargetCalendarId: string | null;
  /** Czy przyznana zgoda Google pozwala w ogóle zapisywać wydarzenia (zakres calendar.events). */
  canPublish: boolean;
  /** Problem z zapisanym kalendarzem publikacji, np. po utracie uprawnień w Google. */
  targetProblem: 'unavailable' | 'not_writable' | 'write_access_missing' | null;
};

export class SelectionError extends Error {
  constructor(readonly code: 'not_connected' | 'selection_conflict' | 'unknown_calendar' | 'calendar_unavailable' | 'target_not_writable' | 'write_access_missing',
    readonly status: number) { super(code); }
}

const WRITE_ROLES = new Set(['owner', 'writer']);

function view(stored: StoredSelection, canPublish: boolean): SelectionView {
  const calendars = stored.calendars.map((calendar) => ({
    id: calendar.id, name: calendar.name, primary: calendar.primary, accessRole: calendar.accessRole, timeZone: calendar.timeZone,
    available: calendar.available, writable: calendar.available && Boolean(calendar.accessRole && WRITE_ROLES.has(calendar.accessRole)),
    source: calendar.source, publicationTarget: calendar.rowId === stored.publicationTargetRowId,
  }));
  const target = calendars.find((calendar) => calendar.publicationTarget) ?? null;
  return {
    version: stored.version, calendars,
    sourceCalendarIds: calendars.filter((calendar) => calendar.source).map((calendar) => calendar.id),
    publicationTargetCalendarId: target?.id ?? null, canPublish,
    targetProblem: !target ? null : !target.available ? 'unavailable' : !target.writable ? 'not_writable' : !canPublish ? 'write_access_missing' : null,
  };
}

export class GoogleCalendarSelectionService {
  constructor(private readonly repository: PostgresGoogleIntegrationRepository) {}

  private async account(scope: UserScope) {
    const account = await this.repository.getActiveAccount(scope.userId);
    if (!account) throw new SelectionError('not_connected', 404);
    return account;
  }

  async get(scope: UserScope): Promise<SelectionView> {
    const account = await this.account(scope);
    return view(await this.repository.getSelection(account.accountId), accessFromScopes(account.grantedScopes).eventsWrite);
  }

  /**
   * Krok 6–7 historyjki 41: zatwierdzenie wyboru. Odrzuca obce identyfikatory, kalendarze bez dostępu i kalendarz publikacji
   * bez prawa zapisu. Nieaktualna wersja (zmiana w innym oknie) kończy się konfliktem bez żadnej zmiany.
   */
  async save(scope: UserScope, input: { version: number; sourceCalendarIds: string[]; publicationTargetCalendarId: string | null }): Promise<SelectionView> {
    const account = await this.account(scope);
    const canPublish = accessFromScopes(account.grantedScopes).eventsWrite;
    const result = await this.repository.saveSelection(account.accountId, input.version, (current) => {
      const byId = new Map(current.calendars.map((calendar) => [calendar.id, calendar]));
      const sources = [...new Set(input.sourceCalendarIds)].map((id) => {
        const calendar = byId.get(id);
        if (!calendar) throw new SelectionError('unknown_calendar', 400);
        // Kalendarz, który zniknął z konta, może zostać w zbiorze tylko, jeśli już tam był (użytkownik widzi go z oznaczeniem).
        if (!calendar.available && !calendar.source) throw new SelectionError('calendar_unavailable', 409);
        return calendar.rowId;
      });
      let targetRowId: string | null = null;
      if (input.publicationTargetCalendarId !== null) {
        const target = byId.get(input.publicationTargetCalendarId);
        if (!target) throw new SelectionError('unknown_calendar', 400);
        if (!target.available) throw new SelectionError('calendar_unavailable', 409);
        if (!target.accessRole || !WRITE_ROLES.has(target.accessRole)) throw new SelectionError('target_not_writable', 422);
        if (!canPublish) throw new SelectionError('write_access_missing', 422);
        targetRowId = target.rowId;
      }
      return { sourceRowIds: sources, targetRowId };
    }, async (client, previous, next) => {
      // D04: odznaczony kalendarz przestaje być brany pod uwagę – pobrane z niego wydarzenia znikają (edytowane w KAC zostają).
      const kept = new Set(next.sourceRowIds);
      await releaseCalendars(client, { userId: scope.userId, accountId: account.accountId,
        calendarRowIds: previous.calendars.filter((calendar) => calendar.source && !kept.has(calendar.rowId)).map((calendar) => calendar.rowId) });
    });
    if (result === 'conflict') throw new SelectionError('selection_conflict', 409);
    return view(result, canPublish);
  }
}
