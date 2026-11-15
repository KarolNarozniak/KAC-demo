import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEventCollisions, CollisionError, findEventCollisions, requireCollisionDecision, validateTimedEvent, type TimedEvent } from '../src/collisions.js';
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
      const response = await app.inject({ method, url: method === 'POST' ? '/api/v1/calendar/events' : '/api/v1/calendar/events/one', payload: { ...input, mandatory: false, location: '' } });
      assert.equal(response.statusCode, 409); assert.equal(response.json().conflicts.length, 1); assert.equal(response.json().collisionToken, conflict.collisionToken);
    }
  } finally { await app.close(); }
});

// S23KC2S1P2-302 (N10): pełna informacja o kolizjach i ponowne sprawdzanie po korekcie.
test('N10: every colliding item is listed with name, times, kind and recurrence; touching ends are not a collision', () => {
  const draft = event({ id: undefined, category: 'Personal', start: '2026-03-23T09:00', end: '2026-03-23T15:00' });
  const existing = [
    event({ id: 'work', title: 'Praca', category: 'Work', start: '2026-03-23T14:00', end: '2026-03-23T18:00' }),
    event({ id: 'lecture', title: 'Wykład', mandatory: true, repeatWeekly: true, start: '2026-03-16T08:00', end: '2026-03-16T10:00' }),
    event({ id: 'lab', title: 'Laboratorium', mandatory: false, start: '2026-03-23T11:00', end: '2026-03-23T12:00' }),
    event({ id: 'touching', title: 'Obiad', category: 'Personal', start: '2026-03-23T15:00', end: '2026-03-23T16:00' }),
    event({ id: 'before', title: 'Siłownia', category: 'Personal', start: '2026-03-23T07:00', end: '2026-03-23T09:00' }),
  ];
  const conflicts = findEventCollisions(draft, existing, zone);
  assert.deepEqual(conflicts.map((item) => item.id), ['lecture', 'lab', 'work']);
  const lecture = conflicts[0]!;
  assert.equal(lecture.title, 'Wykład');
  assert.equal(lecture.mandatory, true);
  assert.equal(lecture.repeatWeekly, true);
  assert.equal(lecture.recurring, false);
  assert.equal(lecture.start, '2026-03-23T07:00:00.000Z');
  assert.equal(lecture.overlapStart, '2026-03-23T08:00:00.000Z');
  assert.equal(conflicts[1]!.mandatory, false);
  assert.equal(conflicts[2]!.category, 'Work');
});

test('N10: a conflict between two weekly series is marked as recurring', () => {
  const series = event({ id: undefined, repeatWeekly: true, start: '2026-03-23T10:00', end: '2026-03-23T12:00' });
  const [conflict] = findEventCollisions(series, [event({ id: 'other', repeatWeekly: true, start: '2026-03-02T11:00', end: '2026-03-02T13:00' })], zone);
  assert.equal(conflict?.recurring, true);
  assert.equal(conflict?.overlapStart, '2026-03-23T10:00:00.000Z');
});

test('N10: re-check after correction returns an empty list, and changed data invalidates the old confirmation', () => {
  const draft = event({ id: undefined });
  const existing = [event({ id: 'lab', start: '2026-03-23T11:00', end: '2026-03-23T13:00' })];
  const first = checkEventCollisions(draft, existing, zone);
  assert.equal(first.conflicts.length, 1);
  assert.match(first.collisionToken ?? '', /^[a-f0-9]{64}$/);
  // Token z ponownego sprawdzenia jest tym samym potwierdzeniem, które akceptuje zapis.
  assert.doesNotThrow(() => requireCollisionDecision({ ...draft, collisionToken: first.collisionToken! }, existing, zone));
  const corrected = { ...draft, start: '2026-03-23T08:00', end: '2026-03-23T11:00' };
  assert.deepEqual(checkEventCollisions(corrected, existing, zone), { conflicts: [], collisionToken: null });
  const moved = { ...draft, end: '2026-03-23T12:30' };
  assert.throws(() => requireCollisionDecision({ ...moved, collisionToken: first.collisionToken! }, existing, zone), CollisionError);
  // Zmiana istniejącego wydarzenia po obejrzeniu listy też unieważnia potwierdzenie.
  const changedExisting = [event({ id: 'lab', start: '2026-03-23T11:30', end: '2026-03-23T13:00' })];
  assert.throws(() => requireCollisionDecision({ ...draft, collisionToken: first.collisionToken! }, changedExisting, zone), CollisionError);
});

test('N10: collision-check endpoint returns the full list without saving and maps errors', async () => {
  let writes = 0;
  const calls: { eventId?: string; userId?: string }[] = [];
  const existing = [event({ id: 'lab', title: 'Laboratorium', mandatory: true, start: '2026-03-23T11:00', end: '2026-03-23T13:00' })];
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
    createEvent: async () => { writes++; throw new Error('must not save'); },
    checkCollisions: async (input, eventId, userId) => {
      calls.push({ eventId, userId });
      if (eventId === 'missing') throw new (await import('../src/collisions.js')).EventNotFoundError('event_not_found');
      return checkEventCollisions(input, existing, zone, eventId);
    } });
  try {
    const { id: _id, ...base } = event();
    const payload = { ...base, mandatory: false, location: '' };
    const response = await app.inject({ method: 'POST', url: '/api/v1/calendar/events/collision-check', payload });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().conflicts.length, 1);
    assert.equal(response.json().conflicts[0].title, 'Laboratorium');
    assert.equal(response.json().conflicts[0].mandatory, true);
    assert.match(response.json().collisionToken, /^[a-f0-9]{64}$/);
    const corrected = await app.inject({ method: 'POST', url: '/api/v1/calendar/events/collision-check', payload: { ...payload, start: '2026-03-23T13:00', end: '2026-03-23T14:00', eventId: 'one' } });
    assert.deepEqual(corrected.json(), { conflicts: [], collisionToken: null });
    assert.equal(calls[1]?.eventId, 'one');
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/calendar/events/collision-check', payload: { ...payload, eventId: 'missing' } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/calendar/events/collision-check', payload: { ...payload, end: payload.start } })).statusCode, 400);
    assert.equal(writes, 0);
  } finally { await app.close(); }
  const offline = buildApi(null);
  try {
    const { id: _id, ...base } = event();
    assert.equal((await offline.inject({ method: 'POST', url: '/api/v1/calendar/events/collision-check', payload: { ...base, mandatory: false, location: '' } })).statusCode, 503);
  } finally { await offline.close(); }
});
