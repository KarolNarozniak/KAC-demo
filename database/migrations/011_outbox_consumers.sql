-- One durable event fans out to independent notification and Google publication consumers.
create table if not exists t_event_outbox_delivery (
  id_delivery text primary key default gen_random_uuid()::text,
  id_outbox text not null references t_event_outbox(id_outbox) on delete cascade,
  consumer text not null check (consumer in ('notifications', 'google')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'blocked', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  worker_id text,
  error_code text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (id_outbox, consumer)
);
create index if not exists idx_event_outbox_delivery_poll
  on t_event_outbox_delivery(consumer, status, available_at, created_at) where status in ('pending', 'processing');

alter table t_event_outbox drop constraint if exists t_event_outbox_status_check;
alter table t_event_outbox add constraint t_event_outbox_status_check check (status in ('pending', 'processing', 'delivered', 'blocked', 'dead'));
comment on table t_event_outbox_delivery is 'Independent at-least-once delivery state for each outbox consumer.';
