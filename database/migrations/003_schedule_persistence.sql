-- Jira S23KC2S1P2-203: persist weekly scheduler metrics, version and input snapshot.
alter table t_grafiki
  add column if not exists min_godzin numeric(6,2) not null default 0 check (min_godzin >= 0),
  add column if not exists max_godzin numeric(6,2) not null default 0 check (max_godzin >= 0),
  add column if not exists target_minutes integer not null default 0 check (target_minutes >= 0),
  add column if not exists existing_work_minutes integer not null default 0 check (existing_work_minutes >= 0),
  add column if not exists proposed_minutes integer not null default 0 check (proposed_minutes >= 0),
  add column if not exists total_minutes integer not null default 0 check (total_minutes >= 0),
  add column if not exists shortfall_minutes integer not null default 0 check (shortfall_minutes >= 0),
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists generator_version text not null default 'greedy-v1',
  add column if not exists input_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists tryb_pracy text not null default 'elastyczny';

alter table t_ograniczenia_grafiku
  add column if not exists kod text not null default 'other',
  add column if not exists szczegoly jsonb not null default '{}'::jsonb;

alter table t_zmiany_pracy
  add column if not exists candidate_id text,
  add column if not exists template_id text,
  add column if not exists optional_lecture_ids text[] not null default '{}',
  add column if not exists soft_penalty integer not null default 0 check (soft_penalty >= 0);

create index if not exists idx_t_grafiki_profile_week_version
  on t_grafiki(id_profilu, tydzien_od, version desc);

comment on column t_grafiki.target_minutes is 'Jira 203: selected weekly work target in whole minutes.';
comment on column t_grafiki.input_snapshot is 'Inputs used to reproduce the generated proposal; no provider tokens or secrets.';
comment on column t_ograniczenia_grafiku.szczegoly is 'Structured, explainable constraint details.';
