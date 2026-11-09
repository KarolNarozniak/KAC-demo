-- Blocks are schema-managed; reading a calendar must never run DDL.
create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  title varchar(255) not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  type varchar(50) not null check (type in ('vacation','exam_session','day_off')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists idx_blocks_owner_time on blocks(user_id,start_time,end_time);
