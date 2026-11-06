import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(resolve(root, '.env'))) {
  console.error('Missing .env. Run scripts/setup.ps1 or scripts/setup.sh first.');
  process.exit(1);
}

const run = (args) => {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log('\n[1/5] Starting and waiting for PostgreSQL');
run(['run', 'db:up']);
console.log('\n[2/5] Applying database migrations');
run(['run', 'db:migrate']);
console.log('\n[3/5] Seeding only an empty development database');
run(['run', 'db:seed:if-empty']);
console.log('\n[4/5] Generating the OpenAPI contract');
run(['run', 'api:openapi:export']);
console.log('\n[5/5] Building Polish and English docs for one shared local site');
run(['run', 'docs:build']);
console.log('\nStarting API, web client and Docusaurus. Press Ctrl+C to stop.\n');
run(['run', 'dev:services']);
