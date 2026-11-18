-- Trwałe połączenie konta Google (US6 / UC4). Jeden wiersz na użytkownika — "Zmień konto" nadpisuje go (upsert).
-- Celowo OSOBNA tabela od jednorazowego importu (S23KC2S1P2-27), który nic nie zapisuje w bazie.

create table if not exists t_konta_google (
  id_konta text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  google_sub text not null,                 -- stabilny, potwierdzony identyfikator konta Google (z id_token "sub")
  adres_email text,
  status text not null default 'connected' check (status in ('connected','disconnected','error')),
  zakresy text[] not null default '{}',     
  token_dostepu text,                      
  token_dostepu_wygasa timestamptz,
  token_odswiezania_zaszyfrowany bytea,    
  ostatnia_sync timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_uzytkownika),                  -- jedno połączone konto na użytkownika aplikacji
  unique (google_sub)                       -- to samo konto Google nie może być podłączone do dwóch kont KAC naraz
);
comment on table t_konta_google is 'Information model: tKontaGoogle';
create index if not exists idx_t_konta_google_user on t_konta_google(id_uzytkownika);