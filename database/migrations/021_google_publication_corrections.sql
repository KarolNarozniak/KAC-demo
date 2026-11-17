-- Korekta i usunięcie opublikowanej zmiany pracy (S23KC2S1P2-47, podzadanie G09 / S23KC2S1P2-292).
-- Pozycja publikacji jest też „nagrobkiem” po usunięciu wydarzenia: id_wydarzenia (FK) jest zerowane, ale ref_wydarzenia,
-- kalendarz Google, zewnętrzne ID, migawka danych i stan próby zostają, więc usunięcie można ponowić także po restarcie.
-- Stany: Opublikowano, Oczekuje (lokalna zmiana czeka na synchronizację), Błąd, Brak w Google, Do usunięcia, Usunięto.

alter table t_publikacje
  add column if not exists ref_wydarzenia text,
  add column if not exists migawka jsonb,
  add column if not exists kod_bledu text,
  add column if not exists proby integer not null default 0,
  add column if not exists ostatnia_proba timestamptz;

update t_publikacje set ref_wydarzenia = id_wydarzenia where ref_wydarzenia is null and id_wydarzenia is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_t_publikacje_proby') then
    alter table t_publikacje add constraint ck_t_publikacje_proby check (proby >= 0);
  end if;
end $$;

create index if not exists idx_t_publikacje_ref_wydarzenia on t_publikacje(ref_wydarzenia) where ref_wydarzenia is not null;
create index if not exists idx_t_publikacje_rozbieznosci on t_publikacje(id_uzytkownika, status)
  where status in ('Oczekuje', 'Błąd', 'Brak w Google', 'Do usunięcia');

-- Makieta: wymuszony wynik następnej synchronizacji korekty (zużywany przez jedną próbę). Tylko demonstracja przebiegów błędów.
alter table t_konta_google add column if not exists symulacja_publikacji text;
