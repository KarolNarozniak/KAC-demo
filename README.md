# KAC monorepo

Kernel 'Aura Kalendar' is split into independently built web and API projects, with the PostgreSQL schema and migrations in a separate database project.

## Structure

- `apps/web` — Expo / React Native Web front end and existing in-memory demo workflows.
- `apps/api` — TypeScript/Fastify API. The first vertical slice exposes liveness/readiness and reads demo calendar data from PostgreSQL.
- `database` — PostgreSQL schema aligned with `KAC_Pelny_Model_Informacyjny_Backlog.xlsx`, SQL migrations and idempotent demo seed.
- `docker-compose.yml` — local PostgreSQL only. Production should use Azure Database for PostgreSQL Flexible Server, not a SQLite file in an App Service instance.

## Local development

Requirements: Node.js 24 LTS, npm and Docker Desktop (the backend can still run without Docker, but the database panel will report that PostgreSQL is unavailable).

1. Copy `.env.example` to `.env`; its database password is local-only.
2. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`.
3. Run `npm install` from the repository root.
4. Start local PostgreSQL with `npm run db:up`, then apply the model and seed with `npm run db:migrate` and `npm run db:seed`.
5. Start the API with `npm run api:dev`.
6. In a second terminal, start Expo Web with `npm run web:dev`.

The web app normally runs on the Expo development port (`8081`); the API listens on port `4000`.

The calendar and all existing interactions remain a local demo. A small status card calls `GET /api/demo/connection`; when PostgreSQL is configured the API reads a seeded user, calendar, categories and events from the database. `GET /api/demo/calendar` exposes the same read-only sample. This is an integration smoke slice, not a replacement of the calendar’s event logic or implementation of the Jira backlog.

## Validation

- `npm run typecheck` — type-check web and API projects.
- `npm test` — current front-end and API unit tests.
- With the local database running: `npm run db:migrate`, `npm run db:seed`, then `npm run test:api:db`.
- `npm run build` — validate the SQL model and build both API and Expo web export.
- `npm run package:deploy --workspace @kac/web` — prepare a minimal static web package without Expo build dependencies.
- `npm run package:deploy --workspace @kac/api` — make a standalone API package for a separate App Service.

## CI/CD and Azure

GitHub Actions builds and type-checks both apps, applies the SQL migrations to a PostgreSQL service container, seeds it, and runs the API-to-PostgreSQL integration smoke test. It always deploys the web App Service. The API deploy job is skipped until the GitHub Actions variable `AZURE_API_WEBAPP_NAME` is set to a separately provisioned Linux Node App Service. Configure that API App Service with `DATABASE_URL`, `PGSSLMODE=require` and `API_CORS_ORIGINS` in App Service settings; grant the workflow's OIDC identity deploy rights to the API App Service. Configure the public GitHub Actions variable `KAC_API_URL` to the API origin; Expo embeds `EXPO_PUBLIC_API_URL` at build time. Without that variable the frontend reports “API not configured” and its existing local demo still works.

For production, use Azure Database for PostgreSQL Flexible Server rather than putting SQLite in an App Service filesystem. No production database URL, password or API deployment target is committed.

The API demo endpoint is read-only. It deliberately does not implement authentication, calendar CRUD, Google OAuth/Calendar, imports, planning or notifications. Those features remain the current mock workflows and should be implemented in separate vertical slices against the information model.
