-- Logowanie do aplikacji: konto KAC z hasłem (argon2id) i sesje urządzeń.
-- Token sesji jest losowy (256 bitów); w bazie leży tylko jego skrót SHA-256, więc wyciek bazy nie daje działających sesji.

create table if not exists t_dane_logowania (
  id_uzytkownika text primary key references t_uzytkownicy(id_uzytkownika) on delete cascade,
  haslo_hash text not null,
  haslo_zmieniono_at timestamptz not null default now(),
  nieudane_proby integer not null default 0 check (nieudane_proby >= 0),
  zablokowane_do timestamptz,
  ostatnie_logowanie_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table t_dane_logowania is 'Logowanie do KAC: skrót hasła argon2id, licznik nieudanych prób i czasowa blokada.';

create table if not exists t_sesje (
  id_sesji text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  token_hash text not null unique,
  urzadzenie text,
  utworzono_at timestamptz not null default now(),
  ostatnio_uzyto_at timestamptz not null default now(),
  wygasa_at timestamptz not null,
  uniewazniono_at timestamptz,
  powod_uniewaznienia text,
  constraint ck_t_sesje_powod check (powod_uniewaznienia is null or powod_uniewaznienia in ('wylogowanie', 'zmiana_hasla', 'reset_hasla', 'usuniecie_konta'))
);
comment on table t_sesje is 'Sesje logowania (urządzenia). Ważna: nieunieważniona, przed wygasa_at i używana w ostatnich 30 dniach.';
create index if not exists idx_t_sesje_user_active on t_sesje(id_uzytkownika) where uniewazniono_at is null;

-- Adres e-mail jest loginem: bez względu na wielkość liter (Jan@x.pl i jan@x.pl to jedno konto).
create unique index if not exists uq_t_uzytkownicy_email_lower on t_uzytkownicy (lower(email));

-- Jedno prawdziwe konto Google może być połączone tylko z jednym kontem KAC: cofnięcie zgody przy odłączeniu
-- unieważnia ją w Google dla wszystkich, więc wspólne konto Google odłączałoby się drugiemu użytkownikowi.
-- Konta demonstracyjne (tryb demo) są wspólne dla wszystkich i nie podlegają temu ograniczeniu.
create unique index if not exists uq_t_konta_google_active_sub on t_konta_google (google_sub)
  where tryb = 'google' and google_sub is not null and status_polaczenia <> 'Niepołączone';
