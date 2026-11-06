---
id: intro
title: Witaj w KAC Platform
sidebar_label: Start tutaj
description: Przewodnik po produkcie, architekturze, API oraz lokalnym środowisku KAC Platform.
---

# KAC Platform

KAC łączy kalendarz wydarzeń z planowaniem tygodniowej pracy. Aplikacja składa się z webowego klienta Expo/React Native, modułowego API Fastify, PostgreSQL i tej strony dokumentacji.

## Najszybszy start

Po zainstalowaniu Node.js 24 LTS i Docker Desktop uruchom z katalogu głównego repozytorium:

```powershell
.
scripts\quickstart.ps1
```

Linux/macOS:

```bash
./scripts/quickstart.sh
```

Quickstart przygotuje lokalną bazę, wykona migracje, wygeneruje kontrakt OpenAPI i uruchomi API, web oraz dokumentację. Szczegóły i wymagania są w [lokalnym quickstarcie](./quickstart.md).

## Ważne adresy

| Usługa | Lokalny adres |
| --- | --- |
| Aplikacja web | `http://localhost:8081` |
| API v1 | `http://localhost:4000/api/v1` |
| Swagger UI | `http://localhost:4000/api/v1/docs` |
| OpenAPI JSON | `http://localhost:4000/api/v1/openapi.json` |
| Dokumentacja Docusaurus | `http://localhost:3000` |

## Dokumentacja

- [Architektura i granice modułów](./architecture.md)
- [Standard zmian API i wymagania dla pull requestów](./api-standard.md)
- [Opis kontraktu i eksplorator endpointów](./api-reference.md)
- [Lokalny quickstart i konfiguracja](./quickstart.md)

Kontrakt API jest wersjonowany w repozytorium w `apps/api/openapi/openapi.json`, generowany ze schematów tras Fastify i renderowany w Docusaurus. Swagger UI na serwerze API służy do interaktywnego wykonywania żądań w środowisku developerskim.
