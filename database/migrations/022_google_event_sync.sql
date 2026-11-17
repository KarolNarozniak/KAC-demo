-- Pobieranie i stosowanie zmian z Google według trwałej tożsamości (S23KC2S1P2-23, podzadanie G05 / S23KC2S1P2-289).
--
-- t_google_wydarzenia – mapowanie „przychodzące”: klucz źródła to konto + kalendarz + identyfikator wydarzenia Google
-- (dla serii: identyfikator instancji). Synchronizacja zmienia i usuwa wyłącznie wydarzenia KAC wskazane w tym mapowaniu;
-- ręczne wpisy nie mają tu wiersza, więc nigdy nie są dotykane.
--   wersja_lokalna – event_version wydarzenia po ostatnim zastosowaniu zmian z Google; wyższa wersja = edycja w KAC (konflikt),
--   dane_google    – ostatnia wersja z Google (także gdy nie została zastosowana) – do „Przywróć wersję z Google”,
--   stan           – aktywne | konflikt (edycja w KAC, Google nie nadpisuje) | odlaczone (usunięte w Google, lokalna kopia zostaje)
--                    | usuniete_w_google; id_wydarzenia null przy stanie aktywne/konflikt = usunięte w KAC (nie odtwarzamy).
-- t_google_sync_stan – checkpoint kalendarza: kursor syncToken zapisywany dopiero po zastosowaniu kompletnej serii stron,
--   okno pełnego odczytu i stan makiety.

create table if not exists t_google_wydarzenia (
  id_powiazania text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_konta text not null references t_konta_google(id_konta) on delete cascade,
  id_kal_google text not null references t_kalendarze_google(id_kal_google) on delete cascade,
  google_id text not null,
  google_seria_id text,
  google_updated timestamptz,
  id_wydarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  wersja_lokalna integer,
  dane_google jsonb,
  stan text not null default 'aktywne',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_t_google_wydarzenia_stan check (stan in ('aktywne', 'konflikt', 'odlaczone', 'usuniete_w_google')),
  constraint uq_t_google_wydarzenia_zrodlo unique (id_konta, id_kal_google, google_id)
);
create index if not exists idx_t_google_wydarzenia_wydarzenie on t_google_wydarzenia(id_wydarzenia) where id_wydarzenia is not null;
create index if not exists idx_t_google_wydarzenia_uzytkownik on t_google_wydarzenia(id_uzytkownika, stan);
comment on table t_google_wydarzenia is 'G05: wydarzenia KAC pobrane z Google (trwała tożsamość źródła: konto, kalendarz, wydarzenie/instancja).';

create table if not exists t_google_sync_stan (
  id_konta text not null references t_konta_google(id_konta) on delete cascade,
  id_kal_google text not null references t_kalendarze_google(id_kal_google) on delete cascade,
  sync_token text,
  okno_od timestamptz,
  okno_do timestamptz,
  pelny_odczyt_at timestamptz,
  ostatni_odczyt_at timestamptz,
  demo_rewizja integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (id_konta, id_kal_google),
  constraint ck_t_google_sync_stan_okno check (okno_od is null or okno_do is null or okno_do > okno_od),
  constraint ck_t_google_sync_stan_rewizja check (demo_rewizja >= 0)
);
comment on table t_google_sync_stan is 'G05: checkpoint synchronizacji kalendarza Google (kursor po kompletnej serii stron, okno pełnego odczytu).';
