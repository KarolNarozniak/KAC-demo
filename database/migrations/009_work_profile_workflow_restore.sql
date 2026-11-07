-- Master and the work-profile planner share tables but have independent proposal lifecycles.
update t_grafiki set status = input_snapshot->>'workProfileStatus'
where generator_version = 'work-profile-v1' and input_snapshot ? 'workProfileStatus';
