import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { buildApi } from '../src/app.js';
import { pool, PostgresDemoRepository } from '../src/database.js';

test('demo endpoint reads the seeded calendar from PostgreSQL', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const app = buildApi(new PostgresDemoRepository(pool), config.corsOrigins);
  try {
    const readiness = await app.inject({ method: 'GET', url: '/api/health/ready' });
    assert.equal(readiness.statusCode, 200);
    assert.equal(readiness.json().database, 'connected');

    const response = await app.inject({ method: 'GET', url: '/api/demo/calendar' });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.source, 'postgresql');
    assert.ok(payload.counts.events >= 3);
    assert.ok(payload.events.some((event: { title: string }) => event.title === 'Praca'));
  } finally {
    await app.close();
    await pool.end();
  }
});
