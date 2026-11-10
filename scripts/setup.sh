#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit((major===24&&minor>=3)||major>=26 ? 0 : 1)" || {
  echo "Use Node.js 24.3+ LTS or Node.js 26+. Node.js 25 is unsupported by the Expo workspace." >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || { echo "Docker is required." >&2; exit 1; }
docker compose version >/dev/null

[ -f .env ] || cp .env.example .env
[ -f apps/web/.env ] || cp apps/web/.env.example apps/web/.env

npm ci
npm run db:up
npm run db:migrate
npm run db:seed:if-empty
npm run api:openapi:export
npm run docs:generate-api
echo 'Setup complete. Start all services with ./scripts/quickstart.sh'
