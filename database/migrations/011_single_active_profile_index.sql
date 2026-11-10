-- Keep master's canonical uniqueness index; remove the duplicate introduced on the integration branch.
create unique index if not exists uq_t_profile_pracy_active_user
  on t_profile_pracy(id_uzytkownika) where aktywny;
drop index if exists uq_active_work_profile;
