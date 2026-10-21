import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deployRoot = resolve(webRoot, 'deploy');
const expoConfig = JSON.parse(await readFile(resolve(webRoot, 'app.json'), 'utf8'));
const runtimeManifest = {
  name: 'kac-web-runtime',
  version: expoConfig.expo.version,
  private: true,
  type: 'module',
  scripts: { start: 'node server.mjs' },
};

await rm(deployRoot, { recursive: true, force: true });
await mkdir(deployRoot, { recursive: true });
await cp(resolve(webRoot, 'dist'), resolve(deployRoot, 'dist'), { recursive: true });
await cp(resolve(webRoot, 'server.mjs'), resolve(deployRoot, 'server.mjs'));
await writeFile(resolve(deployRoot, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8');

console.log('Created minimal static web package in apps/web/deploy (no Expo dependencies).');
