-- Symulowana publikacja zaakceptowanego grafiku (S23KC2S1P2-30, podzadanie G07 / S23KC2S1P2-291).
-- t_publikacje dostaje powiązanie per zmiana pracy: właściciel, lokalne ID zmiany i wydarzenia z wersją, konto i kalendarz Google
-- oraz zewnętrzne ID. Publikacja demonstracyjna ma tryb „symulacja” i nigdy nie zapisuje zewnętrznego ID – nic nie udaje,
-- że istnieje w Google. Przyszła publikacja rzeczywista użyje tych samych wierszy z trybem „google”.

alter table t_publikacje
  add column if not exists id_uzytkownika text references t_uzytkownicy(id_uzytkownika) on delete cascade,
  add column if not exists id_konta text references t_konta_google(id_konta) on delete set null,
  add column if not exists id_zmiany text references t_zmiany_pracy(id_zmiany) on delete set null,
  add column if not exists id_wydarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  add column if not exists wersja_wydarzenia integer,
  add column if not exists tryb text not null default 'google',
  add column if not exists zaktualizowano timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_t_publikacje_tryb') then
    alter table t_publikacje add constraint ck_t_publikacje_tryb check (tryb in ('symulacja', 'google'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_publikacje_symulacja_bez_id') then
    alter table t_publikacje add constraint ck_t_publikacje_symulacja_bez_id check (tryb <> 'symulacja' or zewnetrzne_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_publikacje_wersja') then
    alter table t_publikacje add constraint ck_t_publikacje_wersja check (wersja_wydarzenia is null or wersja_wydarzenia > 0);
  end if;
end $$;

-- Jedna pozycja na zmianę i kalendarz: ponowienie aktualizuje wiersz zamiast dublować wydarzenie.
create unique index if not exists uq_t_publikacje_zmiana_kalendarz on t_publikacje(id_zmiany, id_kal_google) where id_zmiany is not null;
create index if not exists idx_t_publikacje_grafik on t_publikacje(id_grafiku);
