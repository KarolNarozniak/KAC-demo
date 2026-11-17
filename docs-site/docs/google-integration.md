---
id: google-integration
title: Połączenie z Google Calendar
sidebar_label: Google Calendar
description: Trwałe połączenie konta Google – zgoda, szyfrowane tokeny, przyznany dostęp i lista kalendarzy.
---

# Połączenie z Google Calendar

Historyjka S23KC2S1P2-12 („Wykorzystanie istniejącego kalendarza Google”): podzadania G01 (S23KC2S1P2-284, backend) i G02 (S23KC2S1P2-286, panel w Ustawieniach). To połączenie jest **trwałe** – z niego korzystają synchronizacja, odłączanie i publikacja grafiku. Jednorazowy import (S23KC2S1P2-27, `/api/v1/import/google`) ma osobny kontrakt i działa bez zmian.

## Przebieg w aplikacji

**Ustawienia → Google Calendar** pokazuje stan połączenia i zakres dostępu, o który aplikacja poprosi: odczyt kalendarzy i wydarzeń oraz dodawanie i zmiana wydarzeń. „Zaloguj się przez Google” otwiera w nowej karcie stronę Google z wyborem konta i zgodą; panel co 2 sekundy pyta serwer o wynik i sam go pokazuje.

| Krok historyjki | Zachowanie |
| --- | --- |
| 1a – konto już połączone | Widać konto, datę połączenia, przyznany dostęp, listę kalendarzy oraz „Zmień konto” (z potwierdzeniem). Zwykłe „Połącz” zwraca `409 already_connected`. |
| 2a – brak internetu | Komunikat „Brak połączenia z internetem albo z serwerem KAC” i „Spróbuj ponownie”. |
| 5a – odmowa albo zamknięte okno | „Odmów” albo „Anuluj” kończą próbę bez zapisu; dotychczasowe połączenie zostaje. Spóźniony powrót z Google dla anulowanej próby niczego nie zapisuje. |
| 5b – wybór konta | Strona Google zawsze pokazuje wybór konta (`prompt=select_account consent`). W makiecie użytkownik wybiera jedno z dwóch kont demonstracyjnych. |
| 6a – błąd autoryzacji | Wygasły lub użyty kod, błąd Google albo brak tokenu odświeżania kończą próbę komunikatem; nic nie jest zapisywane. |
| 7a – brak kalendarzy | Konto bez kalendarzy zostaje połączone, a panel pokazuje pustą listę z wyjaśnieniem. |

Zapisywany jest **realnie przyznany** dostęp. Gdy użytkownik odznaczy w Google zapis wydarzeń, panel pokazuje „Dodawanie i zmiana wydarzeń – nie przyznano” i proponuje „Połącz ponownie”. Zgoda bez dostępu do kalendarza nie łączy konta. Gdy Google odrzuci zapisany token odświeżania (wygasł albo cofnięto zgodę), konto przechodzi w stan „Wymaga ponownego logowania”; lokalne wydarzenia pozostają bez zmian. Samo połączenie nie tworzy, nie zmienia i nie usuwa żadnych wydarzeń.

„Zmień konto” zastępuje poprzednie konto dopiero po udanym zalogowaniu na nowe. Poprzednie konto dostaje status „Niepołączone”, jego tokeny są usuwane, a licznik generacji rośnie – prace zaplanowane dla starego połączenia są odrzucane.

## Synchronizacja i błędy (G06)

Historyjka S23KC2S1P2-17, podzadanie G06 (S23KC2S1P2-290). Pod listą kalendarzy panel ma sekcję **Synchronizacja**: stan („Nigdy nie synchronizowano”, „W trakcie”, „Zsynchronizowano”, „Częściowo”, „Błąd”), czas ostatniej udanej synchronizacji i przycisk „Synchronizuj z Google”. Synchronizacja odczytuje listę kalendarzy, a potem pobiera zmiany wydarzeń z wybranych kalendarzy (G05, opis niżej). Publikacja (G07) i korekty (G09) zapisują próby w tym samym rejestrze.

- Każda próba trafia do `t_synchronizacje`: kierunek (odczyt/publikacja), zakres, operacja, liczba prób, liczba zmian, wynik, kod błędu i czas. Ostatni sukces odczytu i publikacji jest zapisany w koncie osobno, więc nieudana próba go nie nadpisuje.
- Błędy przejściowe – brak sieci albo przekroczony czas, limit zapytań, błąd serwera Google – są ponawiane automatycznie najwyżej 3 razy, z przerwami 0,5 s i 1 s. Brak zgody, brak uprawnień i wyłączone Calendar API nie są ponawiane.
- Przyczyna błędu jest rozróżniona: brak połączenia, wygasłe logowanie, brak uprawnień do kalendarza, limit, błąd po stronie Google (osobny komunikat dla wyłączonego Calendar API).
- Przy błędzie panel pokazuje przyczynę, czas ostatniego sukcesu oraz „Spróbuj ponownie” albo „Połącz ponownie konto Google”. Przy wygasłym logowaniu zwykłe ponowienie nie jest proponowane. Po udanym ponownym połączeniu synchronizacja rusza sama.
- Odmowa zgody przy ponownym logowaniu (5a) wyłącza synchronizację (`Zgoda_Synchronizacja`); konto i lokalne wydarzenia zostają bez zmian. Zgoda przy kolejnym logowaniu ją przywraca.
- Naraz trwa najwyżej jedna próba danego kierunku na konto. Próba przerwana np. restartem serwera po 5 minutach jest oznaczana jako błąd „przerwana”.
- Niepełna lista kalendarzy daje wynik „Częściowo” i nie usuwa kalendarzy, których lista nie objęła.
- W trybie demonstracyjnym można wymusić wynik następnej synchronizacji (brak internetu, chwilowy błąd sieci, wygasłe logowanie, błąd serwera, limit, wynik częściowy, brak uprawnień), żeby pokazać przebiegi bez prawdziwego Google.

## Wybór kalendarzy (G04)

Historyjka S23KC2S1P2-41, podzadanie G04 (S23KC2S1P2-288). Lista kalendarzy w panelu pokazuje, które są uwzględniane przy planowaniu i synchronizacji, oraz kalendarz publikacji grafiku. „Zmień wybór kalendarzy” otwiera edycję: pola wyboru źródeł i jeden kalendarz publikacji. „Dalej” pokazuje podsumowanie zmian, „Zatwierdź” je zapisuje, „Anuluj” zostawia poprzedni wybór.

- Zbiór źródeł (`t_kalendarze_google.wybrany`) i kalendarz publikacji (`t_konta_google.id_kal_publikacji`) zapisują się razem w jednej transakcji z kontrolą wersji (`wersja_wyboru`). Zapis ze starą wersją (np. z drugiego okna) kończy się `409 selection_conflict` bez żadnej zmiany; panel wczytuje wtedy aktualny wybór.
- Kalendarz publikacji musi mieć rolę właściciela albo odczytu i zapisu, a zgoda Google musi obejmować dodawanie wydarzeń. Sprawdza to serwer (`422 target_not_writable`, `422 write_access_missing`), nie tylko filtr w interfejsie, który pokazuje wyłącznie kalendarze z prawem zapisu.
- Obcy identyfikator kalendarza daje `400 unknown_calendar` i nic nie zapisuje.
- Dopóki użytkownik nie zapisał własnego wyboru, źródłem jest kalendarz główny. Bez żadnego źródła synchronizacja zwraca `409 no_calendars_selected`, a konto zostaje połączone.
- Utrata uprawnień: kalendarz, który zniknął z konta Google albo stracił dostęp, zostaje widoczny z oznaczeniem „brak dostępu”, dopóki jest wybrany albo jest kalendarzem publikacji. Panel pokazuje problem z kalendarzem publikacji (`targetProblem`). Niedostępnego kalendarza nie da się wybrać na nowo.
- Założenie D04 (do potwierdzenia w zespole): odznaczony kalendarz przestaje być brany pod uwagę – wydarzenia pobrane z niego przez synchronizację (G05) znikają z KAC w tej samej transakcji co zapis wyboru, a edytowane w KAC zostają jako zwykłe wydarzenia. Ręczne wpisy i jednorazowy import (27) nie są dotykane. Ponowne zaznaczenie zaczyna od pełnego odczytu i nie dubluje zachowanych kopii. Podsumowanie przed zatwierdzeniem o tym uprzedza.
- Po zatwierdzeniu wyboru, który zmienia kalendarze źródłowe, panel od razu uruchamia synchronizację (krok 6 historyjki 23).
- Lista ma wszystkie strony z Google (testowane na ponad 250 kalendarzach).

## Pobieranie zmian z Google (G05)

Historyjka S23KC2S1P2-23, podzadanie G05 (S23KC2S1P2-289). „Synchronizuj z Google” po odczycie listy kalendarzy pobiera wydarzenia z każdego wybranego kalendarza źródłowego (G04) i stosuje je w kalendarzu KAC. Po próbie panel pokazuje wynik per kalendarz: nowe, zmienione, usunięte, pominięte i konflikty. Działa z prawdziwym Google (tylko odczyt, zakres `calendar.readonly`) i w makiecie.

- **Trwała tożsamość.** Każde pobrane wydarzenie ma wiersz w `t_google_wydarzenia` z kluczem: konto + kalendarz + identyfikator wydarzenia Google (dla serii – instancji). Synchronizacja zmienia i usuwa wyłącznie wydarzenia z tego mapowania; ręczne wpisy nie mają mapowania, więc nigdy nie są dotykane. Powtórny odczyt nie dubluje wydarzeń.
- **Pełny odczyt i zmiany.** Pierwszy odczyt kalendarza obejmuje okno od 4 tygodni wstecz do 26 tygodni naprzód (`singleEvents=true`, wszystkie strony). Kolejne pobierają tylko zmiany kursorem `syncToken`. Pełny odczyt jest powtarzany co 4 tygodnie (żeby okno się przesuwało i wchodziły w nie nowe instancje serii) i po wygaśnięciu kursora (410). Pełny odczyt uzgadnia tylko przestrzeń Google: wydarzenia z mapowania w oknie, których Google już nie zwraca, znikają; starsze niż okno zostają jako historia.
- **Kursor po kompletnej serii.** Wszystkie strony są pobierane przed zapisem, a potem stosowane w jednej transakcji razem z nowym kursorem. Błąd strony (po ograniczonych ponowieniach) albo błąd zapisu niczego nie zmienia w tym kalendarzu i nie przesuwa kursora. Pozostałe kalendarze są zapisywane (wynik „częściowy”). Kalendarz większy niż 25 000 wydarzeń kończy się jawnym błędem `calendar_too_large`, nie cichym obcięciem.
- Pusta poprawna odpowiedź jest sukcesem („Brak zmian w Google”), nie błędem.
- Każda zmiana wydarzenia trafia do outboxa (W02) z `origin: google_sync`, jak każda inna zmiana kalendarza.
- Odłączenie konta (G03) kasuje kursory, ale nie usuwa pobranych wydarzeń; po ponownym połączeniu pierwszy odczyt jest pełny i uzgadnia je bez duplikatów. Po zmianie konta wydarzenia poprzedniego konta zostają nietknięte, a nowe konto ma własne mapowanie.
- Szczegóły pobranego wydarzenia w widoku Tydzień pokazują kalendarz źródłowy i stan; przy edycji w KAC jest „Przywróć wersję z Google” (`POST …/imported-events/{eventId}/restore`, działa bez sieci).
- W makiecie wynik można wymusić: „Zmiany w Google” (przesunięta wizyta, odwołana instancja serii, nowe wydarzenie), „Błąd strony” i „Wygasły kursor (410)”.

Założenie D05 (do potwierdzenia w zespole):

- Instancje serii z Google są osobnymi wydarzeniami KAC; reguła powtarzania nie jest przenoszona (KAC obsługuje tylko serie cotygodniowe).
- Wydarzenia całodniowe i odrzucone zaproszenia są pomijane – nie blokują planowania pracy (jak w jednorazowym imporcie).
- Edycja pobranego wydarzenia w KAC wygrywa: zmiany z Google go nie nadpisują (konflikt, liczony w wyniku). Usunięcie w Google zostawia edytowaną kopię jako zwykłe wydarzenie.
- Usunięcie pobranego wydarzenia w KAC jest trwałe – kolejne synchronizacje go nie odtwarzają.
- Pobrane wydarzenia mają kategorię „Prywatne” i źródło „Google (synchronizacja)”.
- Wydarzenia opublikowane przez KAC (`extendedProperties.private.kacEventId` albo zewnętrzne ID z `t_publikacje`) nie wracają jako nowe wpisy.

Założenie D06 (do potwierdzenia w zespole): w tym zadaniu nie ma harmonogramu automatycznego. Synchronizacja rusza ręcznie, po ponownym połączeniu konta i po zmianie kalendarzy źródłowych. Propozycja na później: worker co 15 minut uruchamia odczyt przyrostowy dla połączonych kont ze zgodą – kursor sprawia, że to tanie.

## Symulowana publikacja grafiku (G07)

Historyjka S23KC2S1P2-30, podzadanie G07 (S23KC2S1P2-291). Pod zaakceptowanym grafikiem w zakładce Grafik jest przycisk „Opublikuj w Google Calendar (symulacja)”. **To symulacja: nic nie trafia do Google**, a każdy podgląd i wynik jest tak oznaczony.

- Wejście wymaga zaakceptowanego grafiku z co najmniej jedną zmianą, połączonego konta i kalendarza z prawem zapisu. Domyślnym celem jest kalendarz publikacji z G04; w podglądzie można wybrać inny kalendarz z prawem zapisu (bez zmiany ustawień).
- Podgląd pokazuje konkretne zmiany: do dodania, do aktualizacji (wydarzenie zmieniło się od publikacji) i bez zmian. Podgląd niczego nie zapisuje; „Anuluj” nie zmienia ani grafiku, ani Google.
- Potwierdzenie wysyła wersję grafiku z podglądu; inna wersja kończy się `409 schedule_version_conflict` bez publikacji.
- Każda próba trafia do rejestru `t_synchronizacje` z kierunkiem „Publikacja” (ponowienia błędów przejściowych jak w G06). Sukces zapisuje ostatnią publikację w koncie; błąd i wynik częściowy jej nie nadpisują. Stan sekcji synchronizacji w Ustawieniach wynika tylko z odczytów.
- Powiązanie per zmiana w `t_publikacje`: właściciel, zmiana i wydarzenie z wersją, konto, kalendarz, tryb i zewnętrzne ID. Tryb „symulacja” nigdy nie ma zewnętrznego ID (ograniczenie w bazie) – demo nie udaje, że wydarzenie istnieje w Google. Jeden wiersz na zmianę i kalendarz, więc ponowienie po błędzie publikuje tylko brakujące pozycje.
- Wynik symulacji można wymusić (brak internetu, chwilowy błąd, wygasłe logowanie, brak prawa zapisu, limit, błąd serwera, wynik częściowy). Błąd nigdy nie jest pokazany jako sukces; „Spróbuj ponownie” działa bez wymuszonego błędu.
- Prawdziwa publikacja podłączy się w API jako drugi `PublicationAdapter` z tym samym kontraktem. To zadanie samo nie odblokowuje korekt opublikowanych zmian (S23KC2S1P2-47).

## Korekta i usunięcie opublikowanej zmiany (G09)

Historyjka S23KC2S1P2-47, podzadanie G09 (S23KC2S1P2-292). Szczegóły opublikowanej zmiany w kalendarzu pokazują stan powiązanego wydarzenia w Google. „Edytuj” → „Zapisz” albo „Usuń” → potwierdzenie zapisuje zmianę lokalnie i od razu ją synchronizuje. **To symulacja – nic nie trafia do Google.** „Anuluj” w formularzu albo w potwierdzeniu usunięcia niczego nie zapisuje i niczego nie zleca.

- Zapis lokalny obejmuje w jednej transakcji: wydarzenie, bieżący zaakceptowany grafik (korekta), oznaczenie pozycji publikacji i zlecenie w outboxie (W02).
- Synchronizację wykonuje konsument „google” w workerze outboxa albo „Ponów synchronizację” (`POST …/publications/events/{eventId}/sync`), które aplikacja wywołuje też od razu po zapisie. Zawsze wysyłany jest najnowszy stan wydarzenia z bazy, nie treść starego zlecenia; pozycje są blokowane, więc dwa workery i kolejność edycja → edycja → usunięcie nie odtwarzają starego stanu.
- Błąd Google nie cofa zmiany lokalnej: pozycja ma stan „Błąd” (albo „Do usunięcia” z kodem błędu) i można ją ponowić. Błędy przejściowe worker ponawia sam z rosnącą przerwą.
- Aktualizacja wydarzenia, którego nie ma już w Google, kończy się stanem „Brak w Google” bez tworzenia nowego (6c). Usunięcie wydarzenia, którego w Google już nie ma, jest sukcesem.
- Usunięcie zostawia nagrobek: `ref_wydarzenia`, kalendarz Google, zewnętrzne ID, migawka danych i stan próby zostają po wyzerowaniu FK wydarzenia, więc usunięcie da się ponowić także po restarcie. Ustawienia → Google Calendar pokazują listę rozbieżności z „Ponów synchronizację”.
- Każda próba trafia do rejestru `t_synchronizacje` (kierunek „Publikacja”, zakres `event:{id}`). W makiecie wynik następnej próby można wymusić (brak internetu, błąd serwera, limit, brak prawa zapisu, brak wydarzenia w Google).

Założenie D07 (do potwierdzenia w zespole):

- Korekta dotyczy tylko bieżącego zaakceptowanego grafiku. Wersje zastąpione i odrzucone zostają bez zmian (historia).
- Zmiana zachowuje stawkę z chwili zatwierdzenia: kwota po korekcie jest liczona tą stawką, nie bieżącą stawką profilu.
- Każda korekta zapisuje wiersz w `t_korekty_grafiku` (przed/po). Usunięta zmiana zostaje w historii ze statusem „Usunięta”; sumy grafiku liczą tylko zmiany aktywne. Korekta nie tworzy nowej wersji grafiku.
- Zastąpienie zaakceptowanego grafiku nową wersją działa jak dotąd: stare wydarzenia są usuwane, a ich publikacje usuwane w Google tą samą synchronizacją.

## Odłączenie konta i cofnięcie zgody (G03)

Historyjka S23KC2S1P2-35, podzadanie G03 (S23KC2S1P2-287). Przycisk „Odłącz konto Google” pokazuje okno potwierdzenia; „Anuluj” niczego nie zmienia. Po potwierdzeniu `DELETE /api/v1/integrations/google` w jednej transakcji:

- ustawia status „Niepołączone”, wyłącza zgodę na synchronizację i podnosi generację połączenia – prace i odświeżenia tokenu ze starą generacją nie wyślą już żadnego żądania do Google,
- usuwa zapisane tokeny,
- anuluje otwarte logowania, więc spóźniony powrót z Google niczego nie zapisze (także taki, który był już w trakcie),
- kończy trwające synchronizacje i zatrzymuje zaplanowane prace dla Google w outboxie (W02),
- nie usuwa żadnych wydarzeń lokalnych.

Decyzja D03: po zatwierdzeniu lokalnych zmian KAC prosi Google o cofnięcie zgody (endpoint `revoke`, token w treści żądania). Odpowiedź opisuje osobno stan w KAC (`local`) i w Google (`remote`): `revoked` tylko wtedy, gdy Google to potwierdził; przy `failed` panel mówi, że dane dostępu usunięto, ale zgodę trzeba cofnąć ręcznie w ustawieniach konta Google. Odłączenie działa także bez internetu. Powtórne odłączenie zwraca ten sam stan. Już wysłanego żądania do Google nie da się cofnąć i panel tego nie obiecuje.

„Zmień konto” również cofa zgodę zastępowanego konta (najlepsza próba po zapisaniu nowego połączenia). Jednorazowy import zachowuje własne `DELETE /api/v1/import/google/connections/{id}` (204), a jego okno informuje, że połączenie z Ustawień nie jest tam używane.

## Bezpieczeństwo

- OAuth 2.0 „authorization code” z PKCE (S256) i dostępem offline. `state` ma 32 losowe bajty, jest jednorazowy, ważny 10 minut i zapisany wyłącznie jako skrót SHA-256. Powrót z Google musi trafić do tego samego użytkownika, który rozpoczął próbę.
- Tożsamością konta jest `sub` z `id_token` (adres e-mail może się zmienić). Konto bez potwierdzonego adresu e-mail jest odrzucane.
- Tokeny są szyfrowane AES-256-GCM kluczem `GOOGLE_TOKEN_ENCRYPTION_KEY` spoza bazy. Dane dodatkowe szyfrogramu wiążą go z kontem i rodzajem tokenu, więc przeniesiony do innego wiersza nie da się odszyfrować. Weryfikator PKCE też jest szyfrowany i usuwany po użyciu.
- Tokeny nie trafiają do odpowiedzi API, aplikacji ani logów. Log żądań zamazuje `code` i `state` w adresie powrotu; błędy są logowane tylko jako kod.
- Token dostępu jest odświeżany pod blokadą wiersza konta i tokenów: równoległe żądania (także z kilku instancji API) wykonują jedno odświeżenie. Odpowiedź Google bez `refresh_token` zachowuje zapisany token; nowy token odświeżania zastępuje stary. Odpowiedź 401 z Calendar API wymusza jedno odświeżenie przed zgłoszeniem `reconnect_required`.

## API

| Metoda i ścieżka | Opis |
| --- | --- |
| `GET /api/v1/integrations/google` | Stan: `not_connected`, `connected`, `reconnect_required`; konto, przyznane zakresy, `requestedAccess`, tryb (`google`/`demo`) i problem konfiguracji. |
| `POST /api/v1/integrations/google/connect` | Początek logowania; `purpose`: `connect`, `change_account` albo `reconnect`. W trybie `google` odpowiedź ma `authUrl`. |
| `GET /api/v1/integrations/google/attempts/{id}` | Stan próby: `pending`, `connected`, `denied`, `error`, `cancelled`, `expired` i `errorCode`. |
| `POST /api/v1/integrations/google/attempts/{id}/cancel` | Anulowanie próby. |
| `POST /api/v1/integrations/google/attempts/{id}/demo-consent` | Tylko makieta: wybór konta i zgoda albo odmowa. |
| `GET /api/v1/integrations/google/callback` | Adres powrotu z Google; zwraca stronę HTML. |
| `GET /api/v1/integrations/google/calendars` | Lista kalendarzy (wszystkie strony) z rolą `owner`, `writer`, `reader` albo `freeBusyReader`. |
| `DELETE /api/v1/integrations/google` | Odłączenie konta i cofnięcie zgody w Google; `local` i `remote` opisują wynik osobno. |
| `GET /api/v1/integrations/google/sync` | Stan synchronizacji, ostatnia próba, ostatni sukces odczytu i publikacji, historia prób. |
| `POST /api/v1/integrations/google/sync` | „Synchronizuj z Google” z ograniczonymi ponowieniami. Błąd Google jest wynikiem próby (200); `simulate` tylko w makiecie. |
| `GET /api/v1/integrations/google/calendar-selection` | Wybór kalendarzy: źródła, kalendarz publikacji, wersja, `canPublish`, `targetProblem`. |
| `PUT /api/v1/integrations/google/calendar-selection` | Atomowy zapis wyboru z wersją. |
| `GET /api/v1/integrations/google/publications/{weekStart}/preview` | Podgląd symulowanej publikacji; opcjonalnie `calendarId`. |
| `GET /api/v1/integrations/google/imported-events/{eventId}` | Pochodzenie i stan pobranego wydarzenia (zgodne, edytowane w KAC, usunięte w Google). |
| `POST /api/v1/integrations/google/imported-events/{eventId}/restore` | „Przywróć wersję z Google”. |
| `GET /api/v1/integrations/google/publications/events/{eventId}` | Stan publikacji wydarzenia (także po jego usunięciu). |
| `POST /api/v1/integrations/google/publications/events/{eventId}/sync` | Synchronizacja korekty / „Ponów synchronizację”; wynik `nothing`, `success` albo `error` (200). |
| `GET /api/v1/integrations/google/publications/divergences` | Rozbieżności KAC ↔ Google. |
| `PUT /api/v1/integrations/google/publications/simulation` | Makieta: wynik następnej synchronizacji korekty. |
| `POST /api/v1/integrations/google/publications/{weekStart}` | Potwierdzona publikacja (symulacja) z `expectedVersion`. Błąd Google jest wynikiem próby (200). |

Błędy Google mają stabilne kody: `reconnect_required` (409), `insufficient_permissions` (403), `rate_limited` (429), `google_unavailable`, `google_error` i `api_not_enabled` (502), `network_error` (504). Synchronizacja zwraca też `sync_disabled`, `sync_in_progress` i `no_calendars_selected` (409). Wybór kalendarzy: `unknown_calendar` (400), `selection_conflict` i `calendar_unavailable` (409), `target_not_writable` i `write_access_missing` (422). Publikacja: `schedule_not_found` (404), `schedule_not_accepted`, `schedule_empty`, `schedule_version_conflict`, `no_publication_target` i `publication_in_progress` (409). Pobrane wydarzenia: `not_imported` (404), `google_version_missing` i `restore_series` (409); w wyniku synchronizacji kalendarza także `sync_token_expired`, `calendar_too_large` i `sync_apply_failed`. Korekty: `publication_not_found` (404); kod `event_not_found` w wyniku oznacza brak wydarzenia w Google. Bez bazy danych endpointy zwracają `503 integration_not_configured`.

## Konfiguracja

| Zmienna | Znaczenie |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Ten sam klient OAuth co w imporcie. Bez nich działa makieta z kontami `student.kac.demo@gmail.com` (cztery kalendarze) i `praca.kac.demo@gmail.com` (bez kalendarzy). |
| `GOOGLE_INTEGRATION_REDIRECT_URI` | Adres powrotu, domyślnie `http://localhost:4000/api/v1/integrations/google/callback`. Dodaj go w Google Cloud Console jako „Authorized redirect URI” obok adresu importu. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 losowe bajty w base64, poza bazą i repozytorium. Bez klucza (albo z kluczem złej długości) prawdziwe logowanie jest wyłączone, a panel wyjaśnia dlaczego. Zmiana klucza wymaga ponownego połączenia kont. |

Klucz można wygenerować raz poleceniem:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Ekran zgody Google musi zawierać zakresy `openid`, `email`, `https://www.googleapis.com/auth/calendar.readonly` i `https://www.googleapis.com/auth/calendar.events`. W trybie testowym aplikacji Google tylko dodani testerzy mogą się zalogować.

## Dane

Migracja `022_google_event_sync.sql` dodaje mapowanie pobranych wydarzeń `t_google_wydarzenia` i checkpoint kalendarza `t_google_sync_stan` (kursor, okno pełnego odczytu, stan makiety). Migracja `021_google_publication_corrections.sql` dodaje do `t_publikacje` nagrobek (`ref_wydarzenia`, `migawka`) i stan próby (`kod_bledu`, `proby`, `ostatnia_proba`), a do `t_konta_google` wymuszony wynik symulacji. Migracja `020_google_schedule_publication.sql` rozszerza `t_publikacje` o powiązanie per zmiana (właściciel, konto, zmiana, wydarzenie i jego wersja, tryb). Migracja `019_google_calendar_selection.sql` dodaje w `t_konta_google` kalendarz publikacji (`id_kal_publikacji`) i wersję wyboru (`wersja_wyboru`). Migracja `018_google_sync_registry.sql` rozszerza `t_synchronizacje` (zakres, liczba prób, kod błędu, czas zakończenia, generacja) i dodaje `ostatnia_publikacja` w `t_konta_google`. Migracja `017_google_integration.sql` rozszerza `t_konta_google` (stabilny `google_sub`, tryb, przyznane zakresy, generacja, daty połączenia i odłączenia) oraz `t_kalendarze_google` (rola dostępu, strefa, kalendarz główny). Nowe tabele: `t_google_tokeny` (tylko szyfrogramy) i `t_google_oauth_proby` (jednorazowe próby OAuth). Jeden użytkownik ma najwyżej jedno aktywne konto Google.

## Testy

- `apps/api/tests/google-integration.test.ts` – szyfrowanie, adres zgody, wymiana kodu, odświeżanie (jedno naraz, rotacja, `invalid_grant`), lista kalendarzy, konfiguracja klucza, logi bez kodu OAuth.
- `apps/api/tests/google-integration.integration.test.ts` (PostgreSQL) – makieta (odmowa, 1a, zmiana konta, 7a, wygasła próba, cudza próba), udawany Google (jednorazowy i wygasły `state`, 6a, brak tokenu odświeżania, szyfrogramy w bazie, brak tokenów w odpowiedziach, ponowne logowanie) oraz równoległe odświeżanie z dwóch instancji. Każdy scenariusz sprawdza, że wydarzenia użytkownika się nie zmieniły.
- `apps/web/tests/googleIntegration.test.ts` – stan panelu i komunikaty.
- `apps/api/tests/google-disconnect.integration.test.ts` (PostgreSQL) – odłączenie w makiecie i z udawanym Google, powtórzenie, anulowana próba, zatrzymane prace outboxa, odrzucona stara generacja i spóźniony powrót, nieudane cofnięcie zgody (sieć, 503), cofnięcie zgody przy zmianie konta; `apps/web/tests/googleDisconnect.test.ts` – teksty potwierdzenia i wyniku.
- `apps/api/tests/google-events-sync.integration.test.ts` (PostgreSQL, udawany Google i stały zegar) – strony, instancje serii, zmiana czasu, pominięte całodniowe/odrzucone/własne, pusty kalendarz, powtórka bez duplikatów, przesunięcie okna, zmiany przyrostowe, ręczny wpis nietknięty, konflikt i przywrócenie, trwałe usunięcie w KAC, błąd strony i kursor, rollback, 410, odznaczenie i ponowny wybór, zmiana konta, cudzy zakres, makieta; `apps/api/tests/google-events.test.ts` – żądania events.list i kody błędów, makieta, komunikat; `apps/web/tests/googleEventsSync.test.ts` – wynik per kalendarz i szczegóły wydarzenia.
- `apps/api/tests/google-corrections.integration.test.ts` (PostgreSQL) – korekta grafiku ze snapshotem stawki, zlecenie w tej samej transakcji, worker, błąd bez cofania zmiany i ponowienie, brak wydarzenia w Google bez tworzenia nowego, błąd przejściowy w workerze, nagrobek po usunięciu, usunięcie brakującego wydarzenia, edycja → edycja → usunięcie z dwoma workerami, restart z wygasłą dzierżawą; `apps/web/tests/googleCorrection.test.ts` – komunikaty i ponowienie.
- `apps/api/tests/google-publication.integration.test.ts` (PostgreSQL, atrapa zegara) – warunki wejścia, podgląd bez zmian, konflikt wersji, błąd bez sukcesu, wynik częściowy i ponowienie bez duplikatów, aktualizacja po zmianie wydarzenia, brak ID Google w symulacji, cudzy grafik; `apps/web/tests/googlePublication.test.ts` – wejście, podgląd, komunikaty wyniku i ponowienie.
- `apps/api/tests/google-calendar-selection.integration.test.ts` (PostgreSQL) – zapis atomowy z wersją, konflikt (także dwa równoległe zapisy), obcy kalendarz, kalendarz tylko do odczytu jako cel, brak zgody na zapis, utrata uprawnień, ponad 250 kalendarzy, synchronizacja bez wyboru; `apps/web/tests/googleCalendarSelection.test.ts` – szkic wyboru, kandydaci na cel, podsumowanie zmian.
- `apps/api/tests/google-sync.test.ts` i `google-sync.integration.test.ts` (PostgreSQL, atrapa zegara) – klasy błędów, ponowienia, ostatni sukces, wynik częściowy, wygasłe logowanie, odmowa wyłączająca synchronizację, jedna próba naraz, 503/sieć/wyłączone Calendar API w udawanym Google; `apps/web/tests/googleSync.test.ts` – stany, przyciski i komunikaty.
