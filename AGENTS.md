# Contributor Requirements

## Backend API Changes

- Every new or modified API endpoint must remain inside a domain module under `apps/api/src/api/v1/` and under the shared `/api/v1` prefix. Do not add unversioned aliases.
- Define or update Fastify JSON Schemas for request parameters, query strings, request bodies and responses. Add a stable `operationId`, domain tag, summary and meaningful description so the runtime OpenAPI contract is complete.
- Add or update behavior and contract tests. Keep examples safe and synthetic; never add tokens, secrets or real personal data.
- In the same change, regenerate `apps/api/openapi/openapi.json` with `npm run api:openapi:export`, regenerate the Docusaurus API reference with `npm run docs:generate-api`, and update explanatory documentation in both Polish and English.
- Before completing API work, run `npm run api:openapi:check`, `npm test`, `npm run docs:build` and `npm run build`.
- CI enforces the generated OpenAPI file and builds both documentation locales. A pull request that changes backend behavior without corresponding contract and documentation updates must not be merged.

See `docs-site/docs/api-standard.md` and its English translation for the detailed workflow and OpenAPI conventions.
