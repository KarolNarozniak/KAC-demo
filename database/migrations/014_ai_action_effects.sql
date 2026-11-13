create table if not exists t_ai_action_effects (
  id_akcji text primary key references t_ai_akcje(id_akcji) on delete cascade,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  rezultat jsonb not null,
  created_at timestamptz not null default now()
);

comment on table t_ai_action_effects is 'Idempotent calendar mutation results for confirmed AI update/delete actions.';
