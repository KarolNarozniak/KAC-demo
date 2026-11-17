-- Kategorie przypomnień (zmiany w powiadomieniach na masterze): zajęcia i wydarzenia prywatne, domyślnie włączone.
alter table t_ustaw_powiadomien
  add column if not exists zajecia_wlaczone boolean not null default true,
  add column if not exists prywatne_wlaczone boolean not null default true;