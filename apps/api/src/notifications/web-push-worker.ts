import type { Pool } from 'pg';
import { sendNotification } from 'web-push';
import type { PushSubscription, RequestOptions } from 'web-push';

export type WebPushConfig = { enabled: boolean; publicKey: string; privateKey: string; subject: string };
type PushSender = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<unknown>;
type PushDelivery = {
  id_dostawy: string; id_powiadomienia: string; id_subskrypcji: string; endpoint: string; p256dh: string; auth: string;
  expires_at: Date | string | null; attempts: number; event_id: string; event_start: string; event_end: string; title: string; message: string;
};

export class WebPushNotificationWorker {
  constructor(private readonly pool: Pool, private readonly settings: WebPushConfig, private readonly sender: PushSender = sendNotification) {}

  async runOnce(batchSize = 20) {
    if (!this.settings.enabled) return 0;
    await this.pool.query(`update t_powiadomienia_push_dostawy d set status = 'dead', lease_until = null,
        error_code = 'notification_no_longer_active', updated_at = now()
      where d.status in ('pending', 'processing') and not exists (
        select 1 from t_powiadomienia n join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
        join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
        join t_web_push_subskrypcje p on p.id_subskrypcji = d.id_subskrypcji
        join lateral (select wlaczone, przypomnienia_wlaczone from t_ustaw_powiadomien
          where id_uzytkownika = n.id_uzytkownika order by updated_at desc limit 1) s on true
        where n.id_powiadomienia = d.id_powiadomienia and n.status in ('Zaplanowane', 'Dostarczanie')
          and e.status = 'Aktywne' and e.rozpoczecie > now() and c.aktywny and c.id_uzytkownika = n.id_uzytkownika
          and p.id_uzytkownika = n.id_uzytkownika and p.id_kalendarza = c.id_kalendarza and s.wlaczone and s.przypomnienia_wlaczone
          and (p.expires_at is null or p.expires_at > now())
      )`);
    await this.pool.query(`insert into t_powiadomienia_push_dostawy (id_powiadomienia, id_subskrypcji)
      select n.id_powiadomienia, p.id_subskrypcji
      from t_powiadomienia n join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
      join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
      join t_web_push_subskrypcje p on p.id_uzytkownika = n.id_uzytkownika and p.id_kalendarza = c.id_kalendarza
      join lateral (select wlaczone, przypomnienia_wlaczone from t_ustaw_powiadomien
        where id_uzytkownika = n.id_uzytkownika order by updated_at desc limit 1) s on true
      where n.status in ('Zaplanowane', 'Dostarczanie') and n.planowana_data <= now()
        and n.id_uzytkownika = c.id_uzytkownika and c.aktywny and e.status = 'Aktywne' and e.rozpoczecie > now()
        and s.wlaczone and s.przypomnienia_wlaczone and (p.expires_at is null or p.expires_at > now())
      on conflict (id_powiadomienia, id_subskrypcji) do nothing`);

    const claimed = await this.pool.query(`with candidates as (
        select d.id_dostawy from t_powiadomienia_push_dostawy d
        join t_powiadomienia n on n.id_powiadomienia = d.id_powiadomienia
        join t_web_push_subskrypcje p on p.id_subskrypcji = d.id_subskrypcji
        join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
        join t_kalendarze c on c.id_kalendarza = e.id_kalendarza
        join lateral (select wlaczone, przypomnienia_wlaczone from t_ustaw_powiadomien
          where id_uzytkownika = n.id_uzytkownika order by updated_at desc limit 1) s on true
        where d.available_at <= now() and (d.status = 'pending' or (d.status = 'processing' and d.lease_until <= now()))
          and n.status in ('Zaplanowane', 'Dostarczanie') and n.planowana_data <= now()
          and e.status = 'Aktywne' and e.rozpoczecie > now() and c.aktywny and c.id_uzytkownika = n.id_uzytkownika
          and p.id_uzytkownika = n.id_uzytkownika and p.id_kalendarza = c.id_kalendarza
          and s.wlaczone and s.przypomnienia_wlaczone and (p.expires_at is null or p.expires_at > now())
        order by d.available_at limit $1 for update of d skip locked
      ) update t_powiadomienia_push_dostawy d set status = 'processing', attempts = attempts + 1,
          lease_until = now() + interval '2 minutes', updated_at = now()
        from candidates where d.id_dostawy = candidates.id_dostawy
        returning d.id_dostawy, d.id_powiadomienia, d.id_subskrypcji, d.attempts`, [Math.min(Math.max(batchSize, 1), 100)]);

    for (const delivery of claimed.rows) await this.deliver(String(delivery.id_dostawy), String(delivery.id_powiadomienia), String(delivery.id_subskrypcji), Number(delivery.attempts));
    return claimed.rowCount ?? 0;
  }

  private async deliver(deliveryId: string, notificationId: string, subscriptionId: string, attempts: number) {
    const result = await this.pool.query(`select p.endpoint, p.p256dh, p.auth, p.expires_at, n.id_wydarzenia as event_id, n.tresc as message, e.tytul as title,
        to_char(e.rozpoczecie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as event_start,
        to_char(e.zakonczenie at time zone u.strefa_czasowa, 'YYYY-MM-DD"T"HH24:MI') as event_end
      from t_powiadomienia n join t_wydarzenia e on e.id_wydarzenia = n.id_wydarzenia
      join t_kalendarze c on c.id_kalendarza = e.id_kalendarza join t_uzytkownicy u on u.id_uzytkownika = c.id_uzytkownika
      join t_web_push_subskrypcje p on p.id_subskrypcji = $2 and p.id_kalendarza = c.id_kalendarza and p.id_uzytkownika = c.id_uzytkownika
      where n.id_powiadomienia = $1 and n.status in ('Zaplanowane', 'Dostarczanie') and e.status = 'Aktywne'
        and e.rozpoczecie > now() and c.aktywny`, [notificationId, subscriptionId]);
    const row = result.rows[0] as PushDelivery | undefined;
    if (!row) {
      await this.pool.query(`update t_powiadomienia_push_dostawy set status = 'dead', lease_until = null, error_code = 'notification_no_longer_active', updated_at = now()
        where id_dostawy = $1`, [deliveryId]);
      return;
    }
    const payload = JSON.stringify({
      title: row.title, body: row.message, tag: notificationId,
      data: { notificationId, eventId: row.event_id, eventStart: row.event_start, eventEnd: row.event_end, title: row.title, body: row.message },
    });
    try {
      await this.sender({ endpoint: row.endpoint, expirationTime: row.expires_at ? new Date(row.expires_at).getTime() : null,
        keys: { p256dh: row.p256dh, auth: row.auth } }, payload, {
        timeout: 10_000, vapidDetails: { subject: this.settings.subject, publicKey: this.settings.publicKey, privateKey: this.settings.privateKey },
      });
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await client.query(`update t_powiadomienia_push_dostawy set status = 'delivered', lease_until = null, error_code = null, updated_at = now()
          where id_dostawy = $1`, [deliveryId]);
        await client.query(`update t_powiadomienia n set status = 'Wysłane', data_wyslania = now(), lease_until = null
          where n.id_powiadomienia = $1 and n.status in ('Zaplanowane', 'Dostarczanie')
            and exists (select 1 from t_powiadomienia_push_dostawy d where d.id_powiadomienia = n.id_powiadomienia and d.status = 'delivered')
            and not exists (select 1 from t_powiadomienia_push_dostawy d where d.id_powiadomienia = n.id_powiadomienia and d.status in ('pending', 'processing'))`, [notificationId]);
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; }
      finally { client.release(); }
    } catch (error) {
      const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode ?? 0);
      if (statusCode === 404 || statusCode === 410) {
        await this.pool.query(`delete from t_web_push_subskrypcje where id_subskrypcji = $1`, [subscriptionId]);
        return;
      }
      const retry = attempts < 5;
      const delaySeconds = Math.min(3600, 2 ** attempts * 30);
      await this.pool.query(`update t_powiadomienia_push_dostawy set status = $2, lease_until = null, error_code = $3,
          available_at = now() + make_interval(secs => $4::integer), updated_at = now() where id_dostawy = $1`,
      [deliveryId, retry ? 'pending' : 'dead', statusCode ? `http_${statusCode}` : error instanceof Error ? error.name.slice(0, 80) : 'unknown', delaySeconds]);
      console.error('Web Push delivery failed', { deliveryId, errorName: error instanceof Error ? error.name : 'unknown', statusCode: statusCode || undefined });
    }
  }
}
