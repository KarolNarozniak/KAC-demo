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
- Every assistant turn receives trusted server context: UTC time, the calendar owner's current local date/time and IANA time zone. It is not derived from user content.
- PostgreSQL stores conversations, messages, usage metrics and action previews. Conversations expire after 30 days of inactivity; pending actions expire after 15 minutes. The worker removes expired history. Prompts, completions, tokens and file bytes are not written to application logs.
- Original PDF/JPG/PNG bytes are validated and sent inline to the request. Before upload, the UI states that the file is sent to Azure AI; cancellation aborts the API request and upstream Responses request. Bytes are not stored in `t_importy`, a cache or Azure Files API. The database stores only normalized import rows, a short source excerpt and page number for review.
- `store: false` disables persisted response state used for later Responses turns. It does not by itself guarantee that all safety/abuse-monitoring logs are disabled. Azure states customer prompts are not used to train models; exact service retention depends on feature and service policy. Choose a regional deployment when residency is required; do not assume the same for Global/Data Zone deployments.
- Images are signature-checked, size/pixel limited and resized when needed. PDFs are limited to 5 MB and 10 pages; images to 20 MP. Failed calls do not automatically fall back to OCR/Document Intelligence.

## Instructions, tools, knowledge and guardrails

- **Instructions:** versioned `KAC_ASSISTANT_INSTRUCTIONS` and import-specific instructions are sent with each request. They require Polish responses, authoritative sources and treating file text as untrusted data.
- **Tools:** `assistantTools` is a strict allow-list in `src/ai/tools.ts`: read calendar/profile and prepare create/update/delete previews. Arguments are validated again by the backend. The model never receives a confirmation tool.
- **Knowledge:** no File Search, vector store or external RAG is configured for this MVP. Calendar/profile data comes from scope-bound tools; an uploaded file is only input to its current import.
- **Memory:** PostgreSQL is the source of truth, scoped by `UserScope`. Context is limited to the last 24 ordered messages, and function calls/results are reconstructed as stateless Responses input items. `demoScope` represents the current development setup without login.
- **Guardrails:** the model cannot mutate the calendar directly. Mutations create a TTL-bound `t_ai_akcje` proposal; a separate confirmation endpoint checks ownership, the full event snapshot, current conflicts and an idempotency key. Updates and deletes persist the action result in the same transaction as the calendar mutation; a retry after a lost response returns that result instead of applying the write again. A stale preview is failed and must be prepared again. Prompt Shields complement input limits, JSON Schema parsing, tool/round limits and server validation.

## Cancelling file analysis

Before sending, the UI states that a PDF/PNG/JPG is transmitted to Azure AI Foundry. The cancel control aborts the client request; the API forwards the abort signal to Responses and does not create a review session if extraction was interrupted. Even a successful extraction only creates a review session; calendar events require a separate confirmation.

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

W02 adds a separate outbox worker. Reminders are scheduled in the database; optional Web Push requires VAPID configuration in the API/worker. Google import currently has only `calendar.readonly`; publishing changes requires adding a write OAuth scope and obtaining consent again. The Google consumer keeps its deliveries explicitly blocked until write scope is granted.

## Creating events in chat (S23KC2S1P2-252)

The assistant asks for a title, date, start and end or duration, and an ambiguous category. Location is optional; mandatory attendance and weekly recurrence default to false. Conversation rules are model instructions and also require testing against the actual Azure deployment.

The Assistant preview displays the time, category, location and both flags. **Zatwierdź** saves the event; **Odrzuć** cancels the proposal. Saying “yes” in chat does not replace the application confirmation.

`POST /api/v1/assistant/actions/{id}/confirm` accepts `{}` or `{ "collisionToken": "<64 hexadecimal characters>" }`. A collision returns HTTP 409 with `conflicts` and a token bound to the proposal and current conflicts. The UI displays them and offers a separate **Zapisz mimo kolizji** button. Changed conflicts invalidate the old token and require another decision. The backend issues this token; the model cannot confirm operations with it.

After a lost response, confirm **the same proposal** again. Existing action identifiers make calendar writes idempotent; requesting another proposal is unnecessary. Cancelled or expired actions cannot be saved.

### Manual test

1. Start an Assistant conversation with “Dodaj spotkanie osobiste”. Verify that it asks for the missing title and time without creating an event.
2. Reply “Spotkanie testowe, 20 listopada 2026, od 10:00 do 11:00”. Check all preview fields. Saying “tak” must not save the event.
3. Select **Odrzuć** and check the calendar. Prepare another proposal, select **Zatwierdź**, and verify a single event.
4. Propose another event at the same time. Review the collision list and explicitly save despite collisions. Also test rejecting it and requesting another time.
5. After losing a confirmation response, retry the same card. Only one event should exist for that action.

## Today card

An empty day displays a fixed message without calling the assistant API or Azure. Detection includes today's weekly occurrences and events crossing midnight. The summary refreshes automatically when today's events change; there is no Refresh button. Unchanged data reuses the result within the current app session. The application displays “Dzień dobry!” from 05:00 through 17:59 and “Dobry wieczór!” otherwise, using the device's local time. The model is instructed to omit the date and an additional greeting.

Internal conversations titled “Dzień w skrócie YYYY-MM-DD” remain available to the card but are hidden from the Assistant conversation list.

## Chat, streaming and personalization

Chat immediately displays the user's message and a typing indicator. It uses `POST /api/v1/assistant/conversations/{id}/messages?stream=true`, returning `application/x-ndjson`. Each line is an event: `accepted` confirms persisted user input, `delta` appends text, `reset` clears provisional text before another tool round, and `done` returns the persisted answer and pending proposals. `error` terminates an unsuccessful turn. Disconnecting aborts the upstream request. Without `stream`, the endpoint retains its JSON response. A stream ending without `done` is not successful.

Empty or incomplete model responses produce `assistant_incomplete_response` (502 before streaming starts, an `error` event afterwards), rather than a stored summary. The 4000-token output budget includes model reasoning; diagnostics record the incomplete reason without conversation text.

Confirmation keeps the user in chat. **Zatwierdź wszystko** executes proposals sequentially and stops on the first error or collision. Successful actions leave the list; remaining actions retain their identifiers for retry. Batch confirmation is not an atomic transaction across all proposals.

Settings → Personalizacja agenta stores an address form (up to 60 characters) and a neutral, friendly or formal tone. Preferences are stored on the device and sent with subsequent messages as optional `preferences: { addressAs, tone }`; API tone values are `neutral`, `friendly`, and `formal`. Style preferences cannot change permissions or confirmation requirements.

Regenerating the Today card creates a fresh hidden internal conversation, preventing reuse of stale calendar tool results from an earlier summary. Unchanged calendar data uses the current app session's cache.

### Azure filtering versus an interrupted response

`assistant_content_filtered` means Azure blocked the input or output through content filtering; `assistant_refused` indicates an explicit model refusal. Both return 422 in JSON mode or an `error` event after streaming starts. The UI clears provisional refusal text and displays a Polish explanation instead of labeling it as an interrupted transmission. The calendar remains unchanged.

Safe diagnostics record the provider code and filtered category names without prompt text. Incorrect classification of an allowed request requires reviewing the assigned Foundry policy or reporting the issue to the provider. The application does not disable filters or automatically rewrite messages to avoid a block.

### Multiple proposals in one turn

The model can return multiple tool calls in one response (`parallel_tool_calls: true`); the backend validates and executes them sequentially. `AZURE_AI_MAX_TOOL_ROUNDS` defaults to 8 (configurable up to 16), with an additional limit of 64 calls per turn. Complete current-turn call/output pairs are retained independently of the 24-message window for earlier history.

Exhausting the limit returns `assistant_tool_limit` (409 or an `error` event). Error responses may include `pendingActions`; the UI shows already prepared previews for confirmation or cancellation. Preparing the identical action again in the same conversation reuses its existing unexpired preview. Limits and errors never confirm calendar changes.

### Current status of historical proposals

A historical `awaiting_user_confirmation` result does not prove that a preview is still valid. Before each turn, the backend refreshes referenced action statuses in the model context from the database, scoped to the user and conversation. Expired, cancelled, failed or unavailable proposals need a fresh preview when requested again; confirmed actions indicate completed writes, while processing actions must not be duplicated. Stored historical messages remain unchanged.

The Assistant displays the actual pending proposal count beside batch confirmation. An earlier textual claim by the model does not establish that all proposals remain available for saving. Preview TTL remains 15 minutes.

### Photo or file from the Assistant

The camera icon beside the message input offers class timetable or work schedule import, then opens the existing import dialog. File selection, row correction, duplicate decisions and confirmation reuse the shared import workflow. Saving keeps the user in the Assistant and marks the calendar for refresh. The shortcut also works without an active chat; local reading remains available without Azure configuration.

The import dialog offers local OCR (Tesseract plus a parser) and Azure AI (model interpretation of the image). Local OCR processes images on the API server; class imports support the recognized WAT table layout, while work imports use the shift parser. Azure receives the image and returns structured rows. Both methods lead to a preview requiring confirmation. The icon is an import shortcut; the original image is not attached to conversation history.
