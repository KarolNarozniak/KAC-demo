import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionError, findEventCollisions, requireCollisionDecision, validateTimedEvent, type TimedEvent } from '../src/collisions.js';
import { buildApi } from '../src/app.js';
const zone = 'Europe/Warsaw';
const event = (overrides: Partial<TimedEvent> = {}): TimedEvent => ({ id: 'one', title: 'Zajęcia', category: 'Class', start: '2026-03-23T10:00', end: '2026-03-23T12:00', repeatWeekly: false, ...overrides });

test('half-open intervals, categories and exact overlap details', () => {
  assert.deepEqual(findEventCollisions(event(), [event({ id: 'two', start: '2026-03-23T12:00', end: '2026-03-23T13:00' })], zone), []);
  const conflicts = findEventCollisions(event(), [event({ id: 'work', category: 'Praca', start: '2026-03-23T11:30', end: '2026-03-23T13:00' })], zone);
  assert.equal(conflicts[0]?.category, 'Praca');
  assert.equal(conflicts[0]?.overlapStart, '2026-03-23T10:30:00.000Z');
  assert.equal(conflicts[0]?.overlapEnd, '2026-03-23T11:00:00.000Z');
  assert.deepEqual(findEventCollisions(event(), [event()], zone, 'one'), []);
});

test('recurrences retain Warsaw time after DST and are not limited to nearby weeks', () => {
  const weekly = event({ repeatWeekly: true });
  assert.equal(findEventCollisions(event({ id: 'later', start: '2027-03-29T11:00', end: '2027-03-29T12:30' }), [weekly], zone).length, 1);
  assert.equal(findEventCollisions(weekly, [event({ id: 'later', start: '2027-03-29T11:00', end: '2027-03-29T12:30', repeatWeekly: true })], zone).length, 1);
  assert.equal(findEventCollisions(weekly, [event({ id: 'earlier', start: '2026-03-16T11:00', end: '2026-03-16T12:30' })], zone).length, 0);
  assert.equal(findEventCollisions(event({ start: '2026-03-22T22:00', end: '2026-03-23T11:00' }), [weekly], zone).length, 1);
});

test('invalid dates and nonexistent DST wall times are rejected', () => {
  assert.throws(() => validateTimedEvent(event({ start: '2026-02-30T10:00' }), zone));
  assert.throws(() => validateTimedEvent(event({ start: '2026-03-29T02:30', end: '2026-03-29T04:00' }), zone));
});

test('override belongs to the displayed draft and latest conflicts', () => {
  const draft = event({ id: undefined });
  let token = '';
  try { requireCollisionDecision(draft, [event()], zone); } catch (error) { assert.ok(error instanceof CollisionError); token = error.collisionToken; }
  assert.ok(token);
  assert.doesNotThrow(() => requireCollisionDecision({ ...draft, collisionToken: token }, [event()], zone));
  assert.throws(() => requireCollisionDecision({ ...draft, title: 'Changed', collisionToken: token }, [event()], zone), CollisionError);
  assert.throws(() => requireCollisionDecision({ ...draft, collisionToken: token }, [event(), event({ id: 'new' })], zone), CollisionError);
});

test('create and update expose conflict details and never silently override', async () => {
  const conflict = new CollisionError(findEventCollisions(event(), [event()], zone), 'a'.repeat(64));
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
    createEvent: async () => { throw conflict; }, updateEvent: async () => { throw conflict; } });
  try {
    for (const method of ['POST', 'PUT'] as const) {
      const { id, ...input } = event();
      const response = await app.inject({ method, url: method === 'POST' ? '/api/events' : '/api/events/one', payload: { ...input, mandatory: false, location: '' } });
      assert.equal(response.statusCode, 409); assert.equal(response.json().conflicts.length, 1); assert.equal(response.json().collisionToken, conflict.collisionToken);
    }
  } finally { await app.close(); }
});
