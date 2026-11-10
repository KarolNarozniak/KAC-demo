-- Preserve the independent work-profile planner before 008 normalizes master workflows.
update t_grafiki set input_snapshot = jsonb_build_object('workProfileStatus', status),
  generator_version = 'work-profile-v1'
where czas_dojazdu_min is not null and input_snapshot = '{}'::jsonb;
