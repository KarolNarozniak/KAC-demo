import { Pool } from 'pg';
import { config } from './config.js';

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export type EventInput = { title: string; start: string; end: string; category: 'Class' | 'Work' | 'Personal'; location: string; mandatory: boolean; repeatWeekly: boolean };

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
    color: string;
    mandatory: boolean;
    repeatWeekly?: boolean;
    location?: string;
  }>;
};

export class PostgresCalendarRepository {
  constructor(private readonly connectionPool: Pool) {}

  // Scope comes from server configuration today; authentication can supply these IDs later.
  async createEvent(input: EventInput, userId = config.demoUserId, calendarId = config.demoCalendarId) {
    const client = await this.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const owner = await client.query(`select u.strefa_czasowa from t_kalendarze c
        join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where c.id_kalendarza = $1 and c.id_uzytkownika = $2 and c.aktywny = true`, [calendarId, userId]);
      if (!owner.rowCount) throw new Error('calendar_not_found');
      const timezone = owner.rows[0].strefa_czasowa;
      const category = { Class: 'Zajęcia', Work: 'Praca', Personal: 'Prywatne' }[input.category];
      let seriesId: string | null = null;
      if (input.repeatWeekly) {
        const series = await client.query(`insert into t_serie
          (id_kalendarza, czestotliwosc, data_poczatku, bezterminowo)
          values ($1, 'WEEKLY', $2::date, true) returning id_serii`, [calendarId, input.start.slice(0, 10)]);
        seriesId = series.rows[0].id_serii;
      }
      const result = await client.query(`insert into t_wydarzenia
        (id_kalendarza, id_kategorii, id_serii, tytul, rozpoczecie, zakonczenie,
         obowiazkowe, powtarzaj_co_tydzien, miejsce)
        values ($1, (select id_kategorii from t_kategorie where nazwa = $2), $3, $4,
          $5::timestamp at time zone $10, $6::timestamp at time zone $10, $7, $8, $9)
        returning id_wydarzenia`, [calendarId, category, seriesId, input.title.trim(), input.start,
          input.end, input.mandatory, input.repeatWeekly, input.location, timezone]);
      await client.query('COMMIT');
      return { id: result.rows[0].id_wydarzenia, ...input, title: input.title.trim() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
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
        color: event.kolor_hex,
        mandatory: event.obowiazkowe,
        repeatWeekly: event.powtarzaj_co_tydzien,
        location: event.miejsce ?? '',
      })),
    };
  }
}
