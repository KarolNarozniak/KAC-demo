// Wykrywanie zmian planu i powiadomienie o nowym terminie (S23KC2S1P2-299, N07). Czysta logika konsumenta outboxa.
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPlanChange, mergePendingBefore, planChangeIdempotencyKey } from '../src/notifications/plan-changes.js';
import { deferForQuietHours, reminderTime } from '../src/notifications/schedule.js';

const now = new Date('2026-11-16T08:00:00Z');
const payload = (overrides: Record<string, unknown> = {}) => ({
  origin: 'calendar', timeZone: 'Europe/Warsaw', eventVersion: 2,
  before: { title: 'Laboratorium', start: '2026-11-19T10:00', end: '2026-11-19T11:30', category: 'Zajęcia', location: 's. 101' },
  after: { title: 'Laboratorium', start: '2026-11-20T12:00', end: '2026-11-20T13:30', category: 'Class', location: 's. 101' },
  ...overrides,
});

test('N07: a real change of date and time gives the name, the new term and the previous one', () => {
  const change = detectPlanChange('calendar_event.updated', payload(), now);
  assert.equal(change?.kind, 'changed');
  assert.ok(change && change.kind === 'changed');
  assert.deepEqual(change.fields, ['date', 'time']);
  assert.deepEqual(change.after, { start: '2026-11-20T12:00', end: '2026-11-20T13:30', location: 's. 101' });
  assert.equal(change.message, 'Zmiana planu: „Laboratorium” – nowy termin 2026-11-20 12:00–13:30 (było 2026-11-19 10:00–11:30).');
  assert.equal(change.eventStart.toISOString(), '2026-11-20T11:00:00.000Z');
});

test('N07: re-reading the same data (also UTC vs local form) is not a change', () => {
  assert.equal(detectPlanChange('calendar_event.updated', payload({ after: payload().before }), now), null);
  const sameInUtc = payload({ after: { title: 'Laboratorium', start: '2026-11-19T09:00:00.000Z', end: '2026-11-19T10:30:00.000Z', location: ' s. 101 ' } });
  assert.equal(detectPlanChange('calendar_event.updated', sameInUtc, now), null);
  // Zmiana samego tytułu nie jest zmianą terminu.
  assert.equal(detectPlanChange('calendar_event.updated', payload({ after: { ...payload().before, title: 'Lab. sieci' } }), now), null);
});

test('N07: a location-only change is reported; an old payload without before.location is not treated as a change', () => {
  const moved = detectPlanChange('calendar_event.updated', payload({ after: { ...payload().before, location: 's. 204' } }), now);
  assert.ok(moved && moved.kind === 'changed');
  assert.deepEqual(moved.fields, ['location']);
  assert.match(moved.message, /termin bez zmian: 2026-11-19 10:00–11:30; miejsce: s\. 204 \(było s\. 101\)/);
  const legacyBefore = { title: 'Laboratorium', start: '2026-11-19T10:00', end: '2026-11-19T11:30' };
  assert.equal(detectPlanChange('calendar_event.updated', payload({ before: legacyBefore, after: { ...legacyBefore, location: 's. 204' } }), now), null);
});

test('N07: missing before leads to a controlled re-read message, not an invented difference', () => {
  const change = detectPlanChange('calendar_event.updated', payload({ before: null }), now);
  assert.equal(change?.kind, 'unknown_previous');
  assert.match(change?.message ?? '', /zostało zmienione\. Aktualny termin: 2026-11-20 12:00–13:30 – otwórz kalendarz/);
});

test('N07: creations, deletions, past events, unreadable data and publication echo are ignored', () => {
  assert.equal(detectPlanChange('calendar_event.created', payload(), now), null);
  assert.equal(detectPlanChange('calendar_event.deleted', payload(), now), null);
  assert.equal(detectPlanChange('calendar_event.updated', payload(), new Date('2026-11-21T00:00:00Z')), null);
  assert.equal(detectPlanChange('calendar_event.updated', payload({ after: { title: 'X', start: 'zły', end: '2026-11-20T13:30' } }), now), null);
  assert.equal(detectPlanChange('calendar_event.updated', payload({ origin: 'google_publication_echo' }), now), null);
});

test('N07: an undelivered earlier change is merged so two quick edits give one full difference, and a revert gives none', () => {
  const second = payload({ before: payload().after, after: { ...payload().after, start: '2026-11-21T12:00', end: '2026-11-21T13:30' } });
  const merged = detectPlanChange('calendar_event.updated', mergePendingBefore(second, { start: '2026-11-19T10:00', end: '2026-11-19T11:30', location: 's. 101' }), now);
  assert.ok(merged && merged.kind === 'changed');
  assert.match(merged.message, /nowy termin 2026-11-21 12:00–13:30 \(było 2026-11-19 10:00–11:30\)/);
  const revert = payload({ before: payload().after, after: payload().before });
  assert.equal(detectPlanChange('calendar_event.updated', mergePendingBefore(revert, { start: '2026-11-19T10:00', end: '2026-11-19T11:30', location: 's. 101' }), now), null);
});

test('N07: the same event version always maps to the same idempotency key', () => {
  assert.equal(planChangeIdempotencyKey('e1', 3), 'plan-change:e1:3');
  assert.notEqual(planChangeIdempotencyKey('e1', 3), planChangeIdempotencyKey('e1', 4));
});

test('N07: quiet hours defer a change notification, outside them it is sent now; reminders keep their behaviour', () => {
  const start = new Date('2026-11-20T11:00:00Z');
  const night = new Date('2026-11-16T22:30:00Z'); // 23:30 w Warszawie
  assert.equal(deferForQuietHours(night, start, 'Europe/Warsaw', night, '22:00:00', '07:00:00').toISOString(), '2026-11-17T06:00:00.000Z');
  assert.equal(deferForQuietHours(now, start, 'Europe/Warsaw', now, '22:00:00', '07:00:00').toISOString(), now.toISOString());
  assert.equal(reminderTime(new Date('2026-11-16T11:00:00Z'), 300, 'Europe/Warsaw', new Date('2026-11-15T00:00:00Z'), '22:00:00', '08:00:00')?.toISOString(), '2026-11-16T07:00:00.000Z');
});
