# Wymagania i przypadki użycia — zakres Michała Kozłowskiego

Źródło: zakres S23KC2S1P2-228, sprint 204. Dokument opracowuje wymagania; nie deklaruje implementacji trybu offline ani przenoszenia semestru. Terminologia uzupełnia dokumenty etapu A w `Dokumentacja_Etap_A_KAC_2026-10-21/`. Aktualizacja: 2026-11-06.

## Potrzeby i słownik

| ID | Opracowanie | Kryterium weryfikacji |
| --- | --- | --- |
| STRQ-07 | Student potrzebuje określać dni tygodnia i przedziały godzin dostępności do pracy, aby plan nie naruszał jego możliwości czasowych. Dostępność jest wejściem do planowania, nie wydarzeniem kalendarza. | Pusty tydzień, kilka przedziałów, zakres nocny, kopiowanie i zapis/anulowanie w UC-07. |
| STRQ-08 | Student potrzebuje określać preferowane warunki pracy: minimum, cel i maksimum godzin tygodniowo oraz preferowane dni. System powinien rozróżniać twardą dostępność od miękkiej preferencji. | UC-08; zgodność minimum ≤ cel ≤ maksimum; preferowane dni jako kryterium wyboru spośród poprawnych planów. |
| TERM-07 | **Praca:** wykonywanie przez studenta obowiązków zawodowych w wyznaczonym terminie. | Zmiana ma początek i koniec; dojazd nie stanowi płatnego czasu pracy. |
| TERM-08 | **Grafik pracy:** zbiór terminów pracy studenta ustalony przez pracodawcę. | Propozycja systemu staje się zaakceptowanym planem studenta; sama propozycja nie potwierdza uzgodnienia z pracodawcą. |

## Funkcje i wymagania jakościowe

| ID | Priorytet | Wymaganie i kryteria akceptacji |
| --- | --- | --- |
| FEAT-07 | High | System wykrywa nakładanie terminów co najmniej dwóch wydarzeń i informuje o kolizjach. Stosuje przedziały półotwarte [początek, koniec): stykające się wydarzenia nie kolidują. Uwzględnia wystąpienia cykliczne i strefę kalendarza. Informacja identyfikuje oba wydarzenia i czas wspólny. Dojazd jest odrębnym ograniczeniem odstępu, nawet bez kolizji samych wydarzeń. |
| FEAT-08 | High | System wykrywa wielokrotnie zapisane wydarzenia i informuje o duplikatach przed zatwierdzeniem importu. Tożsamość zewnętrzna, jeśli dostępna, ma pierwszeństwo; lokalna reguła projektu porównuje znormalizowany tytuł oraz początek. Użytkownik wybiera pominięcie, zastąpienie lub świadome zachowanie obu. Podobny tytuł w innym terminie nie wystarcza do uznania duplikatu. |
| SR-07 | Medium | Przeniesienie planu semestralnego trwa nie więcej niż 30 s, od potwierdzenia operacji do komunikatu o trwałym zapisie. Test obejmuje co najmniej semestr 20 tygodni i 500 wystąpień na opisanym środowisku referencyjnym, po rozgrzaniu aplikacji. Przy błędzie nie wolno pozostawić częściowo przeniesionego planu. Limit nie obejmuje wcześniejszego pobierania zewnętrznych dokumentów; ten etap należy mierzyć osobno. Parametry pomiaru są uszczegółowieniem projektowym, do uzgodnienia przy implementacji tej funkcji. |
| SR-08 | High | Podstawowe przeglądanie wcześniej zapisanego planu działa bez Internetu. Po wcześniejszym udanym pobraniu użytkownik widzi zapisane wydarzenia i datę ostatniej synchronizacji. Brak danych lokalnych daje czytelny pusty stan. Integracje zewnętrzne mogą wymagać sieci. Wymaganie nie obiecuje zapisu offline ani synchronizacji konfliktowych edycji. Kryterium: uruchomienie ponownie bez sieci i przeglądanie pobranego zakresu. |

## UC-07 — ustawienie dostępności (High)

**Aktor:** student. **Cel:** zapis przedziałów jako wejścia do planowania. **Warunki wstępne:** istnieją konto i aktywny profil pracy. **Wyzwalacz:** otwarcie profilu / edytora dostępności.

1. System pokazuje zapisany tydzień i sumę godzin. Brak zakresów oznacza pusty tydzień i informację o niemożności wygenerowania pracy.
2. Student dodaje, usuwa lub zmienia przedziały oraz kopiuje dzień na wybrane dni. Zmiany są szkicem lokalnym.
3. System sprawdza godziny; zakres nocny dzieli na granicy dnia (także niedziela–poniedziałek), zachowując `24:00`. Edytor scala nakładanie w jednym dniu.
4. System oznacza części zajęte przez obowiązkowe zajęcia cykliczne. Student akceptuje wyłączenie tych części albo poprawia godziny. Jednorazowe wydarzenia ograniczają konkretny grafik, zamiast trwale zmieniać wzorzec każdego tygodnia.
5. Student wybiera „Zapisz”. System weryfikuje właściciela i wersję profilu i atomowo zastępuje pełną dostępność.
6. System pokazuje sumę godzin; poniżej celu ostrzega o możliwej nieosiągalności. Nie zmienia wydarzeń kalendarza.

**Alternatywy:** niepoprawne godziny → błąd przy wskazanym dniu; anulowanie → przywrócenie zapisanej kopii; błąd bazy → szkic pozostaje i baza zachowuje poprzedni stan; nieaktualna wersja → konflikt bez nadpisania danych, możliwość ponownego wczytania. Pusta lista świadomie usuwa dostępność. Backend odrzuca nieznormalizowane przecięcia.

**Warunek końcowy sukcesu:** cały wzorzec dostępności zapisany z nową wersją. **Powiązania:** STRQ-07; S23KC2S1P2-9, 149–152; kontrakt dostępności powiązany z zadaniem 153.

## UC-08 — warunki godzinowe pracy (High)

**Aktor:** student. **Cel:** określenie minimum, maksimum i celu godzinowego. **Warunki wstępne:** aktywny profil. **Wyzwalacz:** edycja profilu pracy.

1. System pokazuje zapisane wartości; brak wartości oznacza „nie ustawiono”, a nie zero.
2. Student wprowadza minimum, cel i maksimum godzin tygodniowo.
3. System odrzuca liczby ujemne i niespójne limity (minimum > cel, cel > maksimum lub minimum > maksimum), jeśli odpowiednie granice są ustawione.
4. Student zapisuje; system atomowo utrwala profil z kontrolą wersji.
5. Generator traktuje cel jako liczbę godzin do zaplanowania i maksimum jako granicę. Jeśli ograniczenia uniemożliwiają osiągnięcie celu, zwraca mniejszy plan i wyraźną informację; nie tworzy kolidujących zmian dla osiągnięcia celu.

**Alternatywy:** anulowanie przywraca zapisane ustawienia; błąd zapisu zachowuje formularz; konflikt wersji wymaga ponownego odczytu; brak celu blokuje planowanie z listą brakujących ustawień. Minimum pomaga określić prawidłowy cel, ale nie wymusza kolizyjnego uzupełniania planu.

**Warunek końcowy sukcesu:** wartości zapisane w profilu i dostępne dla planowania. **Powiązania:** STRQ-08. Preferowanie konkretnych dni pozostaje osobną preferencją, nie zakazem pracy w innych dostępnych dniach; obecny zakres techniczny nie obejmuje algorytmu optymalizacji preferencji.

## Granica zakresu dokumentacyjnego

S23KC2S1P2-228 dostarcza wszystkie powyższe definicje i scenariusze. Wdrożenie SR-07, SR-08 oraz pełnej optymalizacji preferowanych dni wymaga osobnego zakresu wykonawczego. Niniejszy dokument nie zmienia Jira.
