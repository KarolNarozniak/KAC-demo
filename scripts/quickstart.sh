#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
if [ ! -f .env ] || [ ! -f apps/web/.env ] || [ ! -d node_modules ]; then
  sh ./scripts/setup.sh
fi
npm run dev:all
