import { requireCollisionDecision, validateTimedEvent, EventNotFoundError, type TimedEvent } from './collisions.js';
import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';
import { CATEGORY_IDS, type ExistingEvent } from './import/rules.js';
import { planImport, type PlanAction } from './import/plan.js';
import { enqueueDomainEvent } from './events/outbox.js';
import { AiActionStalePreviewError } from './ai/repository.js';
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

export type BlockType = 'vacation' | 'exam_session' | 'day_off';

export type Block = {
  id: string;
  userId: string;
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};

export type BlockInput = {
  title: string;
  startTime: string;
  endTime: string;
  type: BlockType;
};

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export type EventInput = { title: string; start: string; end: string; category: 'Class' | 'Work' | 'Personal'; location: string; mandatory: boolean; repeatWeekly: boolean; collisionToken?: string };

export type CalendarOverview = {
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
    eventVersion?: number;
    color: string;
    mandatory: boolean;
    repeatWeekly?: boolean;
    location?: string;
  }>;
};

export class PostgresCalendarRepository {
  constructor(private readonly connectionPool: Pool) {}

  async createEvent(input: EventInput, userId = config.demoUserId, calendarId = config.demoCalendarId, aiActionId?: string) {
    return this.saveEvent(input, undefined, userId, calendarId, aiActionId);
  }

  async updateEvent(id: string, input: EventInput, userId = config.demoUserId, calendarId = config.demoCalendarId,
    assistantAction?: { actionId: string; expected?: Record<string, unknown> }) {
    return this.saveEvent(input, id, userId, calendarId, undefined, assistantAction);
  }

  private async saveEvent(input: EventInput, eventId: string | undefined, userId: string, calendarId: string, aiActionId?: string,
    assistantAction?: { actionId: string; expected?: Record<string, unknown> }) {
    const client = await this.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query(`select u.strefa_czasowa from t_kalendarze c
        join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where c.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true for update of c`, [calendarId, userId]);
      if (!owner.rowCount) throw new EventNotFoundError('calendar_not_found');
      const timezone: string = owner.rows[0].strefa_czasowa;
      validateTimedEvent(input, timezone);
      if (assistantAction) {
        const prior = await client.query(`select rezultat from t_ai_action_effects
          where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3`, [assistantAction.actionId, userId, calendarId]);
        if (prior.rows[0]) { await client.query('COMMIT'); return prior.rows[0].rezultat as EventInput & { id: string }; }
      }
      const records = await client.query(`select e.id_wydarzenia, e.id_serii, e.id_ai_akcji, e.event_version, e.tytul, e.powtarzaj_co_tydzien,
        e.miejsce, e.obowiazkowe, k.nazwa as kategoria,
        to_char(e.rozpoczecie at time zone $2, 'YYYY-MM-DD"T"HH24:MI') as start,
        to_char(e.zakonczenie at time zone $2, 'YYYY-MM-DD"T"HH24:MI') as end
        from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
        where e.id_kalendarza = $1 and e.status = 'Aktywne'`, [calendarId, timezone]);
      if (aiActionId) {
        const alreadyCreated = records.rows.find((row) => row.id_ai_akcji === aiActionId);
        if (alreadyCreated) {
          await client.query('COMMIT');
          return { id: alreadyCreated.id_wydarzenia, ...input, title: alreadyCreated.tytul };
        }
      }
      const current = records.rows.find(row => row.id_wydarzenia === eventId);
      if (eventId && !current) throw new EventNotFoundError('event_not_found');
      if (assistantAction?.expected && current && !this.matchesAssistantSnapshot(current, assistantAction.expected))
        throw new AiActionStalePreviewError('ai_action_stale_preview');
      const events: TimedEvent[] = records.rows.map(row => ({ id: row.id_wydarzenia, title: row.tytul, start: row.start, end: row.end,
        category: row.kategoria, repeatWeekly: row.powtarzaj_co_tydzien }));
      requireCollisionDecision(input, events, timezone, eventId);
      let seriesId: string | null = current?.id_serii ?? null;
      if (input.repeatWeekly && !seriesId) {
        const series = await client.query(`insert into t_serie
          (id_kalendarza, czestotliwosc, data_poczatku, bezterminowo)
          values ($1, 'WEEKLY', $2::date, true) returning id_serii`, [calendarId, input.start.slice(0, 10)]);
        seriesId = series.rows[0].id_serii;
      } else if (input.repeatWeekly && seriesId) {
        await client.query(`update t_serie set data_poczatku = $2::date where id_serii = $1`, [seriesId, input.start.slice(0,10)]);
      }
      const category = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' }[input.category];
      const values = [calendarId, category, input.repeatWeekly ? seriesId : null, input.title.trim(), input.start,
        input.end, input.mandatory, input.repeatWeekly, input.location, timezone];
      const result = eventId
        ? await client.query(`update t_wydarzenia set
            id_kategorii = (select id_kategorii from t_kategorie where nazwa = $2), id_serii = $3, tytul = $4,
            rozpoczecie = $5::timestamp at time zone $10, zakonczenie = $6::timestamp at time zone $10,
             obowiazkowe = $7, powtarzaj_co_tydzien = $8, miejsce = $9, event_version = event_version + 1, updated_at = now()
             where id_kalendarza = $1 and id_wydarzenia = $11 returning id_wydarzenia, event_version`, [...values, eventId])
        : await client.query(`insert into t_wydarzenia
            (id_kalendarza, id_kategorii, id_serii, tytul, rozpoczecie, zakonczenie, obowiazkowe, powtarzaj_co_tydzien, miejsce, id_ai_akcji)
            values ($1, (select id_kategorii from t_kategorie where nazwa = $2), $3, $4,
            $5::timestamp at time zone $10, $6::timestamp at time zone $10, $7, $8, $9, $11) returning id_wydarzenia, event_version`, [...values, aiActionId ?? null]);
      const savedEventId = String(result.rows[0].id_wydarzenia);
      await enqueueDomainEvent(client, { userId, calendarId }, 'calendar_event', savedEventId, eventId ? 'calendar_event.updated' : 'calendar_event.created', {
        origin: aiActionId ? 'assistant' : 'calendar', timeZone: timezone, eventVersion: result.rows[0].event_version,
        before: current ? { title: current.tytul, start: current.start, end: current.end, category: current.kategoria } : null,
        after: { title: input.title.trim(), start: input.start, end: input.end, category: input.category, location: input.location ?? '' },
      });
      if (!input.repeatWeekly && seriesId) await client.query(`delete from t_serie where id_serii = $1
        and not exists (select 1 from t_wydarzenia where id_serii = $1)`, [seriesId]);
      const { collisionToken: _, ...savedInput } = input;
      const savedResult = { id: savedEventId, ...savedInput, title: input.title.trim() };
      if (assistantAction) await client.query(`insert into t_ai_action_effects (id_akcji, id_uzytkownika, id_kalendarza, rezultat)
        values ($1, $2, $3, $4::jsonb)`, [assistantAction.actionId, userId, calendarId, JSON.stringify(savedResult)]);
      await client.query('COMMIT');
      return savedResult;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private matchesAssistantSnapshot(current: Record<string, unknown>, expected: Record<string, unknown>) {
    const actual: Record<string, unknown> = { title: current.tytul, start: current.start, end: current.end, category: current.kategoria,
      location: current.miejsce ?? '', mandatory: current.obowiazkowe, repeatWeekly: current.powtarzaj_co_tydzien,
      eventVersion: Number(current.event_version) };
    return Object.entries(expected).every(([key, value]) => key in actual && actual[key] === value);
  }

  async deleteEvent(eventId: string, userId = config.demoUserId, calendarId = config.demoCalendarId,
    assistantAction?: { actionId: string; expected?: Record<string, unknown> }): Promise<string[] | null> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query(`select c.id_kalendarza, u.strefa_czasowa from t_kalendarze c
        join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
      where c.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true for update of c`, [calendarId, userId]);
      if (!owner.rowCount) { await client.query('ROLLBACK'); return null; }
      if (assistantAction) {
        const prior = await client.query(`select rezultat from t_ai_action_effects
          where id_akcji = $1 and id_uzytkownika = $2 and id_kalendarza = $3`, [assistantAction.actionId, userId, calendarId]);
        if (prior.rows[0]) { await client.query('COMMIT'); return (prior.rows[0].rezultat as { deletedIds: string[] }).deletedIds; }
      }
      const selected = await client.query(`select e.id_serii, e.powtarzaj_co_tydzien, e.event_version, e.tytul, e.obowiazkowe, e.miejsce,
          to_char(e.rozpoczecie at time zone $4, 'YYYY-MM-DD"T"HH24:MI') as start,
          to_char(e.zakonczenie at time zone $4, 'YYYY-MM-DD"T"HH24:MI') as end, k.nazwa as category
        from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
        join t_kategorie k on k.id_kategorii = e.id_kategorii
        where e.id_wydarzenia = $1 and c.id_kalendarza = $2 and c.id_uzytkownika = $3
          and c.aktywny = true and e.status = 'Aktywne' for update of e`, [eventId, calendarId, userId, owner.rows[0].strefa_czasowa]);
      if (!selected.rowCount) {
        if (assistantAction?.expected) throw new AiActionStalePreviewError('ai_action_stale_preview');
        await client.query('COMMIT');
        return null;
      }
      const event = selected.rows[0];
      if (assistantAction?.expected && !this.matchesAssistantSnapshot({ ...event, start: event.start, end: event.end, kategoria: event.category }, assistantAction.expected))
        throw new AiActionStalePreviewError('ai_action_stale_preview');
      const removedEvents = event.powtarzaj_co_tydzien && event.id_serii
        ? await client.query(`select e.id_wydarzenia, e.event_version, e.tytul,
            to_char(e.rozpoczecie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_start,
            to_char(e.zakonczenie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_end, k.nazwa as kategoria
            from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
            where e.id_serii = $1 and e.id_kalendarza = $2 for update of e`, [event.id_serii, calendarId, owner.rows[0].strefa_czasowa])
        : await client.query(`select e.id_wydarzenia, e.event_version, e.tytul,
            to_char(e.rozpoczecie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_start,
            to_char(e.zakonczenie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_end, k.nazwa as kategoria
            from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
            where e.id_wydarzenia = $1 and e.id_kalendarza = $2 for update of e`, [eventId, calendarId, owner.rows[0].strefa_czasowa]);
      for (const removedEvent of removedEvents.rows) await enqueueDomainEvent(client, { userId, calendarId }, 'calendar_event',
        String(removedEvent.id_wydarzenia), 'calendar_event.deleted', { origin: 'calendar', timeZone: owner.rows[0].strefa_czasowa,
          before: { title: removedEvent.tytul, start: removedEvent.local_start, end: removedEvent.local_end, category: removedEvent.kategoria, version: removedEvent.event_version } });
      const removed = event.powtarzaj_co_tydzien && event.id_serii
        ? await client.query(`delete from t_wydarzenia where id_serii = $1 and id_kalendarza = $2 returning id_wydarzenia`, [event.id_serii, calendarId])
        : await client.query(`delete from t_wydarzenia where id_wydarzenia = $1 and id_kalendarza = $2 returning id_wydarzenia`, [eventId, calendarId]);
      const deletedIds = removed.rows.map((row) => String(row.id_wydarzenia));
      if (assistantAction) await client.query(`insert into t_ai_action_effects (id_akcji, id_uzytkownika, id_kalendarza, rezultat)
        values ($1, $2, $3, $4::jsonb)`, [assistantAction.actionId, userId, calendarId, JSON.stringify({ deletedIds })]);
      if (event.id_serii) {
        await client.query(`delete from t_serie s where s.id_serii = $1 and s.id_kalendarza = $2
          and not exists (select 1 from t_wydarzenia e where e.id_serii = s.id_serii)`, [event.id_serii, calendarId]);
      }
      await client.query('COMMIT');
      return deletedIds;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async listBlocks(userId = config.demoUserId): Promise<Block[]> {
    const result = await this.connectionPool.query(
      'SELECT id, user_id as "userId", title, start_time as "startTime", end_time as "endTime", type FROM blocks WHERE user_id=$1 ORDER BY start_time ASC', [userId]
    );
    return result.rows.map(row => ({
      ...row,
      startTime: row.startTime.toISOString(),
      endTime: row.endTime.toISOString(),
    }));
  }

  private async mutateBlocks<T>(userId:string,operation:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.connectionPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('select id_kalendarza from t_kalendarze where id_uzytkownika=$1 and aktywny order by id_kalendarza for update',[userId]);
      const result=await operation(client);
      await client.query('COMMIT');
      return result;
    } catch(error) {await client.query('ROLLBACK');throw error;}
    finally {client.release();}
  }

  async createBlock(input:BlockInput,userId=config.demoUserId):Promise<Block> {
    const start=new Date(input.startTime).toISOString(),end=new Date(input.endTime).toISOString();
    return this.mutateBlocks(userId,async client=>{
      const result=await client.query(`insert into blocks(user_id,title,start_time,end_time,type) values($1,$2,$3,$4,$5) returning id,user_id as "userId",title,start_time as "startTime",end_time as "endTime",type`,[userId,input.title,start,end,input.type]);
      const row=result.rows[0];
      return {...row,startTime:row.startTime.toISOString(),endTime:row.endTime.toISOString()};
    });
  }

  async deleteBlock(id:string,userId=config.demoUserId):Promise<boolean> {
    return this.mutateBlocks(userId,async client=>{
      const result=await client.query('delete from blocks where id=$1 and user_id=$2 returning id',[id,userId]);
      return (result.rowCount??0)>0;
    });
  }

  async getEventOrSeries(eventId: string, userId = config.demoUserId, calendarId = config.demoCalendarId) {
    const client = await this.connectionPool.connect();
    try {
      const selected = await client.query(
        `select e.id_serii
         from t_wydarzenia e
         join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
         where e.id_wydarzenia = $1 and c.id_kalendarza = $2 and c.id_uzytkownika = $3 and c.aktywny = true`,
        [eventId, calendarId, userId]
      );
      if (!selected.rowCount) return null;
      const seriesId = selected.rows[0].id_serii;

      const query = seriesId
        ? `select e.id_wydarzenia, e.tytul, e.rozpoczecie, e.zakonczenie,
                  e.obowiazkowe, e.powtarzaj_co_tydzien, e.miejsce,
                  to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_start,
                  to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_end,
                  k.nazwa as kategoria, k.kolor_hex
           from t_wydarzenia e
           join t_kategorie k on k.id_kategorii = e.id_kategorii
           join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
           join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
           where e.id_serii = $1 and e.id_kalendarza = $2 and e.status = 'Aktywne'
           order by e.rozpoczecie asc`
        : `select e.id_wydarzenia, e.tytul, e.rozpoczecie, e.zakonczenie,
                  e.obowiazkowe, e.powtarzaj_co_tydzien, e.miejsce,
                  to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_start,
                  to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_end,
                  k.nazwa as kategoria, k.kolor_hex
           from t_wydarzenia e
           join t_kategorie k on k.id_kategorii = e.id_kategorii
           join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
           join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
           where e.id_wydarzenia = $1 and c.id_kalendarza = $2 and e.status = 'Aktywne'`;

      const params = seriesId ? [seriesId, calendarId] : [eventId, calendarId];
      const eventsResult = await client.query(query, params);

      return {
        seriesId: seriesId ?? null,
        events: eventsResult.rows.map((event) => ({
          id: event.id_wydarzenia,
          title: event.tytul,
          start: event.local_start,
          end: event.local_end,
          category: event.kategoria,
          color: event.kolor_hex,
          mandatory: event.obowiazkowe,
          repeatWeekly: event.powtarzaj_co_tydzien,
          location: event.miejsce ?? '',
        })),
      };
    } finally {
      client.release();
    }
  }

  async updateSeriesFrom(eventId: string, input: EventInput, userId = config.demoUserId, calendarId = config.demoCalendarId) {
    const client = await this.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query(`
        select u.strefa_czasowa from t_kalendarze c
        join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where c.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true
      `, [calendarId, userId]);
      if (!owner.rowCount) throw new Error('calendar_not_found');
      const timezone = owner.rows[0].strefa_czasowa;

      const targetEvent = await client.query(`
        select id_serii, rozpoczecie from t_wydarzenia
        where id_wydarzenia = $1 and id_kalendarza = $2
      `, [eventId, calendarId]);
      if (!targetEvent.rowCount) throw new Error('event_not_found');
      const { id_serii, rozpoczecie } = targetEvent.rows[0];
      const priorEvents = await client.query(`select e.id_wydarzenia, e.event_version, e.tytul,
        to_char(e.rozpoczecie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_start,
        to_char(e.zakonczenie at time zone $3, 'YYYY-MM-DD"T"HH24:MI') as local_end, k.nazwa as kategoria
        from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
        where e.id_kalendarza = $1 and (($2::text is not null and e.id_serii = $2) or ($2::text is null and e.id_wydarzenia = $4))
          and e.rozpoczecie >= $5 for update of e`, [calendarId, id_serii, timezone, eventId, rozpoczecie]);

      const category = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' }[input.category];

      if (id_serii) {
        await client.query(`
          update t_wydarzenia
          set tytul = $1,
              rozpoczecie = $2::timestamp at time zone $6,
              zakonczenie = $3::timestamp at time zone $6,
              id_kategorii = (select id_kategorii from t_kategorie where nazwa = $4),
              miejsce = $5,
              obowiazkowe = $7,
              powtarzaj_co_tydzien = $8, event_version = event_version + 1, updated_at = now()
          where id_serii = $9 and id_kalendarza = $10 and rozpoczecie >= $11
          returning id_wydarzenia, event_version, rozpoczecie, zakonczenie
        `, [
          input.title.trim(),
          input.start,
          input.end,
          category,
          input.location,
          timezone,
          input.mandatory,
          input.repeatWeekly,
          id_serii,
          calendarId,
          rozpoczecie
        ]);
      } else {
        await client.query(`
          update t_wydarzenia
          set tytul = $1, rozpoczecie = $2::timestamp at time zone $6, zakonczenie = $3::timestamp at time zone $6,
              id_kategorii = (select id_kategorii from t_kategorie where nazwa = $4),
              miejsce = $5, obowiazkowe = $7, powtarzaj_co_tydzien = $8, event_version = event_version + 1, updated_at = now()
          where id_wydarzenia = $9 and id_kalendarza = $10
          returning id_wydarzenia, event_version, rozpoczecie, zakonczenie
        `, [input.title.trim(), input.start, input.end, category, input.location, input.mandatory, input.repeatWeekly, eventId, timezone, calendarId]);
      }

      const updatedEvents = await client.query(`select e.id_wydarzenia, e.event_version, e.rozpoczecie, e.zakonczenie
        from t_wydarzenia e where e.id_kalendarza = $1 and (($2::text is not null and e.id_serii = $2) or ($2::text is null and e.id_wydarzenia = $3))
          and e.rozpoczecie >= $4 order by e.rozpoczecie`, [calendarId, id_serii, eventId, rozpoczecie]);
      const previousById = new Map(priorEvents.rows.map((event) => [event.id_wydarzenia as string, event]));
      for (const updated of updatedEvents.rows) {
        const previous = previousById.get(updated.id_wydarzenia);
        await enqueueDomainEvent(client, { userId, calendarId }, 'calendar_event', String(updated.id_wydarzenia), 'calendar_event.updated', {
          origin: 'calendar_series', timeZone: timezone, eventVersion: updated.event_version,
          before: previous ? { title: previous.tytul, start: previous.local_start, end: previous.local_end, category: previous.kategoria, version: previous.event_version } : null,
          after: { title: input.title.trim(), start: updated.rozpoczecie.toISOString(), end: updated.zakonczenie.toISOString(), category: input.category, location: input.location ?? '' },
        });
      }

      await client.query('COMMIT');
      return { id: eventId, ...input, title: input.title.trim() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
             (id_pozycji, id_importu, tytul_odczyt, rozpoczecie, zakonczenie, id_kategorii, pewnosc, status_kontroli, source_page, source_snippet, unresolved_fields)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
          [
            positionId(id, row.id),
            id,
            row.title,
            valid ? preview.start : null,
            valid ? preview.end : null,
            CATEGORY_IDS[row.category ?? 'Personal'],
            row.confidence ?? null,
            valid ? 'Do kontroli' : 'Błąd odczytu',
            row.sourcePage ?? null,
            row.sourceSnippet?.slice(0, 160) ?? null,
            JSON.stringify(row.unresolvedFields ?? []),
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

  async touchImportSession(sessionId: string, userId = config.demoUserId): Promise<void> {
    await this.connectionPool.query(
      `update t_importy set data_importu = now()
       where id_importu = $1 and id_uzytkownika = $2 and status = 'Podgląd'
         and data_importu >= now() - make_interval(mins => $3)`,
      [sessionId, userId, IMPORT_SESSION_TTL_MINUTES],
    );
  }

  async cancelImportSession(sessionId: string, userId = config.demoUserId): Promise<boolean> {
    const result = await this.connectionPool.query(
      `update t_importy set status = 'Anulowany' where id_importu = $1 and id_uzytkownika = $2 and status = 'Podgląd'`,
      [sessionId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getImportUserName(userId = config.demoUserId): Promise<string> {
    const result = await this.connectionPool.query(`select imie, nazwisko from t_uzytkownicy where id_uzytkownika = $1`, [userId]);
    const row = result.rows[0];
    return row ? `${row.imie} ${row.nazwisko}`.trim() : '';
  }

  async listEventsForImport(calendarId = config.demoCalendarId, userId = config.demoUserId): Promise<ExistingEvent[]> {
    const result = await this.connectionPool.query(
      `select e.id_wydarzenia, e.tytul, e.rozpoczecie, e.powtarzaj_co_tydzien, u.strefa_czasowa
       from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
       join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
       where e.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true and e.status = 'Aktywne'`,
      [calendarId, userId],
    );
    return result.rows.map((event) => ({ id: event.id_wydarzenia, title: event.tytul, start: new Date(event.rozpoczecie), repeatWeekly: event.powtarzaj_co_tydzien, timeZone: event.strefa_czasowa }));
  }

  async confirmImportSession(
    sessionId: string,
    rows: AcceptedRow[],
    userId = config.demoUserId,
    calendarId = config.demoCalendarId,
  ): Promise<ConfirmResult> {
    const client = await this.connectionPool.connect();
    try {
      await client.query('begin');
      const owner = await client.query(`select c.id_kalendarza, u.strefa_czasowa from t_kalendarze c
        join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where c.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true for update of c`, [calendarId, userId]);
      if (!owner.rowCount) { await client.query('rollback'); return { kind: 'not-found' }; }
      if (new Set(rows.map(row => row.id)).size !== rows.length) {
        await client.query('rollback'); return { kind: 'unknown-rows', rowIds: rows.map(row => row.id) };
      }
      const session = await client.query(
        `select status, zrodlo, data_importu < now() - make_interval(mins => $3) as wygasla
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

      const known = await client.query(`select id_pozycji from t_pozycje_importu where id_importu = $1`, [sessionId]);
      const knownIds = new Set(known.rows.map((row) => row.id_pozycji as string));
      const unknown = rows.filter((row) => !knownIds.has(positionId(sessionId, row.id))).map((row) => row.id);
      if (unknown.length > 0) {
        await client.query('rollback');
        return { kind: 'unknown-rows', rowIds: unknown };
      }

      const actions = new Map<string, PlanAction>(rows.map((row) => [row.id, { kind: 'insert', rowId: row.id }]));
      if (rows.length > 0) {
        const existing = (
          await client.query(`select e.id_wydarzenia, e.tytul, e.rozpoczecie, e.powtarzaj_co_tydzien, u.strefa_czasowa
            from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
            join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
            where e.id_kalendarza = $1 and e.status = 'Aktywne'`, [calendarId])
        ).rows.map((event) => ({ id: event.id_wydarzenia as string, title: event.tytul as string, start: new Date(event.rozpoczecie), repeatWeekly: event.powtarzaj_co_tydzien, timeZone: event.strefa_czasowa }));
        const plan = planImport(rows, existing);
        if (!plan.ok) {
          await client.query('rollback');
          return { kind: 'needs-decision', missingDecisions: plan.missingDecisions, invalidDecisions: plan.invalidDecisions };
        }
        for (const action of plan.actions) actions.set(action.rowId, action);
      }

      const saved: SavedEvent[] = [];
      for (const row of rows) {
        const action = actions.get(row.id) ?? { kind: 'insert', rowId: row.id };
        const description = eventDescription(sessionId);
        let eventId: string | null = null;
        if (action.kind === 'insert') {
          const inserted = await client.query(
            `insert into t_wydarzenia (id_kalendarza, id_kategorii, tytul, rozpoczecie, zakonczenie, zrodlo, opis, miejsce)
             values ($1, $2, $3, $4, $5, $8, $6, $7)
             returning id_wydarzenia, event_version`,
            [calendarId, CATEGORY_IDS[row.category], row.title, row.start, row.end, description, row.location ?? '',
              current.zrodlo === SOURCE_LABELS.google ? 'Google' : 'Import'],
          );
          const createdId = String(inserted.rows[0].id_wydarzenia);
          eventId = createdId;
          await enqueueDomainEvent(client, { userId, calendarId }, 'calendar_event', createdId, 'calendar_event.created', {
            origin: current.zrodlo === SOURCE_LABELS.google ? 'google_import' : 'file_import', timeZone: owner.rows[0].strefa_czasowa,
            eventVersion: inserted.rows[0].event_version,
            after: { title: row.title, start: row.start.toISOString(), end: row.end.toISOString(), category: row.category, location: row.location ?? '' },
          });
        } else if (action.kind === 'replace') {
          const updated = await client.query(
            `update t_wydarzenia
             set tytul = $3,
                 rozpoczecie = case when powtarzaj_co_tydzien then rozpoczecie else $4::timestamptz end,
                 zakonczenie = case when powtarzaj_co_tydzien then
                   ((rozpoczecie at time zone $9) + (($5::timestamptz at time zone $9) - ($4::timestamptz at time zone $9))) at time zone $9
                   else $5::timestamptz end,
                 id_kategorii = $6, opis = $7, miejsce = $8, event_version = event_version + 1, updated_at = now()
             where id_wydarzenia = $1 and id_kalendarza = $2
             returning id_wydarzenia, event_version`,
            [action.eventId, calendarId, row.title, row.start, row.end, CATEGORY_IDS[row.category], description, row.location ?? '',
              owner.rows[0].strefa_czasowa],
          );
          eventId = updated.rows[0]?.id_wydarzenia ?? null;
          if (!eventId) throw new Error(`Event ${action.eventId} to replace was not found in calendar ${calendarId}`);
          await enqueueDomainEvent(client, { userId, calendarId }, 'calendar_event', eventId, 'calendar_event.updated', {
            origin: current.zrodlo === SOURCE_LABELS.google ? 'google_import' : 'file_import', timeZone: owner.rows[0].strefa_czasowa,
            eventVersion: updated.rows[0].event_version,
            after: { title: row.title, start: row.start.toISOString(), end: row.end.toISOString(), category: row.category, location: row.location ?? '' },
          });
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

  async checkConnection() {
    await this.connectionPool.query('select 1 as ok');
  }

  async getOverview(userId = config.demoUserId, calendarId = config.demoCalendarId): Promise<CalendarOverview | null> {
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
              e.obowiazkowe, e.powtarzaj_co_tydzien, e.miejsce,
              e.event_version,
              to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_start,
              to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as local_end, k.nazwa as kategoria, k.kolor_hex
       from t_wydarzenia e
       join t_kategorie k on k.id_kategorii = e.id_kategorii
       join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
       join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
       where e.id_kalendarza = $1 and e.status = 'Aktywne'
       order by e.rozpoczecie asc`,
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
        start: event.local_start,
        end: event.local_end,
        category: event.kategoria,
        eventVersion: Number(event.event_version),
        color: event.kolor_hex,
        mandatory: event.obowiazkowe,
        repeatWeekly: event.powtarzaj_co_tydzien,
        location: event.miejsce ?? '',
      })),
    };
  }
}
