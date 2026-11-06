import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApi } from '../src/app.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../openapi/openapi.json');
const checking = process.argv.includes('--check');
const app = buildApi(null, ['*']);

try {
  await app.ready();
  const content = `${JSON.stringify(app.swagger(), null, 2)}\n`;
  if (checking) {
    let current = '';
    try { current = await readFile(outputPath, 'utf8'); } catch {}
    if (current !== content) {
      console.error('OpenAPI contract is out of date. Run `npm run api:openapi:export`, inspect the diff, and update the API reference/docs.');
      process.exitCode = 1;
    } else {
      console.log('OpenAPI contract is current.');
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf8');
    console.log(`Exported ${app.swagger().paths ? Object.keys(app.swagger().paths).length : 0} paths to ${outputPath}`);
  }
} finally {
  await app.close();
}
