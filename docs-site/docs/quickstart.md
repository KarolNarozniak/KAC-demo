---
id: quickstart
title: Lokalny quickstart
sidebar_label: Quickstart
description: Wymagania, jednorazowa konfiguracja i jednopoleceniowe uruchomienie całego workspace.
---

# Lokalny quickstart

## Wymagania

- Node.js `24.3+` LTS (zalecany) lub `26+` i npm `11.x`. Node.js 25 nie jest wspierany przez workspace Expo.
- Docker Desktop (Windows/macOS) albo Docker Engine oraz Docker Compose v2 (Linux).
- Porty `3000`, `4000`, `5432` i `8081` dostępne lokalnie.

## Pierwsza konfiguracja

Windows PowerShell:

```powershell
.
scripts\setup.ps1
```

Linux/macOS:

```bash
sh ./scripts/setup.sh
```

Skrypt sprawdza wymagania, tworzy lokalne pliki `.env` na podstawie przykładów, instaluje zależności i przygotowuje PostgreSQL, migracje oraz dane demonstracyjne. Nie nadpisuje istniejących plików `.env`.

## Uruchamianie całości

```powershell
.
scripts\quickstart.ps1
```

```bash
sh ./scripts/quickstart.sh
```

Skrypt weryfikuje bazę, wykonuje brakujące migracje, buduje dokumentację PL/EN i uruchamia API, Expo oraz statyczny serwer Docusaurus. Obie wersje dokumentacji są dostępne z jednego adresu: polska pod `http://localhost:3000`, angielska pod `http://localhost:3000/en/`. `Ctrl+C` zatrzymuje serwisy aplikacji; baza PostgreSQL pozostaje uruchomiona.

Alternatywnie po konfiguracji można użyć `npm run dev:all` na Windows, Linux i macOS. Przy pracy nad dokumentacją `npm run docs:dev` uruchamia hot reload dla polskiego locale, a `npm run docs:dev:en` serwuje wersję angielską na `http://localhost:3001`.

## Zmienne środowiskowe

Główne ustawienia są w `.env`; klient web pobiera `EXPO_PUBLIC_API_URL` z `apps/web/.env`. Lokalnie ustaw adres bazowy `http://localhost:4000`, a serwer API udostępnia trasę pod `/api/v1`.

Najważniejsze zmienne:

| Zmienna | Zastosowanie |
| --- | --- |
| `DATABASE_URL` | Połączenie PostgreSQL |
| `API_PORT` | Port API, domyślnie `4000` |
| `API_CORS_ORIGINS` | Dozwolone origins klienta web i dokumentacji |
| `EXPO_PUBLIC_API_URL` | Bazowy adres serwera API dla web |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opcjonalny OAuth Google; bez nich dostępne jest konto demonstracyjne |
| `GOOGLE_REDIRECT_URI` | Callback OAuth, domyślnie `http://localhost:4000/api/v1/import/google/callback` |
| `OPENAPI_SERVER_URL` | Bazowy serwer wpisany do eksportowanego OpenAPI |
| `API_ORIGIN`, `API_OPENAPI_URL` | Publiczny host API używany przez Docusaurus w linkach do Swaggera i specyfikacji |
| `DOCUSAURUS_URL`, `DOCUSAURUS_BASE_URL` | Publiczny URL i base path dokumentacji przy wdrożeniu |

## Oddzielne procesy

```bash
npm run api:dev
npm run web:dev --workspace @kac/web
npm run docs:dev
```

Skrypty jednopoleceniowe używają tych samych poleceń i dodatkowo sprawdzają stan bazy. Dla pracy wyłącznie nad dokumentacją użyj `npm run docs:dev`.

## Diagnostyka

- API liveness: `GET http://localhost:4000/api/v1/health/live`.
- API readiness i połączenie z bazą: `GET http://localhost:4000/api/v1/health/ready`.
- Swagger UI: `http://localhost:4000/api/v1/docs`.
- Dokumentacja API: `http://localhost:3000/docs/api-reference`.
- Migracje można sprawdzić poleceniem `npm run db:check` i zastosować przez `npm run db:migrate`.
