import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');
const specPath = resolve(siteRoot, '../apps/api/openapi/openapi.json');
const polishPath = resolve(siteRoot, 'docs/api/openapi-reference.md');
const englishPath = resolve(siteRoot, 'i18n/en/docusaurus-plugin-content-docs/current/api/openapi-reference.md');
const generatedCacheDirectory = resolve(siteRoot, '.docusaurus');
const obsoleteGeneratedDirectories = [
  resolve(siteRoot, 'docs/api/reference'),
  resolve(siteRoot, 'i18n/en/docusaurus-plugin-content-docs/current/api/reference'),
];
const methodOrder = ['get', 'post', 'put', 'patch', 'delete'];
const spec = JSON.parse(await readFile(specPath, 'utf8'));

const tableText = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const codeBlock = (value) => `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
const schemaFor = (response) => response?.content?.['application/json']?.schema ?? response?.content?.['text/html']?.schema ?? null;
const requestSchemaFor = (operation) => operation?.requestBody?.content?.['application/json']?.schema ?? operation?.requestBody?.content?.['text/plain']?.schema ?? null;

const operations = Object.entries(spec.paths ?? {}).flatMap(([path, pathItem]) => methodOrder.flatMap((method) => {
  const operation = pathItem?.[method];
  return operation ? [{ path, method, operation }] : [];
}));
const groups = new Map();
for (const item of operations) {
  const tag = item.operation.tags?.[0] ?? 'Other';
  if (!groups.has(tag)) groups.set(tag, []);
  groups.get(tag).push(item);
}

function render(isEnglish) {
  const title = isEnglish ? 'OpenAPI endpoint reference' : 'Referencja endpointów OpenAPI';
  const intro = isEnglish
    ? `This page is generated from OpenAPI ${spec.openapi}. The source of truth is the Fastify JSON Schema in each route module. Use the live Swagger UI to send development requests.`
    : `Ta strona jest generowana ze specyfikacji OpenAPI ${spec.openapi}. Źródłem prawdy są schematy JSON Fastify przy trasach. Żądania developerskie można wykonywać w interaktywnym Swagger UI.`;
  let markdown = `---\nid: openapi-reference\ntitle: ${title}\nsidebar_label: ${isEnglish ? 'Endpoint reference' : 'Referencja endpointów'}\ndescription: ${intro}\n---\n\n# ${title}\n\n${intro}\n\nimport ApiLinks from '@site/src/components/ApiLinks';\n\n<ApiLinks />\n`;
  for (const [tag, items] of groups) {
    markdown += `\n## ${tag}\n`;
    for (const { method, path, operation } of items) {
      markdown += `\n### \`${method.toUpperCase()} ${path}\`\n\n`;
      markdown += `${operation.summary ?? (isEnglish ? 'Operation' : 'Operacja')}\n\n`;
      if (operation.operationId) markdown += `**operationId:** \`${operation.operationId}\`\n\n`;
      if (operation.description) markdown += `${operation.description}\n\n`;
      const parameters = operation.parameters ?? [];
      if (parameters.length) {
        markdown += `${isEnglish ? '**Parameters**' : '**Parametry**'}\n\n| ${isEnglish ? 'Name' : 'Nazwa'} | ${isEnglish ? 'In' : 'Gdzie'} | ${isEnglish ? 'Required' : 'Wymagane'} | ${isEnglish ? 'Description' : 'Opis'} |\n| --- | --- | --- | --- |\n`;
        for (const parameter of parameters) markdown += `| \`${tableText(parameter.name)}\` | ${tableText(parameter.in)} | ${parameter.required ? 'Yes' : 'No'} | ${tableText(parameter.description)} |\n`;
        markdown += '\n';
      }
      const requestSchema = requestSchemaFor(operation);
      if (requestSchema) {
        markdown += `#### ${isEnglish ? 'Request schema' : 'Schemat żądania'}\n`;
        markdown += codeBlock(requestSchema);
      }
      if (operation.responses && Object.keys(operation.responses).length) {
        markdown += `#### ${isEnglish ? 'Responses' : 'Odpowiedzi'}\n\n`;
        for (const [status, response] of Object.entries(operation.responses)) {
          markdown += `##### ${status} — ${tableText(response.description)}\n`;
          const responseSchema = schemaFor(response);
          if (responseSchema) markdown += codeBlock(responseSchema);
          else markdown += '\n';
        }
      }
    }
  }
  return markdown;
}

await Promise.all([mkdir(dirname(polishPath), { recursive: true }), mkdir(dirname(englishPath), { recursive: true })]);
await Promise.all(obsoleteGeneratedDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
await rm(generatedCacheDirectory, { recursive: true, force: true });
await Promise.all([writeFile(polishPath, render(false)), writeFile(englishPath, render(true))]);
console.log(`Generated bilingual reference for ${operations.length} OpenAPI operations from ${specPath}.`);
