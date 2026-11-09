# Historia i uporządkowanie integracji

Porównanie wykonano na podstawie grafu Git, zawartości commitów i prób zachowania kodu, nie samych opisów commitów ani statusów Jira. Zakres porównania to pierwotna baza `dd87972`, master sprzed naszego PR (`cde8cec`) oraz master po scaleniu PR #17 (`221b846`).

## Najważniejszy wniosek

Funkcje rozwijane na masterze mają pozostać podstawą aplikacji. Nasz zakres powinien je uzupełniać. Błędem wcześniejszej integracji było pozostawienie dwóch aktywnych planerów i dwóch pełnych formularzy dla tych samych danych. Zachowanie obu zapobiegło utracie kodu, ale dało użytkownikowi sprzeczne reguły. Obecna poprawka usuwa ten podział: istnieje jeden formularz profilu i jeden aktywny silnik planowania, oparty na rozwiązaniu z mastera.

## 1. Co wynika z historii

| Moment | Dowód w Git | Stan funkcji |
| --- | --- | --- |
| 5 XI, przed naszą implementacją | `dd87972`, pierwotna baza na masterze | Kalendarz, importy, kolizje i model tabel profilu/grafików. Brak modułu profilu i generatora aplikacyjnego; same tabele nie oznaczały gotowej funkcji. |
| 5–6 XI, równoległa gałąź planowania | `f84de98`, `a65da72`, `f1dec56` | Powstawał generator, ustawienia godzin/dojazdu, tryby i szablony, później edycja dostępności, limity dzienne, akceptacja/odrzucanie i podgląd. Autorstwo części tych commitów czasowo poprzedza nasz pierwszy commit, ale kod nie był jeszcze w pierwotnym masterze. |
| 5–6 XI, nasza gałąź | `be1265e`, `1bbc77d`, `8bff3d3`, `f157336` | Dostępność, osobny profil, dokładna płaca, brutto/netto, drugi prosty planer i dokumentacja. Prace nakładały się z gałęzią wyżej. |
| 6 XI, merge PR #10 i #11 | `604800d`, `245ef1f` | Planowanie i ustawienia były już na masterze. `2fb335e` dodał modularne `/api/v1`, runtime OpenAPI i Docusaurus; `0a135ff` poprawił dokumentację. Tych funkcji nie należy przedstawiać jako nowego wkładu naszego zakresu. |
| 8 XI, merge PR #12 | `ec2d85a`, rodzice `3b83398` i `7703bf9` | Pełny profil, cele miesięczne, licznik celu, ochrona niezapisanej edycji oraz szczegółowe uwzględnianie zajęć. |
| 9 XI, merge PR #16 | `cde8cec`, gałąź z `af7125e` | Urlopy, sesje i dni wolne w Blokadach. To funkcja istniejąca przed naszym PR, a nie funkcja dodana przez nas od zera. |
| 9 XI, merge naszego PR #17 | `221b846`, rodzice `cde8cec` i `f3306f7` | Master zawiera już oba zestawy zmian. Dlatego diff bieżącej gałęzi do mastera był pusty; do ustalenia naszego wkładu trzeba porównać **pierwszego rodzica** tego merge'a, nie całego dzisiejszego mastera. |

Daty commitów i daty wejścia na master to różne informacje. Pierwotna implementacja miała sens wobec ówczesnego mastera, lecz po późniejszych scaleniach należało zrezygnować z równoległego produktu.

## 2. Porównanie funkcji i pochodzenia

| Obszar | Było na masterze przed PR #17 | Nasz potrzebny wkład | Stan po uporządkowaniu |
| --- | --- | --- | --- |
| Profil i cel godzin | Pełny formularz, tryby pracy, minimum/cel/maksimum, cel tygodniowy/miesięczny, walidacja, wersjonowanie, anulowanie i ochrona przy wyjściu | Stawka PLN i brutto/netto; zachowanie oznaczenia i historii | Rozszerzenie istniejącego `WorkProfileScreen`, `useWorkProfile`, `/api/v1/work-profile` i jego repozytorium. Bez drugiego formularza w Ustawieniach. |
| Dostępność | Dodawanie, edycja i usuwanie okien; zapis z profilem w transakcji | Kopiowanie dni, scalanie nakładania w FE, noc/24:00, jednoznaczna normalizacja, suma godzin, osobny zasób dostępności | Jeden kontrolowany edytor wewnątrz formularza Karola. Jedno „Zapisz profil” i „Anuluj”. Zasób dostępności korzysta z tego samego repozytorium i blokady profilu. |
| Generowanie i korekta | Generator, tryby/szablony, limity dzienne i tygodniowe, istniejąca praca, minimum/maksimum slotu, Pracoholik, wersje grafiku | Poprawna płaca i szczegółowe reguły dojazdu | Wyłącznie dotychczasowy silnik w `scheduling/generator.ts` i endpointy `/api/v1/schedules`. Nasz prosty generator został usunięty. |
| Zajęcia | Wystąpienia tygodniowe, data końca serii, obowiązkowe i opcjonalne zajęcia, wolne okna, `class_collision` i kontekst w UI | Brzegi dostępności, sąsiad spoza tygodnia i spójny bufor | Rozszerzenie wspólnego `constraints.ts`; bez drugiego czytnika kalendarza. Edytor dostępności wykorzystuje kontekst już wyliczony przez planer. |
| Dojazd i odpoczynek | Pola profilu i uwzględnianie bufora były już obecne | `max(commute,rest)` zamiast sumy między pracami, bufor wewnątrz dostępności, rzeczywiste instants i wyjaśnialne naruszenia | Jedna reguła dla wspólnego generatora i walidacji. Adres nie wpływa na stały bufor MVP. |
| Wynagrodzenie | Kolumny stawki i kwoty, zapis stawek na zmianach oraz podstawowe mnożenie czasu przez stawkę — nie było to całkowicie puste | Całkowite grosze/BigInt, half-up per zmiana, suma zaokrąglonych zmian, null ≠ zero, brutto/netto, ekspozycja snapshotów i walidacja precyzji | Wspólny `pay.ts`, zapis i odczyt w repozytorium Karola, kwoty w dotychczasowym Grafiku i historii. Nie dodano drugiego mechanizmu kalkulacji. |
| Akceptacja i odrzucanie | Były już wdrożone, także zastępowanie wcześniejszego opublikowanego planu | Ponowna kontrola pod blokadą kalendarza/profilu, ochrona snapshotów | Zachowany cykl Karola z walidacją transakcyjną. |
| Blokady | Ekran i API z PR #16 | Naprawa serializacji JSON, właściciela, UTC, DDL i współpracy z profilem | Ekran pozostaje; błędy integracji naprawione. Blokady nie są kopiowane do edytowalnych ustawień. |
| OpenAPI i Docusaurus | Wersjonowane API, generator specyfikacji, dokumentacja PL/EN i CI były na masterze | Uzupełnienie nowych pól, błędów i przykładów | Jedna specyfikacja generowana z Fastify. Usunięto dodatkowy statyczny JSON i duży duplikat schematów wcześniejszego workflow. |
| Wymagania | Zakres 228 był zadaniem dokumentacyjnym | STRQ/TERM/FEAT/SR/UC z przypisanego zestawu | Dokument zostaje. Nie przypisuje sobie implementacji offline ani przenoszenia semestru. |

## 3. Potwierdzone rozbieżności poprzedniej integracji

Próby wykonano na syntetycznych danych przed usunięciem drugiego silnika. Wyniki zapisano w `/tmp/kac-audit-planners-result.json`.

| Ten sam przypadek | „Grafik” z mastera | Nasz dawny „Asystent” | Wniosek |
| --- | --- | --- | --- |
| Cel 8 h, dostępność jednego dnia, limit dzienny 4 h | Planował 4 h i wskazywał niedobór | Planował 8 h | Drugi planer pomijał limit dzienny. |
| Tryb zmianowy, jedyny szablon 08:00–12:00 | Planował zmianę 08:00–12:00 | Planował 08:00–16:00 | Drugi planer nie stosował szablonów. |
| Istniejące 4 h pracy, cel i maksimum 8 h | Dodawał 4 h, razem 8 h | Dodawał 8 h, razem 12 h | Drugi planer nie zaliczał istniejącej pracy do celu/maksimum. |
| Okna rozdzielone zajęciami, wymagany odpoczynek 120 min | Wspólny wybór kandydatów respektował odpoczynek | Generował 08–10 i 11–13, po czym jego walidator odrzucał odstęp 60 min | Generowanie i walidacja drugiego workflow były sprzeczne. |
| Ręczna zmiana 29 III 2026, 01:00–04:00 w Warszawie | Walidacja liczyła 180 min ściennych | Kalkulator płacy liczył prawidłowe 120 min | Po częściowej integracji istniała niespójność godzin i pieniędzy. Poprawiono walidację istniejącego planera do rzeczywistych minut, również dla jesiennego DST. |

Samo rozdzielenie obu silników polem `generator_version` nie naprawiało problemu: były to różne reguły dla tych samych ustawień użytkownika.

## 4. Co zmieniono teraz

1. Pozostawiono układ i funkcje Karola: Grafik, pełny profil, cele miesięczne, szablony, Pracoholik, licznik celu, klasy/kolizje, blokady, podgląd i ostrzeżenia niezapisanej edycji.
2. Dodano stawkę i brutto/netto do **tego samego formularza**. Zmiany finansów, celu i dostępności zapisują się jednym żądaniem i anulują razem. Starszy klient pomijający nowe pola nie zeruje istniejącej stawki. Stary profil ze stawką bez oznaczenia pozostaje edytowalny, lecz nowe planowanie wymaga uzupełnienia oznaczenia.
3. Dostępność ma kontrolowany edytor, bez własnych niezależnych zapisów. Kopiowanie i normalizacja nie omijają hooka, walidacji ani ostrzeżenia przy wyjściu.
4. Wycofano drugi aktywny planer, jego repozytorium, czytnik kontekstu, ekran, klienta i dodatkowy formularz finansów. Asystent wrócił do miejsca pozostawionego na masterze; nie służy jako alternatywna droga omijania ograniczeń.
5. Stare adresy duplikujących przepływów zwracają jawne `410 workflow_consolidated` ze wskazaniem następcy. Nie wykonują żadnego zapisu ani planowania. Wszystkie adresy pozostają pod `/api/v1`.
6. Historia jest dostępna w **Grafik → Historia wybranego tygodnia**, z paginacją. Wybrany zapis jest tylko do odczytu. Kwoty, stawki, daty i istniejące wydarzenia zachowano. Adapter odczytu rozumie dawne statusy i identyfikatory zmian; nie uruchamia starego silnika i nie przelicza historii bieżącym profilem.
7. Dawne zapisy nie przejmują wersjonowania aktualnego planera. Zakceptowane wcześniej wydarzenia z wycofanego workflow pozostają w kalendarzu jako istniejąca praca; nie są automatycznie kasowane podczas regeneracji. Karolowski mechanizm zastępowania jego własnych opublikowanych planów pozostaje bez zmian.
8. Migracja `011_single_active_profile_index.sql` zachowuje indeks unikalności aktywnego profilu z mastera i usuwa identyczny indeks dodany na naszej gałęzi. Nie przepisuje kwot ani rekordów historii. Zastosowane wcześniej migracje nie zostały zmienione.
9. Pozostawiono lokalną poprawkę przewijania Ustawień: jeden ScrollView dla całej zakładki.

## 5. Świadome decyzje zgodne z pierwotnym zakresem

- Zero stawki jest poprawne, null oznacza brak; brutto/netto nie podlega przeliczeniu.
- FE scala przecięcia, backend odrzuca nieznormalizowane przecięcia.
- `24:00` nie jest zastępowane przez `23:59`; zakresy nocne dzielą się także między niedzielą i poniedziałkiem.
- Minuty i płaca wynikają z instantów, nie różnicy wskazań zegara przy DST.
- Zajęcia opcjonalne zachowują miękką regułę Karola; nie zamieniono ich na obowiązkowe blokady.
- Osobny endpoint dostępności zachowuje liczbową wersję kompatybilności, ale zapisuje ten sam wiersz profilu co `profileVersion` pełnego formularza. Nie jest drugim modelem profilu.
- Podsumowanie wypłaty obejmuje zmiany danej propozycji. Nie wymyśla stawek innych wydarzeń pracy bez snapshotu.

## 6. Weryfikacja

- `npm run typecheck` — poprawnie dla API, aplikacji i dokumentacji.
- `npm run db:check` — poprawnie: 27 tabel, 40 kluczy obcych.
- `npm run api:openapi:check` — kontrakt aktualny; regeneracja referencji PL/EN obejmuje 41 operacji, w tym jawnie wycofane operacje zwracające 410.
- `npm test` — aplikacja 18/18; API 116/118. Dwa procesy (`classes.test.ts`, `work-schedule-reader.test.ts`) kończą się znanym SIGBUS w natywnym OCR, odtworzonym wcześniej także na bazowej wersji. Nie są pominięte w podanych wynikach.
- Testy PostgreSQL — 4/4; dodatkowo ponownie uruchomiony scenariusz integracji profilu i planowania po migracji 011: 1/1. Pokryto rollback INSERT, współbieżną wersję, właściciela, pełny profil i cel miesięczny, snapshot po zmianie stawki, blokady przy akceptacji, odrzucenie oraz odczyt dawnej historii.
- `npm run db:migrate` — migracja 011 zastosowana poprawnie.
- `npm run docs:build` — oba języki poprawnie. Poprawiono składnię Markdown ścieżki z parametrem w nowym opisie API.
- `npm run build` — API, eksport web i dokumentacja PL/EN poprawnie.
- `git diff --check` — bez błędów. Nie wykonano ręcznych testów wizualnych w przeglądarce ani na urządzeniu mobilnym.

 Historyczne raporty `sprint-204-report.md` i `merge-master-2026-11-*.md` opisują wcześniejsze etapy, a nie docelową architekturę.
