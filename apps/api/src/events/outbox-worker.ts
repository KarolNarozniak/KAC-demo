import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { parseEventTime, reminderText, reminderTime } from '../notifications/schedule.js';

type OutboxDelivery = {
  id_delivery: string; id_outbox: string; consumer: 'notifications' | 'google'; attempts: number;
  id_uzytkownika: string; typ_agregatu: string; id_agregatu: string; typ_zdarzenia: string;
  wersja_agregatu: number; payload: Record<string, unknown>;
};
type EventDetails = { title?: string; start?: string; end?: string; category?: string; location?: string };

export class PostgresEventOutboxWorker {
  private readonly workerId = `worker-${randomUUID()}`;

  constructor(private readonly pool: Pool, private readonly batchSize = 20, private readonly maxAttempts = 8) {}

  async runOnce(outboxId?: string): Promise<number> {
    const batch = await this.claim(outboxId);
    for (const item of batch) await this.process(item);
    return batch.length;
  }

  private async claim(outboxId?: string): Promise<OutboxDelivery[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const claimed = await client.query(`with picked as (
          select d.id_delivery from t_event_outbox_delivery d join t_event_outbox o on o.id_outbox = d.id_outbox
          where d.available_at <= now() and d.attempts < $1 and o.status <> 'dead' and ($4::text is null or d.id_outbox = $4)
            and (d.status = 'pending' or (d.status = 'processing' and d.lease_until < now()))
          order by d.created_at asc limit $2 for update of d skip locked
        ) update t_event_outbox_delivery d set status = 'processing', attempts = d.attempts + 1,
          worker_id = $3, lease_until = now() + interval '2 minutes'
        from picked, t_event_outbox o where d.id_delivery = picked.id_delivery and o.id_outbox = d.id_outbox
        returning d.id_delivery, d.id_outbox, d.consumer, d.attempts, o.id_uzytkownika, o.typ_agregatu,
          o.id_agregatu, o.typ_zdarzenia, o.wersja_agregatu, o.payload`, [this.maxAttempts, this.batchSize, this.workerId, outboxId ?? null]);
      await client.query('commit');
      return claimed.rows as OutboxDelivery[];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  private async process(item: OutboxDelivery) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const ownership = await client.query(`select id_delivery from t_event_outbox_delivery
        where id_delivery = $1 and status = 'processing' and worker_id = $2 for update`, [item.id_delivery, this.workerId]);
      if (!ownership.rowCount) {
        await client.query('rollback');
        console.warn('Outbox delivery lease was lost before processing', { deliveryId: item.id_delivery, workerId: this.workerId });
        return;
      }
      if (item.consumer === 'google') {
        // The current Google OAuth connection is read-only. Keep this independent delivery visible and blocked until write scope is configured.
        await client.query(`update t_event_outbox_delivery set status = 'blocked', error_code = 'google_calendar_write_scope_required',
          lease_until = null, worker_id = null where id_delivery = $1`, [item.id_delivery]);
      } else if (item.consumer === 'notifications' && item.typ_agregatu === 'calendar_event') {
        await this.processCalendarEvent(client, item);
        await client.query(`update t_event_outbox_delivery set status = 'delivered', delivered_at = now(), lease_until = null, worker_id = null
          where id_delivery = $1`, [item.id_delivery]);
      } else {
        await client.query(`update t_event_outbox_delivery set status = 'dead', error_code = 'unsupported_outbox_event',
          lease_until = null, worker_id = null where id_delivery = $1`, [item.id_delivery]);
      }
      await this.refreshOutboxStatus(client, item.id_outbox);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      console.error('Outbox delivery failed', { deliveryId: item.id_delivery, consumer: item.consumer,
        errorName: error instanceof Error ? error.name : 'unknown', errorCode: (error as { code?: string } | null)?.code ?? 'unknown' });
      const retry = item.attempts < this.maxAttempts;
      const seconds = Math.min(3600, 2 ** Math.min(item.attempts, 10) * 5);
      await this.pool.query(`update t_event_outbox_delivery set status = $3, lease_until = null, worker_id = null,
          available_at = now() + make_interval(secs => $4::integer), error_code = $5
        where id_delivery = $1 and worker_id = $2`, [item.id_delivery, this.workerId, retry ? 'pending' : 'dead', seconds,
        error instanceof Error ? error.name.slice(0, 80) : 'unknown']);
      await this.refreshOutboxStatus(this.pool, item.id_outbox);
    } finally { client.release(); }
  }

  private async refreshOutboxStatus(connection: Pick<Pool, 'query'>, outboxId: string) {
    await connection.query(`update t_event_outbox o set status = case
        when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('pending', 'processing')) then 'pending'
        when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('blocked', 'dead')) then 'blocked'
        else 'delivered' end,
        delivered_at = case when not exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('pending', 'processing')) then coalesce(o.delivered_at, now()) else null end
      where o.id_outbox = $1`, [outboxId]);
  }

  private async processCalendarEvent(client: PoolClient, item: OutboxDelivery) {
    const payload = item.payload ?? {};
    const after = payload.after as EventDetails | undefined;
    const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone : 'Europe/Warsaw';
    await client.query(`update t_powiadomienia set status = 'Anulowane', lease_until = null
      where event_ref = $1 and status in ('Zaplanowane', 'Dostarczanie')`, [item.id_agregatu]);
    if (item.typ_zdarzenia === 'calendar_event.deleted' || !after || after.category !== 'Work' || !after.start || !after.end) return;

    const settings = await client.query(`select min_przed, cisza_od::text as cisza_od, cisza_do::text as cisza_do
      from t_ustaw_powiadomien where id_uzytkownika = $1 and wlaczone and przypomnienia_wlaczone
      order by updated_at desc limit 1`, [item.id_uzytkownika]);
    if (!settings.rowCount) return;
    const start = parseEventTime(after.start, timeZone);
    const end = parseEventTime(after.end, timeZone);
    const now = new Date();
    const sendAt = reminderTime(start, Number(settings.rows[0].min_przed), timeZone, now,
      settings.rows[0].cisza_od, settings.rows[0].cisza_do);
    if (!sendAt) return;
    const eventTitle = String(after.title ?? 'Zmiana pracy').slice(0, 180);
    const idempotencyKey = `work-reminder:${item.id_agregatu}:${item.wersja_agregatu}:${sendAt.toISOString()}`;
    await client.query(`insert into t_powiadomienia
      (id_uzytkownika, id_wydarzenia, typ, tresc, planowana_data, status, idempotency_key, event_ref)
      values ($1, $2, 'Przypomnienie pracy', $3, $4, 'Zaplanowane', $5, $6)
      on conflict (idempotency_key) where idempotency_key is not null do nothing`,
     [item.id_uzytkownika, item.id_agregatu, reminderText(eventTitle, start, end, timeZone), sendAt.toISOString(), idempotencyKey, item.id_agregatu]);
  }
}
