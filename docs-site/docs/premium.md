---
id: premium
title: Premium i kody aktywacyjne
sidebar_label: Premium
description: Uprawnienia Premium, aktywacja kodem i zabezpieczenia dostępu do funkcji AI.
---

# Premium i kody aktywacyjne

## Funkcje i stan konta

Premium odblokowuje Asystenta AI, podsumowanie dnia, odczyt AI planu zajęć i grafiku pracy oraz funkcje AI dostępne z poziomu rozmowy. Lokalny kalendarz i lokalne ścieżki importu pozostają dostępne bez Premium. Korona oznacza funkcję Premium; decyzję o dostępie zawsze podejmuje API, nie sam interfejs.

W ustawieniach konta widać aktywny stan Premium oraz datę wygaśnięcia. Każdy nowy użytkownik zaczyna bez Premium. Aktualny kod kampanii aktywuje dostęp na skonfigurowany okres (domyślnie 365 dni), jednorazowo dla danego konta w danej kampanii. Ponowne użycie tego samego kodu w tym samym koncie i kampanii jest odrzucane; kolejna kampania ma osobny identyfikator.

W aplikacji nie ma operatora płatności ani automatycznego odnawiania subskrypcji. Użytkownik aktywuje otrzymany kod; tekst oferty powinien jasno o tym informować i nie sugerować pobrania płatności.

## Konfiguracja kodu

Kod jest sprawdzany wyłącznie przez API i nie może być `EXPO_PUBLIC_*`, częścią bundla web ani przykładem w dokumentacji. W KAC App Service ustaw go jako sekret, najlepiej Key Vault reference:

- `PREMIUM_REDEMPTION_CODE` – współdzielony kod kampanii; nie trafia do odpowiedzi API ani logów.
- `PREMIUM_CAMPAIGN_ID` – stabilny, nowy identyfikator przy każdej kolejnej kampanii, np. `black-friday-2026`.
- `PREMIUM_CAMPAIGN_NAME` – nazwa widoczna w paywallu, np. `Black Friday`.
- `PREMIUM_CAMPAIGN_ENDS_AT` – koniec aktywacji w ISO 8601 UTC, np. `2026-11-30T22:59:59Z` oznacza `23:59:59` w strefie Europe/Warsaw.
- `PREMIUM_DURATION_DAYS` – czas przyznanego dostępu; domyślnie `365`.

Zmień kod i `PREMIUM_CAMPAIGN_ID` razem. Kod jest akceptowany tylko do daty końca kampanii. API porównuje kod po stronie serwera, ogranicza liczbę prób i zapisuje redemption w transakcji z ograniczeniem unikalności konta/kampanii. Nie wpisuj prawdziwego kodu do repozytorium, logów ani tego dokumentu.

## Nadanie Premium administratora

Jeśli konto istnieje, operator może jednorazowo nadać Premium z CLI maszyny mającej bezpieczny dostęp do `DATABASE_URL`:

```bash
npm run premium:grant -- <email> [dni]
```

Polecenie wymaga istniejącego konta, nie dodaje żadnej publicznej trasy administracyjnej i nie przedłuża ponownie już aktywnego uprawnienia przy powtórzeniu.

## API

- `GET /api/v1/premium/config` zwraca tylko publiczną nazwę kampanii, datę końca, okres Premium oraz `redeemedByAccount` dla aktualnego konta; nie ujawnia kodu.
- `POST /api/v1/premium/redeem` wymaga uwierzytelnionej sesji i body `{ "code": "..." }`. Sukces zwraca zaktualizowany profil z `isPremium` i `premiumExpiresAt`.
- Endpointy Asystenta i importu AI zwracają `403 premium_required` dla kont bez aktualnego uprawnienia. Odczyt historii i zatwierdzenie wcześniej przygotowanej propozycji nie wykonują nowego wywołania AI.

Rozmowy i wybrane dane kalendarza są przesyłane do Azure AI podczas użycia Asystenta. Plik PDF/PNG/JPG importu jest przekazywany do AI w celu odczytu; oryginalne bajty pliku nie są przechowywane w bazie KAC. Użytkownik widzi tę informację przed wysłaniem pliku.
