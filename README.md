# Aura Kalendar

First application slice: a responsive week calendar, today's view, and PostgreSQL-backed event creation. Bottom navigation contains **Dziś**, **Tydzień**, **Ustawienia**, **Asystent**. The cog tab contains calendar layout settings; assistant integration is reserved for a later increment.

## Run locally

Use Node.js 24 LTS (24.3+; `.nvmrc` selects 24) and PostgreSQL 16. Node 25 is not supported by the Expo 58 toolchain. Docker Compose is provided for PostgreSQL.

1. Copy `.env.example` to `.env`, `apps/api/.env.example` to `apps/api/.env`, and `apps/web/.env.example` to `apps/web/.env`. Configure `DATABASE_URL` and `EXPO_PUBLIC_API_URL`.
2. `npm ci`
3. `npm run db:up` (or start your own PostgreSQL instance).
4. `npm run db:migrate` then `npm run db:seed`. Fresh databases start with an empty calendar; seeding does not remove existing events.
5. `npm run api:dev`
6. In a second terminal: `npm run web:dev`.

Open the Expo URL, normally `http://localhost:8081`. To use a phone, set `EXPO_PUBLIC_API_URL` to your computer's reachable API address and add the web origin to `API_CORS_ORIGINS`.

## Expo / React upgrade

The frontend uses Expo SDK 58, React 19.3, React Native 0.88 and TypeScript 6 with the SDK-matched native modules. Native splash configuration uses the Expo plugin, and safe-area/status-bar handling supports current mobile layouts. React is deduplicated across the workspace.

For native preview, use `npm run start:dev --workspace @kac/web -- --lan`, with `EXPO_PUBLIC_API_URL` set to the computer's reachable LAN address. Use an Expo Go version that supports SDK 58 or a development build. Store availability can lag the SDK release; see the [Expo 58 release notes](https://expo.dev/changelog/sdk-58).

The dependency audit on 2026-10-22 decreased from **55 findings (1 critical, 37 high, 17 moderate)** to **16 high findings, with no critical or moderate findings**. The remaining dependency chains trace to [braces ≤3.0.3](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge ≤1.4.0](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Those are still the latest published versions at the time of the audit. No forced downgrades or audit exclusions were applied. Run `npm audit` to check the current status.

## Current behavior

- The week keeps time slots readable with at least 80 pixels per hour horizontally (48 vertically in the alternate layout), scrolling along the time axis with fixed day labels. The single-day home view shows only upcoming events, from the current device time to midnight, with at least 48 pixels per hour and vertical scrolling. It has no repeated day header. The current week opens near the device time and displays a line across all days: thin gray on other days and thicker red on today. Manual scrolling is preserved as the clock updates. By default, days run down the left and hours across the top. The cog tab offers a switch to days across the top; the choice is saved on the device. Tap a day label to add an event or an event to open details.
- Tabs slide out and in together, retaining visited screens and respecting reduced-motion settings.
- The header shows the logo and the centered current date. Dark mode is the default; the theme switch is in Ustawienia and remembers the chosen theme.
- Dziś is the home screen, with a welcome and a reserved area for a future agent-generated daily summary. No agent is connected yet.
- Dziś keeps a day grid visible even when empty, showing only today's events whose start time has not passed according to the device clock, updating while the tab is open.
- Date and start/end times use platform-native pickers on web, Android and iOS.
- Open an event to delete it after confirmation. Deleting a weekly event removes the entire series. Database failures keep the event visible and allow retrying.
- Creation saves to PostgreSQL before updating the calendar. Connection failures keep the form open with the entered data. No in-memory demo fallback.
- **Powtarzaj co tydzień** stores a series and its first event in one transaction. Occurrences are derived for the visible week, without a fixed end date. Calendar dates and times use the configured account timezone (initially Europe/Warsaw), retaining weekly wall-clock time across daylight-saving changes.
- Calendar ownership, categories, series and the original relational schema are retained for subsequent features. `DB_DEMO_USER_ID` and `DB_DEMO_CALENDAR_ID` select the initial seeded calendar. There is no authentication yet; these server-selected IDs must be replaced by authenticated account scope when accounts are implemented.
- Event creation and whole-series editing use server-side collision checks. Warnings show titles, categories, full dates/times and overlap intervals. Choose **Popraw termin**, **Zapisz mimo kolizji**, or **Anuluj**. Touching interval endpoints do not collide. An override applies only to the displayed draft and current conflicts. Updates retain event IDs and save atomically. Recurring events retain the account's local wall time; nonexistent spring-DST times are rejected. One-off events may span up to 366 days; weekly events up to 7 days.
- **Tydzień → Importuj plan PDF** reads text PDFs exported in the WAT mini e-D semester layout locally on the API server. PDF selection works on web, Android and iOS. The reader maps date columns, time blocks, the subject legend and printed page continuations. It uses the academic semester, not the document update date. Dated classes become individual events, without infinite weekly repetition.
- The paginated import preview supports corrections, selection and duplicate decisions: **Pomiń**, **Zastąp**, **Zachowaj oba**. Uncertain rows start unselected. A duplicate has the same normalized title and start instant; end time is deliberately excluded so a corrected duration can replace an existing event. Matches include derived weekly occurrences. Replacing a weekly match changes the whole series while preserving its anchor; the UI labels this, and a series may be replaced only once per batch. Ambiguous matches require an explicit target. Confirmation rechecks duplicates under the same calendar lock used by manual writes and commits the whole batch atomically.
- This demo accepts text PDFs only for class timetables: **photos, scans, OCR and other layouts are deferred**. Limits: 5 MB, 10 pages, 30,000 text items, 1,000 imported rows, two readers at once and a 15-second worker timeout. The worker has a bounded heap; uploads are neither retained on disk nor sent to third-party services. Native document cache copies are deleted after reading. Existing work-schedule import remains a separately labelled demonstration reader.
- Authentication remains a later task: the server-selected demo account and calendar remain in use. Planning and notifications are outside this increment.

## Checks and deployment

`npm run typecheck`, `npm test`, `npm run build`. With PostgreSQL migrated and seeded, run `npm run test:api:db` to verify create/read/delete persistence, ownership checks and series cleanup through a fresh API instance. The integration test removes its own records.

The API and Expo web deployment scripts and existing GitHub Actions remain. Configure API `DATABASE_URL`, `PGSSLMODE=require` and `API_CORS_ORIGINS`; the web build embeds `EXPO_PUBLIC_API_URL`. Apply database migrations before deploying the updated API.

## Feature validation (S23KC2S1P2-43, -14, -38)

Run the checks above and `npm run test:api:db` against a migrated, seeded **test database**. Database suites run sequentially because legacy tests share the demo calendar; new feature scenarios create and remove a separate calendar. They cover concurrent create requests, collision overrides, atomic edits, ownership, recurring duplicate replacement, cancellation and repeated semester imports. The three paired PDF/JSON timetable fixtures live in `apps/api/tests/fixtures/timetables`, named by printed semester and academic year. They contain 166, 212 and 37 entries. Actual-PDF worker and upload tests are mandatory; missing source fixtures fail the tests rather than being skipped.

Native JavaScript bundles can be checked with `npx expo export --platform ios --platform android` from `apps/web`. Native device picker behavior still requires a device/emulator smoke test; a successful bundle export does not establish that a physical-device test passed.

The proposed next increment is documented in [the local OCR implementation plan](docs/ocr-implementation-plan.md). OCR remains unimplemented until the plan is approved.
