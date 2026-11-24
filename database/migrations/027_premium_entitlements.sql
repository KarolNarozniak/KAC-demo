create table if not exists t_premium_entitlements (
  id_uzytkownika text primary key references t_uzytkownicy(id_uzytkownika) on delete cascade,
  wygasa_at timestamptz not null,
  zrodlo text not null check (zrodlo in ('code', 'manual')),
  campaign_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_t_premium_entitlements_expiry
  on t_premium_entitlements(wygasa_at);

create table if not exists t_premium_redemptions (
  id_redemption text primary key default gen_random_uuid()::text,
  id_uzytkownika text not null references t_uzytkownicy(id_uzytkownika) on delete cascade,
  campaign_id text not null,
  zrodlo text not null check (zrodlo in ('code', 'manual')),
  redeemed_at timestamptz not null default now(),
  premium_until timestamptz not null,
  unique (id_uzytkownika, campaign_id)
);

create index if not exists idx_t_premium_redemptions_campaign
  on t_premium_redemptions(campaign_id, redeemed_at);
