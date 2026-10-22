# Calendar frontend

Expo SDK 58, React 19.3, React Native 0.88 and TypeScript 6. Supports web, Android and iOS. Use Node.js 24 LTS (24.3+); the repository's `.nvmrc` selects Node 24.

See the [root README](../../README.md) for PostgreSQL/API setup, implemented features, deployment and the remaining dependency audit findings.

## Development

Run these commands from the repository root after `npm ci` and starting the database and API:

- Web: `npm run web:dev`
- Native device preview: `npm run start:dev --workspace @kac/web -- --lan`
- Restart with a cleared Metro cache after upgrading: `npm run start:dev --workspace @kac/web -- --clear`

Configure `apps/web/.env` with `EXPO_PUBLIC_API_URL`. On a physical device, use the computer's reachable LAN IP rather than `localhost` and connect both devices to the same network. For mobile web, add its web origin to the API's `API_CORS_ORIGINS` and restart the API.

Native preview requires an Expo Go version compatible with SDK 58 or a development build. See the [Expo 58 release notes](https://expo.dev/changelog/sdk-58) for Expo Go availability.

## Validation

- `npm run typecheck:web`
- `npm run test:web`
- `npm run build:web`
- SDK/configuration checks: `cd apps/web` then `npx expo-doctor@latest`
- Bundle all platforms: `cd apps/web` then `npx expo export --platform all --output-dir /tmp/kac-export`

Web, Android and iOS bundle exports pass after the upgrade. Native bundle export does not replace testing on a real device.
