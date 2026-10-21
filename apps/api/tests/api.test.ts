import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type DemoRepository } from '../src/app.js';

const sample = {
  source: 'postgresql' as const,
  user: { id: 'U001', name: 'Student Demo', timezone: 'Europe/Warsaw' },
  calendar: { id: 'K001', name: 'KAC — kalendarz demonstracyjny' },
  counts: { events: 1, categories: 1 },
  events: [{ id: 'E001', title: 'Zajęcia pokazowe', start: '2026-02-23T07:00:00.000Z', end: '2026-02-23T08:35:00.000Z', category: 'Zajęcia', color: '#2563EB', mandatory: true }],
};

const fakeRepository: DemoRepository = {
  checkConnection: async () => {},
  getOverview: async () => sample,
};

test('liveness endpoint does not depend on PostgreSQL', async () => {
  const app = buildApi(null);
  const response = await app.inject({ method: 'GET', url: '/api/health/live' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { api: 'ok' });
  await app.close();
});

test('readiness reports an unconfigured database without crashing the API', async () => {
  const app = buildApi(null);
  const response = await app.inject({ method: 'GET', url: '/api/health/ready' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { api: 'ok', database: 'not-configured' });
  await app.close();
});

test('demo connection distinguishes a live API from an unconfigured database', async () => {
  const app = buildApi(null);
  const response = await app.inject({ method: 'GET', url: '/api/demo/connection' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { api: 'connected', database: 'not-configured', overview: null });
  await app.close();
});

test('demo route returns the repository calendar contract', async () => {
  const app = buildApi(fakeRepository);
  const response = await app.inject({ method: 'GET', url: '/api/demo/calendar' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().source, 'postgresql');
  assert.equal(response.json().counts.events, 1);
  assert.equal(response.json().events[0].title, 'Zajęcia pokazowe');
  await app.close();
});

test('demo connection confirms PostgreSQL data when repository read succeeds', async () => {
  const app = buildApi(fakeRepository);
  const response = await app.inject({ method: 'GET', url: '/api/demo/connection' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().database, 'connected');
  assert.equal(response.json().overview.counts.events, 1);
  await app.close();
});
