// Przykłady w Swagger UI muszą pasować do schematów (S23KC2S1P2-183, -153, -178, -191, -207, -217).
// Test waliduje każdy przykład żądania i odpowiedzi względem jego schematu z wygenerowanego kontraktu OpenAPI 3.1.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { buildApi } from '../src/app.js';

type Media = { schema?: object; example?: unknown; examples?: Record<string, { value: unknown }> };

test('every OpenAPI example matches its schema and every operation documents its responses', async () => {
  const app = buildApi(null);
  try {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
    let checked = 0;
    for (const [path, operations] of Object.entries(spec.paths) as [string, Record<string, any>][]) {
      for (const [method, operation] of Object.entries(operations)) {
        const media: [string, Media][] = [];
        const body = operation.requestBody?.content?.['application/json'];
        if (body) media.push(['request', body]);
        for (const [status, response] of Object.entries(operation.responses) as [string, any][]) {
          assert.notEqual(response.description, 'Default Response', `${method} ${path} ${status} has no description`);
          const json = response.content?.['application/json'];
          if (json) media.push([status, json]);
        }
        for (const [where, content] of media) {
          const examples = content.examples ? Object.entries(content.examples).map(([name, example]) => [name, example.value] as const)
            : 'example' in content ? [['example', content.example] as const] : [];
          assert.ok(operation.deprecated || examples.length > 0, `${method} ${path} ${where} has no example`);
          const validate = ajv.compile(content.schema ?? {});
          for (const [name, value] of examples) {
            assert.ok(validate(value), `${method} ${path} ${where} example "${name}": ${ajv.errorsText(validate.errors)}`);
            checked++;
          }
        }
      }
    }
    assert.ok(checked > 100, `only ${checked} examples checked`);
  } finally { await app.close(); }
});
