-- Keep the defaults used by the notification repository for existing preferences.
alter table t_ustaw_powiadomien
  add column if not exists zajecia_wlaczone boolean not null default true,
  add column if not exists prywatne_wlaczone boolean not null default true;
