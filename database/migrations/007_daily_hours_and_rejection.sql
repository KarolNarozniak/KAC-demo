alter table t_profile_pracy
  add column if not exists max_godzin_dzien numeric(4,2) not null default 8
    check (max_godzin_dzien > 0 and max_godzin_dzien <= 24);

alter table t_grafiki
  add column if not exists rejected_at timestamptz;

create index if not exists idx_t_grafiki_calendar_week_pending
  on t_grafiki(id_kalendarza, tydzien_od, version desc) where rejected_at is null;

comment on column t_profile_pracy.max_godzin_dzien is 'Maximum working hours scheduled within one local calendar day.';
comment on column t_grafiki.rejected_at is 'Timestamp when a pending proposal was rejected and removed from active schedule results.';
