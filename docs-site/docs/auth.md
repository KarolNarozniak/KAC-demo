---
id: auth
title: Logowanie i konta
sidebar_label: Logowanie
description: Konta KAC z e-mailem i hasłem, sesje w bazie, kod odzyskiwania na zapomniane hasło, ochrona API, rejestracja, usuwanie konta i dzienny limit AI.
---

# Logowanie i konta

Każdy użytkownik ma własne konto KAC (e-mail i hasło) i widzi tylko swoje dane. Google służy wyłącznie do połączenia kalendarza po zalogowaniu (Ustawienia → Google Calendar) – nie jest sposobem logowania do KAC.

## Założenia

- **Własne konta zamiast „Zaloguj przez Google”.** Logowanie przez Google wymagałoby zgody w projekcie Google Cloud dla każdej osoby. Konto Google spoza listy testerów aplikacji nie połączy kalendarza, ale cała reszta KAC działa.
- **Sesje w bazie zamiast JWT.** Token sesji to 256 losowych bitów; w bazie (`t_sesje`) leży tylko jego skrót SHA-256. Sesję można unieważnić od razu (wylogowanie, zmiana hasła, usunięcie konta), nie ma sekretu JWT do przechowywania ani odświeżania tokenów w kilku kartach naraz. Sprawdzenie sesji to jedno zapytanie po indeksie.
- **Ważność sesji:** 30 dni bez użycia, najwyżej 90 dni od zalogowania. Czas ostatniego użycia zapisuje się co najwyżej raz na 10 minut.

## Przebieg w aplikacji

- Po uruchomieniu aplikacja sprawdza zapisaną sesję (`GET /api/v1/auth/me`). Bez sesji pokazuje ekran logowania z przejściem do zakładania konta.
- Sesja jest zapamiętana: na telefonie w zaszyfrowanym magazynie systemu (`expo-secure-store`), w przeglądarce w `localStorage`. Brak sieci przy starcie nie wylogowuje – aplikacja proponuje ponowienie.
- Każde zapytanie wysyła `Authorization: Bearer <token>`. Odpowiedź `401 {"error":"unauthorized"}` (sesja wygasła albo zakończona na innym urządzeniu) wraca do ekranu logowania z komunikatem. Inne błędy 401 (np. `google-unauthorized` z importu Google) nie wylogowują.
- Ustawienia → Konto: kto jest zalogowany, czy konto ma kod odzyskiwania, „Wyloguj”, „Zmień hasło” (wylogowuje pozostałe urządzenia, bieżące zostaje), „Nowy kod odzyskiwania” i „Usuń konto” (oba z potwierdzeniem hasłem).
- Wylogowanie wyłącza Web Push w tej przeglądarce i czyści lokalną personalizację asystenta, więc kolejna osoba na tym urządzeniu nie dostanie cudzych przypomnień. Po zalogowaniu Web Push wraca sam, jeśli konto ma włączone przypomnienia, a przeglądarka zgodę.
- Zapomniane hasło: ekran logowania → „Nie pamiętasz hasła?” → e-mail, kod odzyskiwania i nowe hasło (opis niżej). Bez kodu nowe hasło ustawia administrator.

## Hasła i ochrona przed zgadywaniem

- Skrót **argon2id** (19 MiB pamięci, 2 iteracje, 1 wątek – parametry OWASP). Hasło nie trafia do logów ani do bazy.
- Zasady w duchu NIST SP 800-63B: 12–128 znaków, bez wymogu cyfr i znaków specjalnych. Odrzucane są popularne hasła, powtórzenia, ciągi klawiszy i hasła zawierające nazwę z adresu e-mail.
- Zły e-mail i złe hasło dają ten sam komunikat i ten sam czas odpowiedzi (sprawdzenie „na pusto” dla nieznanego adresu), więc nie da się sprawdzić, kto ma konto.
- Po 10 nieudanych próbach konto jest zablokowane na 15 minut (`429 too_many_attempts`). Dodatkowo limity z jednego adresu IP: logowanie 10 na minutę, rejestracja 5 na godzinę, zmiana hasła, reset hasła kodem, nowy kod odzyskiwania i usunięcie konta 10 na 15 minut.
- Adres e-mail jest unikalny bez względu na wielkość liter.

## Kod odzyskiwania (zapomniane hasło)

KAC nie wysyła poczty – reset przez e-mail wymagałby domeny, dostawcy wysyłki i kolejnego sekretu. Zamiast tego każde konto ma jednorazowy **kod odzyskiwania**, podobnie jak kody zapasowe przy logowaniu dwuetapowym. Działa bez żadnej usługi zewnętrznej, w przeglądarce i w Expo Go.

- **Postać:** 16 znaków w grupach po 4, np. `7F3Q-9XWM-2HDA-K8PR` – 80 losowych bitów zapisanych alfabetem Crockforda (bez liter I, L, O i U, które mylą się z 1 i 0). Wielkość liter, spacje i myślniki nie mają znaczenia; O czytane jest jako 0, a I i L jako 1.
- **W bazie** (`t_dane_logowania.kod_odzyskiwania_hash`) leży tylko skrót SHA-256. Kodu 80-bitowego nie da się zgadnąć ani odtworzyć ze skrótu, więc wolny skrót typu argon2 nie jest potrzebny (tak samo jak przy tokenach sesji).
- **Kiedy widać kod:** tylko raz – po rejestracji (ekran przed wejściem do aplikacji; dalej dopiero po zaznaczeniu „Zapisałem kod w bezpiecznym miejscu”), po resecie hasła (nowy kod) i po utworzeniu nowego w Ustawienia → Konto (po podaniu hasła; poprzedni przestaje działać). Przycisk „Kopiuj kod” korzysta z `expo-clipboard`.
- **Reset** (`POST /auth/recover`, trasa publiczna): e-mail, kod i nowe hasło. W jednej transakcji KAC ustawia nowe hasło, zdejmuje blokadę po nieudanych logowaniach (kod działa także przy blokadzie), wylogowuje wszystkie urządzenia (powód `reset_hasla`), loguje bieżące urządzenie i zapisuje nowy kod. Kod jest jednorazowy – przy dwóch równoczesnych użyciach tego samego kodu wygrywa jedno. Nowe hasło takie jak obecne jest odrzucane (`400 password_unchanged`), a kod zostaje niezużyty – wystarczy zalogować się tym hasłem.
- Zły e-mail, konto bez kodu i zły kod dają ten sam błąd `401 invalid_recovery_code`, a każda ścieżka robi to samo zapytanie i szybki skrót, więc odpowiedź nie zdradza, kto ma konto. Zgadywanie ogranicza dodatkowo limit z adresu IP.
- Kto zna kod i e-mail, może ustawić nowe hasło. Dlatego aplikacja pokazuje kod raz, prosi o zapisanie go w menedżerze haseł albo na kartce i ostrzega, żeby nikomu go nie wysyłać.
- Ustawienie hasła przez administratora (`auth:set-password`) unieważnia kod – zwykle dzieje się to wtedy, gdy kod zaginął. Konto bez kodu (także sprzed tej funkcji) widzi w Ustawienia → Konto przypomnienie i przycisk „Utwórz kod odzyskiwania”.

## Ochrona API

Wszystkie trasy `/api/v1` wymagają sesji poza: `GET /health/live`, `GET /health/ready`, dokumentacją (`/openapi.json`, `/docs`), `GET /auth/config`, `POST /auth/register`, `POST /auth/login`, `POST /auth/recover` i powrotami z Google (`GET /integrations/google/callback`, `GET /import/google/callback`). Brak albo nieważny token: `401 {"error":"unauthorized"}`; niedostępna baza: `503 database_unavailable`.

Zakres danych (użytkownik i jego aktywny kalendarz) pochodzi z sesji, więc jeden użytkownik nie odczyta ani nie zmieni cudzych wydarzeń, grafików, rozmów czy połączenia Google – takie odwołanie kończy się `404`.

Przeglądarka wracająca ze strony zgody Google nie ma sesji KAC. Właściciela próby wskazuje jednorazowy `state` (32 losowe bajty, ważny 10 minut, w bazie tylko skrót). Jedno konto Google może być połączone tylko z jednym kontem KAC naraz (`google_account_in_use`); wspólne konta makiety są z tego wyłączone.

API uruchomione bez bazy danych (testy, tryb demonstracyjny) działa jak dotąd na danych demonstracyjnych, a trasy `/auth/*` zwracają `503 auth_not_configured`.

## Rejestracja

`REGISTRATION_MODE` decyduje, kto może założyć konto:

| Tryb | Działanie |
| --- | --- |
| `open` (domyślnie) | Każdy może założyć konto. |
| `invite` | Rejestracja wymaga kodu `REGISTRATION_INVITE_CODE` (porównanie w stałym czasie). Bez ustawionego kodu działa jak `closed`. |
| `closed` | Konta zakłada tylko administrator (`npm run auth:set-password -- adres --create`). |

Nowe konto dostaje kalendarz „Mój kalendarz”, pusty profil pracy (bez godzin i stawki, dojazd 0 min – uzupełnia się go w zakładce Grafik → „Edytuj profil”) i strefę czasową urządzenia (domyślnie `Europe/Warsaw`). Konto bez kalendarza albo profilu (np. założone skryptem administratora) dostaje je przy logowaniu. Aplikacja pobiera tryb z `GET /auth/config` i pokazuje pole kodu albo informację, że rejestracja jest wyłączona.

## Usunięcie konta (RODO)

`DELETE /api/v1/auth/account` wymaga hasła. Kolejno: KAC cofa zgodę w Google (najlepsza próba), unieważnia wszystkie sesje i w jednej transakcji usuwa konto ze wszystkimi danymi – kalendarze, wydarzenia, plan zajęć, profil pracy i grafiki, blokady, rozmowy z asystentem, importy, powiadomienia, subskrypcje Web Push, połączenie Google z tokenami i publikacje. Zostają tylko wydarzenia opublikowane wcześniej w Google Calendar (są w Google, nie w KAC) oraz anonimowe statystyki zużycia AI bez treści (`t_ai_uzycie`, identyfikator użytkownika wyzerowany).

## Dzienny limit AI

Asystent i odczyt planu przez AI kosztują wywołania Azure. `AI_DAILY_LIMIT` (domyślnie 200 wywołań na konto w ciągu ostatnich 24 godzin, `0` wyłącza limit) zatrzymuje kolejne wywołania przed wysłaniem do Azure: `429 {"error":"ai_daily_limit"}`. Odczyt załącznika lokalnym parserem nie jest liczony.

## API

| Metoda i ścieżka | Opis |
| --- | --- |
| `GET /api/v1/auth/config` | Tryb rejestracji i długość hasła (publiczne). |
| `POST /api/v1/auth/register` | Nowe konto i sesja (`201 {user, token, expiresAt, recoveryCode}`); `inviteCode` w trybie `invite`. |
| `POST /api/v1/auth/login` | Sesja dla e-maila i hasła (`{user, token, expiresAt}`). |
| `POST /api/v1/auth/recover` | Zapomniane hasło: `{email, recoveryCode, newPassword}` → nowa sesja i nowy kod (`{user, token, expiresAt, recoveryCode}`); publiczna. |
| `POST /api/v1/auth/logout` | Unieważnia bieżącą sesję. |
| `GET /api/v1/auth/me` | Dane zalogowanego użytkownika, w tym `hasRecoveryCode`. |
| `POST /api/v1/auth/recovery-code` | Nowy kod odzyskiwania po podaniu hasła (`{password}` → `{recoveryCode}`); poprzedni przestaje działać. |
| `POST /api/v1/auth/change-password` | Zmiana hasła; `{otherSessionsRevoked}` – ile innych urządzeń wylogowano. |
| `DELETE /api/v1/auth/account` | Usunięcie konta z danymi; treść `{password}`. |

Kody błędów: `invalid_credentials` i `invalid_recovery_code` (401), `too_many_attempts` (429), `email_taken` (409), `invalid_email`, `invalid_name`, `invalid_time_zone`, `password_too_short`, `password_too_long`, `password_too_common`, `password_contains_email`, `password_unchanged` (400), `registration_closed`, `invalid_invite_code` i `invalid_password` (403 – złe hasło przy zmianie hasła, nowym kodzie albo usuwaniu konta nie wylogowuje), `account_not_found` (404). Swagger UI ma przycisk „Authorize” na token sesji.

## Konfiguracja

| Zmienna | Znaczenie |
| --- | --- |
| `REGISTRATION_MODE` | `open`, `invite` albo `closed`. Na publicznym serwerze ustaw `invite` albo `closed`. |
| `REGISTRATION_INVITE_CODE` | Kod zaproszenia dla trybu `invite`. Trzymaj go poza repozytorium (lokalnie `.env`, w Azure ustawienia aplikacji). |
| `AI_DAILY_LIMIT` | Dzienny limit wywołań AI na konto, domyślnie `200`; `0` wyłącza limit. |
| `TRUST_PROXY` | Ilu serwerom pośredniczącym ufać przy ustalaniu adresu klienta dla limitów z adresu IP (`X-Forwarded-For`, port jest obcinany). W Azure App Service domyślnie `1`, lokalnie brak pośrednika. Bez tego wszyscy użytkownicy za pośrednikiem dzieliliby jeden licznik. |

## Administrator

```bash
npm run auth:set-password -- student.demo@example.test
npm run auth:set-password -- anna@example.test --create --first Anna --last Nowak
```

Skrypt pyta dwa razy o hasło (znaki nie są wyświetlane) albo bierze je ze zmiennej `KAC_NEW_PASSWORD`. Sprawdza te same zasady co rejestracja, zdejmuje blokadę po nieudanych próbach, wylogowuje wszystkie urządzenia konta i unieważnia kod odzyskiwania (nowy użytkownik tworzy w Ustawienia → Konto). `--create` zakłada konto (domyślnie strefa `Europe/Warsaw`, inną podasz przez `--zone`).

Istniejąca baza (np. lokalna z danymi demonstracyjnymi albo produkcyjna): `npm run db:migrate`, a potem hasło dla konta, którego dane mają zostać – np. `student.demo@example.test`. Konta sprzed logowania nie mają hasła, więc bez tego kroku nie da się na nie wejść.

## Ograniczenia

- Brak resetu hasła przez e-mail (zamiast niego kod odzyskiwania – kto zgubi i hasło, i kod, potrzebuje administratora) i listy zalogowanych urządzeń w aplikacji (dane urządzeń są już w `t_sesje`: opis, ostatnie użycie).
- Token w przeglądarce leży w `localStorage`, więc ochroną jest brak wstrzykiwania skryptów (KAC nie wstawia surowego HTML). Ciasteczko HttpOnly wymagałoby aplikacji i API pod wspólną domeną.
- Link zgody Google z cudzym `state` (np. podesłany przez innego użytkownika) połączyłby konto Google osoby, która wybierze konto i kliknie „Zezwól”, z kontem nadawcy. Google zawsze pokazuje wybór konta i ekran zgody z nazwą KAC, link wygasa po 10 minutach, a w trybie testowym zalogują się tylko dodani testerzy. Pełne zabezpieczenie to potwierdzenie powrotu w aplikacji, która rozpoczęła łączenie.

## Dane

Migracja `024_auth_sessions.sql`: `t_dane_logowania` (skrót hasła, licznik nieudanych prób, blokada, ostatnie logowanie), `t_sesje` (skrót tokenu, urządzenie, ostatnie użycie, wygaśnięcie, unieważnienie z powodem), unikalny e-mail bez względu na wielkość liter i jedno aktywne konto Google (`google_sub`) na konto KAC. Migracja `025_recovery_codes.sql`: kolumna `t_dane_logowania.kod_odzyskiwania_hash` (null – konto bez kodu). Migracja `026_default_work_profiles.sql`: pusty profil pracy dla kont, które go nie miały.

## Testy

- `apps/api/tests/auth.test.ts` – zasady haseł, argon2id i skrót tokenu, postać i skrót kodu odzyskiwania, lista tras publicznych, kontrakt OpenAPI (każda chroniona trasa dokumentuje 401), API bez bazy, dzienny limit AI.
- `apps/api/tests/auth.integration.test.ts` (PostgreSQL, prawdziwe tokeny w nagłówku) – rejestracja, 401 bez sesji, wylogowanie, zajęty e-mail, słabe hasła, tryby `invite` i `closed`, blokada i limit z IP, zmiana hasła wylogowująca inne urządzenia, reset hasła kodem (także przy blokadzie, wylogowanie wszystkich urządzeń, jednorazowość, równoczesne użycie), nowy kod z hasłem i konto bez kodu, izolacja dwóch użytkowników, powrót z Google bez sesji, `google_account_in_use`, usunięcie konta z publikacją grafiku.
- `apps/web/tests/auth.test.ts` – walidacja formularzy (także resetu z kodem), nagłówek sesji, wylogowanie tylko przy `401 unauthorized` (raz przy równoległych zapytaniach), klient `/auth/*` z resetem i nowym kodem, komunikaty limitu AI.
