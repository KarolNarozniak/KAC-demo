// Synchronizacja korekt opublikowanych zmian z Google Calendar – SYMULACJA (S23KC2S1P2-47, G09 / S23KC2S1P2-292).
//
// Edycja albo usunięcie opublikowanej zmiany oznacza jej pozycje publikacji (t_publikacje) w tej samej transakcji co zapis
// lokalny i zlecenie w outboxie (W02). Konsument „google” w workerze – albo „Ponów synchronizację” w API – wykonuje potem
// aktualizację lub usunięcie przez adapter. Zasady:
//  - zawsze wysyłany jest najnowszy stan wydarzenia z bazy, nie stare body zlecenia; spóźnione zlecenie nie odtwarza starego stanu,
//  - pozycje są blokowane (for update), więc dwa workery nie przetworzą tej samej pozycji naraz,
//  - błąd Google nie cofa zmiany lokalnej – pozycja ma stan „Błąd” i można ją ponowić,
//  - aktualizacja brakującego wydarzenia w Google kończy się stanem „Brak w Google” bez tworzenia nowego,
//  - usunięcie wydarzenia, którego w Google już nie ma, jest sukcesem,
//  - po usunięciu lokalnym pozycja zostaje jako „nagrobek” (ref_wydarzenia, kalendarz, zewnętrzne ID, migawka, stan próby).
// Dziś działa tylko adapter demonstracyjny – nic nie trafia do Google.
import type { PoolClient } from 'pg';
import type { UserScope } from '../../api/scope.js';
import type { PostgresGoogleIntegrationRepository } from './repository.js';
import { GoogleIntegrationError, type GoogleErrorCode } from './oauth-client.js';
import { classifySyncError, isTransientCode, messageFor, type SyncErrorClass } from './sync.js';

export const CORRECTION_SIMULATIONS = ['network', 'server', 'rate_limit', 'auth', 'permissions', 'missing'] as const;
export type CorrectionSimulation = typeof CORRECTION_SIMULATIONS[number];

type Snapshot = { title: string; start: string; end: string };

/** Adapter korekt. Przyszła publikacja rzeczywista dostarczy wersję wywołującą Google Calendar API (events.patch / events.delete). */
export interface CorrectionAdapter {
  readonly mode: 'symulacja' | 'google';
  update(input: { calendarId: string; externalId: string | null; event: Snapshot }): Promise<void>;
  /** Brak wydarzenia w Google to sukces usunięcia. */
  delete(input: { calendarId: string; externalId: string | null }): Promise<void>;
}

export class SimulatedCorrectionAdapter implements CorrectionAdapter {
  readonly mode = 'symulacja' as const;
  constructor(private readonly simulate: CorrectionSimulation | null) {}
  private failFor(operation: 'update' | 'delete') {
    const fail = (code: GoogleErrorCode): never => { throw new GoogleIntegrationError(code); };
    switch (this.simulate) {
      case 'network': return fail('network_error');
      case 'server': return fail('google_unavailable');
      case 'rate_limit': return fail('rate_limited');
      case 'auth': return fail('reconnect_required');
      case 'permissions': return fail('calendar_not_writable');
      // Wydarzenie usunięte w Google ręcznie: aktualizacja zgłasza brak (bez tworzenia nowego), usunięcie – sukces.
      case 'missing': if (operation === 'update') fail('event_not_found'); return;
      default: return;
    }
  }
  async update() { this.failFor('update'); }
  async delete() { this.failFor('delete'); }
}

// --- Oznaczenie pozycji przy zapisie lokalnym (ta sama transakcja co zmiana wydarzenia) ---

/** Edycja opublikowanego wydarzenia: pozycje czekają na aktualizację. „Brak w Google” zostaje – nie tworzymy wydarzenia na nowo. */
export async function markPublicationsUpdated(client: PoolClient, eventId: string): Promise<number> {
  const result = await client.query(`update t_publikacje set status = 'Oczekuje', kod_bledu = null, zaktualizowano = now()
    where ref_wydarzenia = $1 and status in ('Opublikowano', 'Oczekuje', 'Błąd')`, [eventId]);
  return result.rowCount ?? 0;
}

/** Usunięcie: pozycja zostaje jako nagrobek z migawką danych, żeby usunięcie w Google dało się ponowić po wyzerowaniu FK. */
export async function markPublicationsDeleted(client: PoolClient, eventId: string, snapshot: Snapshot | null): Promise<number> {
  const result = await client.query(`update t_publikacje set status = 'Do usunięcia', kod_bledu = null, zaktualizowano = now(),
      migawka = coalesce($2::jsonb, migawka)
    where ref_wydarzenia = $1 and status <> 'Usunięto'`, [eventId, snapshot ? JSON.stringify(snapshot) : null]);
  return result.rowCount ?? 0;
}

// --- Stan dla interfejsu ---

export type CorrectionState = 'synced' | 'pending' | 'error' | 'missing' | 'pending_delete' | 'deleted';
const STATE: Record<string, CorrectionState> = {
  'Opublikowano': 'synced', 'Oczekuje': 'pending', 'Błąd': 'error', 'Brak w Google': 'missing', 'Do usunięcia': 'pending_delete', 'Usunięto': 'deleted',
};
export type CorrectionItem = {
  eventId: string; calendar: { id: string; name: string }; state: CorrectionState; simulated: boolean;
  errorCode: string | null; errorClass: SyncErrorClass | null; message: string | null;
  tries: number; lastTryAt: string | null; publishedAt: string | null; snapshot: Snapshot | null;
};

const CORRECTION_MESSAGES: Record<string, string> = {
  event_not_found: 'Powiązane wydarzenie nie istnieje już w Google Calendar – nie można go zaktualizować. Lokalna zmiana została zachowana, nowe wydarzenie nie zostało utworzone.',
  not_connected: 'Konto Google, do którego opublikowano zmianę, nie jest już połączone.',
};
const correctionMessage = (code: string | null) => (code ? CORRECTION_MESSAGES[code] ?? messageFor(code) : null);

export const correctionItemFrom = (row: Record<string, any>): CorrectionItem => ({
  eventId: String(row.ref_wydarzenia), calendar: { id: String(row.kalendarz_id), name: String(row.kalendarz_nazwa) }, state: STATE[row.status] ?? 'error',
  simulated: row.tryb === 'symulacja', errorCode: row.kod_bledu ?? null,
  errorClass: row.kod_bledu ? (row.kod_bledu === 'event_not_found' ? 'other' : row.kod_bledu === 'not_connected' ? 'reconnect' : classifySyncError(row.kod_bledu)) : null,
  message: correctionMessage(row.kod_bledu ?? null), tries: Number(row.proby ?? 0),
  lastTryAt: row.ostatnia_proba ? new Date(row.ostatnia_proba).toISOString() : null,
  publishedAt: row.opublikowano ? new Date(row.opublikowano).toISOString() : null, snapshot: row.migawka ?? null,
});

export const CORRECTION_SELECT = `select p.*, k.id_zewnetrzne as kalendarz_id, k.nazwa as kalendarz_nazwa
  from t_publikacje p join t_kalendarze_google k on k.id_kal_google = p.id_kal_google`;

// --- Wykonanie synchronizacji (worker albo „Ponów synchronizację”) ---

export type CorrectionOutcome = {
  /** nothing – zdarzenie nie dotyczy opublikowanego wydarzenia albo wszystko jest już zgodne. */
  status: 'nothing' | 'success' | 'error';
  errorCode: string | null;
  /** Czy warto ponowić automatycznie (błąd przejściowy). */
  transient: boolean;
  items: CorrectionItem[];
};

export class GoogleCorrectionSync {
  constructor(private readonly adapterFor: (simulate: CorrectionSimulation | null) => CorrectionAdapter = (simulate) => new SimulatedCorrectionAdapter(simulate)) {}

  /** Synchronizuje wszystkie oczekujące pozycje jednego wydarzenia (także usuniętego) w transakcji wywołującego. */
  async process(client: PoolClient, input: { userId: string; eventId: string }): Promise<CorrectionOutcome> {
    const rows = (await client.query(`${CORRECTION_SELECT} where p.ref_wydarzenia = $1 and p.id_uzytkownika = $2
      order by p.id_publikacji for update of p`, [input.eventId, input.userId])).rows;
    const pending = rows.filter((row) => ['Oczekuje', 'Błąd', 'Do usunięcia'].includes(row.status));
    if (!pending.length) return { status: 'nothing', errorCode: null, transient: false, items: rows.map(correctionItemFrom) };

    // Najnowszy stan lokalny – nie treść zlecenia, które mogło zostać wyprzedzone przez późniejszą edycję lub usunięcie.
    const event = (await client.query(`select event_version, tytul, rozpoczecie, zakonczenie from t_wydarzenia
      where id_wydarzenia = $1 and status = 'Aktywne'`, [input.eventId])).rows[0];
    const account = (await client.query(`with current as (
        select id_konta, generacja, symulacja_publikacji from t_konta_google
        where id_uzytkownika = $1 and status_polaczenia = 'Połączone' for update)
      update t_konta_google k set symulacja_publikacji = null from current where k.id_konta = current.id_konta
      returning current.id_konta, current.generacja, current.symulacja_publikacji`, [input.userId])).rows[0];
    const adapter = this.adapterFor((account?.symulacja_publikacji as CorrectionSimulation | null) ?? null);

    let errorCode: string | null = null;
    let changes = 0;
    for (const row of pending) {
      const remove = !event || row.status === 'Do usunięcia';
      let code: string | null = null;
      if (!account || account.id_konta !== row.id_konta) code = 'not_connected';
      else {
        try {
          if (remove) await adapter.delete({ calendarId: row.kalendarz_id, externalId: row.zewnetrzne_id });
          else await adapter.update({ calendarId: row.kalendarz_id, externalId: row.zewnetrzne_id,
            event: { title: event.tytul, start: new Date(event.rozpoczecie).toISOString(), end: new Date(event.zakonczenie).toISOString() } });
        } catch (error) {
          code = error instanceof GoogleIntegrationError ? error.code : 'google_error';
        }
      }
      if (!code) {
        changes += 1;
        if (remove) await client.query(`update t_publikacje set status = 'Usunięto', kod_bledu = null, proby = proby + 1, ostatnia_proba = now(),
          zaktualizowano = now() where id_publikacji = $1`, [row.id_publikacji]);
        else await client.query(`update t_publikacje set status = 'Opublikowano', kod_bledu = null, proby = proby + 1, ostatnia_proba = now(),
            opublikowano = now(), zaktualizowano = now(), operacja = 'Aktualizacja', id_wydarzenia = $2, wersja_wydarzenia = $3, migawka = $4::jsonb
          where id_publikacji = $1`, [row.id_publikacji, input.eventId, event.event_version,
          JSON.stringify({ title: event.tytul, start: new Date(event.rozpoczecie).toISOString(), end: new Date(event.zakonczenie).toISOString() })]);
        continue;
      }
      errorCode ??= code;
      // Brak wydarzenia w Google przy aktualizacji: zgłaszamy, ale nie tworzymy nowego. Usunięcie, które się nie udało, zostaje „Do usunięcia”.
      const status = remove ? 'Do usunięcia' : code === 'event_not_found' ? 'Brak w Google' : 'Błąd';
      await client.query(`update t_publikacje set status = $2, kod_bledu = $3, proby = proby + 1, ostatnia_proba = now(), zaktualizowano = now()
        where id_publikacji = $1`, [row.id_publikacji, status, code]);
    }

    if (account) {
      const operation = `${!event ? 'Usunięcie' : 'Aktualizacja'} opublikowanej zmiany (symulacja)`;
      const status = !errorCode ? 'Sukces' : changes ? 'Częściowo' : 'Błąd';
      await client.query(`insert into t_synchronizacje (id_konta, kierunek, operacja, status, zakres, proby, generacja, liczba_zmian, kod_bledu, komunikat, zakonczono_at)
        values ($1, 'Publikacja', $2, $3, $4, 1, $5, $6, $7, $8, now())`,
      [account.id_konta, operation, status, `event:${input.eventId}`, account.generacja, changes, errorCode,
        errorCode ? `Symulacja: ${correctionMessage(errorCode)}` : `Symulacja: zsynchronizowano ${changes} ${changes === 1 ? 'pozycję' : 'pozycje'}. Nic nie trafiło do Google.`]);
      if (!errorCode) await client.query(`update t_konta_google set ostatnia_publikacja = now(), updated_at = now() where id_konta = $1`, [account.id_konta]);
    }
    const items = (await client.query(`${CORRECTION_SELECT} where p.ref_wydarzenia = $1 and p.id_uzytkownika = $2 order by p.id_publikacji`,
      [input.eventId, input.userId])).rows.map(correctionItemFrom);
    return { status: errorCode ? 'error' : 'success', errorCode, transient: isTransientCode(errorCode), items };
  }
}

export class CorrectionError extends Error {
  constructor(readonly code: 'publication_not_found' | 'not_connected', readonly status: number) { super(code); }
}

/** API korekt: stan publikacji wydarzenia, lista rozbieżności, „Ponów synchronizację” i wymuszenie wyniku symulacji. */
export class GoogleCorrectionService {
  constructor(private readonly repository: PostgresGoogleIntegrationRepository, private readonly engine = new GoogleCorrectionSync()) {}

  async status(scope: UserScope, eventId: string): Promise<{ eventId: string; items: CorrectionItem[] }> {
    return this.repository.runInTransaction(async (client) => {
      const rows = (await client.query(`${CORRECTION_SELECT} where p.ref_wydarzenia = $1 and p.id_uzytkownika = $2 order by p.id_publikacji`,
        [eventId, scope.userId])).rows;
      if (!rows.length) throw new CorrectionError('publication_not_found', 404);
      return { eventId, items: rows.map(correctionItemFrom) };
    });
  }

  /** Pozycje, w których KAC i Google się rozjechały – także po usunięciu wydarzenia lokalnie (nagrobki). */
  async divergences(scope: UserScope): Promise<{ items: CorrectionItem[] }> {
    return this.repository.runInTransaction(async (client) => ({
      items: (await client.query(`${CORRECTION_SELECT} where p.id_uzytkownika = $1 and p.status in ('Oczekuje', 'Błąd', 'Brak w Google', 'Do usunięcia')
        order by p.zaktualizowano desc limit 100`, [scope.userId])).rows.map(correctionItemFrom),
    }));
  }

  /**
   * „Ponów synchronizację” (6b, 3a.1) – a po zapisie w kalendarzu także pierwsza synchronizacja bez czekania na worker.
   * Wysyła najnowszy stan; po sukcesie zaległe zlecenia „google” tego wydarzenia są już zbędne i zostają zamknięte.
   */
  async sync(scope: UserScope, eventId: string): Promise<{ eventId: string; result: CorrectionOutcome['status']; errorCode: string | null; items: CorrectionItem[] }> {
    return this.repository.runInTransaction(async (client) => {
      const exists = await client.query(`select 1 from t_publikacje where ref_wydarzenia = $1 and id_uzytkownika = $2 limit 1`, [eventId, scope.userId]);
      if (!exists.rowCount) throw new CorrectionError('publication_not_found', 404);
      const outcome = await this.engine.process(client, { userId: scope.userId, eventId });
      if (outcome.status !== 'error') {
        const closed = await client.query(`update t_event_outbox_delivery d set status = 'delivered', delivered_at = now(), error_code = null
          from t_event_outbox o where o.id_outbox = d.id_outbox and o.typ_agregatu = 'calendar_event' and o.id_agregatu = $1 and o.id_uzytkownika = $2
            and d.consumer = 'google' and d.status in ('pending', 'blocked', 'dead') returning d.id_outbox`, [eventId, scope.userId]);
        for (const row of closed.rows) await client.query(`update t_event_outbox o set status = case
            when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('pending', 'processing')) then 'pending'
            when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('blocked', 'dead')) then 'blocked'
            else 'delivered' end where o.id_outbox = $1`, [row.id_outbox]);
      }
      return { eventId, result: outcome.status, errorCode: outcome.errorCode, items: outcome.items };
    });
  }

  /** Makieta: wynik następnej synchronizacji korekty (jedna próba), żeby pokazać przebiegi błędów bez prawdziwego Google. */
  async simulateNext(scope: UserScope, simulate: CorrectionSimulation | null): Promise<{ simulate: CorrectionSimulation | null }> {
    return this.repository.runInTransaction(async (client) => {
      const updated = await client.query(`update t_konta_google set symulacja_publikacji = $2 where id_uzytkownika = $1 and status_polaczenia = 'Połączone'`,
        [scope.userId, simulate]);
      if (!updated.rowCount) throw new CorrectionError('not_connected', 404);
      return { simulate };
    });
  }
}
