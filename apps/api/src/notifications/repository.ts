import type { Pool } from 'pg';
import type { UserScope } from '../api/scope.js';
import { parseEventTime, reminderText, reminderTime } from './schedule.js';

export type NotificationSettings = { enabled: boolean; workRemindersEnabled: boolean; eventChangesEnabled: boolean; minutesBefore: number; quietStart: string | null; quietEnd: string | null; pendingReminderCount: number };
export type DueNotification = { id: string; eventId: string; type: string; message: string; scheduledAt: string; eventStart: string; eventEnd: string; title: string };
export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string; expirationTime?: number | null };

export class PostgresNotificationRepository {
  constructor(private readonly pool: Pool) {}

  async getSettings(scope: UserScope): Promise<NotificationSettings> {
    const result = await this.pool.query(`select wlaczone, przypomnienia_wlaczone, zmiany_wlaczone, min_przed,
      cisza_od::text as cisza_od, cisza_do::text as cisza_do from t_ustaw_powiadomien where id_uzytkownika = $1 order by updated_at desc limit 1`, [scope.userId]);
    const pending = await this.pool.query(`select count(*)::integer as count from t_powiadomienia n
      join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
      where n.id_uzytkownika = $1 and c.id_kalendarza = $2 and c.id_uzytkownika = $1 and c.aktywny
        and e.status = 'Aktywne' and e.rozpoczecie > now() and n.status = 'Zaplanowane'`, [scope.userId, scope.calendarId]);
    const row = result.rows[0];
    return row ? { enabled: row.wlaczone, workRemindersEnabled: row.przypomnienia_wlaczone,
      eventChangesEnabled: row.zmiany_wlaczone, minutesBefore: Number(row.min_przed),
      quietStart: row.cisza_od?.slice(0, 5) ?? null, quietEnd: row.cisza_do?.slice(0, 5) ?? null, pendingReminderCount: Number(pending.rows[0]?.count ?? 0) }
      : { enabled: false, workRemindersEnabled: true, eventChangesEnabled: true, minutesBefore: 30, quietStart: null, quietEnd: null, pendingReminderCount: 0 };
  }

  async updateSettings(scope: UserScope, settings: Pick<NotificationSettings, 'enabled' | 'workRemindersEnabled' | 'minutesBefore'>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query(`select id_ustawien from t_ustaw_powiadomien
        where id_uzytkownika = $1 order by updated_at desc limit 1 for update`, [scope.userId]);
      let settingsId: string;
      if (current.rows[0]) {
        await client.query(`update t_ustaw_powiadomien set wlaczone = $2, przypomnienia_wlaczone = $3,
          min_przed = $4, updated_at = now() where id_ustawien = $1 returning id_ustawien`,
        [current.rows[0].id_ustawien, settings.enabled, settings.workRemindersEnabled, settings.minutesBefore]);
        settingsId = String(current.rows[0].id_ustawien);
      } else {
        const inserted = await client.query(`insert into t_ustaw_powiadomien (id_uzytkownika, wlaczone, przypomnienia_wlaczone, min_przed)
          values ($1, $2, $3, $4) returning id_ustawien`, [scope.userId, settings.enabled, settings.workRemindersEnabled, settings.minutesBefore]);
        settingsId = String(inserted.rows[0].id_ustawien);
      }
      await client.query(`update t_powiadomienia n set status = 'Anulowane', lease_until = null
        where n.id_uzytkownika = $1 and n.status in ('Zaplanowane', 'Dostarczanie')
          and exists (select 1 from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
            where e.id_wydarzenia = n.id_wydarzenia and c.id_kalendarza = $2 and c.id_uzytkownika = $1)`, [scope.userId, scope.calendarId]);
      if (settings.enabled && settings.workRemindersEnabled) {
        const events = await client.query(`select e.id_wydarzenia, e.event_version, e.tytul,
              to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as start,
              to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as "end",
              u.strefa_czasowa as timezone, s.cisza_od::text as quiet_start, s.cisza_do::text as quiet_end
            from t_wydarzenia e join t_kategorie k on k.id_kategorii = e.id_kategorii
            join t_kalendarze c on c.id_kalendarza = e.id_kalendarza join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
            join t_ustaw_powiadomien s on s.id_ustawien = $3
            where e.id_kalendarza = $2 and c.id_uzytkownika = $1 and c.aktywny and e.status = 'Aktywne'
              and k.nazwa = 'Praca' and e.rozpoczecie > now() order by e.rozpoczecie`, [scope.userId, scope.calendarId, settingsId]);
        const settingStampResult = await client.query(`select updated_at::text as stamp from t_ustaw_powiadomien where id_ustawien = $1`, [settingsId]);
        const nowResult = await client.query('select now() as now');
        const now = new Date(nowResult.rows[0].now);
        const settingStamp = String(settingStampResult.rows[0]?.stamp ?? 'settings');
        for (const event of events.rows) {
          const timeZone = String(event.timezone);
          const start = parseEventTime(String(event.start), timeZone);
          const end = parseEventTime(String(event.end), timeZone);
          const plannedAt = reminderTime(start, settings.minutesBefore, timeZone, now, event.quiet_start, event.quiet_end);
          if (!plannedAt) continue;
          const eventId = String(event.id_wydarzenia);
          const key = `work-reminder:${eventId}:${event.event_version}:${settingStamp}:${plannedAt.toISOString()}`;
          await client.query(`insert into t_powiadomienia
            (id_uzytkownika, id_wydarzenia, typ, tresc, planowana_data, status, idempotency_key, event_ref)
            values ($1, $2, 'Przypomnienie pracy', $3, $4, 'Zaplanowane', $5, $2)
            on conflict (idempotency_key) where idempotency_key is not null do nothing`,
          [scope.userId, eventId, reminderText(String(event.tytul), start, end, timeZone), plannedAt.toISOString(), key]);
        }
      }
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }

  async savePushSubscription(scope: UserScope, subscription: PushSubscriptionInput) {
    const expiresAt = typeof subscription.expirationTime === 'number' ? new Date(subscription.expirationTime) : null;
    if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new Error('invalid_push_expiration');
    await this.pool.query(`insert into t_web_push_subskrypcje (id_uzytkownika, id_kalendarza, endpoint, p256dh, auth, expires_at)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (endpoint) do update set id_uzytkownika = excluded.id_uzytkownika, id_kalendarza = excluded.id_kalendarza,
        p256dh = excluded.p256dh, auth = excluded.auth, expires_at = excluded.expires_at, updated_at = now()`,
    [scope.userId, scope.calendarId, subscription.endpoint, subscription.p256dh, subscription.auth, expiresAt]);
  }

  async deletePushSubscription(scope: UserScope, endpoint: string) {
    const result = await this.pool.query(`delete from t_web_push_subskrypcje where endpoint = $1 and id_uzytkownika = $2 and id_kalendarza = $3`,
      [endpoint, scope.userId, scope.calendarId]);
    return Boolean(result.rowCount);
  }

  async listDue(scope: UserScope, limit = 20): Promise<DueNotification[]> {
    await this.pool.query(`update t_powiadomienia n set status = 'Anulowane', lease_until = null
      where n.id_uzytkownika = $1 and n.status in ('Zaplanowane', 'Dostarczanie')
        and exists (select 1 from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
          where e.id_wydarzenia = n.id_wydarzenia and e.id_kalendarza = $2 and c.id_uzytkownika = $1 and c.aktywny
            and e.status = 'Aktywne' and e.rozpoczecie <= now())`, [scope.userId, scope.calendarId]);
    const result = await this.pool.query(`with due as (
        select n.id_powiadomienia, n.id_wydarzenia, n.typ, n.tresc, n.planowana_data,
          to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as event_start,
          to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as event_end, e.tytul
        from t_powiadomienia n join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
        join t_kalendarze c on c.id_kalendarza = e.id_kalendarza join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
        where n.id_uzytkownika = $1 and c.id_kalendarza = $2 and c.id_uzytkownika = $1 and c.aktywny
          and e.status = 'Aktywne' and e.rozpoczecie > now() and n.planowana_data <= now()
          and (n.status = 'Zaplanowane' or (n.status = 'Dostarczanie' and n.lease_until <= now()))
        order by n.planowana_data asc limit $3 for update of n skip locked
      ) update t_powiadomienia n set status = 'Dostarczanie', data_wyslania = now(), lease_until = now() + interval '2 minutes'
        from due where n.id_powiadomienia = due.id_powiadomienia returning due.*`,
    [scope.userId, scope.calendarId, Math.min(Math.max(limit, 1), 100)]);
    return result.rows.map((row) => ({ id: row.id_powiadomienia, eventId: row.id_wydarzenia, type: row.typ, message: row.tresc,
      scheduledAt: new Date(row.planowana_data).toISOString(), eventStart: row.event_start, eventEnd: row.event_end, title: row.tytul }));
  }

  async acknowledge(scope: UserScope, notificationId: string): Promise<boolean> {
    const result = await this.pool.query(`update t_powiadomienia n set status = 'Wysłane', data_wyslania = now(), lease_until = null
      where n.id_powiadomienia = $1 and n.id_uzytkownika = $2 and n.status = 'Dostarczanie' and n.planowana_data <= now()
        and exists (select 1 from t_wydarzenia e join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
          where e.id_wydarzenia = n.id_wydarzenia and c.id_kalendarza = $3 and c.id_uzytkownika = $2 and c.aktywny and e.status = 'Aktywne')`,
    [notificationId, scope.userId, scope.calendarId]);
    return Boolean(result.rowCount);
  }
}
