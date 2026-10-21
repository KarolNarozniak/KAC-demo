-- PostgreSQL mapping of KAC_Pelny_Model_Informacyjny_Backlog.xlsx.
-- Names use snake_case, while comments preserve each workbook entity name.
-- IDs are opaque text values compatible with the workbook's illustrative U001/E001 IDs;
-- new rows default to UUID strings. Instants use timestamptz, not ISO text.

create table if not exists t_uzytkownicy (
  id_uzytkownika text primary key default gen_random_uuid()::text,
  imie text not null,
  nazwisko text not null,
  email text not null unique,
  strefa_czasowa text not null default 'Europe/Warsaw',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table t_uzytkownicy is 'Information model: tUzytkownicy';

create table if not exists t_kalendarze (
  id_kalendarza text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  nazwa text not null,
  typ text not null,
  aktywny boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table t_kalendarze is 'Information model: tKalendarze';
create index if not exists idx_t_kalendarze_user on t_kalendarze(id_uzytkownika);

create table if not exists t_kategorie (
  id_kategorii text primary key default gen_random_uuid()::text,
  nazwa text not null unique,
  kolor_hex varchar(7) not null check (kolor_hex ~ '^#[0-9A-Fa-f]{6}$'),
  czy_praca boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table t_kategorie is 'Information model: tKategorie';

create table if not exists t_serie (
  id_serii text primary key default gen_random_uuid()::text,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  czestotliwosc text not null,
  data_poczatku date not null,
  data_konca date,
  bezterminowo boolean not null default false,
  created_at timestamptz not null default now(),
  check (data_konca is null or data_konca >= data_poczatku),
  check (not bezterminowo or data_konca is null)
);
comment on table t_serie is 'Information model: tSerie';
create index if not exists idx_t_serie_calendar on t_serie(id_kalendarza);

create table if not exists t_wydarzenia (
  id_wydarzenia text primary key default gen_random_uuid()::text,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  id_kategorii text not null references t_kategorie(id_kategorii) on delete restrict,
  id_serii text references t_serie(id_serii) on delete set null,
  tytul text not null,
  rozpoczecie timestamptz not null,
  zakonczenie timestamptz not null,
  obowiazkowe boolean not null default false,
  powtarzaj_co_tydzien boolean not null default false,
  zrodlo text not null default 'Ręcznie',
  id_zewnetrzne text,
  status text not null default 'Aktywne',
  opis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (zakonczenie > rozpoczecie),
  check (not powtarzaj_co_tydzien or id_serii is not null)
);
comment on table t_wydarzenia is 'Information model: tWydarzenia';
create index if not exists idx_t_wydarzenia_calendar_start on t_wydarzenia(id_kalendarza, rozpoczecie);
create index if not exists idx_t_wydarzenia_category on t_wydarzenia(id_kategorii);
create index if not exists idx_t_wydarzenia_series on t_wydarzenia(id_serii);
create unique index if not exists uq_t_wydarzenia_external
  on t_wydarzenia(id_kalendarza, zrodlo, id_zewnetrzne) where id_zewnetrzne is not null;

create table if not exists t_profile_pracy (
  id_profilu text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  stawka_pln numeric(12,2) check (stawka_pln is null or stawka_pln >= 0),
  min_godzin_tydzien numeric(6,2) check (min_godzin_tydzien is null or min_godzin_tydzien >= 0),
  cel_godzin_tydzien numeric(6,2) check (cel_godzin_tydzien is null or cel_godzin_tydzien >= 0),
  max_godzin_tydzien numeric(6,2) check (max_godzin_tydzien is null or max_godzin_tydzien > 0),
  czas_dojazdu_min integer not null default 0 check (czas_dojazdu_min >= 0),
  min_odpoczynku_min integer not null default 0 check (min_odpoczynku_min >= 0),
  aktywny boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_godzin_tydzien is null or max_godzin_tydzien is null or min_godzin_tydzien <= max_godzin_tydzien)
);
comment on table t_profile_pracy is 'Information model: tProfilePracy';
create index if not exists idx_t_profile_pracy_user on t_profile_pracy(id_uzytkownika);

create table if not exists t_dostepnosc (
  id_dostepnosci text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  dzien_tygodnia smallint not null check (dzien_tygodnia between 1 and 7),
  od_godzina time not null,
  do_godzina time not null,
  rodzaj text not null,
  check (do_godzina > od_godzina)
);
comment on table t_dostepnosc is 'Information model: tDostepnosc';
create index if not exists idx_t_dostepnosc_profile_day on t_dostepnosc(id_profilu, dzien_tygodnia);

create table if not exists t_prefer_godziny (
  id_preferencji text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  dzien_tygodnia smallint not null check (dzien_tygodnia between 1 and 7),
  od_godzina time not null,
  do_godzina time not null,
  waga numeric(5,2) not null default 1 check (waga >= 0),
  check (do_godzina > od_godzina)
);
comment on table t_prefer_godziny is 'Information model: tPreferGodziny';
create index if not exists idx_t_prefer_godziny_profile_day on t_prefer_godziny(id_profilu, dzien_tygodnia);

create table if not exists t_blokady (
  id_blokady text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  typ text not null,
  rozpoczecie timestamptz not null,
  zakonczenie timestamptz not null,
  powod text,
  check (zakonczenie > rozpoczecie)
);
comment on table t_blokady is 'Information model: tBlokady';
create index if not exists idx_t_blokady_profile_time on t_blokady(id_profilu, rozpoczecie, zakonczenie);

create table if not exists t_miejsca (
  id_miejsca text primary key default gen_random_uuid()::text,
  nazwa text not null,
  typ text not null,
  adres text
);
comment on table t_miejsca is 'Information model: tMiejsca';

create table if not exists t_dojazdy (
  id_dojazdu text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  id_miejsca_od text not null references t_miejsca(id_miejsca) on delete restrict,
  id_miejsca_do text not null references t_miejsca(id_miejsca) on delete restrict,
  minuty integer not null check (minuty >= 0),
  unique (id_profilu, id_miejsca_od, id_miejsca_do)
);
comment on table t_dojazdy is 'Information model: tDojazdy';

create table if not exists t_grafiki (
  id_grafiku text primary key default gen_random_uuid()::text,
  id_profilu text not null references t_profile_pracy(id_profilu) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  tydzien_od date not null,
  tydzien_do date not null,
  status text not null,
  cel_godzin numeric(6,2) not null check (cel_godzin >= 0),
  plan_godzin numeric(6,2) not null default 0 check (plan_godzin >= 0),
  szac_placa_pln numeric(12,2) not null default 0 check (szac_placa_pln >= 0),
  czy_osiagalny boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tydzien_do >= tydzien_od)
);
comment on table t_grafiki is 'Information model: tGrafiki';
create index if not exists idx_t_grafiki_profile_week on t_grafiki(id_profilu, tydzien_od);

create table if not exists t_zmiany_pracy (
  id_zmiany text primary key default gen_random_uuid()::text,
  id_grafiku text not null references t_grafiki(id_grafiku) on delete cascade,
  id_wydarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  rozpoczecie timestamptz not null,
  zakonczenie timestamptz not null,
  godziny numeric(6,2) not null check (godziny >= 0),
  stawka_pln numeric(12,2) not null check (stawka_pln >= 0),
  wynagrodzenie_pln numeric(12,2) not null check (wynagrodzenie_pln >= 0),
  status text not null,
  check (zakonczenie > rozpoczecie)
);
comment on table t_zmiany_pracy is 'Information model: tZmianyPracy';
create index if not exists idx_t_zmiany_pracy_schedule on t_zmiany_pracy(id_grafiku, rozpoczecie);

create table if not exists t_korekty_grafiku (
  id_korekty text primary key default gen_random_uuid()::text,
  id_zmiany text not null references t_zmiany_pracy(id_zmiany) on delete cascade,
  od_przed timestamptz not null,
  do_przed timestamptz not null,
  od_po timestamptz not null,
  do_po timestamptz not null,
  powod text,
  status text not null,
  check (do_przed > od_przed),
  check (do_po > od_po)
);
comment on table t_korekty_grafiku is 'Information model: tKorektyGrafiku';

create table if not exists t_ograniczenia_grafiku (
  id_ograniczenia text primary key default gen_random_uuid()::text,
  id_grafiku text not null references t_grafiki(id_grafiku) on delete cascade,
  typ text not null,
  parametr text not null,
  wartosc numeric(12,3),
  wynik text not null,
  opis text
);
comment on table t_ograniczenia_grafiku is 'Information model: tOgraniczeniaGrafiku';

create table if not exists t_kolizje (
  id_kolizji text primary key default gen_random_uuid()::text,
  id_wydarzenia_a text not null references t_wydarzenia(id_wydarzenia) on delete cascade,
  id_wydarzenia_b text not null references t_wydarzenia(id_wydarzenia) on delete cascade,
  poczatek_kolizji timestamptz not null,
  koniec_kolizji timestamptz not null,
  minuty integer not null check (minuty > 0),
  rodzaj text not null,
  status text not null,
  check (id_wydarzenia_a <> id_wydarzenia_b),
  check (koniec_kolizji > poczatek_kolizji),
  unique (id_wydarzenia_a, id_wydarzenia_b, poczatek_kolizji)
);
comment on table t_kolizje is 'Information model: tKolizje';
create index if not exists idx_t_kolizje_event_b on t_kolizje(id_wydarzenia_b);

create table if not exists t_importy (
  id_importu text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  format text not null,
  zrodlo text not null,
  nazwa_pliku text,
  status text not null,
  data_importu timestamptz not null default now(),
  liczba_rekordow integer not null default 0 check (liczba_rekordow >= 0)
);
comment on table t_importy is 'Information model: tImporty';
create index if not exists idx_t_importy_user_time on t_importy(id_uzytkownika, data_importu);

create table if not exists t_pozycje_importu (
  id_pozycji text primary key default gen_random_uuid()::text,
  id_importu text not null references t_importy(id_importu) on delete cascade,
  id_wydarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  tytul_odczyt text not null,
  rozpoczecie timestamptz,
  zakonczenie timestamptz,
  id_kategorii text references t_kategorie(id_kategorii) on delete set null,
  pewnosc numeric(5,4) check (pewnosc is null or (pewnosc >= 0 and pewnosc <= 1)),
  czy_duplikat boolean not null default false,
  status_kontroli text not null,
  check (rozpoczecie is null or zakonczenie is null or zakonczenie > rozpoczecie)
);
comment on table t_pozycje_importu is 'Information model: tPozycjeImportu';
create index if not exists idx_t_pozycje_importu_batch on t_pozycje_importu(id_importu);

create table if not exists t_konta_google (
  id_konta text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  adres_email text not null,
  status_polaczenia text not null,
  zgoda_synchronizacja boolean not null default false,
  ostatnia_sync timestamptz,
  created_at timestamptz not null default now(),
  unique (id_uzytkownika, adres_email)
);
comment on table t_konta_google is 'Information model: tKontaGoogle. Tokens are intentionally not stored here.';
create index if not exists idx_t_konta_google_user on t_konta_google(id_uzytkownika);

create table if not exists t_kalendarze_google (
  id_kal_google text primary key default gen_random_uuid()::text,
  id_konta text not null references t_konta_google(id_konta) on delete cascade,
  id_kalendarza text references t_kalendarze(id_kalendarza) on delete set null,
  nazwa text not null,
  id_zewnetrzne text not null,
  wybrany boolean not null default false,
  uprawnienia text not null default 'Odczyt',
  unique (id_konta, id_zewnetrzne)
);
comment on table t_kalendarze_google is 'Information model: tKalendarzeGoogle';

create table if not exists t_synchronizacje (
  id_sync text primary key default gen_random_uuid()::text,
  id_konta text not null references t_konta_google(id_konta) on delete cascade,
  id_kal_google text references t_kalendarze_google(id_kal_google) on delete set null,
  kierunek text not null,
  operacja text not null,
  status text not null,
  data_proby timestamptz not null default now(),
  liczba_zmian integer not null default 0 check (liczba_zmian >= 0),
  komunikat text
);
comment on table t_synchronizacje is 'Information model: tSynchronizacje';

create table if not exists t_publikacje (
  id_publikacji text primary key default gen_random_uuid()::text,
  id_grafiku text not null references t_grafiki(id_grafiku) on delete cascade,
  id_kal_google text not null references t_kalendarze_google(id_kal_google) on delete restrict,
  id_sync text references t_synchronizacje(id_sync) on delete set null,
  status text not null,
  opublikowano timestamptz,
  zewnetrzne_id text,
  operacja text not null
);
comment on table t_publikacje is 'Information model: tPublikacje';

create table if not exists t_ustaw_powiadomien (
  id_ustawien text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  wlaczone boolean not null default true,
  przypomnienia_wlaczone boolean not null default true,
  zmiany_wlaczone boolean not null default true,
  cisza_od time,
  cisza_do time,
  min_przed integer not null default 30 check (min_przed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table t_ustaw_powiadomien is 'Information model: tUstawPowiadomien';
create index if not exists idx_t_ustaw_powiadomien_user on t_ustaw_powiadomien(id_uzytkownika);

create table if not exists t_powiadomienia (
  id_powiadomienia text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_wydarzenia text references t_wydarzenia(id_wydarzenia) on delete set null,
  id_grafiku text references t_grafiki(id_grafiku) on delete set null,
  typ text not null,
  tresc text not null,
  planowana_data timestamptz not null,
  status text not null,
  data_wyslania timestamptz
);
comment on table t_powiadomienia is 'Information model: tPowiadomienia';
create index if not exists idx_t_powiadomienia_user_schedule on t_powiadomienia(id_uzytkownika, planowana_data);

create table if not exists t_zmiany_historii (
  id_zmiany text primary key default gen_random_uuid()::text,
  id_wydarzenia text not null references t_wydarzenia(id_wydarzenia) on delete cascade,
  id_sync text references t_synchronizacje(id_sync) on delete set null,
  typ_operacji text not null,
  pole text not null,
  wartosc_przed text,
  wartosc_po text,
  data_zmiany timestamptz not null default now()
);
comment on table t_zmiany_historii is 'Information model: tZmianyHistorii';
create index if not exists idx_t_zmiany_historii_event_time on t_zmiany_historii(id_wydarzenia, data_zmiany);
