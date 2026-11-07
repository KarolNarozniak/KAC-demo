-- Jira S23KC2S1P2-204: distinguish target success from proven or heuristic failure.
alter table t_grafiki
  add column if not exists solution_status text not null default 'not_found';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 't_grafiki_solution_status_check') then
    alter table t_grafiki add constraint t_grafiki_solution_status_check
      check (solution_status in ('target_met', 'proven_infeasible', 'not_found'));
  end if;
end $$;

create index if not exists idx_t_grafiki_solution_status on t_grafiki(solution_status);

comment on column t_grafiki.solution_status is
  'proven_infeasible only when an upper bound proves the target cannot be reached; greedy failure alone is not proof.';
