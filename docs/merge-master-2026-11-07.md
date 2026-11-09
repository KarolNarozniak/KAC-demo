# Scalenie master — 2026-11-07

Gałąź robocza: `feature/sprint-204-michal`. Pobrano i scalono `origin/master` na commicie `245ef1f` (poprzednia baza: `dd87972`). Drzewo robocze przed scaleniem było czyste. Niczego nie opublikowano.

## Rozwiązanie konfliktów

Konflikty obejmowały `apps/api/package.json`, `app.ts`, `server.ts`, repozytorium i testy planowania, `ScheduleScreen.tsx` oraz seed bazy. Zachowano modułową architekturę master, Swagger/Docusaurus, konfigurację trybów pracy, limity dzienne, podgląd propozycji w kalendarzu, wersjonowanie grafiku, potwierdzenie tygodnia bez zajęć i zastępowanie zaakceptowanego planu.

Wcześniejszy zakres dostępności, stawki i wynagrodzenia nie został usunięty:

- **Grafik** wykorzystuje `PostgresScheduleRepository` i endpointy `/api/v1/schedules` / `/api/v1/scheduling/settings`.
- **Asystent** zachowuje wcześniejszy planer oraz jego historię w `scheduling/work-profile-repository.ts` i `WorkScheduleScreen.tsx`. Endpointy są teraz pod `/api/v1/work-profile/schedules`.
- Edycja profilu i dostępności jest pod `/api/v1/work-profile` i `/api/v1/work-profile/availability`. Wszystkie trasy znajdują się w modułach `apps/api/src/api/v1/`; nie dodano niewersjonowanych aliasów.
- Oba planery współdzielą profil, dostępność i wydarzenia, ale przechowują osobne cykle życia propozycji. Zapytania filtrują rodzaj generatora, aby odrzucenie, numerowanie wersji lub zastąpienie w jednym planerze nie dotykało historii drugiego. Zaawansowane ustawienia i szablony master pozostają funkcją zakładki Grafik.

## Ujednolicone zachowanie

- Zapis ustawień zaawansowanego planera zwiększa także liczbową wersję profilu używaną przez edytor dostępności. Przecięcia dostępności są sprawdzane w repozytorium; pełna lista jest zastępowana w tej samej transakcji co ustawienia. `24:00` jest obsługiwane również w planerze z master.
- W Grafikach wynagrodzenie jest liczone wspólnym kalkulatorem całkowitych groszy i zapisuje stawkę oraz brutto/netto na zmianach. Podsumowanie sumuje osobno zaokrąglone kwoty. Wyświetlane kwoty po edycji godzin pozostają ostatnim snapshotem do ponownego zapisu. Nie przelicza się historii aktualną stawką.
- Reguła przerw to `max(dojazd, odpoczynek)` między zmianami. Bufor musi mieścić się w dostępności. Uwzględniane są także wydarzenia poza granicą tygodnia. Zaawansowany planer nadal może pomijać nieobowiązkowy wykład z ostrzeżeniem, zgodnie z funkcją master.
- Akceptacja zaawansowanego planu ponownie waliduje kalendarz i profil **wewnątrz transakcji**, po ich zablokowaniu, nie tylko w handlerze przed zapisem. Odczyty używają tego samego klienta transakcji.
- Odczyt grafiku po ID w zaawansowanym repozytorium jest ograniczony do kalendarza wybranego na serwerze.
- Ścisła walidacja danych profilu działa w osobnym zakresie Fastify. Zachowano konwersję typów parametrów query, potrzebną paginacji master.

## Migracje i dane

Nie zmieniono wcześniej zastosowanych migracji 001–004. Dodano:

- `007_work_profile_workflow.sql`: oznacza wcześniejsze rekordy generatora i zachowuje ich status przed migracją `008_schedule_workflow_status.sql` z master;
- `009_work_profile_workflow_restore.sql`: przywraca te statusy po normalizacji master.

Migracje z master i obie powyższe zostały zastosowane w lokalnej bazie. Test izolowanego PostgreSQL sprawdza, że wcześniejsze akceptacje, odrzucenia i kwoty przetrwały normalizację, oraz że dwa planery nie odrzucają sobie propozycji. Seed nie tworzy drugiego aktywnego profilu istniejącego konta. Test PostgreSQL z master ma osobne konto i kalendarz, zgodnie z ograniczeniem jednego aktywnego profilu.

## Weryfikacja

- API i web oraz dokumentacja: poprawny typecheck.
- 27 testów regresyjnych API, obu generatorów i dwóch zestawów PostgreSQL: **27/27**.
- Pełne `npm test`: web **12/12**, API **101/103**. Pozostają znane z poprzedniego wdrożenia awarie `SIGBUS` w `classes.test.ts` i `work-schedule-reader.test.ts`; pozostałe testy przechodzą. Te same ścieżki OCR wcześniej odtworzono na niezmienionym master. Nie maskowano ich przez usuwanie testów.
- `npm run api:openapi:check`: poprawny, 32 ścieżki i 38 operacji. Kanoniczna specyfikacja jest w `apps/api/openapi/openapi.json`, generowana ze schematów Fastify.
- `npm run docs:build`: poprawny build polskiej i angielskiej dokumentacji.
- `npm run build`: pełny build aplikacji i dokumentacji.
- `npm run db:check`: 26 tabel i 39 kluczy obcych; walidator uwzględnia wszystkie pliki migracji.

Dokumentacja opisowa została uzupełniona w obu językach: `docs-site/docs/work-profile.md` i odpowiednik angielski. Referencja API jest generowana z aktualnego OpenAPI. Nie wykonano wizualnego przeglądu interfejsu w przeglądarce; weryfikacja obejmuje testy, Swagger przez `app.inject()`, kompilację i build.
