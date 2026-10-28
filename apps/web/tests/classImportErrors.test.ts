import assert from 'node:assert/strict';
import test from 'node:test';
import { readClassSchedule } from '../src/services/importApi.ts';

test('class import distinguishes database, damaged file, layout and non-JSON errors', async () => {
  const fetchBefore = globalThis.fetch;
  const urlBefore = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  try {
    for (const [status, body, message] of [
      [503, '{"error":"database_unavailable"}', /PostgreSQL/],
      [503, '{"error":"database_not_configured"}', /DATABASE_URL/],
      [422, '{"error":"corrupted-file"}', /uszkodzony lub niekompletny/],
      [422, '{"error":"unsupported-image-layout"}', /Miniatura WAT/],
      [422, '{"error":"unsupported-layout"}', /PDF z tekstem/],
      [413, 'Payload too large', /5 MB/],
      [502, 'Bad Gateway', /HTTP 502/],
    ] as const) {
      globalThis.fetch = async () => new Response(body, { status });
      await assert.rejects(readClassSchedule('plan.pdf', 'UERG'), message);
    }
  } finally {
    globalThis.fetch = fetchBefore;
    if (urlBefore === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = urlBefore;
  }
});
