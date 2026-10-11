# KAC — Kernel Aura Calendar

Responsive calendar demo built with Expo, React Native and TypeScript. The same app can run in a browser and on iOS or Android.

## Run locally

Requirements: Node.js 22 LTS or newer.

```sh
npm install
npm run web
```

For browser development, use `npm run web` (or `npm run start:dev` and choose a target in Expo Dev Tools). Native targets are not part of the Azure web export.

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

This repository targets a browser build, not an iOS/Android deployment bundle. The App Service option is a non-container Node.js static-file server.

```sh
npm install
npm run build:web
npm start
```

For Azure App Service, create a **Linux App Service using a supported Node.js LTS runtime**. Deploy the repository through Deployment Center or your preferred source deployment. Configure the build command as `npm install && npm run build:web` and the startup command as `npm start`. The server binds to the platform-provided `PORT`, serves `dist/`, sets common static MIME types and falls back to Expo's `index.html` for application routes. Alternatively, build `dist/` in CI and deploy the repository plus `dist/` to the App Service with the same `npm start` command. Do not use a container for this option.

No credentials, secrets, database or backend are required. This demo keeps changes in memory and reset restores the fixture state. Google, notification delivery and import recognition are simulated, not connected integrations.

Azure Static Web Apps can also host the exported static site without the Node server, but that is a separate hosting alternative; this project includes the requested App Service server.

## Demo routes

- **Week:** weekly calendar, event CRUD, category colors, mandatory classes, repeat series, collision warnings, empty weeks and mobile day selection.
- **Work planner:** profile-like work preferences, capacity/infeasibility, proposed shifts, edits, accept/reject and earnings estimate.
- **Imports:** sample Google calendar and file/PDF/image previews, field correction, duplicate checks, cancel, denied access, empty range and sync error/retry controls.
- **Publish:** accepted-shift preview, mock calendar selection and allow/deny/failure/success/update/delete outcomes.
- **Notifications:** preferences, overnight quiet-hour preview and reminder simulations.
- **Profile:** demo identity and work planning defaults.

All external operations display a `MOCK` label. See [BACKLOG-COVERAGE.md](BACKLOG-COVERAGE.md) for each Jira story and epic from the supplied CSV snapshot.
