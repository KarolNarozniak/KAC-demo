-- Product Owner input: flexible slots or user-configured shift templates.
alter table t_profile_pracy
  add column if not exists tryb_pracy text not null default 'elastyczny',
  add column if not exists min_slot_min integer not null default 120,
  add column if not exists max_slot_min integer not null default 360;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 't_profile_pracy_work_mode_check') then
    alter table t_profile_pracy add constraint t_profile_pracy_work_mode_check check (tryb_pracy in ('elastyczny', 'zmianowy'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 't_profile_pracy_slot_bounds_check') then
    alter table t_profile_pracy add constraint t_profile_pracy_slot_bounds_check check (min_slot_min >= 120 and max_slot_min >= min_slot_min);
  end if;
end $$;

create table if not exists t_szablony_zmian (
  id_szablonu text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  nazwa text not null,
  godzina_od time not null,
  godzina_do time not null,
  koniec_nastepnego_dnia boolean not null default false,
  dni_tygodnia smallint[] not null default array[1,2,3,4,5]::smallint[],
  aktywna boolean not null default true,
  created_at timestamptz not null default now(),
  check ((koniec_nastepnego_dnia and godzina_do < godzina_od) or (not koniec_nastepnego_dnia and godzina_do > godzina_od)),
  check (cardinality(dni_tygodnia) between 1 and 7),
  check (dni_tygodnia <@ array[1,2,3,4,5,6,7]::smallint[])
);
comment on table t_szablony_zmian is 'KAC extension: available fixed-shift templates. The planner chooses how many instances to assign.';
create index if not exists idx_t_szablony_zmian_profile_active on t_szablony_zmian(id_profilu, aktywna);
comment on column t_profile_pracy.tryb_pracy is 'elastyczny or zmianowy';
comment on column t_profile_pracy.max_slot_min is 'Flexible-mode slot cap; default 360 minutes.';
