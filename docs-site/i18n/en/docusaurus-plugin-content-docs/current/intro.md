---
id: intro
title: Welcome to KAC Platform
sidebar_label: Start here
description: Product, architecture, API and local development guide for KAC Platform.
---

# KAC Platform

KAC combines an event calendar with weekly work planning. The application consists of an Expo/React Native web client, a modular Fastify API, PostgreSQL and this documentation site.

## Fastest start

Install Node.js 24 LTS and Docker Desktop, then run from the repository root:

```powershell
.\scripts\quickstart.ps1
```

Linux/macOS:

```bash
./scripts/quickstart.sh
```

The quickstart prepares the local database, applies migrations, exports OpenAPI and starts the API, web app and docs. See the [local quickstart](./quickstart.md) for requirements and details.

## Important addresses

| Service | Local address |
| --- | --- |
| Web application | `http://localhost:8081` |
| API v1 | `http://localhost:4000/api/v1` |
| Swagger UI | `http://localhost:4000/api/v1/docs` |
| OpenAPI JSON | `http://localhost:4000/api/v1/openapi.json` |
| Docusaurus docs | `http://localhost:3000` |

## Documentation

- [Architecture and module boundaries](./architecture.md)
- [API change standard and pull request requirements](./api-standard.md)
- [API contract and endpoint explorer](./api-reference.md)
- [Azure AI Foundry integration](./ai-integration.md)
- [Local quickstart and configuration](./quickstart.md)

The API contract is versioned at `apps/api/openapi/openapi.json`, generated from Fastify route schemas and rendered in Docusaurus. The API-hosted Swagger UI is for interactive development requests.
