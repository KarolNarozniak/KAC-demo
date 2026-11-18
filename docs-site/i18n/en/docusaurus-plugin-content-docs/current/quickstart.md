---
id: quickstart
title: Local quickstart
sidebar_label: Quickstart
description: Requirements, first-time setup and one-command startup for the complete workspace.
---

# Local quickstart

## Requirements

- Node.js `24.3+` LTS (recommended) or `26+` and npm `11.x`. Node.js 25 is not supported by the Expo workspace.
- Docker Desktop (Windows/macOS), or Docker Engine and Docker Compose v2 (Linux).
- Local ports `3000`, `4000`, `5432` and `8081` available.

## First-time setup

Windows PowerShell:

```powershell
.\scripts\setup.ps1
```

Linux/macOS:

```bash
sh ./scripts/setup.sh
```

The setup script checks prerequisites, creates local `.env` files from the examples, installs dependencies and prepares PostgreSQL, migrations and demo data. Existing `.env` files are never overwritten.

## Start everything

```powershell
.\scripts\quickstart.ps1
```

```bash
sh ./scripts/quickstart.sh
```

The script checks the database, applies pending migrations, builds the PL/EN documentation and starts the API, Expo, outbox worker and static Docusaurus server. Both language versions share one origin: Polish at `http://localhost:3000` and English at `http://localhost:3000/en/`. `Ctrl+C` stops application processes; PostgreSQL remains running.

Alternatively, after setup, run `npm run dev:all` on Windows, Linux or macOS. While editing docs, `npm run docs:dev` provides hot reload for Polish, and `npm run docs:dev:en` serves English at `http://localhost:3001`.

## Environment variables

Main settings are in `.env`; the web client reads `EXPO_PUBLIC_API_URL` from `apps/web/.env`. Locally use `http://localhost:4000` as the API base; API resources are under `/api/v1`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_PORT` | API port, defaults to `4000` |
| `API_CORS_ORIGINS` | Allowed web-client and docs origins |
| `EXPO_PUBLIC_API_URL` | Base API address for the web client |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google OAuth; demo account is available without them |
| `GOOGLE_REDIRECT_URI` | OAuth callback, defaults to `http://localhost:4000/api/v1/import/google/callback` |
| `GOOGLE_INTEGRATION_REDIRECT_URI` | Persistent connection callback, defaults to `http://localhost:4000/api/v1/integrations/google/callback` |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Google token encryption key (32 bytes in base64); without it the real connection is disabled |
| `REGISTRATION_MODE`, `REGISTRATION_INVITE_CODE` | Who can create an account: `open` (default), `invite` with a code or `closed` – see [Sign-in and accounts](./auth.md) |
| `AI_DAILY_LIMIT` | Daily AI call limit per account, default `200`; `0` disables it |
| `OPENAPI_SERVER_URL` | Base server written to exported OpenAPI |
| `API_ORIGIN`, `API_OPENAPI_URL` | Public API host used by Docusaurus Swagger and specification links |
| `DOCUSAURUS_URL`, `DOCUSAURUS_BASE_URL` | Public docs URL and base path at deployment |

## First sign-in

The app starts with the sign-in screen. Create an account with „Załóż konto” (create account) or set a password for the account with demo data:

```bash
npm run auth:set-password -- student.demo@example.test
```

After creating an account the app shows a recovery code once – it sets a new password when you forget the old one ("Nie pamiętasz hasła?" on the sign-in screen). For the demo account create a code in Settings → Account.

After pulling a new version into an existing database run `npm run db:migrate` first (the quickstart scripts do it themselves). Details: [Sign-in and accounts](./auth.md).

## Separate processes

```bash
npm run api:dev
npm run web:dev --workspace @kac/web
npm run docs:dev
```

The one-command scripts use the same services and also check database readiness. For docs-only work run `npm run docs:dev`.

## Troubleshooting

- API liveness: `GET http://localhost:4000/api/v1/health/live`.
- API readiness and database connectivity: `GET http://localhost:4000/api/v1/health/ready`.
- The outbox worker starts automatically; use `npm run worker:dev --workspace @kac/api` to work on it alone.
- Swagger UI: `http://localhost:4000/api/v1/docs`.
- API documentation: `http://localhost:3000/docs/api-reference`.
- Check migrations with `npm run db:check`; apply them with `npm run db:migrate`.
