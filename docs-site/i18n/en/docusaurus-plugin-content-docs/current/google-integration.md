---
id: google-integration
title: Google Calendar connection
sidebar_label: Google Calendar
description: Persistent Google account connection – consent, encrypted tokens, granted access and calendar list.
---

# Google Calendar connection

Story S23KC2S1P2-12 ("Use an existing Google calendar"): subtasks G01 (S23KC2S1P2-284, backend) and G02 (S23KC2S1P2-286, Settings panel). This connection is **persistent** – synchronisation, disconnecting and schedule publishing build on it. The one-time import (S23KC2S1P2-27, `/api/v1/import/google`) keeps its own contract unchanged.

## Flow in the app

**Ustawienia → Google Calendar** shows the connection state and the access the app will ask for: reading calendars and events, and adding and changing events. "Zaloguj się przez Google" opens the Google account choice and consent page in a new tab; the panel polls the server every 2 seconds and shows the result itself.

| Story step | Behaviour |
| --- | --- |
| 1a – account already connected | Shows the account, connection date, granted access, calendar list and "Zmień konto" (with confirmation). A plain connect returns `409 already_connected`. |
| 2a – no internet | "No connection to the internet or the KAC server" message and "Spróbuj ponownie". |
| 5a – denial or closed window | "Odmów" or "Anuluj" end the attempt without saving; an existing connection is kept. A late return from Google for a cancelled attempt saves nothing. |
| 5b – account choice | Google always shows account choice (`prompt=select_account consent`). In demo mode the user picks one of two demo accounts. |
| 6a – authorisation error | An expired or reused code, a Google error or a missing refresh token end the attempt with a message; nothing is saved. |
| 7a – no calendars | An account without calendars stays connected and the panel explains the empty list. |

The **actually granted** access is stored. If the user unticks event writing on the Google page, the panel shows "Adding and changing events – not granted" and offers "Połącz ponownie". Consent without calendar access does not connect the account. When Google rejects the stored refresh token (expired or revoked), the account switches to "reconnect required"; local events stay unchanged. Connecting never creates, changes or deletes events.

"Zmień konto" replaces the previous account only after the new sign-in succeeds. The previous account becomes "Niepołączone", its tokens are deleted and its generation counter grows, so work queued for the old connection is rejected.

## Synchronization and errors (G06)

Story S23KC2S1P2-17, subtask G06 (S23KC2S1P2-290). Below the calendar list the panel has a **Synchronization** section: state ("never synchronized", "running", "synchronized", "partial", "error"), time of the last successful synchronization and a "Synchronizuj z Google" button. For now synchronization reads the calendar list; event import (G05), publishing (G07) and corrections (G09) are meant to record their attempts in the same registry.

- Every attempt is stored in `t_synchronizacje`: direction (read/publish), scope, operation, number of tries, number of changes, result, error code and time. The last successful read and publication are stored separately in the account, so a failed attempt never overwrites them.
- Transient errors – no network or timeout, rate limit, Google server error – are retried automatically at most 3 times, with 0.5 s and 1 s pauses. Missing consent, missing permissions and a disabled Calendar API are not retried.
- The cause is distinguished: no connection, expired login, no permission for the calendar, rate limit, Google-side error (with a dedicated message for a disabled Calendar API).
- On error the panel shows the cause, the time of the last success and "Spróbuj ponownie" or "Połącz ponownie konto Google". An expired login does not offer a plain retry. After a successful reconnect, synchronization starts automatically.
- Denying consent during reconnect (5a) disables synchronization (`Zgoda_Synchronizacja`); the account and local events stay unchanged. Granting consent on a later sign-in enables it again.
- At most one attempt per direction runs per account. An attempt interrupted e.g. by a server restart is marked as an "interrupted" error after 5 minutes.
- An incomplete calendar list gives a "partial" result and does not delete calendars it did not cover.
- In demo mode the next synchronization result can be forced (no internet, transient network error, expired login, server error, rate limit, partial result, no permissions) to show the flows without real Google.

## Calendar selection (G04)

Story S23KC2S1P2-41, subtask G04 (S23KC2S1P2-288). The calendar list in the panel shows which calendars are used for planning and synchronization, and the schedule publication calendar. "Zmień wybór kalendarzy" opens editing: source checkboxes and one publication calendar. "Dalej" shows a summary of changes, "Zatwierdź" saves them, "Anuluj" keeps the previous selection.

- The source set (`t_kalendarze_google.wybrany`) and the publication calendar (`t_konta_google.id_kal_publikacji`) are saved together in one transaction with version control (`wersja_wyboru`). A save with an old version (e.g. from a second window) ends with `409 selection_conflict` and changes nothing; the panel then loads the current selection.
- The publication calendar needs the owner or writer role, and the Google consent must include adding events. The server checks this (`422 target_not_writable`, `422 write_access_missing`), not only the UI filter, which lists writable calendars only.
- A foreign calendar ID gives `400 unknown_calendar` and saves nothing.
- Until the user saves their own selection, the primary calendar is the source. With no source, synchronization returns `409 no_calendars_selected` and the account stays connected.
- Lost permissions: a calendar that disappeared from the Google account or lost access stays visible as "brak dostępu" while it is selected or is the publication calendar. The panel shows the publication calendar problem (`targetProblem`). An unavailable calendar cannot be selected again.
- Assumption D04 (to be confirmed by the team): unselecting a calendar only excludes it from future syncs; nothing is deleted from the KAC calendar.
- The list includes all pages from Google (tested with more than 250 calendars).

## Simulated schedule publication (G07)

Story S23KC2S1P2-30, subtask G07 (S23KC2S1P2-291). Below an accepted schedule in the Grafik tab there is an "Opublikuj w Google Calendar (symulacja)" button. **This is a simulation: nothing is sent to Google**, and every preview and result is labelled that way.

- Entry requires an accepted schedule with at least one shift, a connected account and a writable calendar. The default target is the publication calendar from G04; the preview allows choosing another writable calendar (without changing the settings).
- The preview lists concrete changes: to add, to update (the event changed since publication) and unchanged. The preview saves nothing; "Anuluj" changes neither the schedule nor Google.
- Confirmation sends the schedule version from the preview; another version ends with `409 schedule_version_conflict` and nothing is published.
- Every attempt is recorded in `t_synchronizacje` with direction "publish" (transient errors retried as in G06). Success stores the last publication on the account; an error or partial result does not overwrite it. The sync section state in Settings is based on reads only.
- Per-shift binding in `t_publikacje`: owner, shift and event with version, account, calendar, mode and external ID. The "symulacja" mode never has an external ID (database constraint) – the demo does not pretend the event exists in Google. One row per shift and calendar, so a retry after an error publishes only the missing items.
- The simulation result can be forced (no internet, transient error, expired login, no write permission, rate limit, server error, partial result). An error is never shown as success; "Spróbuj ponownie" runs without a forced error.
- Real publication will plug into the API as a second `PublicationAdapter` with the same contract. This task alone does not unblock corrections of published shifts (S23KC2S1P2-47).

## Disconnecting and revoking consent (G03)

Story S23KC2S1P2-35, subtask G03 (S23KC2S1P2-287). The "Odłącz konto Google" button shows a confirmation; "Anuluj" changes nothing. After confirmation `DELETE /api/v1/integrations/google` in one transaction:

- sets the status to "Niepołączone", turns sync consent off and bumps the connection generation – work and token refreshes of the old generation no longer send any request to Google,
- deletes stored tokens,
- cancels open sign-in attempts, so a late return from Google saves nothing (including one already in progress),
- finishes running synchronizations and stops queued Google work in the outbox (W02),
- never deletes local events.

Decision D03: after the local changes are committed KAC asks Google to revoke its consent (`revoke` endpoint, token in the request body). The response describes KAC (`local`) and Google (`remote`) separately: `revoked` only when Google confirmed it; with `failed` the panel says the access data was deleted but consent must be removed manually in the Google account settings. Disconnecting also works offline. Repeating it returns the same state. A request already sent to Google cannot be undone, and the panel does not promise that.

"Zmień konto" also revokes the consent of the replaced account (best effort after the new connection is saved). The one-time import keeps its own `DELETE /api/v1/import/google/connections/{id}` (204), and its dialog says the Settings connection is not used there.

## Security

- OAuth 2.0 authorization code flow with PKCE (S256) and offline access. The `state` has 32 random bytes, is single-use, valid for 10 minutes and stored only as a SHA-256 hash. The Google return must reach the same user who started the attempt.
- The account identity is `sub` from the `id_token` (the email address can change). Accounts without a verified email are rejected.
- Tokens are encrypted with AES-256-GCM using `GOOGLE_TOKEN_ENCRYPTION_KEY`, kept outside the database. Additional authenticated data binds each ciphertext to its account and token kind, so a ciphertext moved to another row cannot be decrypted. The PKCE verifier is encrypted too and deleted after use.
- Tokens never reach API responses, the app or logs. The request log masks `code` and `state` in the return URL; errors are logged as codes only.
- The access token is refreshed under a row lock on the account and its tokens: parallel requests (also from several API instances) perform one refresh. A Google response without `refresh_token` keeps the stored one; a new refresh token replaces the old one. A 401 from the Calendar API forces one refresh before `reconnect_required` is reported.

## API

| Method and path | Description |
| --- | --- |
| `GET /api/v1/integrations/google` | State: `not_connected`, `connected`, `reconnect_required`; account, granted scopes, `requestedAccess`, mode (`google`/`demo`) and configuration problem. |
| `POST /api/v1/integrations/google/connect` | Starts sign-in; `purpose`: `connect`, `change_account` or `reconnect`. In `google` mode the response has `authUrl`. |
| `GET /api/v1/integrations/google/attempts/{id}` | Attempt state: `pending`, `connected`, `denied`, `error`, `cancelled`, `expired` and `errorCode`. |
| `POST /api/v1/integrations/google/attempts/{id}/cancel` | Cancels the attempt. |
| `POST /api/v1/integrations/google/attempts/{id}/demo-consent` | Demo mode only: account choice and consent or denial. |
| `GET /api/v1/integrations/google/callback` | Google return URL; renders an HTML page. |
| `GET /api/v1/integrations/google/calendars` | Calendar list (all pages) with role `owner`, `writer`, `reader` or `freeBusyReader`. |
| `DELETE /api/v1/integrations/google` | Disconnects the account and revokes consent in Google; `local` and `remote` describe the result separately. |
| `GET /api/v1/integrations/google/sync` | Sync state, last attempt, last successful read and publication, attempt history. |
| `POST /api/v1/integrations/google/sync` | "Synchronize with Google" with limited retries. A Google error is the attempt result (200); `simulate` only in demo mode. |
| `GET /api/v1/integrations/google/calendar-selection` | Calendar selection: sources, publication calendar, version, `canPublish`, `targetProblem`. |
| `PUT /api/v1/integrations/google/calendar-selection` | Atomic selection save with version. |
| `GET /api/v1/integrations/google/publications/{weekStart}/preview` | Simulated publication preview; optional `calendarId`. |
| `POST /api/v1/integrations/google/publications/{weekStart}` | Confirmed publication (simulation) with `expectedVersion`. A Google error is the attempt result (200). |

Google errors have stable codes: `reconnect_required` (409), `insufficient_permissions` (403), `rate_limited` (429), `google_unavailable`, `google_error` and `api_not_enabled` (502), `network_error` (504). Synchronization also returns `sync_disabled`, `sync_in_progress` and `no_calendars_selected` (409). Calendar selection: `unknown_calendar` (400), `selection_conflict` and `calendar_unavailable` (409), `target_not_writable` and `write_access_missing` (422). Publication: `schedule_not_found` (404), `schedule_not_accepted`, `schedule_empty`, `schedule_version_conflict`, `no_publication_target` and `publication_in_progress` (409). Without a database the endpoints return `503 integration_not_configured`.

## Configuration

| Variable | Meaning |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The same OAuth client as the import. Without them a demo runs with `student.kac.demo@gmail.com` (four calendars) and `praca.kac.demo@gmail.com` (no calendars). |
| `GOOGLE_INTEGRATION_REDIRECT_URI` | Return URL, default `http://localhost:4000/api/v1/integrations/google/callback`. Register it in Google Cloud Console as an "Authorized redirect URI" next to the import URL. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 random bytes in base64, kept outside the database and the repository. Without a key (or with a key of the wrong length) real sign-in is disabled and the panel explains why. Changing the key requires reconnecting accounts. |

Generate the key once with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The Google consent screen must list the scopes `openid`, `email`, `https://www.googleapis.com/auth/calendar.readonly` and `https://www.googleapis.com/auth/calendar.events`. While the Google app is in testing mode only added test users can sign in.

## Data

Migration `020_google_schedule_publication.sql` extends `t_publikacje` with a per-shift binding (owner, account, shift, event and its version, mode). Migration `019_google_calendar_selection.sql` adds the publication calendar (`id_kal_publikacji`) and selection version (`wersja_wyboru`) to `t_konta_google`. Migration `018_google_sync_registry.sql` extends `t_synchronizacje` (scope, tries, error code, finish time, generation) and adds `ostatnia_publikacja` to `t_konta_google`. Migration `017_google_integration.sql` extends `t_konta_google` (stable `google_sub`, mode, granted scopes, generation, connect and disconnect dates) and `t_kalendarze_google` (access role, time zone, primary calendar). New tables: `t_google_tokeny` (ciphertexts only) and `t_google_oauth_proby` (single-use OAuth attempts). A user has at most one active Google account.

## Tests

- `apps/api/tests/google-integration.test.ts` – encryption, consent URL, code exchange, refresh (single flight, rotation, `invalid_grant`), calendar list, key configuration, logs without OAuth codes.
- `apps/api/tests/google-integration.integration.test.ts` (PostgreSQL) – demo mode (denial, 1a, account change, 7a, expired attempt, another user's attempt), simulated Google (single-use and expired `state`, 6a, missing refresh token, ciphertexts in the database, no tokens in responses, reconnect) and parallel refresh from two instances. Every scenario checks that the user's events did not change.
- `apps/web/tests/googleIntegration.test.ts` – panel state and messages.
- `apps/api/tests/google-disconnect.integration.test.ts` (PostgreSQL) – disconnecting in demo mode and with simulated Google, repeating, cancelled attempt, stopped outbox work, rejected old generation and late callback, failed revoke (network, 503), revoke on account change; `apps/web/tests/googleDisconnect.test.ts` – confirmation and result texts.
- `apps/api/tests/google-publication.integration.test.ts` (PostgreSQL, fake clock) – entry conditions, preview without changes, version conflict, error never success, partial result and retry without duplicates, update after an event change, no Google ID in simulation, another user's schedule; `apps/web/tests/googlePublication.test.ts` – entry, preview, result messages and retry.
- `apps/api/tests/google-calendar-selection.integration.test.ts` (PostgreSQL) – atomic save with version, conflict (including two parallel saves), foreign calendar, read-only calendar as target, missing write consent, lost permissions, more than 250 calendars, sync without selection; `apps/web/tests/googleCalendarSelection.test.ts` – selection draft, target candidates, change summary.
- `apps/api/tests/google-sync.test.ts` and `google-sync.integration.test.ts` (PostgreSQL, fake clock) – error classes, retries, last success, partial result, expired login, denial disabling sync, one attempt at a time, 503/network/disabled Calendar API with simulated Google; `apps/web/tests/googleSync.test.ts` – states, buttons and messages.
