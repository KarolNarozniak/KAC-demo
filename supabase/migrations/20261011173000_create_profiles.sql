create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  student_number text,
  study_program text not null,
  academic_year text,
  timezone text not null default 'Europe/Warsaw',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_first_name_nonempty check (length(btrim(first_name)) > 0),
  constraint profiles_last_name_nonempty check (length(btrim(last_name)) > 0),
  constraint profiles_study_program_nonempty check (length(btrim(study_program)) > 0)
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_profile_updated_at();

create policy "Students can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Students can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Students can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
