-- Keep event location separate from its description for future event details.
alter table t_wydarzenia add column if not exists miejsce text not null default '';
