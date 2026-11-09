---
id: work-profile
title: Profil pracy, dostępność i wynagrodzenie
sidebar_position: 5
---

Profil w zakładce **Grafik** przechowuje dostępność, warunki pracy oraz cel tygodniowy lub miesięczny. Sekcja **Stawka i dostępność** w Ustawieniach pozwala dodatkowo zapisać stawkę PLN i brutto/netto. Puste pole dojazdu jest brakiem ustawienia; jawne zero jest poprawne. Stawka zero jest również poprawna. Nie przeliczamy brutto na netto.

Dostępność jest lokalnym szkicem do chwili zapisania. Anulowanie przywraca zapisaną kopię. Edytor scala przecięcia i pozwala zaakceptować wyłączenie obowiązkowych zajęć cyklicznych. API odrzuca nieznormalizowane przecięcia. Obsługiwany jest koniec dnia `24:00` i podział zakresu nocnego, także niedziela–poniedziałek. Zapis pełnej listy jest atomowy i kontroluje wspólną wersję profilu; błąd nie usuwa dotychczasowych danych.

## Dwa zachowane sposoby planowania

- **Grafik**: zaawansowany generator z master, szablony zmian, limity dzienne, podgląd w kalendarzu, potwierdzenie tygodnia bez zajęć i zastępowanie poprzedniego planu. API: `/api/v1/schedules`.
- **Asystent**: wcześniejszy prosty planer dostępności i odczyt jego historii. API: `/api/v1/work-profile/schedules`.

Oba korzystają z tych samych ustawień dostępności i kalendarza. Propozycje mają osobne cykle życia: odrzucenie lub akceptacja w jednym planerze nie zmienia rekordu propozycji drugiego. Wspólne wydarzenia kalendarza nadal ograniczają planowanie. Pełny profil tygodniowy/miesięczny: `/api/v1/work-profile` (wersja tekstowa `profileVersion`). Stawka i starszy formularz tygodniowy: `/api/v1/work-profile/compensation` (liczbowa `version`). Osobny zapis dostępności: `/api/v1/work-profile/availability`. Oba rodzaje wersji są aktualizowane wspólnie, więc równoległe formularze nie nadpisują zmian. Nie ma niewersjonowanych aliasów.

Dojazd jest niepłatnym buforem przed i po pracy, mieszczącym się w dostępności. Pomiędzy dwiema zmianami wymagana jest większa z wartości: dojazd lub odpoczynek, bez ich sumowania. Adres wydarzenia nie zmienia stałego bufora MVP. W Grafikach nieobowiązkowe wykłady zachowują miękką regułę pomijania z ostrzeżeniem.

## Wynagrodzenie i historia

Każda zapisana zmiana ma snapshot stawki, brutto/netto i kwoty. Obliczenie wykorzystuje rzeczywiste minuty między instantami (również przy DST) i całkowite grosze: `halfUp(rateGrosz * durationMinutes / 60)`. Suma jest sumą osobno zaokrąglonych zmian, bez wynagrodzenia za dojazd. Kwota dotyczy zmian tej propozycji, nie nieznanych historycznych stawek innych wydarzeń pracy. Zmiana profilu nie przelicza zapisanej historii. Po niezapisanej korekcie godzin kwota na ekranie pozostaje ostatnim snapshotem do ponownego zapisu.

Kanoniczny kontrakt znajduje się w [wygenerowanej referencji API](./api/openapi-reference). Schematy źródłowe są w `apps/api/src/api/v1/`. Przy aktualizacji starszej bazy migracje `007_work_profile_workflow.sql` i `009_work_profile_workflow_restore.sql` chronią stany wcześniejszych propozycji przed normalizacją cyklu życia wprowadzaną na master.

## Cel miesięczny i blokady

`targetPeriod: month` zachowuje podany cel miesięczny, a planowanie korzysta z odpowiednika tygodniowego (miesiąc = 52/12 tygodnia). Zapis samej stawki zachowuje wybrany okres. Jawna zmiana celu tygodniowego w sekcji Stawka i dostępność przełącza cel na tygodniowy.

Zakładka **Blokady** obsługuje urlopy, sesje egzaminacyjne i dni wolne przez `/api/v1/blocks`. API odczytuje i usuwa wyłącznie blokady użytkownika ustalonego przez serwer. Wymaga instantów ISO z offsetem; formularz przelicza wpisane lokalne daty na UTC. Blokady obowiązują w obu planerach i nie są kopiowane do edytowalnych blokad profilu. Tworzenie i usuwanie blokady blokuje kalendarze użytkownika, aby zmiana nie ominęła transakcyjnej walidacji akceptacji. Strukturę tabeli tworzy migracja `010_calendar_blocks.sql`, a nie konstruktor repozytorium.
