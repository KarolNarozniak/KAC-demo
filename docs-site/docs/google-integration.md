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

Historyjka S23KC2S1P2-17, podzadanie G06 (S23KC2S1P2-290). Pod listą kalendarzy panel ma sekcję **Synchronizacja**: stan („Nigdy nie synchronizowano”, „W trakcie”, „Zsynchronizowano”, „Częściowo”, „Błąd”), czas ostatniej udanej synchronizacji i przycisk „Synchronizuj z Google”. Na razie synchronizacja odczytuje listę kalendarzy; pobieranie wydarzeń (G05), publikacja (G07) i korekty (G09) mają zapisywać próby w tym samym rejestrze.

- Każda próba trafia do `t_synchronizacje`: kierunek (odczyt/publikacja), zakres, operacja, liczba prób, liczba zmian, wynik, kod błędu i czas. Ostatni sukces odczytu i publikacji jest zapisany w koncie osobno, więc nieudana próba go nie nadpisuje.
- Błędy przejściowe – brak sieci albo przekroczony czas, limit zapytań, błąd serwera Google – są ponawiane automatycznie najwyżej 3 razy, z przerwami 0,5 s i 1 s. Brak zgody, brak uprawnień i wyłączone Calendar API nie są ponawiane.
- Przyczyna błędu jest rozróżniona: brak połączenia, wygasłe logowanie, brak uprawnień do kalendarza, limit, błąd po stronie Google (osobny komunikat dla wyłączonego Calendar API).
- Przy błędzie panel pokazuje przyczynę, czas ostatniego sukcesu oraz „Spróbuj ponownie” albo „Połącz ponownie konto Google”. Przy wygasłym logowaniu zwykłe ponowienie nie jest proponowane. Po udanym ponownym połączeniu synchronizacja rusza sama.
- Odmowa zgody przy ponownym logowaniu (5a) wyłącza synchronizację (`Zgoda_Synchronizacja`); konto i lokalne wydarzenia zostają bez zmian. Zgoda przy kolejnym logowaniu ją przywraca.
- Naraz trwa najwyżej jedna próba danego kierunku na konto. Próba przerwana np. restartem serwera po 5 minutach jest oznaczana jako błąd „przerwana”.
- Niepełna lista kalendarzy daje wynik „Częściowo” i nie usuwa kalendarzy, których lista nie objęła.
- W trybie demonstracyjnym można wymusić wynik następnej synchronizacji (brak internetu, chwilowy błąd sieci, wygasłe logowanie, błąd serwera, limit, wynik częściowy, brak uprawnień), żeby pokazać przebiegi bez prawdziwego Google.

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

Błędy Google mają stabilne kody: `reconnect_required` (409), `insufficient_permissions` (403), `rate_limited` (429), `google_unavailable`, `google_error` i `api_not_enabled` (502), `network_error` (504). Synchronizacja zwraca też `sync_disabled` i `sync_in_progress` (409). Bez bazy danych endpointy zwracają `503 integration_not_configured`.

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

Migracja `018_google_sync_registry.sql` rozszerza `t_synchronizacje` (zakres, liczba prób, kod błędu, czas zakończenia, generacja) i dodaje `ostatnia_publikacja` w `t_konta_google`. Migracja `017_google_integration.sql` rozszerza `t_konta_google` (stabilny `google_sub`, tryb, przyznane zakresy, generacja, daty połączenia i odłączenia) oraz `t_kalendarze_google` (rola dostępu, strefa, kalendarz główny). Nowe tabele: `t_google_tokeny` (tylko szyfrogramy) i `t_google_oauth_proby` (jednorazowe próby OAuth). Jeden użytkownik ma najwyżej jedno aktywne konto Google.

## Testy

- `apps/api/tests/google-integration.test.ts` – szyfrowanie, adres zgody, wymiana kodu, odświeżanie (jedno naraz, rotacja, `invalid_grant`), lista kalendarzy, konfiguracja klucza, logi bez kodu OAuth.
- `apps/api/tests/google-integration.integration.test.ts` (PostgreSQL) – makieta (odmowa, 1a, zmiana konta, 7a, wygasła próba, cudza próba), udawany Google (jednorazowy i wygasły `state`, 6a, brak tokenu odświeżania, szyfrogramy w bazie, brak tokenów w odpowiedziach, ponowne logowanie) oraz równoległe odświeżanie z dwóch instancji. Każdy scenariusz sprawdza, że wydarzenia użytkownika się nie zmieniły.
- `apps/web/tests/googleIntegration.test.ts` – stan panelu i komunikaty.
- `apps/api/tests/google-disconnect.integration.test.ts` (PostgreSQL) – odłączenie w makiecie i z udawanym Google, powtórzenie, anulowana próba, zatrzymane prace outboxa, odrzucona stara generacja i spóźniony powrót, nieudane cofnięcie zgody (sieć, 503), cofnięcie zgody przy zmianie konta; `apps/web/tests/googleDisconnect.test.ts` – teksty potwierdzenia i wyniku.
- `apps/api/tests/google-sync.test.ts` i `google-sync.integration.test.ts` (PostgreSQL, atrapa zegara) – klasy błędów, ponowienia, ostatni sukces, wynik częściowy, wygasłe logowanie, odmowa wyłączająca synchronizację, jedna próba naraz, 503/sieć/wyłączone Calendar API w udawanym Google; `apps/web/tests/googleSync.test.ts` – stany, przyciski i komunikaty.
