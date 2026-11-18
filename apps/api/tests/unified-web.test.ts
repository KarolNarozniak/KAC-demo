import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApi } from '../src/app.js';

test('one Fastify server serves the frontend, static assets and versioned API without SPA-falling back API 404s', async () => {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/unified-web');
  const app = buildApi(null, [], { webRoot });
  try {
    const home = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    assert.equal(home.statusCode, 200);
    assert.match(home.headers['content-type'] ?? '', /text\/html/);
    assert.match(home.body, /Synthetic frontend/);

    const deepLink = await app.inject({ method: 'GET', url: '/assistant', headers: { accept: 'text/html' } });
    assert.equal(deepLink.statusCode, 200);
    assert.match(deepLink.body, /Synthetic frontend/);

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    assert.equal(asset.statusCode, 200);
    assert.match(asset.body, /kacUnifiedFrontend/);

    const live = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    assert.deepEqual([live.statusCode, live.json()], [200, { api: 'ok' }]);

    const unknownApi = await app.inject({ method: 'GET', url: '/api/v1/not-a-route', headers: { accept: 'text/html' } });
    assert.equal(unknownApi.statusCode, 404);
    assert.doesNotMatch(unknownApi.body, /Synthetic frontend/);
  } finally { await app.close(); }
});
