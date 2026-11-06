-- Approved proposals are materialized as regular work events in the user's calendar.
alter table t_grafiki
  add column if not exists approved_at timestamptz;

create index if not exists idx_t_grafiki_calendar_week_approved
  on t_grafiki(id_kalendarza, tydzien_od, approved_at);

comment on column t_grafiki.approved_at is 'Timestamp when proposal shifts were published into the calendar.';
