# KAC — Kernel 'Aura Kalendar' · Frontend

Expo / React Native Web frontend. The current calendar workflows remain a local in-memory demo; the small environment panel performs a read-only request to the separate KAC API when `EXPO_PUBLIC_API_URL` is configured.

## Run locally

Requirements: Node.js 24 LTS and npm. See the monorepo README for the API and PostgreSQL setup.

Run these commands from the repository root:

```sh
npm install
npm run web:dev
```

For browser development, use `npm run web:dev` (or `npm run start:dev --workspace @kac/web` and choose a target in Expo Dev Tools). Native targets are not part of the Azure web export.

## Demo features

- Week view with previous/next navigation; initial demo week is 12–18 October 2026.
- Add events, choose a category, set mandatory lessons and weekly recurrence.
- Open event details and edit event hours.
- Detect and warn about overlapping events without discarding either event.
- Reset demo restores the original in-memory data. No changes are persisted.
- Category colors: classes `#2563EB`, work `#F97316`, personal `#16A34A`.

## Acceptance checklist

- [ ] Navigate forward/back and see weekly recurring events.
- [ ] Add and cancel events; verify category color and mandatory label.
- [ ] Edit an event's hours and reject an end time earlier than its start.
- [ ] Add an overlapping event and acknowledge the warning.
- [ ] Open the non-destructive Empty week preview and verify the empty-state message.
- [ ] Reset the demo and verify the initial events return.

## Azure App Service (static Expo web export)

This project targets a browser build, not an iOS/Android deployment bundle. The frontend App Service uses the managed Linux Node runtime and a static-file server; it does not require a custom container.

```sh
npm ci
npm run build:web
npm run web:start
```

For Azure App Service, create a **Linux Web App using the Node 24 LTS runtime**. The frontend package is `apps/web`; its start script runs the static server, which binds to the platform-provided `PORT`, serves `dist/` and falls back to Expo's `index.html` for application routes.

The core calendar remains in-memory and reset restores fixture state. Authentication, Google OAuth/Calendar, import recognition, scheduling, and notifications remain mock flows. The status panel makes a read-only request to `GET /api/demo/calendar`; its failure does not block the app.

The separate API is in `apps/api`; database schema and migrations are in `database/`.

## Demo routes

- **Week:** weekly calendar, event CRUD, category colors, mandatory classes, repeat series, collision warnings, empty weeks and mobile day selection.
- **Work planner:** profile-like work preferences, capacity/infeasibility, proposed shifts, edits, accept/reject and earnings estimate.
- **Imports:** sample Google calendar and file/PDF/image previews, field correction, duplicate checks, cancel, denied access, empty range and sync error/retry controls.
- **Publish:** accepted-shift preview, mock calendar selection and allow/deny/failure/success/update/delete outcomes.
- **Notifications:** preferences, overnight quiet-hour preview and reminder simulations.
- **Profile:** demo identity and work planning defaults.

All external operations display a `MOCK` label. See [BACKLOG-COVERAGE.md](BACKLOG-COVERAGE.md) for each Jira story and epic from the supplied CSV snapshot.
