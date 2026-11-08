---
id: architecture
title: Architecture
sidebar_label: Architecture
description: Application boundaries, API domains, data flow and validation.
---

# Architecture

## Main components

```mermaid
flowchart LR
  Browser[Web / Expo React Native] -->|JSON /api/v1| Api[Fastify API]
  Api --> Calendar[Calendar module]
  Api --> Profile[Work profile module]
  Api --> Scheduling[Scheduling module]
  Api --> Imports[Import modules]
  Api --> Google[One-time Google read]
  Calendar --> Pg[(PostgreSQL)]
  Profile --> Pg
  Scheduling --> Pg
  Imports --> Pg
  Api --> OpenAPI[OpenAPI contract]
  OpenAPI --> Swagger[Swagger UI]
  OpenAPI --> Docs[Docusaurus PL / EN]
```

## Modular backend

All HTTP resources belong to one API domain and the shared `/api/v1` version. Routes are split by responsibility:

- `src/api/v1/calendar/routes.ts` handles calendar overview and events.
- `src/api/v1/profile/routes.ts` handles the work profile: hour limits, the hour target (week or month), commute, availability, preferences, blocked periods and shift templates. Saving is atomic and requires the current profile version (optimistic locking).
- `src/api/v1/scheduling/routes.ts` handles generation, editing, validation, approval and schedule history.
- `src/api/scope.ts` resolves the request user on the server. Until login exists it is the demo user from configuration.
- `src/api/v1/imports/routes.ts` handles import previews, sessions, file readers and class schedules.
- `src/api/v1/imports/google-routes.ts` implements one-time Google import as a data-source adapter.
- `src/api/v1/health/routes.ts` contains liveness and readiness probes.
- `src/api/contracts.ts` defines repository dependencies passed to route modules.

Route modules receive dependencies through Fastify plugin options. They do not open database connections or import another domain's implementation. Domain logic and SQL live in their respective services and repositories.

## Request flow

1. Fastify matches a route under `/api/v1`.
2. JSON Schema validates parameters, query string and body before the handler runs.
3. The handler coordinates the domain use case.
4. A repository performs reads or a PostgreSQL transaction.
5. OpenAPI is generated from the same schemas used for runtime validation.

## Versioning

`/api/v1` is the contract version, not a domain name. Add features as resources in this version, for example `/api/v1/calendar/events`, `/api/v1/schedules` and `/api/v1/import/sessions`. Breaking changes require a new `/api/v2` namespace; do not silently change existing behavior.

## Data rules

- Imports are staged as proposals/sessions. The calendar changes only after validation and confirmation.
- Schedule approval rechecks constraints on the server and commits shifts with calendar events in a transaction.
- Classes in planning (`src/scheduling/constraints.ts`): `listBlockingOccurrences` expands weekly series into the planned week, `freeWindows` subtracts mandatory classes and other events (with the commute buffer) from availability, and `constraints.classCollision` reports a `class_collision` error that identifies the class. Optional classes are skipped only as a last resort, with a warning. Schedule responses include `blockingEvents` and `freeWindows` computed from the current calendar.
- Event times are interpreted in the user's profile timezone.
- A user has at most one active work profile (unique database index). A monthly target is converted to a weekly one (month = 52/12 weeks) and that value is used by the generator. Profile changes affect only future generated schedules.
- Calendar conflicts and schedule versions are resolved by the backend, not only by the UI.
