$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$nodeVersion = [version]((node -p "process.versions.node").Trim())
if (($nodeVersion.Major -eq 24 -and $nodeVersion -lt [version]'24.3.0') -or $nodeVersion.Major -eq 25 -or $nodeVersion.Major -lt 24) {
    throw 'Use Node.js 24.3+ LTS or Node.js 26+. Node.js 25 is unsupported by the Expo workspace.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required. Install Docker Desktop and rerun setup.' }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }

if (-not (Test-Path -LiteralPath '.env')) { Copy-Item '.env.example' '.env' }
if (-not (Test-Path -LiteralPath 'apps/web/.env')) { Copy-Item 'apps/web/.env.example' 'apps/web/.env' }

npm ci
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:up
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:seed:if-empty
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run api:openapi:export
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run docs:generate-api
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Setup complete. Start all services with .\scripts\quickstart.ps1'
