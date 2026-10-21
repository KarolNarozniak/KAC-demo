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
