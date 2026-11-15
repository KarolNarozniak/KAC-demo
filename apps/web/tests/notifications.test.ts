import assert from 'node:assert/strict';
import test from 'node:test';
import { planChangeLines, planChangeOutdated, resolveNotificationTarget } from '../src/domain/notifications.ts';
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

// S23KC2S1P2-299 (N07): różnica po kliknięciu powiadomienia o zmianie planu.
const change = { kind: 'changed' as const, fields: ['date', 'time', 'location'], eventVersion: 3,
  before: { start: '2026-11-19T10:00', end: '2026-11-19T11:30', location: 's. 101' }, after: { start: '2026-11-20T12:00', end: '2026-11-20T13:30', location: null } };

test('N07: plan change shows the previous and the new term and place', () => {
  assert.deepEqual(planChangeLines(change), ['Termin: 2026-11-19 10:00–11:30 → 2026-11-20 12:00–13:30', 'Miejsce: s. 101 → nie podano']);
  assert.deepEqual(planChangeLines({ ...change, fields: ['location'] }), ['Miejsce: s. 101 → nie podano']);
  assert.deepEqual(planChangeLines(null), []);
});

test('N07: unknown previous state is not turned into an invented difference', () => {
  assert.deepEqual(planChangeLines({ ...change, kind: 'unknown_previous', before: null, fields: [] }),
    ['Poprzedni termin nie jest znany – poniżej aktualny stan wydarzenia.', 'Termin teraz: 2026-11-20 12:00–13:30']);
});

test('N07: a later change after the notification is detected against the current event', () => {
  assert.equal(planChangeOutdated(change, { start: '2026-11-20T12:00', end: '2026-11-20T13:30' }), false);
  assert.equal(planChangeOutdated(change, { start: '2026-11-21T12:00', end: '2026-11-21T13:30' }), true);
  assert.equal(planChangeOutdated(change, null), false);
});
