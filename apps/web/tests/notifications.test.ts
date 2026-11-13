import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNotificationTarget } from '../src/domain/notifications.ts';
import type { CalendarEvent } from '../src/domain/model.ts';

const week = { start: new Date(2026, 10, 16), end: new Date(2026, 10, 23) };

test('notification opens current event details when its time changed within the selected week', () => {
  const event: CalendarEvent = { id: 'event-1', title: 'Changed shift', start: '2026-11-18T09:00', end: '2026-11-18T17:00', category: 'Work', mandatory: false, repeatWeekly: false };
  const result = resolveNotificationTarget([event], { eventId: event.id, eventStart: '2026-11-16T08:00' }, week);
  assert.equal(result.kind, 'open');
  if (result.kind === 'open') assert.equal(result.occurrence.title, 'Changed shift');
});

test('notification asks calendar to navigate when a one-off shift moved to another week', () => {
  const event: CalendarEvent = { id: 'event-1', title: 'Moved shift', start: '2026-11-25T09:00', end: '2026-11-25T17:00', category: 'Work', mandatory: false, repeatWeekly: false };
  assert.deepEqual(resolveNotificationTarget([event], { eventId: event.id, eventStart: '2026-11-16T08:00' }, week), { kind: 'navigate', date: '2026-11-25' });
});

test('notification distinguishes a deleted shift from a removed recurring occurrence', () => {
  const target = { eventId: 'event-1', eventStart: '2026-11-16T08:00' };
  assert.deepEqual(resolveNotificationTarget([], target, week), { kind: 'missing', eventExists: false });
  const recurring: CalendarEvent = { id: 'event-1', title: 'Weekly', start: '2026-11-17T09:00', end: '2026-11-17T17:00', category: 'Work', mandatory: false, repeatWeekly: true };
  assert.deepEqual(resolveNotificationTarget([recurring], target, week), { kind: 'missing', eventExists: true });
});
