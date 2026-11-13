import type { Pool } from 'pg';
import type { UserScope } from '../api/scope.js';

export type NotificationSettings = { enabled: boolean; workRemindersEnabled: boolean; eventChangesEnabled: boolean; minutesBefore: number; quietStart: string | null; quietEnd: string | null };
export type DueNotification = { id: string; eventId: string; type: string; message: string; scheduledAt: string; eventStart: string; title: string };

export class PostgresNotificationRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(scope: UserScope): Promise<NotificationSettings> {
    const result = await this.pool.query(`select wlaczone, przypomnienia_wlaczone, zmiany_wlaczone, min_przed,
      cisza_od::text as cisza_od, cisza_do::text as cisza_do from t_ustaw_powiadomien where id_uzytkownika = $1 order by updated_at desc limit 1`, [scope.userId]);
    const row = result.rows[0];
    return row ? { enabled: row.wlaczone, workRemindersEnabled: row.przypomnienia_wlaczone,
      eventChangesEnabled: row.zmiany_wlaczone, minutesBefore: Number(row.min_przed),
      quietStart: row.cisza_od?.slice(0, 5) ?? null, quietEnd: row.cisza_do?.slice(0, 5) ?? null }
      : { enabled: false, workRemindersEnabled: true, eventChangesEnabled: true, minutesBefore: 30, quietStart: null, quietEnd: null };
  }

  async updateSettings(scope: UserScope, settings: Pick<NotificationSettings, 'enabled' | 'workRemindersEnabled' | 'minutesBefore'>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query(`select id_ustawien from t_ustaw_powiadomien
        where id_uzytkownika = $1 order by updated_at desc limit 1 for update`, [scope.userId]);
      if (current.rows[0]) {
        await client.query(`update t_ustaw_powiadomien set wlaczone = $2, przypomnienia_wlaczone = $3,
          min_przed = $4, updated_at = now() where id_ustawien = $1`,
        [current.rows[0].id_ustawien, settings.enabled, settings.workRemindersEnabled, settings.minutesBefore]);
      } else {
        await client.query(`insert into t_ustaw_powiadomien (id_uzytkownika, wlaczone, przypomnienia_wlaczone, min_przed)
          values ($1, $2, $3, $4)`, [scope.userId, settings.enabled, settings.workRemindersEnabled, settings.minutesBefore]);
      }
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }

  async listDue(scope: UserScope, limit = 20): Promise<DueNotification[]> {
    const result = await this.pool.query(`with due as (
        select n.id_powiadomienia, n.id_wydarzenia, n.typ, n.tresc, n.planowana_data,
          to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as event_start, e.tytul
        from t_powiadomienia n join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
        join t_kalendarze c on c.id_kalendarza = e.id_kalendarza join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where n.id_uzytkownika = $1 and c.id_kalendarza = $2 and n.status = 'Zaplanowane' and n.planowana_data <= now()
        order by n.planowana_data asc limit $3 for update of n skip locked
      ) update t_powiadomienia n set status = 'Wysłane', data_wyslania = now()
        from due where n.id_powiadomienia = due.id_powiadomienia returning due.*`,
    [scope.userId, scope.calendarId, Math.min(Math.max(limit, 1), 100)]);
    return result.rows.map((row) => ({ id: row.id_powiadomienia, eventId: row.id_wydarzenia, type: row.typ, message: row.tresc,
      scheduledAt: new Date(row.planowana_data).toISOString(), eventStart: row.event_start, title: row.tytul }));
  }

  async acknowledge(scope: UserScope, notificationId: string): Promise<boolean> {
    const result = await this.pool.query(`update t_powiadomienia n set status = 'Wysłane', data_wyslania = now()
      where n.id_powiadomienia = $1 and n.id_uzytkownika = $2 and n.status = 'Zaplanowane' and n.planowana_data <= now()
        and exists (select 1 from t_wydarzenia e where e.id_wydarzenia = n.id_wydarzenia and e.id_kalendarza = $3)`,
    [notificationId, scope.userId, scope.calendarId]);
    return Boolean(result.rowCount);
  }
}
