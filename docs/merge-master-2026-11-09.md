# Aktualizacja master — 2026-11-09

Pobrano `origin/master` na commicie `cde8cec` i scalono z `feature/sprint-204-michal` (poprzedni HEAD: `ba352c1`). Przed rozpoczęciem drzewo było czyste. Nie wykonano push ani zmian w Jira.

## Zachowane funkcje z master

- Pełny profil pracy z celem tygodniowym lub miesięcznym, przeliczeniem miesiąca jako 52/12 tygodnia, postępem względem celu i ochroną niezapisanej edycji przy zmianie zakładki.
- Szczegóły zajęć i ich wystąpień cyklicznych w planowanym tygodniu, lista wolnych okien, wskazanie konkretnych zajęć kolidujących z ręczną korektą oraz `insufficient_free_time`.
- Zakładka Blokady: urlopy, sesje egzaminacyjne i dni wolne.
- Dotychczasowe planery, odczyt historii, akceptacja i odrzucanie propozycji, limity dzienne, szablony zmian i podgląd kalendarza.

## Ponowna integracja wcześniejszego zakresu

Nowy master wprowadził inne implementacje plików `profile/repository.ts`, `WorkProfileScreen.tsx`, `workProfileApi.ts` i `scheduling/constraints.ts`, a także własny kontrakt `/api/v1/work-profile`. Nie zastąpiono ich starszymi wersjami.

- `/api/v1/work-profile` zachowuje kontrakt master: pełny profil z `profileVersion`, `targetPeriod`, celami i ustawieniami planowania.
- Wcześniejszy, nieopublikowany wariant formularza stawki jest pod **`/api/v1/work-profile/compensation`**. Repozytorium i klient zostały wydzielone do `profile/compensation-repository.ts` i `services/compensationApi.ts`, a formularz do `CompensationScreen.tsx`. Klient web został zaktualizowany w tym samym scaleniu.
- Edytor dostępności nadal używa `/api/v1/work-profile/availability`, w tym `24:00`, przedziałów nocnych, kopiowania i zapisu atomowego. Pełny profil z master także akceptuje `24:00`.
- Zapis pełnego profilu zwiększa również liczbową wersję używaną przez wcześniejszy edytor. Oba formularze wykrywają równoczesne zmiany, zamiast nadpisywać je po cichu.
- Zapis samej stawki i brutto/netto **zachowuje cel miesięczny**. Jawna zmiana celu tygodniowego w sekcji Stawka i dostępność przełącza cel na tygodniowy i czyści miesięczną wartość. Stawki, kwoty i brutto/netto zaakceptowanych zmian pozostają snapshotami.
- Zachowano regułę `max(dojazd, odpoczynek)` dla dwóch zmian. Nowe funkcje kolizji zajęć współdzielą tę regułę z wcześniejszym walidatorem. Testy wymagające sumowania zostały dostosowane do przyjętej wcześniej decyzji architektonicznej.
- Nowe schematy odpowiedzi grafiku nadal opisują kwoty PLN i snapshoty, obok pól `blockingEvents`, `freeWindows` i naruszeń zajęć.
- Błąd wykryty w transakcji akceptacji zwraca poprawną odpowiedź `422` z `errors` i `warnings`, zgodną z nowym schematem master. Nie jest maskowany przez błąd serializacji.

Wszystkie endpointy pozostają w modułach `apps/api/src/api/v1/` i pod `/api/v1`. Nie dodano niewersjonowanych aliasów. Tożsamość dla profilu, dostępności, wynagrodzenia, wcześniejszego planera i blokad jest ustalana przez serwerowy scope.

## Poprawki potrzebne do działania blokad

Podczas integracji poprawiono problemy w nowym kodzie:

1. Listowanie i usuwanie blokad ograniczono do właściciela. Cudzy identyfikator przy usuwaniu daje `404`.
2. Schematy odpowiedzi Fastify zwracają rzeczywistą tablicę/obiekt JSON; zastąpiono nieprawidłowe zagnieżdżenie OpenAPI `content` w schemacie serializatora.
3. API wymaga jednoznacznych instantów ISO z offsetem i końca po początku. Formularz przelicza lokalne wpisy na UTC, a odpowiedź zachowuje `Z`, zamiast obcinać strefę.
4. Tworzenie tabeli przeniesiono z konstruktorów i odczytów repozytorium do migracji **`010_calendar_blocks.sql`**. Odczyt profilu nie wykonuje DDL ani nie ukrywa błędów inicjalizacji.
5. Blokady kalendarza ograniczają oba planery. Nie są kopiowane do edytowalnych blokad profilu: usunięcie blokady nie pozostawia przypadkowej drugiej kopii.
6. Tworzenie/usuwanie blokady blokuje kalendarze właściciela w transakcji, dzięki czemu nie omija blokad używanych przy akceptacji grafiku.
7. Zapytania kontekstu wykonywane na kliencie transakcji są szeregowane, zamiast uruchamiać współbieżne `client.query()`.

## Migracje i dokumentacja

W lokalnej bazie zastosowano `009_work_profile.sql` z master oraz `010_calendar_blocks.sql`. Wcześniejszych zastosowanych migracji nie zmieniono. Kontrola schematu obejmuje 27 tabel i 40 kluczy obcych.

Zregenerowano kanoniczny `apps/api/openapi/openapi.json` (34 ścieżki, 41 operacji) i obie referencje Docusaurus. Dokumentacja opisowa w `docs-site/docs/work-profile.md` i odpowiedniku angielskim opisuje nowe kontrakty, cele miesięczne i blokady. `docs/openapi-work-planning.json` pozostaje uzupełniającym kontraktem wcześniejszego zakresu; wspólnym źródłem bieżącego API są schematy Fastify i kanoniczny eksport.

## Weryfikacja

- `npm run typecheck`: API, web i dokumentacja — poprawne.
- `npm run api:openapi:check`: aktualny kontrakt.
- `npm run docs:build`: poprawny build PL i EN, także po aktualizacji opisów integracji.
- `npm run build`: poprawny pełny build aplikacji i dokumentacji.
- `npm test`: **18/18 web**, **117/119 API**. Dwa niepowodzenia to znane awarie `SIGBUS` w `classes.test.ts` i `work-schedule-reader.test.ts`; nie usunięto tych testów ani nie przedstawiono pełnego zestawu jako zielonego.
- PostgreSQL: **4/4** — izolowany test wcześniejszego zakresu i integracji obu profili, integracja grafiku z master, profil miesięczny oraz kolizje zajęć.
- Końcowe testy odpowiedzi akceptacji, blokad i stawki: **6/6**.

Rozszerzony test izolowanego PostgreSQL potwierdza: zapis miesięcznego celu przez HTTP z `24:00`; zmianę stawki bez utraty okresu; wspólne wersjonowanie; brak dostępu do cudzych blokad; brak kopiowania blokad do profilu; odrzucenie planowania podczas sesji w obu planerach i ponowną możliwość planowania po usunięciu blokady. Zachowane są wcześniejsze testy rollbacku, groszowego zaokrąglania i niezmienności historii.

Logi sesji: `/tmp/kac-nov09-full-tests.log`, `/tmp/kac-nov09-final-db.log`, `/tmp/kac-nov09-final-contracts.log`, `/tmp/kac-nov09-openapi-check.log`, `/tmp/kac-nov09-typecheck.log`, `/tmp/kac-nov09-final-docs-build.log`, `/tmp/kac-nov09-build.log`, `/tmp/kac-nov09-migrate.log`.

Nie wykonano wizualnego przeglądu w przeglądarce ani testów na urządzeniu mobilnym. Weryfikacja obejmuje zachowanie domeny, `app.inject()`, rzeczywisty PostgreSQL, kompilację i build.
