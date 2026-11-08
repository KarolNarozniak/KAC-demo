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

-- Użytkownik ma najwyżej jeden aktywny profil (S23KC2S1P2-186); profilem demonstracyjnym jest P001.
update t_profile_pracy set aktywny = false where id_uzytkownika = 'U001' and id_profilu <> 'P001' and aktywny;

insert into t_profile_pracy (
  id_profilu, id_uzytkownika, stawka_pln, min_godzin_tydzien, cel_godzin_tydzien,
  max_godzin_tydzien, czas_dojazdu_min, min_odpoczynku_min, aktywny,
  tryb_pracy, min_slot_min, max_slot_min
)
values ('P001', 'U001', 35.50, 10, 20, 30, 45, 60, true, 'elastyczny', 120, 360)
on conflict (id_profilu) do update set
  stawka_pln = excluded.stawka_pln,
  min_godzin_tydzien = excluded.min_godzin_tydzien,
  cel_godzin_tydzien = excluded.cel_godzin_tydzien,
  max_godzin_tydzien = excluded.max_godzin_tydzien,
  czas_dojazdu_min = excluded.czas_dojazdu_min,
  min_odpoczynku_min = excluded.min_odpoczynku_min,
  tryb_pracy = excluded.tryb_pracy,
  min_slot_min = excluded.min_slot_min,
  max_slot_min = excluded.max_slot_min,
  aktywny = excluded.aktywny;

insert into t_dostepnosc (id_dostepnosci, id_profilu, dzien_tygodnia, od_godzina, do_godzina, rodzaj)
values
  ('AV001', 'P001', 1, '08:00', '22:00', 'Dostępny'),
  ('AV002', 'P001', 2, '08:00', '22:00', 'Dostępny'),
  ('AV003', 'P001', 3, '08:00', '22:00', 'Dostępny'),
  ('AV004', 'P001', 4, '08:00', '22:00', 'Dostępny'),
  ('AV005', 'P001', 5, '08:00', '22:00', 'Dostępny'),
  ('AV006', 'P001', 6, '10:00', '18:00', 'Dostępny')
on conflict (id_dostepnosci) do update set
  od_godzina = excluded.od_godzina,
  do_godzina = excluded.do_godzina,
  rodzaj = excluded.rodzaj;

insert into t_prefer_godziny (id_preferencji, id_profilu, dzien_tygodnia, od_godzina, do_godzina, waga)
values
  ('PR001', 'P001', 1, '12:00', '17:00', 5),
  ('PR002', 'P001', 3, '10:00', '16:00', 4)
on conflict (id_preferencji) do update set
  od_godzina = excluded.od_godzina,
  do_godzina = excluded.do_godzina,
  waga = excluded.waga;

insert into t_szablony_zmian (
  id_szablonu, id_profilu, nazwa, godzina_od, godzina_do, koniec_nastepnego_dnia, dni_tygodnia, aktywna
)
values
  ('SHIFT-AM', 'P001', 'Zmiana poranna', '06:00', '14:00', false, array[1,2,3,4,5]::smallint[], true),
  ('SHIFT-PM', 'P001', 'Zmiana popołudniowa', '14:00', '22:00', false, array[1,2,3,4,5]::smallint[], true),
  ('SHIFT-NIGHT', 'P001', 'Zmiana nocna', '22:00', '06:00', true, array[1,2,3,4,5]::smallint[], true)
on conflict (id_szablonu) do update set
  nazwa = excluded.nazwa,
  godzina_od = excluded.godzina_od,
  godzina_do = excluded.godzina_do,
  koniec_nastepnego_dnia = excluded.koniec_nastepnego_dnia,
  dni_tygodnia = excluded.dni_tygodnia,
  aktywna = excluded.aktywna;

insert into t_serie (id_serii, id_kalendarza, czestotliwosc, data_poczatku, data_konca, bezterminowo)
values
  ('S001', 'K001', 'WEEKLY', '2026-10-12', '2027-06-30', false),
  ('S002', 'K001', 'WEEKLY', '2026-10-13', '2027-06-30', false),
  ('S003', 'K001', 'WEEKLY', '2026-10-14', '2027-06-30', false)
on conflict (id_serii) do update set
  data_poczatku = excluded.data_poczatku,
  data_konca = excluded.data_konca,
  bezterminowo = excluded.bezterminowo;

insert into t_wydarzenia (
  id_wydarzenia, id_kalendarza, id_kategorii, id_serii, tytul, rozpoczecie,
  zakonczenie, obowiazkowe, powtarzaj_co_tydzien, zrodlo, status, opis, miejsce
)
values
  ('E001', 'K001', 'CAT01', 'S001', 'Laboratorium obowiązkowe', '2026-10-12 08:00:00+02', '2026-10-12 09:35:00+02', true, true, 'DemoDB', 'Aktywne', 'Cotygodniowa blokada demonstracyjna.', 'WAT'),
  ('E002', 'K001', 'CAT01', 'S002', 'Wykład nieobowiązkowy', '2026-10-13 10:00:00+02', '2026-10-13 11:30:00+02', false, true, 'DemoDB', 'Aktywne', 'Opcjonalne zajęcia do pokazania kary miękkiej.', 'WAT'),
  ('E003', 'K001', 'CAT02', 'S003', 'Praca', '2026-10-14 12:00:00+02', '2026-10-14 16:00:00+02', false, true, 'DemoDB', 'Aktywne', 'Istniejąca zmiana uwzględniana w godzinach tygodnia.', 'Praca')
on conflict (id_wydarzenia) do update set
  id_kalendarza = excluded.id_kalendarza,
  id_kategorii = excluded.id_kategorii,
  id_serii = excluded.id_serii,
  tytul = excluded.tytul,
  rozpoczecie = excluded.rozpoczecie,
  zakonczenie = excluded.zakonczenie,
  obowiazkowe = excluded.obowiazkowe,
  powtarzaj_co_tydzien = excluded.powtarzaj_co_tydzien,
  zrodlo = excluded.zrodlo,
  status = excluded.status,
  opis = excluded.opis,
  miejsce = excluded.miejsce;
