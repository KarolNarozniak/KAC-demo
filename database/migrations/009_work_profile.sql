-- Profil pracy (S23KC2S1P2-15) i cel godzin (S23KC2S1P2-39).

-- S23KC2S1P2-39: cel godzin można podać na tydzień albo na miesiąc.
-- cel_godzin_tydzien zawsze zawiera cel tygodniowy, z którego korzysta generator grafiku.
-- Przy celu miesięcznym cel_godzin_miesiac przechowuje wartość wpisaną przez użytkownika,
-- a cel_godzin_tydzien jej odpowiednik tygodniowy (miesiąc = 52/12 tygodnia).
alter table t_profile_pracy add column if not exists okres_celu text not null default 'Tydzien';
alter table t_profile_pracy add column if not exists cel_godzin_miesiac numeric(6,2);
alter table t_profile_pracy drop constraint if exists ck_t_profile_pracy_okres_celu;
alter table t_profile_pracy add constraint ck_t_profile_pracy_okres_celu check (
  (okres_celu = 'Tydzien' and cel_godzin_miesiac is null)
  or (okres_celu = 'Miesiac' and cel_godzin_miesiac is not null and cel_godzin_miesiac > 0)
);
comment on column t_profile_pracy.okres_celu is 'Okres celu godzin: Tydzien albo Miesiac (S23KC2S1P2-39).';
comment on column t_profile_pracy.cel_godzin_miesiac is 'Cel miesięczny wpisany przez użytkownika; cel_godzin_tydzien zawiera wtedy odpowiednik tygodniowy.';

-- S23KC2S1P2-186: użytkownik ma najwyżej jeden aktywny profil pracy.
-- Gdyby w bazie deweloperskiej zostały duplikaty (np. po testach), aktywny zostaje najstarszy profil –
-- zwykle ten z danych demonstracyjnych.
update t_profile_pracy p set aktywny = false
where p.aktywny and exists (
  select 1 from t_profile_pracy q
  where q.id_uzytkownika = p.id_uzytkownika and q.aktywny
    and (q.created_at, q.id_profilu) < (p.created_at, p.id_profilu)
);
create unique index if not exists uq_t_profile_pracy_active_user on t_profile_pracy(id_uzytkownika) where aktywny;
