-- S23KC2S1P2-299 (N07): powiadomienie o zmianie planu przechowuje szczegóły różnicy (przed/po, zmienione pola),
-- żeby kliknięcie w powiadomienie mogło pokazać, co się zmieniło, bez zgadywania na podstawie aktualnego stanu.
alter table t_powiadomienia add column if not exists szczegoly jsonb;
comment on column t_powiadomienia.szczegoly is 'Szczegóły powiadomienia, np. dla typu „Zmiana planu”: kind, fields, before, after, eventVersion.';
