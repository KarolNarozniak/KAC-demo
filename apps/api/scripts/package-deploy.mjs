import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiRoot, '../..');
const deployRoot = resolve(apiRoot, 'deploy');
const sourceManifest = JSON.parse(await readFile(resolve(apiRoot, 'package.json'), 'utf8'));

await rm(deployRoot, { recursive: true, force: true });
await mkdir(deployRoot, { recursive: true });
await cp(resolve(apiRoot, 'dist'), resolve(deployRoot, 'dist'), { recursive: true });
await cp(resolve(apiRoot, '../web/dist'), resolve(deployRoot, 'web'), { recursive: true });
await cp(resolve(repoRoot, 'database'), resolve(deployRoot, 'database'), { recursive: true });

const runtimeManifest = {
  name: '@kac/api-runtime',
  version: sourceManifest.version,
  private: true,
  type: 'module',
  scripts: {
    start: 'node dist/server.js',
    'db:migrate': 'node database/scripts/migrate.mjs',
    'db:seed': 'node database/scripts/seed.mjs',
    'db:seed:if-empty': 'node database/scripts/seed-if-empty.mjs',
    'db:check': 'node database/scripts/check-schema.mjs',
  },
  dependencies: sourceManifest.dependencies,
};
await writeFile(resolve(deployRoot, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

const workerJobRoot = resolve(deployRoot, 'App_Data/jobs/continuous/kac-outbox');
await mkdir(workerJobRoot, { recursive: true });
const workerRunner = resolve(workerJobRoot, 'run.sh');
await writeFile(workerRunner, '#!/bin/sh\ncd /home/site/wwwroot\nexec node dist/worker.js\n', 'utf8');
await writeFile(resolve(workerJobRoot, 'settings.job'), `${JSON.stringify({ is_singleton: true })}\n`, 'utf8');
if (process.platform !== 'win32') await chmod(workerRunner, 0o755);

if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd install --omit=dev'], { cwd: deployRoot, stdio: 'inherit' });
} else {
  execFileSync('npm', ['install', '--omit=dev'], { cwd: deployRoot, stdio: 'inherit' });
}
console.log('Created unified frontend/API, database tools and outbox WebJob package in apps/api/deploy.');
