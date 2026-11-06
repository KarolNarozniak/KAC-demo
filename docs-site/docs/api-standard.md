---
id: api-standard
title: Standard zmian API
sidebar_label: Standard API
description: Obowiązkowy proces projektowania, walidacji i dokumentowania każdej zmiany backendu.
---

# Standard zmian API

**Każda zmiana zachowania API wymaga aktualizacji schematu OpenAPI i dokumentacji w tym samym pull requeście.** Nie wydzielamy tego jako osobnego późniejszego zadania.

## Dodawanie lub zmiana endpointu

1. Umieść trasę w module domenowym `apps/api/src/api/v1/<domena>/routes.ts`. Współdzielony kontrakt zależności umieść w `apps/api/src/api/contracts.ts`.
2. Dodaj walidację JSON Schema dla `params`, `querystring`, `headers` i `body`. Nie deklaruj typu TypeScript bez walidacji runtime.
3. Dodaj `tags`, jednoznaczne `summary`, pełne `description`, stabilny `operationId` i schematy odpowiedzi, w tym błędy domenowe. Przykłady i formaty mają opisywać rzeczywiste zachowanie handlera.
4. Utrzymuj publiczne ścieżki pod `/api/v1`. Używaj zasobów i czasowników HTTP; nie dodawaj niewersjonowanych aliasów. Wersja jest wspólna dla całej domeny API.
5. Dodaj testy kontraktowe i testy zachowania: pozytywne, błędne dane, kody błędów i graniczne przypadki. Gdy zmieniasz zapis danych, testuj transakcję i odczyt.
6. Wygeneruj specyfikację i referencję API:

   ```bash
   npm run api:openapi:export
   npm run docs:generate-api
   ```

7. Zaktualizuj przykłady i wyjaśnienia w dokumentacji **polskiej oraz angielskiej**. Przejrzyj zmieniony `apps/api/openapi/openapi.json` i wygenerowane strony; nie zatwierdzaj niezamierzonego szumu.
8. Uruchom `npm run api:openapi:check`, testy i build dokumentacji. CI odrzuci pull request, jeśli schematy Fastify i wersjonowany kontrakt się różnią.

## Konwencje OpenAPI

- OpenAPI 3.1; kod źródłowy kontraktu to JSON Schema w schematach tras Fastify.
- `operationId` jest stabilny i unikalny. Nazwy są w `camelCase`, np. `createCalendarEvent`.
- Endpoint otrzymuje tag domenowy; tag `System` jest zarezerwowany dla health-checków.
- `summary` jest krótki, a `description` dokumentuje semantykę, skutki uboczne, idempotencję, wersjonowanie i wymagane potwierdzenia.
- Odpowiedzi definiują sukces oraz istotne kody błędów. Wspólna odpowiedź błędu ma stabilne pole `error` i może zawierać domenowe szczegóły.
- Daty i czasy zawierają jawny format i strefę czasową. Nie wysyłaj lokalnej daty jako nieopisanego UTC.
- Usunięcie albo zmiana semantyki pola jest zmianą łamiącą. Dla takich zmian projektujemy `/api/v2`; v1 utrzymujemy bez cichego naruszania klientów.
- Nie umieszczaj sekretów, tokenów, danych osobowych ani rzeczywistych danych w `example` OpenAPI.

## Wymagane bramki

```bash
npm run typecheck
npm test
npm run api:openapi:check
npm run docs:build
npm run build
```

W razie zmiany trasy sprawdź ręcznie stronę w `http://localhost:4000/api/v1/docs` oraz przetłumaczoną dokumentację pod `http://localhost:3000` i `/en/`.
