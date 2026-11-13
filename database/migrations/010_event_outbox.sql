-- Transactional outbox for reminders and Google publication workers (Sprint 3 W02).
create table if not exists t_event_outbox (
  id_outbox text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  typ_agregatu text not null check (typ_agregatu in ('calendar_event', 'schedule')),
  id_agregatu text not null,
  typ_zdarzenia text not null,
  wersja_agregatu integer not null default 1 check (wersja_agregatu > 0),
  klucz_idempotencji text not null unique,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'blocked', 'dead')),
  proby integer not null default 0 check (proby >= 0),
  dostepne_od timestamptz not null default now(),
  zablokowane_do timestamptz,
  worker_id text,
  blad_kod text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_event_outbox_aggregate_version') then
    alter table t_event_outbox add constraint uq_event_outbox_aggregate_version
      unique (typ_agregatu, id_agregatu, wersja_agregatu);
  end if;
end $$;

alter table t_wydarzenia add column if not exists event_version integer not null default 1 check (event_version > 0);
alter table t_powiadomienia
  add column if not exists idempotency_key text,
  add column if not exists event_ref text;
create unique index if not exists uq_t_powiadomienia_idempotency
  on t_powiadomienia(idempotency_key) where idempotency_key is not null;
create index if not exists idx_t_powiadomienia_event_ref on t_powiadomienia(event_ref, status);

create index if not exists idx_t_event_outbox_poll
  on t_event_outbox(status, dostepne_od, created_at) where status in ('pending', 'processing');
create index if not exists idx_t_event_outbox_aggregate
  on t_event_outbox(typ_agregatu, id_agregatu, wersja_agregatu);
comment on table t_event_outbox is 'At-least-once event publication queue; consumers must be idempotent.';
