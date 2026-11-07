---
id: work-profile
title: Profil pracy, dostępność i wynagrodzenie
sidebar_position: 5
---

Profil pracy w **Ustawieniach** przechowuje tygodniową dostępność, stawkę PLN, oznaczenie brutto/netto, czas dojazdu i limity godzin. Puste pole dojazdu jest brakiem ustawienia; jawne zero jest poprawne. Stawka zero jest również poprawna. Nie przeliczamy brutto na netto.

Dostępność jest lokalnym szkicem do chwili zapisania. Anulowanie przywraca zapisaną kopię. Edytor scala przecięcia i pozwala zaakceptować wyłączenie obowiązkowych zajęć cyklicznych. API odrzuca nieznormalizowane przecięcia. Obsługiwany jest koniec dnia `24:00` i podział zakresu nocnego, także niedziela–poniedziałek. Zapis pełnej listy jest atomowy i kontroluje wspólną wersję profilu; błąd nie usuwa dotychczasowych danych.

## Dwa zachowane sposoby planowania

- **Grafik**: zaawansowany generator z master, szablony zmian, limity dzienne, podgląd w kalendarzu, potwierdzenie tygodnia bez zajęć i zastępowanie poprzedniego planu. API: `/api/v1/schedules` i `/api/v1/scheduling/settings`.
- **Asystent**: wcześniejszy prosty planer dostępności i odczyt jego historii. API: `/api/v1/work-profile/schedules`.

Oba korzystają z tych samych ustawień dostępności i kalendarza. Propozycje mają osobne cykle życia: odrzucenie lub akceptacja w jednym planerze nie zmienia rekordu propozycji drugiego. Wspólne wydarzenia kalendarza nadal ograniczają planowanie. Profil i dostępność: `/api/v1/work-profile` oraz `/api/v1/work-profile/availability`. Nie ma niewersjonowanych aliasów.

Dojazd jest niepłatnym buforem przed i po pracy, mieszczącym się w dostępności. Pomiędzy dwiema zmianami wymagana jest większa z wartości: dojazd lub odpoczynek, bez ich sumowania. Adres wydarzenia nie zmienia stałego bufora MVP. W Grafikach nieobowiązkowe wykłady zachowują miękką regułę pomijania z ostrzeżeniem.

## Wynagrodzenie i historia

Każda zapisana zmiana ma snapshot stawki, brutto/netto i kwoty. Obliczenie wykorzystuje rzeczywiste minuty między instantami (również przy DST) i całkowite grosze: `halfUp(rateGrosz * durationMinutes / 60)`. Suma jest sumą osobno zaokrąglonych zmian, bez wynagrodzenia za dojazd. Kwota dotyczy zmian tej propozycji, nie nieznanych historycznych stawek innych wydarzeń pracy. Zmiana profilu nie przelicza zapisanej historii. Po niezapisanej korekcie godzin kwota na ekranie pozostaje ostatnim snapshotem do ponownego zapisu.

Kanoniczny kontrakt znajduje się w [wygenerowanej referencji API](./api/openapi-reference). Schematy źródłowe są w `apps/api/src/api/v1/`. Przy aktualizacji starszej bazy migracje `007_work_profile_workflow.sql` i `009_work_profile_workflow_restore.sql` chronią stany wcześniejszych propozycji przed normalizacją cyklu życia wprowadzaną na master.
