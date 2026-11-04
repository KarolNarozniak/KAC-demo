-- Keep the weekly target hours inside [min_godzin_tydzien, max_godzin_tydzien] when those bounds are set.
-- Nulls stay allowed everywhere (optional fields), and the existing max_godzin_tydzien > 0 check
-- from 001_initial_model.sql is untouched.

-- Detect rows that would violate the new rule before adding it. Report and abort — do not delete anything.
do $$
declare
  inconsistent_count integer;
  inconsistent_ids text;
begin
  select count(*), string_agg(id_profilu, ', ')
    into inconsistent_count, inconsistent_ids
    from t_profile_pracy
    where cel_godzin_tydzien is not null
      and (
        (min_godzin_tydzien is not null and cel_godzin_tydzien < min_godzin_tydzien)
        or (max_godzin_tydzien is not null and cel_godzin_tydzien > max_godzin_tydzien)
      );
  if inconsistent_count > 0 then
    raise exception
      'Migration 003 aborted: % t_profile_pracy row(s) have cel_godzin_tydzien outside [min_godzin_tydzien, max_godzin_tydzien]: %. Fix these records manually (no automatic deletion), then rerun the migration.',
      inconsistent_count, inconsistent_ids;
  end if;
end $$;

alter table t_profile_pracy
  add constraint chk_t_profile_pracy_cel_w_zakresie
  check (
    cel_godzin_tydzien is null
    or (
      (min_godzin_tydzien is null or cel_godzin_tydzien >= min_godzin_tydzien)
      and (max_godzin_tydzien is null or cel_godzin_tydzien <= max_godzin_tydzien)
    )
  );