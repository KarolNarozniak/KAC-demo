-- Kod odzyskiwania: samodzielne ustawienie nowego hasła bez poczty e-mail.
-- Kod (80 losowych bitów) aplikacja pokazuje tylko raz: po rejestracji, po użyciu i po wygenerowaniu nowego. W bazie leży wyłącznie
-- jego skrót SHA-256. Kod jest jednorazowy – użycie zastępuje go nowym. Konta bez kodu (np. sprzed tej zmiany) mają tu null.

alter table t_dane_logowania add column if not exists kod_odzyskiwania_hash text;
comment on column t_dane_logowania.kod_odzyskiwania_hash is
  'Skrót SHA-256 jednorazowego kodu odzyskiwania; null – konto nie ma kodu (nowe hasło ustawi tylko administrator, kod wygeneruje się w Ustawienia → Konto).';
