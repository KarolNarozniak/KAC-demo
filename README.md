# KAC — Kernel Aura Calendar

Responsive calendar demo built with Expo, React Native and TypeScript. The same app can run in a browser and on iOS or Android.

## Run locally

Requirements: Node.js 18+.

```sh
npm install
npm run web
```

For native targets, run `npm run android` or `npm run ios` (requires the relevant emulator/device setup). Alternatively, use `npm start` and select a target in Expo Dev Tools.

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
- [ ] Open an empty week and verify the empty-state message.
- [ ] Reset the demo and verify the initial events return.
