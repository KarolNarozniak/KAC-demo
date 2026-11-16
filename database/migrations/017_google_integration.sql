-- Trwałe połączenie z kontem Google (S23KC2S1P2-12, podzadanie G01 / S23KC2S1P2-284).
-- t_konta_google opisuje konto z modelu informacyjnego; tokeny są celowo w osobnej tabeli i zawsze zaszyfrowane
-- kluczem spoza bazy (GOOGLE_TOKEN_ENCRYPTION_KEY). Jednorazowy import (S23KC2S1P2-27) nie korzysta z tych tabel.

alter table t_konta_google
  add column if not exists google_sub text,
  add column if not exists tryb text not null default 'google',
  add column if not exists uprawnienia text[] not null default '{}',
  add column if not exists generacja integer not null default 1,
  add column if not exists polaczono_at timestamptz,
  add column if not exists odlaczono_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_t_konta_google_tryb') then
    alter table t_konta_google add constraint ck_t_konta_google_tryb check (tryb in ('google', 'demo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_konta_google_status') then
    alter table t_konta_google add constraint ck_t_konta_google_status
      check (status_polaczenia in ('Połączone', 'Wymaga ponownego logowania', 'Niepołączone'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_t_konta_google_generacja') then
    alter table t_konta_google add constraint ck_t_konta_google_generacja check (generacja > 0);
  end if;
end $$;

-- Jeden aktywny (połączony albo czekający na ponowne logowanie) rachunek Google na użytkownika. Zmiana konta zastępuje poprzednie.
create unique index if not exists uq_t_konta_google_active_user on t_konta_google(id_uzytkownika)
  where status_polaczenia <> 'Niepołączone';

-- Dane dostępu: tylko szyfrogramy (AES-256-GCM, dane dodatkowe = id konta), nigdy jawny token.
create table if not exists t_google_tokeny (
  id_konta text primary key references t_konta_google(id_konta) on delete cascade,
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  klucz_id text not null,
  updated_at timestamptz not null default now()
);
comment on table t_google_tokeny is 'G01: zaszyfrowane dane dostępu Google. Klucz szyfrowania jest poza bazą.';

-- Próby połączenia OAuth: state jednorazowy, z terminem ważności, zapisany jako skrót (sam skrót nie pozwala dokończyć logowania).
create table if not exists t_google_oauth_proby (
  id_proby text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  id_kalendarza text not null references t_kalendarze(id_kalendarza) on delete cascade,
  state_hash text not null unique,
  cel text not null check (cel in ('connect', 'change_account', 'reconnect')),
  tryb text not null check (tryb in ('google', 'demo')),
  code_verifier_enc text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'connected', 'denied', 'error', 'cancelled')),
  blad_kod text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finished_at timestamptz
);
create index if not exists idx_t_google_oauth_proby_user on t_google_oauth_proby(id_uzytkownika, created_at desc);
comment on table t_google_oauth_proby is 'G01: jednorazowe próby połączenia OAuth (state, PKCE) z terminem ważności.';

-- Rola konta na kalendarzu Google (G01/G04): reader, writer, owner. Uprawnienia z modelu informacyjnego zostają opisowe.
alter table t_kalendarze_google
  add column if not exists rola_dostepu text,
  add column if not exists strefa text,
  add column if not exists glowny boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
