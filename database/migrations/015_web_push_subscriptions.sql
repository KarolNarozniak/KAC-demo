create table if not exists t_web_push_subskrypcje (
  id_subskrypcji text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_t_web_push_scope on t_web_push_subskrypcje(id_uzytkownika, id_kalendarza);

create table if not exists t_powiadomienia_push_dostawy (
  id_dostawy text primary key default gen_random_uuid()::text,
  id_powiadomienia text not null references t_powiadomienia(id_powiadomienia) on delete cascade,
  id_subskrypcji text not null references t_web_push_subskrypcje(id_subskrypcji) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_powiadomienia, id_subskrypcji)
);

create index if not exists idx_t_push_delivery_claim on t_powiadomienia_push_dostawy(status, available_at, lease_until)
  where status in ('pending', 'processing');
