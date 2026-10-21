-- Synthetic records for the read-only front -> API -> PostgreSQL demo flow.
-- Reserved .test address; no real account, OAuth token, or user credential.
insert into t_uzytkownicy (id_uzytkownika, imie, nazwisko, email, strefa_czasowa)
values ('U001', 'Student', 'Demo', 'student.demo@example.test', 'Europe/Warsaw')
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
values ('K001', 'U001', 'KAC — kalendarz demonstracyjny', 'Wewnetrzny', true)
on conflict (id_kalendarza) do update set
  id_uzytkownika = excluded.id_uzytkownika,
  nazwa = excluded.nazwa,
  typ = excluded.typ,
  aktywny = excluded.aktywny;

insert into t_profile_pracy (
  id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien,
  cel_godzin_tydzien, max_godzin_tydzien, czas_dojazdu_min,
  min_odpoczynku_min, aktywny
)
values ('P001', 'U001', 35.50, 10, 20, 30, 30, 60, true)
on conflict (id_profilu) do update set
  id_uzytkownika = excluded.id_uzytkownika,
  stawka_pln = excluded.stawka_pln,
  min_godzin_tydzien = excluded.min_godzin_tydzien,
  cel_godzin_tydzien = excluded.cel_godzin_tydzien,
  max_godzin_tydzien = excluded.max_godzin_tydzien,
  czas_dojazdu_min = excluded.czas_dojazdu_min,
  min_odpoczynku_min = excluded.min_odpoczynku_min,
  aktywny = excluded.aktywny;

insert into t_wydarzenia (
  id_wydarzenia, id_kalendarza, id_kategorii, tytul, rozpoczecie,
  zakonczenie, obowiazkowe, powtarzaj_co_tydzien, zrodlo, status, opis
)
values
  ('E001', 'K001', 'CAT01', 'Zajęcia pokazowe', '2026-02-23 08:00:00+01', '2026-02-23 09:35:00+01', true, false, 'DemoDB', 'Aktywne', 'Odczyt z PostgreSQL — rekord demonstracyjny.'),
  ('E002', 'K001', 'CAT02', 'Praca', '2026-02-23 16:00:00+01', '2026-02-23 20:00:00+01', false, false, 'DemoDB', 'Aktywne', 'Odczyt z PostgreSQL — rekord demonstracyjny.'),
  ('E003', 'K001', 'CAT03', 'Wydarzenie prywatne', '2026-02-24 10:00:00+01', '2026-02-24 11:00:00+01', false, false, 'DemoDB', 'Aktywne', 'Odczyt z PostgreSQL — rekord demonstracyjny.')
on conflict (id_wydarzenia) do update set
  id_kalendarza = excluded.id_kalendarza,
  id_kategorii = excluded.id_kategorii,
  tytul = excluded.tytul,
  rozpoczecie = excluded.rozpoczecie,
  zakonczenie = excluded.zakonczenie,
  obowiazkowe = excluded.obowiazkowe,
  powtarzaj_co_tydzien = excluded.powtarzaj_co_tydzien,
  zrodlo = excluded.zrodlo,
  status = excluded.status,
  opis = excluded.opis;
