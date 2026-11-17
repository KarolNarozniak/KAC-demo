-- Trwały wybór kalendarzy Google (S23KC2S1P2-41, podzadanie G04 / S23KC2S1P2-288).
-- Zbiór kalendarzy źródłowych do planowania to istniejąca kolumna t_kalendarze_google.wybrany (model informacyjny: Wybrany).
-- Kalendarz docelowy publikacji jest jeden i osobny; wersja wyboru chroni przed nadpisaniem zmian z innego okna.

alter table t_konta_google
  add column if not exists id_kal_publikacji text references t_kalendarze_google(id_kal_google) on delete set null,
  add column if not exists wersja_wyboru integer not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_t_konta_google_wersja_wyboru') then
    alter table t_konta_google add constraint ck_t_konta_google_wersja_wyboru check (wersja_wyboru > 0);
  end if;
end $$;

create index if not exists idx_t_kalendarze_google_wybrane on t_kalendarze_google(id_konta) where wybrany;
