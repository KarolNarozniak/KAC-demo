import type { PoolClient } from 'pg';
import type { UserScope } from '../api/scope.js';

export type AggregateType = 'calendar_event' | 'schedule';

export async function enqueueDomainEvent(client: PoolClient, scope: UserScope, aggregateType: AggregateType,
  aggregateId: string, eventType: string, payload: Record<string, unknown>) {
  const versionResult = await client.query(`select coalesce(max(wersja_agregatu), 0)::integer + 1 as next_version
    from t_event_outbox where typ_agregatu = $1 and id_agregatu = $2`, [aggregateType, aggregateId]);
  const version = Number(versionResult.rows[0].next_version);
  const idempotencyKey = `${aggregateType}:${aggregateId}:${version}`;
  const inserted = await client.query(`insert into t_event_outbox
    (id_uzytkownika, typ_agregatu, id_agregatu, typ_zdarzenia, wersja_agregatu, klucz_idempotencji, payload)
    values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id_outbox`,
  [scope.userId, aggregateType, aggregateId, eventType, version, idempotencyKey, JSON.stringify(payload)]);
  const outboxId = inserted.rows[0].id_outbox;
  for (const consumer of ['notifications', 'google']) await client.query(`insert into t_event_outbox_delivery (id_outbox, consumer)
    values ($1, $2) on conflict (id_outbox, consumer) do nothing`, [outboxId, consumer]);
}
