-- Bootstrap a local calendar and categories until account onboarding is implemented.
-- Reserved .test address; no real account, OAuth token, or user credential.
insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa)
values ('U001', 'Użytkownik', 'Lokalny', 'student.demo@example.test', 'Europe/Warsaw')
on conflict (id_uzytkownika) do update set
  imie = excluded.imie,
  nazwisko = excluded.nazwisko,
  email = excluded.email,
  strefa_czasowa = excluded.strefa_czasowa;

insert into t_kategorie (id_kategorii, nazwa, kolor_hex, czy_praca)
values
  ('CAT01', 'Zajęcia', '#2563EB', false),
  ('CAT02', 'Praca', '#F97316', true),
  ('CAT03', 'Prywatne', '#16A34A', false)
on conflict (id_kategorii) do update set
  nazwa = excluded.nazwa,
  kolor_hex = excluded.kolor_hex,
  czy_praca = excluded.czy_praca;

insert into t_kalendarze (id_kalendarza, id_uzytkownika, nazwa, typ, aktywny)
values ('K001', 'U001', 'Mój kalendarz', 'Wewnetrzny', true)
on conflict (id_kalendarza) do update set
  id_uzytkownika = excluded.id_uzytkownika,
  nazwa = excluded.nazwa,
  typ = excluded.typ,
  aktywny = excluded.aktywny;
