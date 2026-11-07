$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not (Test-Path -LiteralPath '.env') -or -not (Test-Path -LiteralPath 'apps/web/.env') -or -not (Test-Path -LiteralPath 'node_modules')) { & "$PSScriptRoot/setup.ps1" }
exit $LASTEXITCODE
