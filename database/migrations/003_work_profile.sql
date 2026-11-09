alter table t_profile_pracy add column version integer not null default 1;
alter table t_profile_pracy add column rodzaj_stawki text check (rodzaj_stawki in ('gross','net'));
alter table t_profile_pracy alter column czas_dojazdu_min drop not null;
alter table t_profile_pracy alter column czas_dojazdu_min drop default;
-- Existing explicit zeroes remain valid; new profiles must configure commute.
alter table t_zmiany_pracy add column rodzaj_stawki text check (rodzaj_stawki in ('gross','net'));
create unique index uq_active_work_profile on t_profile_pracy(id_uzytkownika) where aktywny=true;
insert into t_profile_pracy(id_uzytkownika)
select u.id_uzytkownika from t_uzytkownicy u
where not exists (select 1 from t_profile_pracy p where p.id_uzytkownika=u.id_uzytkownika and p.aktywny=true);
