// S23KC2S1P2-263: karta podglądu wydarzenia w czacie.
import assert from 'node:assert/strict';
import test from 'node:test';
import { collisionLabel, createdMessage, eventPreview } from '../src/domain/assistantPreview.ts';
import type { PendingAssistantAction } from '../src/services/assistantApi.ts';

const action = (event: Record<string, unknown>, extra: Partial<PendingAssistantAction> = {}): PendingAssistantAction => ({
  id: 'a1', kind: 'calendar_event_create', expiresAt: '2026-11-16T12:15:00.000Z',
  payload: { event: { title: 'Trening', start: '2026-11-16T18:00', end: '2026-11-16T19:00', category: 'Personal', location: 'Bemowo', mandatory: false, repeatWeekly: false, ...event } }, ...extra });

test('S23KC2S1P2-263: podgląd pokazuje konkretną datę, godziny, kategorię, miejsce i powtarzanie', () => {
  const preview = eventPreview(action({}));
  assert.ok(preview);
  assert.equal(preview.date, 'poniedziałek, 16 listopada 2026');
  assert.equal(preview.time, '18:00–19:00');
  assert.equal(preview.category, 'Prywatne');
  assert.equal(preview.mandatory, '', 'obowiązkowość tylko przy zajęciach');
  assert.equal(preview.location, 'Bemowo');
  assert.equal(preview.recurrence, 'Jednorazowo');
  assert.equal(preview.blocked, false);
  assert.equal(createdMessage(preview), 'Dodano „Trening” do kalendarza: poniedziałek, 16 listopada 2026, 18:00–19:00.');
  const weekly = eventPreview(action({ category: 'Class', mandatory: true, repeatWeekly: true, location: '' }));
  assert.equal(weekly?.recurrence, 'Co tydzień (poniedziałek), od tej daty');
  assert.equal(weekly?.mandatory, 'obowiązkowe');
  assert.equal(weekly?.location, 'nie podano');
  assert.equal(eventPreview(action({ end: '2026-11-17T06:00', category: 'Work' }))?.time, '18:00 – wt 17.11 06:00');
});

test('S23KC2S1P2-263: kolizja albo błędny termin blokują dodanie i są opisane', () => {
  const collisions = [{ id: 'E1', title: 'Laboratorium', category: 'Class' as const, startLocal: '2026-11-16T08:00', endLocal: '2026-11-16T09:35' }];
  assert.equal(collisionLabel(collisions[0]!), 'Laboratorium (pn 16.11, 08:00–09:35)');
  const blocked = eventPreview(action({}, { collisions }));
  assert.equal(blocked?.blocked, true);
  assert.match(blocked?.blockReason ?? '', /koliduje/);
  assert.match(eventPreview(action({}, { validationError: 'invalid_event' }))?.blockReason ?? '', /nie istnieje/);
  assert.equal(eventPreview({ ...action({}), kind: 'calendar_event_delete' }), null, 'inne akcje mają własny opis (S23KC2S1P2-255)');
});
