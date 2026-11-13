---
id: ai-integration
title: Azure AI Foundry
sidebar_label: AI integration
description: Entra ID, stateless Responses API, AI imports, tool registry, retention and App Service Managed Identity.
---

# Azure AI Foundry

## Selected integration

The API uses a Foundry project and a **model deployment**, not Hosted Agent Service. The project OpenAI client sends Responses API requests with `store: false`; instructions, tool inputs, history and files are prepared by the backend. The test Hosted Agent `jovial-agent-…` is not used by the runtime and must not be used as a model deployment name.

This matches the sprint export: Responses API, stateless requests, application-owned conversation memory and a backend tool registry without Agent Service. `getOpenAIClient({agentName})` targets the separate preview-agent endpoint and does not accept the same request-level settings as direct model inference. A separate smoke command is retained for that preview agent.

## One-time Foundry setup

1. Use the existing Foundry project referenced by `AZURE_AI_PROJECT_ENDPOINT`.
2. In **Models + endpoints / Deployments**, create or confirm a standard model deployment. Record the deployment name, model/version, region and deployment type. The Responses API `model` field is the deployment name, not `agent_name`.
3. Verify that the selected deployment supports Responses API, images, PDF `input_file`, function calling and JSON Schema. Availability depends on the model, version, region and TPM/RPM quota.
4. Grant the developer identity **Foundry User** at the project scope. Do not grant Contributor/Owner or subscription-wide access.
5. Configure content filters. Enable core safety categories and Prompt Shields for user attacks; also test protection against instructions embedded in documents. Document attack detection may not be enabled by default.

### Important endpoint distinction

`https://…services.ai.azure.com/api/projects/…` is the project endpoint from the test. It is not a model deployment ID. Runtime uses the official project OpenAI client **without `agentName`** and sets `model` to the deployment name. Do not construct an endpoint from a Hosted Agent URL. Classic Azure OpenAI resources document a different endpoint, `https://<resource>.openai.azure.com/openai/v1`; changing endpoint type also changes RBAC/configuration requirements.

## Local development

Authentication uses a cached Azure CLI session. Sign in once using the correct tenant and subscription:

```powershell
az login --tenant <tenant-id>
az account set --subscription <subscription-id>
az account get-access-token --resource https://ai.azure.com --query expiresOn --output tsv
```

The API uses `AzureCliCredential`, so it does not open a browser for every request. Do not set `AZURE_CLIENT_SECRET` locally; if such variables exist, `DefaultAzureCredential` may unexpectedly select a service-principal credential.

Set the following in the ignored `.env` (or `apps/api/.env` when running the API independently):

```dotenv
AZURE_AI_PROJECT_ENDPOINT=<Foundry project endpoint>
AZURE_AI_MODEL_DEPLOYMENT=gpt-5-mini
AZURE_AI_AUTH_MODE=azure-cli
```

`AZURE_AI_AGENT_NAME` is only used by `npm run ai:inspect` and `npm run ai:smoke` to diagnose the preview Hosted Agent. It does not affect the runtime API.

## Azure App Service

Enable a **system-assigned managed identity** on the API App Service (not the frontend), then grant it the `Foundry User` role on the project. Set `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT` and `AZURE_AI_AUTH_MODE=managed-identity` in App Service configuration. For a user-assigned identity, add `AZURE_AI_CLIENT_ID`; it is an identifier, not a secret. Do not copy GitHub Actions Azure login/publish-profile credentials into App Service; deployment identity and runtime identity are separate.

For a private endpoint, configure API App Service VNet Integration and private DNS. For a public endpoint, still require Entra ID and least-privilege RBAC.

## Data and retention

- Responses requests explicitly use `store: false`; conversation context is reconstructed from application tables.
- PostgreSQL stores conversations, messages, usage metrics and action previews. Conversations expire after 30 days of inactivity; pending actions expire after 15 minutes. The worker removes expired history. Prompts, completions, tokens and file bytes are not written to application logs.
- Original PDF/JPG/PNG bytes are validated and sent inline to the request. They are not stored in `t_importy`, a cache or Azure Files API. The database stores only normalized import rows, a short source excerpt and page number for review.
- `store: false` disables persisted response state used for later Responses turns. It does not by itself guarantee that all safety/abuse-monitoring logs are disabled. Azure states customer prompts are not used to train models; exact service retention depends on feature and service policy. Choose a regional deployment when residency is required; do not assume the same for Global/Data Zone deployments.
- Images are signature-checked, size/pixel limited and resized when needed. PDFs are limited to 5 MB and 10 pages; images to 20 MP. Failed calls do not automatically fall back to OCR/Document Intelligence.

## Instructions, tools, knowledge and guardrails

- **Instructions:** versioned `KAC_ASSISTANT_INSTRUCTIONS` and import-specific instructions are sent with each request. They require Polish responses, authoritative sources and treating file text as untrusted data.
- **Tools:** `assistantTools` is a strict allow-list in `src/ai/tools.ts`: read calendar/profile and prepare create/update/delete previews. Arguments are validated again by the backend. The model never receives a confirmation tool.
- **Knowledge:** no File Search, vector store or external RAG is configured for this MVP. Calendar/profile data comes from scope-bound tools; an uploaded file is only input to its current import.
- **Memory:** PostgreSQL is the source of truth, scoped by `UserScope`. Context is limited to the last 24 ordered messages, and function calls/results are reconstructed as stateless Responses input items. `demoScope` represents the current development setup without login.
- **Guardrails:** the model cannot mutate the calendar directly. Mutations create a TTL-bound `t_ai_akcje` proposal; a separate confirmation endpoint checks ownership, state, current conflicts and an idempotency key. Prompt Shields complement input limits, JSON Schema parsing, tool/round limits and server validation.

## Manual deployment smoke tests

Real Azure calls are not run in CI. After configuring `.env`, use these controlled checks:

```powershell
npm run ai:smoke:responses --workspace @kac/api -- structured
npm run ai:smoke:responses --workspace @kac/api -- tools
npm run ai:smoke:responses --workspace @kac/api -- file tests/fixtures/ai-import/Plan_test_1.png work
npm run ai:smoke:responses --workspace @kac/api -- file tests/fixtures/ai-import/Plan_test_2.png work
```

The script prints only row count, unresolved fields and usage; it does not print employee data. `AZURE_AI_AGENT_NAME` can separately inspect the preview Hosted Agent with `npm run ai:smoke --workspace @kac/api -- "short message"`.

## Sprint integration limits

W02 adds a separate outbox worker. The current worker schedules reminder records in the database, and the frontend can display them in an active browser after permission is granted. Real push after the app is closed requires choosing a Web Push/Notification Hubs provider and configuring keys/subscriptions. Google import currently has only `calendar.readonly`; publishing changes requires adding a write OAuth scope and obtaining consent again. The worker leaves those deliveries explicitly blocked instead of claiming success.
