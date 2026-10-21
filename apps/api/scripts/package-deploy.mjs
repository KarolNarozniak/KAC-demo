import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployRoot = resolve(apiRoot, 'deploy');
const sourceManifest = JSON.parse(await readFile(resolve(apiRoot, 'package.json'), 'utf8'));

await rm(deployRoot, { recursive: true, force: true });
await mkdir(deployRoot, { recursive: true });
await cp(resolve(apiRoot, 'dist'), resolve(deployRoot, 'dist'), { recursive: true });

const runtimeManifest = {
  name: '@kac/api-runtime',
  version: sourceManifest.version,
  private: true,
  type: 'module',
  scripts: { start: 'node dist/server.js' },
  dependencies: sourceManifest.dependencies,
};
await writeFile(resolve(deployRoot, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd install --omit=dev'], { cwd: deployRoot, stdio: 'inherit' });
} else {
  execFileSync('npm', ['install', '--omit=dev'], { cwd: deployRoot, stdio: 'inherit' });
}
console.log('Created standalone API deployment package in apps/api/deploy.');
