import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type CalendarRepository } from '../src/app.js';

const sample = {
  source: 'postgresql' as const,
  user: { id: 'U001', name: 'Student Demo', timezone: 'Europe/Warsaw' },
  calendar: { id: 'K001', name: 'KAC — kalendarz demonstracyjny' },
  counts: { events: 1, categories: 1 },
  events: [{ id: 'E001', title: 'Zajęcia pokazowe', start: '2026-02-23T07:00:00.000Z', end: '2026-02-23T08:35:00.000Z', category: 'Zajęcia', color: '#2563EB', mandatory: true }],
};

const fakeRepository: CalendarRepository = {
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

test('calendar route returns the repository calendar contract', async () => {
  const app = buildApi(fakeRepository);
  const response = await app.inject({ method: 'GET', url: '/api/calendar' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().source, 'postgresql');
  assert.equal(response.json().counts.events, 1);
  assert.equal(response.json().events[0].title, 'Zajęcia pokazowe');
  await app.close();
});

const input = { title: 'Weekly meeting', start: '2026-10-22T09:00', end: '2026-10-22T10:00', category: 'Work', location: 'Office', mandatory: false, repeatWeekly: true };
test('create validates input and returns a persisted series anchor', async () => {
  let writes = 0;
  const app = buildApi({ ...fakeRepository, createEvent: async (event) => { writes++; return { id: 'new-event', ...event }; } }, ['http://localhost:8081']);
  try {
    for (const body of [{ ...input, title: ' ' }, { ...input, start: '2026-02-30T09:00' }, { ...input, end: input.start }, { ...input, category: 'unknown' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/events', payload: body })).statusCode, 400);
    }
    assert.equal(writes, 0);
    const response = await app.inject({ method: 'POST', url: '/api/events', payload: input });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().repeatWeekly, true);
    assert.equal(writes, 1);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/events', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'POST' } });
    assert.match(String(preflight.headers['access-control-allow-methods']), /POST/);
  } finally { await app.close(); }
});
test('write failures are reported and never presented as a successful save', async () => {
  for (const repository of [null, { ...fakeRepository, createEvent: async () => { throw new Error('offline'); } }]) {
    const app = buildApi(repository);
    try { assert.equal((await app.inject({ method: 'POST', url: '/api/events', payload: input })).statusCode, 503); }
    finally { await app.close(); }
  }
});

test('delete returns removed event IDs and permits browser DELETE requests', async () => {
  const requested: string[] = [];
  const app = buildApi({ ...fakeRepository, deleteEvent: async (id) => { requested.push(id); return [id, 'series-member']; } }, ['http://localhost:8081']);
  try {
    const response = await app.inject({ method: 'DELETE', url: '/api/events/event-123' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { deletedIds: ['event-123', 'series-member'] });
    assert.deepEqual(requested, ['event-123']);
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/events/event-123', headers: { origin: 'http://localhost:8081', 'access-control-request-method': 'DELETE' } });
    assert.match(String(preflight.headers['access-control-allow-methods']), /DELETE/);
  } finally { await app.close(); }
});

test('delete distinguishes missing events from unavailable storage', async () => {
  for (const [repository, status] of [
    [{ ...fakeRepository, deleteEvent: async () => null }, 404],
    [null, 503],
    [{ ...fakeRepository, deleteEvent: async () => { throw new Error('offline'); } }, 503],
  ] as const) {
    const app = buildApi(repository);
    try { assert.equal((await app.inject({ method: 'DELETE', url: '/api/events/missing' })).statusCode, status); }
    finally { await app.close(); }
  }
});
