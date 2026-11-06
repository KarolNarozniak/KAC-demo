---
id: api-reference
title: Kontrakt API
sidebar_label: API i OpenAPI
description: Wersjonowanie, Swagger UI, eksport OpenAPI i wygenerowana referencja endpointów.
---

# Kontrakt API

## Eksplorator interaktywny

import ApiLinks from '@site/src/components/ApiLinks';

<ApiLinks />

Swagger UI i Docusaurus korzystają z tego samego kontraktu OpenAPI 3.1. Kontrakt nie jest utrzymywany ręcznie: `@fastify/swagger` odczytuje schematy tras Fastify, które jednocześnie walidują żądania.

Opis wszystkich operacji generujemy z OpenAPI w [referencji endpointów](./api/openapi-reference). Ta strona pokazuje modele żądań i odpowiedzi, pogrupowane według tagów API.

## Domeny API v1

| Domena | Prefiks zasobów | Przykładowe operacje |
| --- | --- | --- |
| System | `/api/v1/health` | Liveness i readiness |
| Kalendarz | `/api/v1/calendar` | Odczyt overview, CRUD wydarzeń |
| Profil pracy | `/api/v1/work-profile` | Limity godzin, cel tygodniowy lub miesięczny, dojazd, dostępność, szablony zmian, wersja profilu |
| Planowanie | `/api/v1/schedules` | Generowanie, lista, wersje, walidacja i akceptacja |
| Importy | `/api/v1/import` | Pliki klas/grafików, podgląd, sesje, potwierdzanie |
| Google | `/api/v1/import/google` | Jednorazowy odczyt i podgląd wydarzeń |

Wszystkie ścieżki są pod jedną domeną serwera API. OpenAPI pokazuje pełne ścieżki wraz z prefiksem wersji.

## Kody błędów

Walidacja wejścia Fastify zwraca `400`. Błędne wartości profilu pracy zwracają `422` z kodem błędu przy każdym polu (`fields`). Konflikt wydarzeń lub nieaktualna wersja wykorzystuje `409`; naruszenia ograniczeń planu `422`; nieznane zasoby `404`; brak bazy lub niedostępna zależność `503`. Import nie zapisuje wydarzeń przed potwierdzeniem sesji.

## Kontrakt w repozytorium

- Runtime routes i schematy: `apps/api/src/api/v1/`.
- Eksport OpenAPI 3.1: `apps/api/openapi/openapi.json`.
- Generator: `apps/api/scripts/export-openapi.ts`.
- Każda zmiana endpointu, schematu, statusu lub przykładu wymaga eksportu OpenAPI, regeneracji polskiej i angielskiej referencji oraz aktualizacji tej dokumentacji. CI porównuje wygenerowany kontrakt z plikiem wersjonowanym.

Procedura zmiany jest opisana w [standardzie API](./api-standard.md).
