import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { deferForQuietHours, parseEventTime, reminderText, reminderTime } from '../notifications/schedule.js';
import { GoogleCorrectionSync } from '../integrations/google/corrections.js';
import { detectPlanChange, mergePendingBefore, PLAN_CHANGE_TYPE, planChangeIdempotencyKey, type PlanChangeState } from '../notifications/plan-changes.js';

type OutboxDelivery = {
  id_delivery: string; id_outbox: string; consumer: 'notifications' | 'google'; attempts: number;
  id_uzytkownika: string; typ_agregatu: string; id_agregatu: string; typ_zdarzenia: string;
  wersja_agregatu: number; payload: Record<string, unknown>;
};
type EventDetails = { title?: string; start?: string; end?: string; category?: string; location?: string };

export class PostgresEventOutboxWorker {
  private readonly workerId = `worker-${randomUUID()}`;

  constructor(private readonly pool: Pool, private readonly batchSize = 20, private readonly maxAttempts = 8,
    private readonly google = new GoogleCorrectionSync()) {}

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
      if (item.consumer === 'google' && item.typ_agregatu === 'calendar_event') {
        // G09: korekta opublikowanej zmiany (prawdziwa dla kont Google, symulacja dla demonstracyjnych). Wysyłany jest najnowszy stan wydarzenia.
        // Wydarzenie, którego nie publikowano, nie wymaga niczego w Google.
        const outcome = await this.google.process(client, { userId: item.id_uzytkownika, eventId: item.id_agregatu });
        if (outcome.status !== 'error') {
          await client.query(`update t_event_outbox_delivery set status = 'delivered', delivered_at = now(), error_code = null,
            lease_until = null, worker_id = null where id_delivery = $1`, [item.id_delivery]);
        } else {
          // Błąd przejściowy: automatyczne ponowienie z rosnącą przerwą. Inne błędy czekają na „Ponów synchronizację”.
          const retry = outcome.transient && item.attempts < this.maxAttempts;
          await client.query(`update t_event_outbox_delivery set status = $2, error_code = $3, lease_until = null, worker_id = null,
              available_at = now() + make_interval(secs => $4::integer) where id_delivery = $1`,
          [item.id_delivery, retry ? 'pending' : 'dead', outcome.errorCode, Math.min(3600, 2 ** Math.min(item.attempts, 10) * 5)]);
        }
      } else if (item.consumer === 'google') {
        // Pozostałe zdarzenia (np. agregat schedule) nie mają jeszcze odpowiednika w Google – zostają widoczne jako zablokowane.
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
    // Blokada wiersza zdarzenia: dwa workery kończące różne dostawy tego samego zdarzenia liczą stan po kolei,
    // inaczej każdy widzi drugą dostawę jako trwającą i zdarzenie zostaje „pending” (niestabilny test outboxa).
    await connection.query('select 1 from t_event_outbox where id_outbox = $1 for update', [outboxId]);
    await connection.query(`update t_event_outbox o set status = case
        when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('pending', 'processing')) then 'pending'
        when exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('blocked', 'dead')) then 'blocked'
        else 'delivered' end,
        delivered_at = case when not exists (select 1 from t_event_outbox_delivery d where d.id_outbox = o.id_outbox and d.status in ('pending', 'processing')) then coalesce(o.delivered_at, now()) else null end
      where o.id_outbox = $1`, [outboxId]);
  }

  /** S23KC2S1P2-299 (N07): powiadomienie o realnej zmianie daty, godziny albo miejsca – z poszanowaniem godzin ciszy. */
  private async schedulePlanChange(client: PoolClient, item: OutboxDelivery, pendingBefore: PlanChangeState | null) {
    const settings = await client.query(`select cisza_od::text as cisza_od, cisza_do::text as cisza_do
      from t_ustaw_powiadomien where id_uzytkownika = $1 and wlaczone and zmiany_wlaczone
      order by updated_at desc limit 1`, [item.id_uzytkownika]);
    if (!settings.rowCount) return;
    const now = new Date();
    const change = detectPlanChange(item.typ_zdarzenia, mergePendingBefore(item.payload ?? {}, pendingBefore), now);
    if (!change) return;
    const timeZone = typeof item.payload?.timeZone === 'string' ? item.payload.timeZone : 'Europe/Warsaw';
    const sendAt = deferForQuietHours(now, change.eventStart, timeZone, now, settings.rows[0].cisza_od, settings.rows[0].cisza_do);
    const details = change.kind === 'changed'
      ? { kind: change.kind, fields: change.fields, before: change.before, after: change.after, eventVersion: item.wersja_agregatu }
      : { kind: change.kind, fields: [], before: null, after: change.after, eventVersion: item.wersja_agregatu };
    await client.query(`insert into t_powiadomienia
      (id_uzytkownika, id_wydarzenia, typ, tresc, planowana_data, status, idempotency_key, event_ref, szczegoly)
      values ($1, $2, $3, $4, $5, 'Zaplanowane', $6, $2, $7::jsonb)
      on conflict (idempotency_key) where idempotency_key is not null do nothing`,
    [item.id_uzytkownika, item.id_agregatu, PLAN_CHANGE_TYPE, change.message.slice(0, 1000), sendAt.toISOString(),
      planChangeIdempotencyKey(item.id_agregatu, item.wersja_agregatu), JSON.stringify(details)]);
  }

  private async processCalendarEvent(client: PoolClient, item: OutboxDelivery) {
    const payload = item.payload ?? {};
    const after = payload.after as EventDetails | undefined;
    const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone : 'Europe/Warsaw';
    // N07: niedostarczone powiadomienie o wcześniejszej zmianie zostaje zastąpione jednym z pełną różnicą (od najstarszego stanu).
    // Ponowna dostawa tej samej wersji (at-least-once) nie może anulować powiadomień, które ta wersja już utworzyła –
    // insert z tym samym kluczem idempotencji nic by nie dodał i powiadomienie by zniknęło.
    const currentVersionKeys = [planChangeIdempotencyKey(item.id_agregatu, item.wersja_agregatu), `work-reminder:${item.id_agregatu}:${item.wersja_agregatu}:%`];
    const pendingChange = await client.query(`select szczegoly from t_powiadomienia
      where event_ref = $1 and typ = $2 and status = 'Zaplanowane' and coalesce(idempotency_key, '') <> $3
      order by planowana_data asc limit 1`, [item.id_agregatu, PLAN_CHANGE_TYPE, currentVersionKeys[0]]);
    const pendingDetails = pendingChange.rows[0]?.szczegoly as { kind?: string; before?: PlanChangeState } | undefined;
    await client.query(`update t_powiadomienia set status = 'Anulowane', lease_until = null
      where event_ref = $1 and status in ('Zaplanowane', 'Dostarczanie')
        and coalesce(idempotency_key, '') <> $2 and coalesce(idempotency_key, '') not like $3`, [item.id_agregatu, ...currentVersionKeys]);
    if (item.typ_zdarzenia === 'calendar_event.updated') {
      const pendingBefore = pendingDetails?.kind === 'changed' && pendingDetails.before ? pendingDetails.before : null;
      await this.schedulePlanChange(client, item, pendingBefore);
    }
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
