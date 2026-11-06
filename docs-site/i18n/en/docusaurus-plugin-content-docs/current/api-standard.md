---
id: api-standard
title: API change standard
sidebar_label: API standard
description: Mandatory process for designing, validating and documenting every backend change.
---

# API change standard

**Every API behavior change must update the OpenAPI schema and documentation in the same pull request.** Do not defer documentation to a later task.

## Adding or changing an endpoint

1. Put the route in its domain module `apps/api/src/api/v1/<domain>/routes.ts`. Shared repository dependency contracts belong in `apps/api/src/api/contracts.ts`.
2. Add JSON Schema validation for `params`, `querystring`, `headers` and `body`. A TypeScript type without runtime validation is not sufficient.
3. Add `tags`, a clear `summary`, a complete `description`, a stable `operationId` and response schemas, including domain errors. Examples and formats must match actual handler behavior.
4. Keep public paths under `/api/v1`. Use resources and HTTP verbs; do not add unversioned aliases. Version the entire API domain consistently.
5. Add contract and behavior tests: success, invalid input, error statuses and edge cases. Test transactions and reads when persistence changes.
6. Export the specification and regenerate the API reference:

   ```bash
   npm run api:openapi:export
   npm run docs:generate-api
   ```

7. Update examples and explanatory docs in **Polish and English**. Review `apps/api/openapi/openapi.json` and generated pages; do not commit unrelated output noise.
8. Run `npm run api:openapi:check`, tests and the docs build. CI rejects a pull request if Fastify schemas and the versioned contract differ.

## OpenAPI conventions

- OpenAPI 3.1; the source contract is JSON Schema in Fastify route schemas.
- `operationId` is stable and unique, in `camelCase`, for example `createCalendarEvent`.
- Every endpoint has a domain tag; `System` is reserved for health checks.
- Keep `summary` concise. Use `description` for semantics, side effects, idempotency, versioning and required confirmations.
- Define success and relevant error response schemas. Common errors use a stable `error` field and may include domain-specific details.
- Dates and times state their format and timezone. Do not send an undocumented local date as UTC.
- Removing or changing a field's meaning is a breaking change. Design `/api/v2` for such changes; preserve v1 behavior.
- Never include secrets, tokens, personal information or real data in OpenAPI examples.

## Required gates

```bash
npm run typecheck
npm test
npm run api:openapi:check
npm run docs:build
npm run build
```

For route changes, manually verify Swagger UI at `http://localhost:4000/api/v1/docs` and the translated docs at `http://localhost:3000` and `/en/`.
