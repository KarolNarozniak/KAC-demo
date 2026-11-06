import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const roots = [
  'docs/api/reference',
  'i18n/en/docusaurus-plugin-content-docs/current/api/reference',
];

async function visit(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
    const source = await readFile(path, 'utf8');
    let output = source;
    for (const component of ['OperationTabs', 'SchemaTabs']) {
      const importLine = new RegExp(`^import ${component} from [^\\n]+\\n`, 'm');
      const stripped = output.replace(importLine, '');
      if (!new RegExp(`<${component}\\b`).test(stripped)) output = stripped;
    }
    if (output !== source) await writeFile(path, output, 'utf8');
  }
}

for (const root of roots) await visit(root);
