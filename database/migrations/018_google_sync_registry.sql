-- Rejestr prób synchronizacji z Google (S23KC2S1P2-17, podzadanie G06 / S23KC2S1P2-290).
-- t_synchronizacje z modelu informacyjnego dostaje zakres, liczbę prób, kod błędu i czas zakończenia.
-- Ostatni sukces odczytu i publikacji jest zapisany osobno w koncie, więc nieudana próba go nie nadpisuje.

alter table t_synchronizacje
  add column if not exists zakres text,
  add column if not exists proby integer not null default 1,
  add column if not exists kod_bledu text,
  add column if not exists zakonczono_at timestamptz,
  add column if not exists generacja integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_t_synchronizacje_kierunek') then
    alter table t_synchronizacje add constraint ck_t_synchronizacje_kierunek check (kierunek in ('Odczyt', 'Publikacja'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_synchronizacje_status') then
    alter table t_synchronizacje add constraint ck_t_synchronizacje_status check (status in ('W trakcie', 'Sukces', 'Częściowo', 'Błąd'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_synchronizacje_proby') then
    alter table t_synchronizacje add constraint ck_t_synchronizacje_proby check (proby > 0);
  end if;
end $$;

-- Najwyżej jedna trwająca próba danego kierunku na konto – drugie kliknięcie „Synchronizuj” nie uruchamia równoległej.
create unique index if not exists uq_t_synchronizacje_w_trakcie on t_synchronizacje(id_konta, kierunek) where status = 'W trakcie';
create index if not exists idx_t_synchronizacje_konto_data on t_synchronizacje(id_konta, data_proby desc);

-- Ostatnia udana publikacja (G07/G09); ostatni udany odczyt to istniejąca kolumna ostatnia_sync.
alter table t_konta_google add column if not exists ostatnia_publikacja timestamptz;
