-- Azure AI Foundry chat/action history is owned by the application and never stores original file bytes.
create table if not exists t_ai_rozmowy (
  id_rozmowy text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  model_deployment text not null,
  title text not null default 'Nowa rozmowa',
  status text not null default 'active' check (status in ('active', 'closed', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_t_ai_rozmowy_owner_updated
  on t_ai_rozmowy(id_uzytkownika, updated_at desc);
create index if not exists idx_t_ai_rozmowy_expiry
  on t_ai_rozmowy(expires_at) where status = 'active';

create table if not exists t_ai_wiadomosci (
  id_wiadomosci text primary key default gen_random_uuid()::text,
  id_rozmowy text not null references t_ai_rozmowy(id_rozmowy) on delete cascade,
  rola text not null check (rola in ('user', 'assistant', 'tool')),
  tresc jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_t_ai_wiadomosci_conversation_created
  on t_ai_wiadomosci(id_rozmowy, created_at, id_wiadomosci);

create table if not exists t_ai_akcje (
  id_akcji text primary key default gen_random_uuid()::text,
  id_rozmowy text not null references t_ai_rozmowy(id_rozmowy) on delete cascade,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  typ text not null check (typ in ('calendar_event_create', 'calendar_event_update', 'calendar_event_delete')),
  argumenty jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'confirmed', 'cancelled', 'expired', 'failed')),
  id_zdarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  blad_kod text
);
create index if not exists idx_t_ai_akcje_owner_status
  on t_ai_akcje(id_uzytkownika, status, expires_at);

create table if not exists t_ai_uzycie (
  id_zdarzenia text primary key default gen_random_uuid()::text,
  id_uzytkownika text references t_uzytkownicy(id_uzytkownika) on delete set null,
  operacja text not null,
  model text not null,
  tokeny_we integer not null default 0 check (tokeny_we >= 0),
  tokeny_wy integer not null default 0 check (tokeny_wy >= 0),
  czas_ms integer not null default 0 check (czas_ms >= 0),
  status text not null check (status in ('ok', 'error')),
  kod_bledu text,
  created_at timestamptz not null default now()
);
create index if not exists idx_t_ai_uzycie_created on t_ai_uzycie(created_at desc);

alter table t_wydarzenia
  add column if not exists id_ai_akcji text unique references t_ai_akcje(id_akcji) on delete set null;

alter table t_pozycje_importu
  add column if not exists source_page integer check (source_page is null or source_page > 0),
  add column if not exists source_snippet text,
  add column if not exists unresolved_fields jsonb not null default '[]'::jsonb;

comment on table t_ai_rozmowy is 'Application-owned conversation index; message history retention is enforced by app policy.';
comment on table t_ai_wiadomosci is 'Redacted chat/tool messages; original input file bytes are never persisted here.';
comment on table t_ai_akcje is 'Validated assistant proposals awaiting explicit user confirmation.';
comment on table t_ai_uzycie is 'Usage metrics without prompts, completions, tokens or document contents.';
comment on column t_pozycje_importu.source_snippet is 'Short synthetic-safe excerpt from the source used for review; do not persist a whole document page.';
