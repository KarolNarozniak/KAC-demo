import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';

const scopeForTest = (request: { headers: Record<string, unknown> }) => {
  const userId = request.headers['x-test-user'] === 'B' ? 'U-B' : 'U-A';
  return { userId, calendarId: userId === 'U-B' ? 'K-B' : 'K-A' };
};

test('API resource reads and Google import connections are bound to the server-resolved scope', async () => {
  const app = buildApi({ checkConnection: async () => {}, getOverview: async (userId, calendarId) => ({
    user: { id: userId, name: userId, timezone: 'Europe/Warsaw' }, calendar: { id: calendarId, name: calendarId }, counts: { events: 0, categories: 0 }, events: [],
  }) }, [], { userScope: scopeForTest });
  try {
    const own = await app.inject({ method: 'GET', url: '/api/v1/calendar/overview', headers: { 'x-test-user': 'A' } });
    const other = await app.inject({ method: 'GET', url: '/api/v1/calendar/overview', headers: { 'x-test-user': 'B' } });
    assert.equal(own.json().calendar.id, 'K-A');
    assert.equal(other.json().calendar.id, 'K-B');

    const start = await app.inject({ method: 'POST', url: '/api/v1/import/google/connections', headers: { 'x-test-user': 'A' }, payload: {} });
    assert.equal(start.statusCode, 201);
    const connectionId = start.json().connectionId;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/import/google/connections/${connectionId}`, headers: { 'x-test-user': 'A' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/import/google/connections/${connectionId}`, headers: { 'x-test-user': 'B' } })).statusCode, 404);
  } finally { await app.close(); }
});
