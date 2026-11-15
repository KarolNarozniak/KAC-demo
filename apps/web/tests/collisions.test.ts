// Pełna informacja o kolizjach (S23KC2S1P2-302, N10): opis każdej kolidującej pozycji w oknie kolizji i po ponownym sprawdzeniu.
import assert from 'node:assert/strict';
import test from 'node:test';
import { collisionRange, collisionSummary, describeCollision } from '../src/domain/collisions.ts';
import type { EventCollision } from '../src/services/calendarApi.ts';

const lab: EventCollision = { id: 'E-LAB', title: 'Laboratorium', category: 'Class', start: '2026-11-19T14:30:00.000Z', end: '2026-11-19T15:30:00.000Z',
  overlapStart: '2026-11-19T14:30:00.000Z', overlapEnd: '2026-11-19T15:00:00.000Z', mandatory: true, repeatWeekly: true, recurring: false };

test('N10: collision is described with name, kind, local range, overlap and notes', () => {
  const view = describeCollision(lab);
  assert.equal(view.title, 'Laboratorium');
  assert.equal(view.kind, 'Zajęcia');
  assert.match(view.range, /19\.11 15:30–16:30$/);
  assert.match(view.overlap, /19\.11 15:30–16:00$/);
  assert.deepEqual(view.notes, ['zajęcia obowiązkowe', 'wystąpienie serii cotygodniowej']);
  assert.deepEqual(describeCollision({ ...lab, mandatory: false, recurring: true }).notes, ['kolizja powtarza się co tydzień']);
  assert.equal(describeCollision({ ...lab, category: 'Praca' }).kind, 'Praca');
});

test('N10: ranges spanning midnight show both days', () => {
  assert.match(collisionRange('2026-11-19T21:00:00.000Z', '2026-11-20T01:00:00.000Z'), /19\.11 22:00 – .* 20\.11 02:00$/);
});

test('N10: summary counts all items and mandatory classes; empty list means a free slot', () => {
  assert.equal(collisionSummary([]), 'Termin jest wolny – brak kolizji.');
  assert.equal(collisionSummary([lab]), 'Koliduje z 1 pozycją, w tym z zajęciami obowiązkowymi (1).');
  assert.equal(collisionSummary([lab, { ...lab, id: 'W', mandatory: false }]), 'Koliduje z 2 pozycjami, w tym z zajęciami obowiązkowymi (1).');
});
