---
id: premium
title: Premium and activation codes
sidebar_label: Premium
description: Premium entitlements, code redemption and server-side AI access controls.
---

# Premium and activation codes

## Features and account status

Premium unlocks the AI Assistant, the daily summary, AI reading of class timetables and work schedules, and AI features inside a conversation. The local calendar and local import paths remain available without Premium. The crown marks a Premium feature; API authorization is enforced server-side and does not rely on UI visibility.

Account settings display the Premium status and its expiry date. New accounts start without Premium. The current campaign code grants the configured term (365 days by default), once per account for that campaign. A second redemption by the same account for the same campaign is rejected; each new campaign uses a distinct identifier.

The app does not include a payment provider or automatic subscription renewal. Users activate a code they have received; offer copy must not imply an in-app payment or charge.

## Code configuration

Codes are verified only by the API. Never use `EXPO_PUBLIC_*`, include the code in the web bundle, or add a real code to examples or documentation. Configure these KAC App Service settings as server-side secrets, preferably Key Vault references:

- `PREMIUM_REDEMPTION_CODE`: shared campaign code; it is never returned by the API or logged.
- `PREMIUM_CAMPAIGN_ID`: stable, unique identifier for each campaign, e.g. `black-friday-2026`.
- `PREMIUM_CAMPAIGN_NAME`: display name shown in the paywall, e.g. `Black Friday`.
- `PREMIUM_CAMPAIGN_ENDS_AT`: activation cutoff in ISO 8601 UTC, e.g. `2026-11-30T22:59:59Z` is `23:59:59` in Europe/Warsaw.
- `PREMIUM_DURATION_DAYS`: entitlement duration; defaults to `365`.

Rotate the code and `PREMIUM_CAMPAIGN_ID` together for a new campaign. The API rejects codes after the campaign end time, rate-limits attempts, and persists redemptions transactionally with a per-account/per-campaign uniqueness constraint. Do not put a real code in source control, logs or this document.

## Administrator grant

An operator can grant Premium once to an existing account using a trusted environment that can access `DATABASE_URL`:

```bash
npm run premium:grant -- <email> [days]
```

The command requires an existing account, exposes no public administrator endpoint and does not extend an already active grant when repeated.

## API

- `GET /api/v1/premium/config` returns only the public campaign name, end date, Premium term and the current account's `redeemedByAccount` status; it never reveals the code.
- `POST /api/v1/premium/redeem` requires an authenticated session and a body such as `{ "code": "..." }`. Success returns the updated account with `isPremium` and `premiumExpiresAt`.
- Assistant and AI import endpoints return `403 premium_required` to accounts without an active entitlement. Reading history and confirming a previously prepared proposal do not initiate a new AI request.

Conversations and selected calendar data are sent to Azure AI when the Assistant is used. PDF/PNG/JPG imports are transmitted to AI for extraction; original file bytes are not persisted in the KAC database. The UI informs users before sending a file.
