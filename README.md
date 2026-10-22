# Aura Kalendar

First application slice: a responsive week calendar, today's view, and PostgreSQL-backed event creation. Bottom navigation contains **Dziś**, **Tydzień**, **Ustawienia**, **Asystent**. The cog tab contains calendar layout settings; assistant integration is reserved for a later increment.

## Run locally

Use Node.js 24+ and PostgreSQL 16 (Docker Compose is provided).

1. Copy `.env.example` to `.env`, `apps/api/.env.example` to `apps/api/.env`, and `apps/web/.env.example` to `apps/web/.env`. Configure `DATABASE_URL` and `EXPO_PUBLIC_API_URL`.
2. `npm install`
3. `npm run db:up` (or start your own PostgreSQL instance).
4. `npm run db:migrate` then `npm run db:seed`. Fresh databases start with an empty calendar; seeding does not remove existing events.
5. `npm run api:dev`
6. In a second terminal: `npm run web:dev`.

Open the Expo URL, normally `http://localhost:8081`. To use a phone, set `EXPO_PUBLIC_API_URL` to your computer's reachable API address and add the web origin to `API_CORS_ORIGINS`.

## Current behavior

- The week keeps time slots readable with at least 80 pixels per hour horizontally (48 vertically in the alternate layout), scrolling along the time axis with fixed day labels. The single-day home view shows only upcoming events, from the current device time to midnight, with at least 48 pixels per hour and vertical scrolling. It has no repeated day header. The current week opens near the device time and displays a line across all days: thin gray on other days and thicker red on today. Manual scrolling is preserved as the clock updates. By default, days run down the left and hours across the top. The cog tab offers a switch to days across the top; the choice is saved on the device. Tap a day label to add an event or an event to open details.
- Tabs slide out and in together, retaining visited screens and respecting reduced-motion settings.
- The header shows the logo and the centered current date. Dark mode is the default; the theme switch is in Ustawienia and remembers the chosen theme.
- Dziś is the home screen, with a welcome and a reserved area for a future agent-generated daily summary. No agent is connected yet.
- Dziś keeps a day grid visible even when empty, showing only today's events whose start time has not passed according to the device clock, updating while the tab is open.
- Creation saves to PostgreSQL before updating the calendar. Connection failures keep the form open with the entered data. No in-memory demo fallback.
- **Powtarzaj co tydzień** stores a series and its first event in one transaction. Occurrences are derived for the visible week, without a fixed end date. Calendar dates and times use the configured account timezone (initially Europe/Warsaw), retaining weekly wall-clock time across daylight-saving changes.
- Calendar ownership, categories, series and the original relational schema are retained for subsequent features. `DB_DEMO_USER_ID` and `DB_DEMO_CALENDAR_ID` select the initial seeded calendar. There is no authentication yet; these server-selected IDs must be replaced by authenticated account scope when accounts are implemented.
- Event editing/deletion, account flows, imports, planning and notifications are outside this increment. Their simulated UI and fixtures have been removed.

## Checks and deployment

`npm run typecheck`, `npm test`, `npm run build`. With PostgreSQL migrated and seeded, run `npm run test:api:db` to verify create/read persistence and series linkage through a fresh API instance. The integration test removes its own records.

The API and Expo web deployment scripts and existing GitHub Actions remain. Configure API `DATABASE_URL`, `PGSSLMODE=require` and `API_CORS_ORIGINS`; the web build embeds `EXPO_PUBLIC_API_URL`. Apply database migrations before deploying the updated API.
