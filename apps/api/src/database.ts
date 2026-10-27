import { Pool } from 'pg';
import { config } from './config.js';
import { CATEGORY_IDS, type ExistingEvent } from './import/rules.js';
import { planWorkImport, type PlanAction } from './import/work-schedule/plan.js';
import {
  IMPORT_SESSION_TTL_MINUTES,
  SOURCE_LABELS,
  eventDescription,
  positionId,
  type AcceptedRow,
  type ConfirmResult,
  type CreateSessionInput,
  type SavedEvent,
} from './import/session.js';

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export type DemoCalendarOverview = {
  source: 'postgresql';
  user: { id: string; name: string; timezone: string };
  calendar: { id: string; name: string };
  counts: { events: number; categories: number };
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    category: string;
    color: string;
    mandatory: boolean;
  }>;
};

export class PostgresDemoRepository {
  constructor(private readonly connectionPool: Pool) {}

  async checkConnection() {
    await this.connectionPool.query('select 1 as ok');
  }

  /** Tworzy sesję importu: zapisuje odczytane wiersze jako pozycje do kontroli. Kalendarz pozostaje bez zmian. */
  async createImportSession(input: CreateSessionInput, userId = config.demoUserId): Promise<{ id: string; expiresAt: Date }> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      const session = await client.query(
        `insert into t_importy (id_uzytkownika, format, zrodlo, status, liczba_rekordow)
         values ($1, $2, $3, 'Podgląd', $4)
         returning id_importu, data_importu`,
        [userId, input.format, SOURCE_LABELS[input.source], input.rows.length],
      );
      const id: string = session.rows[0].id_importu;
      const previewById = new Map(input.preview.map((row) => [row.id, row]));
      for (const row of input.rows) {
        const preview = previewById.get(row.id);
        const valid = preview?.status === 'ok';
        await client.query(
          `insert into t_pozycje_importu
             (id_pozycji, id_importu, tytul_odczyt, rozpoczecie, zakonczenie, id_kategorii, pewnosc, status_kontroli)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            positionId(id, row.id),
            id,
            row.title,
            valid ? preview.start : null,
            valid ? preview.end : null,
            CATEGORY_IDS[row.category ?? 'Personal'],
            row.confidence ?? null,
            valid ? 'Do kontroli' : 'Błąd odczytu',
          ],
        );
      }
      await client.query('commit');
      return { id, expiresAt: new Date(new Date(session.rows[0].data_importu).getTime() + IMPORT_SESSION_TTL_MINUTES * 60_000) };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Każda akcja użytkownika w podglądzie przedłuża sesję o kolejne 15 minut. */
  async touchImportSession(sessionId: string, userId = config.demoUserId): Promise<void> {
    await this.connectionPool.query(
      `update t_importy set data_importu = now()
       where id_importu = $1 and id_uzytkownika = $2 and status = 'Podgląd'
         and data_importu >= now() - make_interval(mins => $3)`,
      [sessionId, userId, IMPORT_SESSION_TTL_MINUTES],
    );
  }

  /** Imię i nazwisko użytkownika – służy do rozpoznania jego zmian w grafiku wielu pracowników. */
  async getImportUserName(userId = config.demoUserId): Promise<string> {
    const result = await this.connectionPool.query(`select imie, nazwisko from t_uzytkownicy where id_uzytkownika = $1`, [userId]);
    const row = result.rows[0];
    return row ? `${row.imie} ${row.nazwisko}`.trim() : '';
  }

  /** Aktywne wydarzenia kalendarza potrzebne do wykrywania duplikatów. */
  async listEventsForImport(calendarId = config.demoCalendarId): Promise<ExistingEvent[]> {
    const result = await this.connectionPool.query(
      `select id_wydarzenia, tytul, rozpoczecie from t_wydarzenia where id_kalendarza = $1 and status = 'Aktywne'`,
      [calendarId],
    );
    return result.rows.map((event) => ({ id: event.id_wydarzenia, title: event.tytul, start: new Date(event.rozpoczecie) }));
  }

  /** Anulowanie importu: sesja kończy się bez zmian w kalendarzu (wynik „Anulowano”). */
  async cancelImportSession(sessionId: string, userId = config.demoUserId): Promise<boolean> {
    const result = await this.connectionPool.query(
      `update t_importy set status = 'Anulowany' where id_importu = $1 and id_uzytkownika = $2 and status = 'Podgląd'`,
      [sessionId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Zatwierdza import w jednej transakcji: albo zapisują się wszystkie zaakceptowane wiersze, albo żaden.
   * Zmiany pracy będące duplikatami są dodawane, zastępowane albo pomijane zgodnie z decyzją użytkownika.
   * Wiersze sesji, których użytkownik nie zaakceptował, dostają status „Odrzucona”.
   */
  async confirmImportSession(
    sessionId: string,
    rows: AcceptedRow[],
    userId = config.demoUserId,
    calendarId = config.demoCalendarId,
  ): Promise<ConfirmResult> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      const session = await client.query(
        `select status, data_importu < now() - make_interval(mins => $3) as wygasla
         from t_importy where id_importu = $1 and id_uzytkownika = $2
         for update`,
        [sessionId, userId, IMPORT_SESSION_TTL_MINUTES],
      );
      const current = session.rows[0];
      if (!current) {
        await client.query('rollback');
        return { kind: 'not-found' };
      }
      if (current.status !== 'Podgląd') {
        await client.query('rollback');
        return { kind: 'closed' };
      }
      if (current.wygasla) {
        await client.query(`update t_importy set status = 'Wygasła' where id_importu = $1`, [sessionId]);
        await client.query('commit');
        return { kind: 'expired' };
      }

      // Zapisać można tylko wiersze, które naprawdę należą do tej sesji.
      const known = await client.query(`select id_pozycji from t_pozycje_importu where id_importu = $1`, [sessionId]);
      const knownIds = new Set(known.rows.map((row) => row.id_pozycji as string));
      const unknown = rows.filter((row) => !knownIds.has(positionId(sessionId, row.id))).map((row) => row.id);
      if (unknown.length > 0) {
        await client.query('rollback');
        return { kind: 'unknown-rows', rowIds: unknown };
      }

      // Zmiany pracy sprawdzamy pod kątem duplikatów (S23KC2S1P2-44). Pozostałe wiersze są po prostu dodawane.
      const workRows = rows.filter((row) => row.category === 'Work');
      const actions = new Map<string, PlanAction>(rows.map((row) => [row.id, { kind: 'insert', rowId: row.id }]));
      if (workRows.length > 0) {
        const existing = (
          await client.query(`select id_wydarzenia, tytul, rozpoczecie from t_wydarzenia where id_kalendarza = $1 and status = 'Aktywne'`, [calendarId])
        ).rows.map((event) => ({ id: event.id_wydarzenia as string, title: event.tytul as string, start: new Date(event.rozpoczecie) }));
        const plan = planWorkImport(workRows, existing);
        if (!plan.ok) {
          await client.query('rollback');
          return { kind: 'needs-decision', missingDecisions: plan.missingDecisions, invalidDecisions: plan.invalidDecisions };
        }
        for (const action of plan.actions) actions.set(action.rowId, action);
      }

      const saved: SavedEvent[] = [];
      for (const row of rows) {
        const action = actions.get(row.id) ?? { kind: 'insert', rowId: row.id };
        const description = eventDescription(sessionId, row.location);
        let eventId: string | null = null;
        if (action.kind === 'insert') {
          const inserted = await client.query(
            `insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo, opis)
             values ($1, $2, $3, $4, $5, 'Import', $6)
             returning id_wydarzenia`,
            [calendarId, CATEGORY_IDS[row.category], row.title, row.start, row.end, description],
          );
          eventId = inserted.rows[0].id_wydarzenia;
        } else if (action.kind === 'replace') {
          // „Zastąp”: istniejące wydarzenie z kalendarza użytkownika dostaje zatwierdzone dane z importu.
          const updated = await client.query(
            `update t_wydarzenia
             set tytul = $3, rozpoczecie = $4, zakonczenie = $5, id_kategorii = $6, opis = $7, updated_at = now()
             where id_wydarzenia = $1 and id_kalendarza = $2
             returning id_wydarzenia`,
            [action.eventId, calendarId, row.title, row.start, row.end, CATEGORY_IDS[row.category], description],
          );
          eventId = updated.rows[0]?.id_wydarzenia ?? null;
          if (!eventId) throw new Error(`Event ${action.eventId} to replace was not found in calendar ${calendarId}`);
        }
        const status = action.kind === 'insert' ? 'Zatwierdzona' : action.kind === 'replace' ? 'Zastąpiła' : 'Pominięta (duplikat)';
        await client.query(
          `update t_pozycje_importu
           set id_wydarzenia = $2, tytul_odczyt = $3, rozpoczecie = $4, zakonczenie = $5, id_kategorii = $6,
               czy_duplikat = $7, status_kontroli = $8
           where id_pozycji = $1`,
          [positionId(sessionId, row.id), eventId, row.title, row.start, row.end, CATEGORY_IDS[row.category], action.kind !== 'insert' || Boolean(row.duplicateDecision), status],
        );
        saved.push({
          id: eventId ?? '',
          rowId: row.id,
          action: action.kind === 'insert' ? 'added' : action.kind === 'replace' ? 'replaced' : 'skipped',
          title: row.title,
          start: row.start.toISOString(),
          end: row.end.toISOString(),
          category: row.category,
          location: row.location,
        });
      }
      const rejected = await client.query(
        `update t_pozycje_importu set status_kontroli = 'Odrzucona'
         where id_importu = $1 and status_kontroli in ('Do kontroli', 'Błąd odczytu')`,
        [sessionId],
      );
      const summary = {
        added: saved.filter((item) => item.action === 'added').length,
        replaced: saved.filter((item) => item.action === 'replaced').length,
        skipped: saved.filter((item) => item.action === 'skipped').length,
        rejected: rejected.rowCount ?? 0,
      };
      await client.query(`update t_importy set status = 'Zakończony', liczba_rekordow = $2 where id_importu = $1`, [sessionId, summary.added + summary.replaced]);
      await client.query('commit');
      return { kind: 'ok', saved, summary };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async getOverview(userId = config.demoUserId, calendarId = config.demoCalendarId): Promise<DemoCalendarOverview | null> {
    const calendarResult = await this.connectionPool.query(
      `select u.id_uzytkownika, u.imie, u.nazwisko, u.strefa_czasowa,
              c.id_kalendarza, c.nazwa
       from t_uzytkownicy u
       join t_kalendarze c on c.id_uzytkownika = u.id_uzytkownika
       where u.id_uzytkownika = $1 and c.id_kalendarza = $2 and c.aktywny = true`,
      [userId, calendarId],
    );
    if (!calendarResult.rowCount) return null;

    const eventResult = await this.connectionPool.query(
      `select e.id_wydarzenia, e.tytul, e.rozpoczecie, e.zakonczenie,
              e.obowiazkowe, k.nazwa as kategoria, k.kolor_hex
       from t_wydarzenia e
       join t_kategorie k on k.id_kategorii = e.id_kategorii
       where e.id_kalendarza = $1 and e.status = 'Aktywne'
       order by e.rozpoczecie asc
       limit 20`,
      [calendarId],
    );
    const row = calendarResult.rows[0];
    const categories = new Set(eventResult.rows.map((item) => item.kategoria));

    return {
      source: 'postgresql',
      user: {
        id: row.id_uzytkownika,
        name: `${row.imie} ${row.nazwisko}`.trim(),
        timezone: row.strefa_czasowa,
      },
      calendar: { id: row.id_kalendarza, name: row.nazwa },
      counts: { events: eventResult.rowCount ?? 0, categories: categories.size },
      events: eventResult.rows.map((event) => ({
        id: event.id_wydarzenia,
        title: event.tytul,
        start: new Date(event.rozpoczecie).toISOString(),
        end: new Date(event.zakonczenie).toISOString(),
        category: event.kategoria,
        color: event.kolor_hex,
        mandatory: event.obowiazkowe,
      })),
    };
  }
}
