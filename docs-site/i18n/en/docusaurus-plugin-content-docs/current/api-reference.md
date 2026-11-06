---
id: api-reference
title: API contract
sidebar_label: API and OpenAPI
description: API versioning, Swagger UI, OpenAPI export and generated endpoint reference.
---

# API contract

## Interactive explorer

import ApiLinks from '@site/src/components/ApiLinks';

<ApiLinks />

Swagger UI and Docusaurus use the same OpenAPI 3.1 contract. The contract is not maintained by hand: `@fastify/swagger` reads Fastify route schemas, which also validate requests at runtime.

All operations are generated from OpenAPI in the [endpoint reference](./api/openapi-reference). The page includes request and response schemas grouped by API tags.

## API v1 domains

| Domain | Resource prefix | Example operations |
| --- | --- | --- |
| System | `/api/v1/health` | Liveness and readiness |
| Calendar | `/api/v1/calendar` | Overview and event CRUD |
| Work profile | `/api/v1/work-profile` | Hour limits, weekly or monthly hour target, commute, availability, shift templates, profile version |
| Scheduling | `/api/v1/schedules` | Generation, listing, versions, validation and approval |
| Imports | `/api/v1/import` | Timetables, previews, sessions and confirmation |
| Google | `/api/v1/import/google` | One-time read and event preview |

All paths are served from the same API host. OpenAPI lists full paths including the version prefix.

## Error conventions

Invalid input returns `400`. Invalid work profile values return `422` with an error code for each field (`fields`). Calendar conflicts or stale versions use `409`; schedule constraint violations use `422`; unknown resources use `404`; missing database or unavailable dependency uses `503`. Import does not write calendar events before confirmation.

## Contract in the repository

- Runtime routes and schemas: `apps/api/src/api/v1/`.
- OpenAPI 3.1 export: `apps/api/openapi/openapi.json`.
- Exporter: `apps/api/scripts/export-openapi.ts`.
- Every route, schema, status or example change must include an OpenAPI export, regeneration of the Polish and English API references and updates to this documentation. CI compares the generated contract with the versioned file.

Follow the [API change standard](./api-standard.md).
