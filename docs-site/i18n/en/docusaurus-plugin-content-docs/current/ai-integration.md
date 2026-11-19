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
- Original PDF/JPG/PNG bytes are validated and sent inline to the request. Before upload, the UI states that the file is sent to Azure AI; cancellation aborts the API request and upstream Responses request. Original file bytes are not stored in the database, a cache or Azure Files API. Standard imports store normalized rows, a short excerpt and page number. Chat imports additionally retain a bounded derivative image preview as described below.
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

## Today card and calendar questions (S23KC2S1P2-254)

### Data sources

| Data | Source | Computed by |
| --- | --- | --- |
| Today's events on the card | Calendar loaded by the app, expanded for the current day by `occurrencesForRange` | App (device) |
| Events in the model's answer | `calendar_search_events` tool, current `UserScope` calendar only | Backend |
| Profile, availability, hour target | `work_profile_get` tool | Backend |
| Current date, time and zone | Trusted server context (`trustedTimeContext`): UTC time and time in the calendar owner's IANA zone | Backend |

The model receives no data outside these sources. Message text, event titles and locations are untrusted data — writing "today is 1 January" does not change the trusted time. An invalid account zone falls back to `Europe/Warsaw`.

`calendar_search_events` accepts a date range of up to 93 days and returns at most 100 events. The text filter checks title and location.

### Calculations

The Today card asks the model for 2–4 sentences: the main events with times and the longer free windows. The model does not save changes or prepare actions.

For questions such as "how many classes do I have on Thursday?" or "when am I free?", the model answers from the event list returned by the tool. The backend does not yet have a dedicated tool for hour totals or free windows — the model derives totals and gaps from that list, so the answer is advisory. Exact free windows for work planning are computed by the schedule generator (see below).

Time ranges are half-open `[start, end)`: events 10:00–11:00 and 11:00–12:00 do not overlap and leave no gap.

### Recurrence

On the Today card, `repeatWeekly` events are expanded to the current day — an occurrence of a series that started in earlier weeks appears in the summary. Each occurrence keeps the series' local time.

Limitation: `calendar_search_events` compares first-occurrence dates and does not expand series. When asked about next week, the model may miss weekly classes that started earlier. Full occurrence support in search belongs to the backend part of the story.

### Midnight and daylight saving time (DST)

- An event crossing midnight (e.g. 23:00–01:00) belongs to both days: it affects the summary of the day it starts and the day it ends. An event ending exactly at 00:00 does not belong to the next day.
- At midnight the day key changes — the card creates a new summary in a new hidden conversation "Dzień w skrócie YYYY-MM-DD".
- On DST changes (in `Europe/Warsaw`, 29 March 2026 has 23 hours and 25 October 2026 has 25 hours) weekly events keep their local time, e.g. 10:00 classes stay at 10:00. Duration is measured in real time: a 01:00–04:00 event on 25 October 2026 lasts 4 hours.
- The card determines "today" and the greeting by the **device** time zone, while the model uses the **account** zone from the trusted context. If the device is in a different zone than the account, the two views may point to different days.
- Greeting: "Dzień dobry!" from 05:00 to 17:59, "Dobry wieczór!" otherwise.

### Cache and refresh

- An empty day shows the fixed message "Nie masz dziś zaplanowanych wydarzeń" without calling the assistant API or Azure.
- The summary key is the date plus a snapshot of today's occurrences: ID, title, category, location, mandatory flag, recurrence, start and end. Changing any of these fields in today's event generates a new summary; changing an event on another day does not.
- An unchanged day reuses the result kept in memory for the current app session. The cache is cleared on sign-out, after a generation error and when the day becomes empty. After an app restart the cache is empty, so a new summary is generated.
- Every new summary runs in a fresh hidden conversation so the model cannot reuse an old calendar read. There is no "Refresh" button.
- If the model prepares an action in a summary conversation, the app cancels it — the card never changes the calendar.
- When the assistant is disabled (`GET /api/v1/assistant/config` returns `enabled: false`), the card shows an Azure AI unavailability message.
- "Dzień w skrócie YYYY-MM-DD" conversations are hidden from the Assistant conversation list.

### Calendar gap versus work availability

These are different concepts:

- A **calendar gap** is the time between events on a given day. It comes from the calendar only and appears in the summary as a "free window". It does not mean that work is possible at that time.
- **Work availability** is computed by the schedule generator (`freeWindows`): availability windows from the work profile minus mandatory classes and other events, minus commute buffer and rest, minus unavailable days. Only windows at least as long as the minimum shift remain. Optional classes are a soft constraint (warning).

Example: a 13:00–14:30 break between classes is a calendar gap. With a 30-minute commute and a 3-hour minimum shift it is not work availability. Conversely, a free evening in the calendar is not availability if the profile has no availability window at that time. Questions about whether work fits should go to the Schedule screen; the assistant reads the profile but does not run the generator.

### Tests

| Area | Tests |
| --- | --- |
| Day context, recurrence, midnight, greeting | `apps/web/tests/dailySummary.test.ts` |
| Cache, empty day, regeneration, hidden conversations | `apps/web/tests/dailySummary.test.ts` |
| Tools, trusted time, user scope | `apps/api/tests/ai.test.ts`, `apps/api/tests/assistant-api.test.ts` |
| Free windows and work availability | `apps/api/tests/class-constraints.test.ts`, `apps/api/tests/class-constraints.integration.test.ts` |

Run time-zone-dependent tests with `Europe/Warsaw` (e.g. `TZ=Europe/Warsaw`).

#### Manual test

1. Add weekly classes that started a week earlier and open Today — the classes must appear in the summary.
2. Switch to another tab and back to Today without calendar changes — the text stays the same and no new assistant turn runs.
3. Change the time of today's event — the summary refreshes automatically. Changing tomorrow's event does not change it.
4. Delete all of today's events — the fixed message appears without an assistant call.
5. Ask the Assistant: "How much free time do I have tomorrow?". Check that the answer is based on calendar events and that no action was prepared.

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

### Photos and completing an import in chat

The camera icon offers a class timetable or work schedule, local OCR or Azure AI, and file or camera selection. The image appears immediately in the conversation. The review stays in chat, where the user can ask to correct times, dates, titles, employee selection, omitted rows and duplicate decisions. Clicking the image enlarges it.

The assistant uses `import_get_preview` and `import_prepare_changes` against a specific draft revision. A null `rowId` adds a missing row; other null fields leave values unchanged. There is no model confirmation tool. **Zatwierdź import** saves only the reviewed revision through the shared import workflow, including duplicates, overnight acknowledgement and transactional writes. Retrying a successful confirmation returns its receipt. Corrections renew the draft's 15-minute validity. The image and draft survive reopening the conversation.

Drafts extend the existing `t_importy` table through `016_chat_import_drafts.sql`, scoped to user, calendar and conversation. Original image/PDF bytes are not stored. Images retain a derivative JPEG up to 1600×1600 and 700,000 data URL characters, following conversation retention. The latest AI-mode preview may enter the model context during follow-up discussion. With local OCR, image pixels stay outside Azure context; the model discusses normalized rows. PDFs appear as file-name messages without page thumbnails.

The existing timetable and work schedule forms are now **Szybki import** (Quick import). **Dokończ w czacie** transfers an image and available corrections to the AI workflow when recognition, validation or saving needs attention. An active session preserves corrected rows, selections and duplicate decisions. Recognition errors without a session trigger a new image read. Transfer never confirms calendar writes.

#### Manual verification

1. In the Assistant, select the camera, class timetable and Azure AI, then a synthetic photo. Verify its message preview and event draft without calendar writes.
2. Ask “w pierwszym wierszu koniec 10:30”. Check the new revision and time. Add a missing row, omit an unwanted row and resolve duplicates in chat.
3. Reload and reopen the conversation; the image and draft should remain available.
4. Confirm the import; retrying the same revision must not add copies. Also test cancellation and rejection of an old revision after corrections.
5. Trigger an incomplete row or error in Quick import. Select Dokończ w czacie and verify the image and earlier corrections are retained.

## Planning through chat (S23KC2S1P2-257)

### Current state

The assistant **does not run the schedule generator**. The tool registry (`apps/api/src/ai/tools.ts`) has no planning or schedule-saving tool. In a conversation about work planning the assistant can:

- read the work profile with `work_profile_get`: hour target and limits, work mode, availability, preferred windows, blocked periods, shift templates, commute and rest;
- read the calendar with `calendar_search_events` (range up to 93 days, at most 100 events, weekly series are not expanded);
- prepare a preview of a single work shift with `calendar_prepare_event_create` (category `Work`), saved only after **Zatwierdź** (Confirm).

A full weekly schedule is created on the **Grafik** (Schedule) screen (`POST /api/v1/schedules/generate`) and approved with the button on that screen (`POST /api/v1/schedules/{weekStart}/approve`). Handing a proposal from the Assistant over to the Schedule screen is not implemented yet.

### Assistant answer versus generator result

| | Assistant in chat | Generator on the Schedule screen |
| --- | --- | --- |
| Profile source | `work_profile_get` – the same read as `GET /api/v1/work-profile` (`profileFromContext` built from the planning context) | `getPlanningContext` – the same planning context |
| Weekly classes | Series are not expanded; classes that started earlier may be missed | Series are expanded in the selected week, also across DST changes |
| Free time | Estimated from the event list | Computed as `freeWindows`: availability minus mandatory classes, other events, commute buffer, rest and unavailable days; windows shorter than the minimum shift are dropped |
| Result | Text and optional single-event previews | Saved schedule proposal with `solutionStatus`, shifts, hour total and warnings |
| Calendar write | Only after Confirm on each preview | Only after the schedule is approved |

The generator result is authoritative. The assistant's answer on whether the hour target fits is advisory – it may differ from the generator because the model does not apply its rules (buffers, rest, minimum shift, daily limits) and does not see every occurrence of a series.

### Special cases

| Case | Assistant | Generator (`POST /schedules/generate`) |
| --- | --- | --- |
| No work profile | `work_profile_get` returns `work_profile_not_found`; the assistant does not guess the target or availability | 404 `work_profile_not_found` |
| Profile without availability or target | Sees empty profile fields | 409 `profile_setup_required` with a `missing` list (`availability`, `target`) |
| Outdated profile version | – | 409 `profile_version_conflict` with the current `profileVersion` |
| No classes in the week | May report it from the calendar | 409 `no_classes_for_week` with `requiresConfirmation: true`; retry with `confirmNoClasses: true` |
| Not enough time for the target | Model estimate | Valid result (201) with the `insufficient_free_time` warning (`freeMinutes`, `missingMinutes`), `shortfallMinutes` and `solutionStatus` `proven_infeasible` or `not_found` |
| Retry | An identical unexpired preview is reused; expired, cancelled and confirmed previews require a new request; retrying a confirmation does not duplicate the event | Generation is deterministic for the same data; approval requires the current version (`schedule_version_conflict`, `schedule_already_approved`) |

### No writes without acceptance

- The model has no confirmation tool. `calendar_prepare_*` tools only create a preview in `t_ai_akcje` with a 15-minute TTL.
- An event is created only by `POST /api/v1/assistant/actions/{id}/confirm`, triggered by the **Zatwierdź** button. Typing "yes" in the chat saves nothing. Collisions require a separate decision (`collisionToken`).
- A generated schedule is a saved proposal, not events. Shifts reach the calendar only after the schedule is approved, which re-checks collisions with mandatory classes and limits.

### Manual test

1. Without a work profile, ask the Assistant: "Zaplanuj mi pracę na przyszły tydzień". The assistant reports the missing profile and creates no proposal.
2. Complete the profile (availability and target). Ask: "Czy zmieszczę 20 godzin pracy w przyszłym tygodniu?". Compare the answer with **Generuj** on the Schedule screen for the same week – the generator result decides.
3. Ask to add a single work shift. Check the preview and that no event exists before **Zatwierdź**; after **Odrzuć** the calendar is unchanged.
4. Generate a schedule for a week without classes on the Schedule screen – confirmation of no classes is required.
5. Set a target larger than the available time – the result contains the insufficient-time warning, and the calendar does not change until the schedule is approved.
