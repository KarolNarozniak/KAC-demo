alter table t_powiadomienia add column if not exists lease_until timestamptz;
create index if not exists idx_t_powiadomienia_delivery_lease
  on t_powiadomienia(status, lease_until, planowana_data) where status in ('Zaplanowane', 'Dostarczanie');
