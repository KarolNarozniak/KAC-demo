// Zajęcia w podglądzie grafiku (S23KC2S1P2-40, S23KC2S1P2-195/196): wskazanie zajęć kolidujących ze zmianą.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classTimeLabel, conflictMessage, shiftClassConflicts, weekClasses, windowsLabel } from '../src/domain/scheduleClasses.ts';
import type { BlockingEvent } from '../src/services/scheduleApi.ts';

const event = (overrides: Partial<BlockingEvent> = {}): BlockingEvent => ({
  eventId: 'C1', title: 'Analiza', category: 'Class', mandatory: true, repeatWeekly: true,
  start: '2026-11-03T09:00:00.000Z', end: '2026-11-03T10:30:00.000Z', startLocal: '2026-11-03T10:00', endLocal: '2026-11-03T11:30',
  effect: 'hard', bufferMinutes: 15, ...overrides,
});

test('kolizja zmiany z zajęciami: bufor dojazdu, zetknięcie granic i zajęcia nieobowiązkowe', () => {
  const events = [event(), event({ eventId: 'C2', title: 'Seminarium', mandatory: false, effect: 'soft', startLocal: '2026-11-03T14:00', endLocal: '2026-11-03T15:00' }),
    event({ eventId: 'W1', category: 'Work', title: 'Kawiarnia', startLocal: '2026-11-03T12:00', endLocal: '2026-11-03T13:00' })];
  assert.deepEqual(shiftClassConflicts({ startLocal: '2026-11-03T07:45', endLocal: '2026-11-03T09:45' }, events), []);
  const hard = shiftClassConflicts({ startLocal: '2026-11-03T08:00', endLocal: '2026-11-03T10:00' }, events);
  assert.deepEqual(hard.map((item) => [item.event.eventId, item.blocking]), [['C1', true]]);
  const soft = shiftClassConflicts({ startLocal: '2026-11-03T13:00', endLocal: '2026-11-03T16:00' }, events);
  assert.deepEqual(soft.map((item) => [item.event.eventId, item.blocking]), [['C2', false]]);
  assert.deepEqual(shiftClassConflicts({ startLocal: '2026-11-03T11:45', endLocal: '2026-11-03T13:45' }, events), []);
  assert.deepEqual(shiftClassConflicts({ startLocal: 'zły', endLocal: '2026-11-03T13:45' }, events), []);
  assert.deepEqual(weekClasses(events).map((item) => item.eventId), ['C1', 'C2']);
  // Poniedziałek po tygodniu jest potrzebny do sprawdzania zmian nocnych, ale nie trafia na listę zajęć tygodnia.
  const nextMonday = event({ eventId: 'C9', startLocal: '2026-11-09T08:00', endLocal: '2026-11-09T09:35' });
  assert.deepEqual(weekClasses([...events, nextMonday], '2026-11-02').map((item) => item.eventId), ['C1', 'C2']);
  assert.deepEqual([1, 3, 7, 12, 22].map(windowsLabel), ['1 przedział', '3 przedziały', '7 przedziałów', '12 przedziałów', '22 przedziały']);
});

test('komunikaty: dzień tygodnia, godziny zajęć i bufor', () => {
  assert.equal(classTimeLabel(event()), 'wt 3.11, 10:00–11:30');
  const message = conflictMessage(shiftClassConflicts({ startLocal: '2026-11-03T08:00', endLocal: '2026-11-03T10:00' }, [event()]));
  assert.equal(message.blocking, 'Koliduje z zajęciami obowiązkowymi: Analiza (wt 3.11, 10:00–11:30, z dojazdem 15 min).');
  assert.equal(message.optional, '');
});
