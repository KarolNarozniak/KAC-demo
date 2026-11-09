Aktualny stan po kolejnym scaleniu: [raport 2026-11-09](./merge-master-2026-11-09.md).

# Raport realizacji sprintu 204 — Michał Kozłowski

Uwaga: raport opisuje pierwotne wdrożenie. Zmiany ścieżek API i integrację z nowszym master opisuje [raport scalenia z 2026-11-07](./merge-master-2026-11-07.md).

Data: 2026-11-06. Projekt: S23KC2S1P2. Zakres: 18 zgłoszeń (3 story, 14 podzadań, 1 opracowanie dokumentacji). **Jira pozostaje bez zmian.**

## Baza i podział pracy

Przed implementacją wykonano `git fetch origin`, stwierdzono nowszy master i zaktualizowano go przez fast-forward z `ba05804` do `dd87972`. Implementacja bazuje na najnowszym wówczas `origin/master`.

Zastane modyfikacje `package-lock.json` oraz nieśledzone `docs/backend-prezentacja.md` i `docs/taski-epic-3-4.md`, zgodnie z późniejszą uwagą użytkownika, odłożono do `/tmp/kac-before-sprint-204/`. Lockfile przywrócono z origin. Nie weszły do zakresu ani commitów.

Branche tworzą stos zależności:

1. `feature/sprint-204-availability`: profil, wersjonowanie, atomowa dostępność, edytor i podstawowe testy; wspólny kontrakt stawki stanowi fundament planowania.
2. `feature/sprint-204-pay-commute`: planowanie, pieniądze, snapshoty i wspólna walidacja dojazdu, ekrany oraz testy PostgreSQL. Wynagrodzenie i dojazd współdzielą cykl życia tej samej propozycji.
3. `docs/sprint-204-contract-requirements`: OpenAPI, opracowanie wymagań i raport.
4. `feature/sprint-204-michal`: końcowa gałąź zbiorcza wskazująca cały dostarczony zakres.

Nie wykonano push, PR ani scalenia do master.

## Weryfikacja kodu zastanego

Na master znajdowały się tabele profilu, dostępności i grafików, ale brakowało modułów `profile/`, `scheduling/`, API profilu i ekranów planowania. Status „Gotowe” story 16 i zadań 218–222 nie odpowiadał dostępnym modułom aplikacji. Zakres dojazdu zaimplementowano i przetestowano od podstaw, tak samo jak pozostałe zadania.

## Pokrycie 18 zgłoszeń

W tabeli identyfikatory mają wspólny prefiks **S23KC2S1P2-**. Wszystkie ścieżki odnoszą się do repozytorium.

| Zgłoszenie | Dostarczone zmiany | Dowód weryfikacji |
| --- | --- | --- |
| **9 — story dostępności** | Tygodniowy edytor w Ustawieniach, dodawanie/usuwanie/kopiowanie, szkic lokalny, anulowanie, scalanie, akceptacja wyłączenia obowiązkowych zajęć cyklicznych, suma zapisanych godzin i ostrzeżenie względem celu. Jednorazowe wydarzenia ograniczają konkretny grafik. | `apps/web/tests/availability.test.ts`, testy API i PostgreSQL; typecheck i build web. |
| **149 — BE/DB** | `apps/api/src/profile/repository.ts`: `listAvailability(userId)` i `replaceAvailability(userId, intervals, version)`. BEGIN, FOR UPDATE własnego aktywnego profilu, kontrola wersji, DELETE, INSERT, podbicie wersji, COMMIT; ROLLBACK na błędzie. Normalizacja przed modyfikacją danych; `24:00`, podział 7→1, sortowanie, odrzucenie duplikatów/przecięć. | Wymuszony błąd drugiego INSERT przez trigger w osobnym schemacie: stare zakresy i wersja pozostają; równoczesne zapisy: dokładnie jeden sukces. |
| **150 — API** | GET/PUT `/api/work-profile/availability`; pełna lista i wersja; ścisłe schematy, dni 1–7, pusta lista, błędy 400/422/409 i obsługa braku profilu/bazy. | `apps/api/tests/work-profile.test.ts`: `app.inject()`, nieznane pola, brak konwersji tekstu na liczbę, nieprawidłowy dzień, przecięcie i konflikt wersji. |
| **151 — FE** | `AvailabilityEditor.tsx`, `services/workProfileApi.ts`; istniejący TimeField także dla końca, osobny wybór `24:00`; kopiowanie na zaznaczone dni, pełny PUT, komunikaty dnia, blokada równoległego żądania. Zapis profilu nie usuwa szkicu dostępności. | Testy domeny edytora, typecheck, build. Błąd żądania nie zastępuje szkicu ani kopii zapisanego stanu. |
| **152 — testy dostępności** | Normalizator, trasy i `planning.integration.test.ts` z osobnymi profilami/kalendarzem w izolowanym schemacie PostgreSQL. | Noc 22–02 bez utraty minuty, niedziela–poniedziałek, `24:00`, stykające zakresy, pusta lista, cudze dane, rollback i wersje. |
| **45 — story wynagrodzenia** | Stawka PLN i brutto/netto w profilu; zapis/anulowanie, zachowanie formularza po błędzie; podsumowanie godzin i kwot propozycji oraz odczyt zapisanych grafików dla wybranego tygodnia. | 20 h × 30 PLN = 600 PLN w teście PostgreSQL; pusty plan = 0; snapshoty po zmianie profilu są identyczne. |
| **169 — BE/API stawki** | `hourlyRatePln:number|null`, `rateKind`, jawne konwersje SQL numeric do number, zakres numeric(12,2), kontrola precyzji bez podatności na błąd mnożenia zmiennoprzecinkowego; `null` ≠ 0. | Testy wartości ujemnej, trzech miejsc, bardzo małej wartości, przekroczenia zakresu, zera i braku stawki. |
| **170 — kalkulator** | `scheduling/pay.ts`: stawka w groszach, arytmetyka BigInt, half-up dla każdej zmiany, czas z rzeczywistych instantów. Trwałe `stawka_pln`, `wynagrodzenie_pln`, `rodzaj_stawki`; suma kwot w `szac_placa_pln`. Brak stawki → `profile_incomplete` przy generowaniu. | 30/45/61 min, noc i DST wiosna/jesień; kontrola przepełnienia; sumowanie w SQL numeric zachowuje dokładność kwot. |
| **171 — FE stawki** | Pole numeryczne, normalizacja przecinka, liczba bez symbolu waluty w JSON; formatowanie `Intl.NumberFormat('pl-PL', {style:'currency',currency:'PLN'})`. Każda zmiana pokazuje własny snapshot stawki i rodzaju kwoty. | Typecheck/build web; odczyt historycznych grafików nie korzysta z aktualnej stawki profilu. |
| **172 — testy wynagrodzenia** | `work-profile.test.ts`, `planning.integration.test.ts`. | Granica pół grosza: 0,01 PLN/h × 30 min → 0,01 PLN; dwie takie zmiany dają 0,02 PLN. Po akceptacji zmiana stawki i brutto/netto nie zmienia historii. Korekta propozycji używa jej snapshotu. |
| **173 — OpenAPI wynagrodzenia** | `docs/openapi-work-planning.json`: WorkProfile, ScheduleShift, ScheduleSummary, kwoty PLN, null/zero, snapshoty, zaokrąglanie per zmiana, suma, `invalid_hourly_rate`, przykłady. | Wszystkie schematy kompilują się w Ajv 2020; przykłady profilu, dostępności i naruszeń walidują się. |
| **16 — story dojazdu („Gotowe”)** | Dojazd sprawdzany przy generowaniu, korekcie i akceptacji. Odrzucenie nie dodaje wydarzeń; akceptacja ponownie sprawdza kalendarz i zapisuje wszystko atomowo. Pusty plan ma komunikat braku okien. | Testy jednostkowe i PostgreSQL, w tym wydarzenie dodane po generowaniu blokuje akceptację bez częściowego zapisu. |
| **218 — profil/API dojazdu („Gotowe”)** | `commuteMinutes:number|null`, mapowanie na `czas_dojazdu_min`; nieujemne pełne minuty. Brak ustawienia blokuje planowanie; jawne 0 dozwolone. Jeden bufor niezależny od adresu, bez map. | Nowy profil ma null; scenariusze 0 i 30 min; zdarzenie z pustym adresem w teście granicy tygodnia. |
| **219 — walidator („Gotowe”)** | `validateCommuteGaps()` i `validateAvailability()` w `scheduling/constraints.ts`. Work–Class/Personal: commute; Work–Work: max(commute,rest), bez sumowania. Generator odejmuje zajętość i sprawdza granice. Porównania uporządkowanych instantów, także dla zagnieżdżonych wydarzeń. | Dokładny odstęp, brak minuty, zero, max(), rzeczywiste instants; DTO z requiredMinutes, actualMinutes i ID sąsiadów. |
| **220 — FE dojazdu („Gotowe”)** | Pole minut w WorkProfileScreen; pomocniczy obszar dojazdu przy zmianie w ScheduleScreen, bez zwiększania płatnego czasu. Komunikaty rozróżniają za krótką przerwę od wyjścia poza dostępność i wskazują brakujące minuty/sąsiadów. | Typecheck/build web; odpowiedzi API z naruszeniami używane przez warstwę komunikatów. |
| **221 — testy dojazdu („Gotowe”)** | `scheduling.test.ts` i `planning.integration.test.ts`. | Zero, równość, 1 min za mało, max(), puste location, granice dostępności, noc, DST, ciągłość na północy i sąsiad z niedzieli poza tygodniem. W DB wygenerowanie dokładnie 30 min przerwy, korekta do 29 min odrzucona, poprawny plan zaakceptowany. |
| **222 — OpenAPI dojazdu („Gotowe”)** | Profil, generowanie, PUT zmiany, akceptacja; CommuteViolation, AvailabilityViolation, MVP bez geokodowania, minuty, dojazd niepłatny. | Przykłady actualMinutes:15 / requiredMinutes:30 oraz `commute_outside_availability`. |
| **228 — wymagania/UC** | `docs/requirements/sprint-204-kozlowski.md`: STRQ-07/08, TERM-07/08, FEAT-07/08, SR-07/08 i UC-07/08, priorytety, kryteria i scenariusze alternatywne. | Wszystkie 10 identyfikatorów opracowane; jawnie oddzielona dokumentacja od niewymaganej implementacji offline/przenoszenia semestru. |

Kontrakt zależności **153** został uwzględniony (AvailabilityInterval, AvailabilityResponse, ValidationError, tag Work profile, pusty tydzień, `24:00`, odpowiedzi 200/400/404/409/422/503). Nie jest zaliczony do 18 zgłoszeń Michała.

## Jawne rozstrzygnięcia i ulepszenia

- **Nakładanie dostępności:** edytor scala przed wysłaniem; repozytorium/API odrzucają przecięcia i duplikaty. Łączy to sprzeczne wymagania story i technicznych podzadań. Stykanie bez przecięcia jest poprawne.
- **Stawka zero:** poprawna we wszystkich warstwach. Wybór zgodny z technicznymi zadaniami i istniejącym CHECK w bazie. Niezgodność ze zdaniem story o zakazie zera pozostaje jawną decyzją, nie pominięciem.
- **Brutto/netto:** dodano `rateKind: gross|net|null` i `rodzaj_stawki` na profilu oraz zmianach. Przy stawce wymagane oznaczenie; brak konwersji jednego rodzaju kwoty na drugi. Dla starszych rekordów nie zgaduje się rodzaju kwoty.
- **Brak dojazdu vs zero:** kolumna nullable, bez domyślnego zera dla nowych profili. Istniejące zapisane zera zachowano, ponieważ nie można wiarygodnie odtworzyć, czy pochodziły z ustawienia, czy dawnego defaultu.
- **Wspólna wersja profilu i dostępności:** oba zapisy zwiększają tę samą wersję i blokują ten sam profil. Baza dodatkowo wymusza jeden aktywny profil na użytkownika.
- **Północ i granice tygodnia:** stykające się okna dostępności są scalane na rzeczywistych instantach na potrzeby planowania, by nie pobierać sztucznego bufora o północy. Płatna praca mieści się w wybranym tygodniu; ciągła dostępność sąsiedniego tygodnia może pomieścić bufor.
- **Zajęcia a wzorzec tygodnia:** po akceptacji użytkownika edytor wyłącza obowiązkowe zajęcia cykliczne. Jednorazowa wizyta nie usuwa godzin ze wszystkich przyszłych tygodni; generator uwzględnia ją w konkretnym terminie. Żaden zapis dostępności nie edytuje wydarzeń.
- **Snapshot:** utrwalany już przy generowaniu, więc korekta i późniejsza akceptacja nie podmieniają stawki po zmianie profilu. Akceptacja nadal sprawdza aktualne ograniczenia czasowe, lecz nie wymaga ponownego ustawienia stawki dla istniejącego snapshotu. Bufor przy generowaniu również jest zachowany do prezentacji.
- **Generator MVP:** deterministycznie wykorzystuje najwcześniejsze poprawne okna. Gdy cel jest nieosiągalny, zwraca częściowy/pusty plan z informacją, zamiast naruszać ograniczenia. Nie deklaruje globalnej optymalizacji ani optymalizacji preferowanych dni.
- **Ścisłe schematy:** wyłączono ciche usuwanie dodatkowych właściwości i konwersję typów przez Fastify/Ajv. Odrzucenie struktury zwraca spójne `invalid_request` z detalami.

## Weryfikacja końcowa

| Sprawdzenie | Wynik |
| --- | --- |
| `npm run typecheck` | API i web poprawne. |
| `npm run db:check` | 25 tabel modelu, 38 kluczy obcych. |
| `npm run build:api` | Poprawny build TypeScript. |
| `npm run build:web` | Poprawny eksport Expo web. |
| Wybrany zestaw API, normalizatorów, importów, kolizji, OCR i nowych testów PostgreSQL | **79/79** bez błędów; uruchomienie sekwencyjne. |
| `npm run test:web` | **12/12** bez błędów, w tym 3 nowe scenariusze domeny edytora i edycji instantów. |
| Nowe moduły po ostatnim rozszerzeniu testu PostgreSQL | **9/9** bez błędów (8 jednostkowych/tras + 1 rozbudowany integracyjny). |
| OpenAPI | Wszystkie schematy skompilowane w Ajv 2020, przykłady poprawne. |
| `npm run db:migrate` na lokalnej bazie | Migracje 001/002 pozostawione; 003/004 zastosowane poprawnie. |

Pełna komenda dla zestawu 79 testów:

```sh
node_modules/.bin/tsx --test --test-concurrency=1 \
  apps/api/tests/api.test.ts \
  apps/api/tests/import-rules.test.ts \
  apps/api/tests/import-session.test.ts \
  apps/api/tests/work-schedule.test.ts \
  apps/api/tests/work-schedule-api.test.ts \
  apps/api/tests/ics.test.ts \
  apps/api/tests/google.test.ts \
  apps/api/tests/collisions.test.ts \
  apps/api/tests/ocr.test.ts \
  apps/api/tests/work-profile.test.ts \
  apps/api/tests/scheduling.test.ts \
  apps/api/tests/planning.integration.test.ts
```

### Zastane problemy szerokiego zestawu testów

Wstępne uruchomienie wszystkich plików API dało 94 sukcesy i 4 niepowodzenia:

1. `classes.test.ts` i `work-schedule-reader.test.ts` — proces kończy się sygnałem **SIGBUS** podczas testów odczytu dokumentów. Obie awarie odtworzono także na niezmienionym `origin/master` w `/tmp/kac-origin-baseline`, z tymi samymi zainstalowanymi zależnościami.
2. `features.integration.test.ts` — SIGBUS przy odczycie PDF po wcześniejszych poprawnych operacjach kalendarza/importu. Jest to ta sama ścieżka odczytu dokumentu co powyżej; dla tego pliku nie wykonano osobnego porównania baseline. Nie deklaruje się ustalonej przyczyny natywnej awarii.
3. `postgres.integration.test.ts` — 409 zamiast 201, ponieważ starszy test tworzy stałe terminy w kalendarzu demonstracyjnym z istniejącymi wydarzeniami. Ten sam wynik potwierdzono na `origin/master` z tą samą bazą. Nowy test zakresu używa własnego schematu, profilu i kalendarza.

Nie ma dostępnego core dumpu (`coredumpctl`: „No coredumps found”), więc brak podstaw do wskazania konkretnej natywnej biblioteki jako przyczyny SIGBUS. Odczyt pamięci systemu nie wskazywał wyczerpania RAM. Środowisko uruchamia Node **22.23.3**, podczas gdy repo wymaga **^24.3.0 / ^26 / >=27**; warto ujednolicić runtime i ponowić testy odczytu dokumentów. Nie zmieniano konfiguracji systemu ani zależności w celu maskowania tych awarii.

Logi diagnostyczne z sesji: `/tmp/kac-all-api-tests.log`, `/tmp/kac-baseline-tests.log`, `/tmp/kac-baseline-postgres.log`, `/tmp/kac-final-api-tests.log`, `/tmp/kac-final-web-tests.log`, `/tmp/kac-planning-tests.log`.

Nie wykonano ręcznego przeglądu interfejsu w przeglądarce ani testów na urządzeniu mobilnym. Walidacja FE obejmuje testy domeny, kompilację i build. Uwierzytelnianie produkcyjne nie jest częścią tego zakresu: właściciel wybierany jest po stronie serwera przez konfigurację konta demonstracyjnego, zgodnie z dotychczasową architekturą; repozytoria sprawdzają własność przekazanego konta.
