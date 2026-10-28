import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRow, toInstant, type ImportRow } from '../src/import/rules.js';
import { buildImportPreview } from '../src/import/preview.js';

const row = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  id: 'r1',
  title: 'Bezpieczeństwo sieci – laboratorium',
  date: '2026-10-13',
  startTime: '10:00',
  endTime: '12:00',
  ...overrides,
});

test('poprawny wiersz: pełny termin na wspólnej osi czasu', () => {
  const result = resolveRow(row());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.start.toISOString(), '2026-10-13T08:00:00.000Z'); // 10:00 czasu polskiego (CEST)
  assert.equal(result.end.toISOString(), '2026-10-13T10:00:00.000Z');
});

test('koniec musi następować po początku (s < e)', () => {
  assert.deepEqual(resolveRow(row({ endTime: '09:00' })), { ok: false, id: 'r1', issues: ['end-not-after-start'] });
  assert.deepEqual(resolveRow(row({ endTime: '10:00' })), { ok: false, id: 'r1', issues: ['end-not-after-start'] });
});

test('wydarzenie wielodniowe jest poprawne, gdy plik podaje datę końca', () => {
  const result = resolveRow(row({ startTime: '22:00', endTime: '06:00', endDate: '2026-10-14' }));
  assert.equal(result.ok, true);
});

test('brak tytułu i błędna godzina są zgłaszane razem', () => {
  const result = resolveRow(row({ title: '   ', startTime: '25:00' }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.issues, ['missing-title', 'invalid-time']);
});

test('nieistniejąca data jest odrzucana', () => {
  assert.equal(resolveRow(row({ date: '2026-02-30' })).ok, false);
});

test('czas jest liczony poprawnie także po zmianie czasu na zimowy', () => {
  assert.equal(toInstant('2026-10-26', '08:00')?.toISOString(), '2026-10-26T07:00:00.000Z'); // CET
  assert.equal(toInstant('2026-10-23', '08:00')?.toISOString(), '2026-10-23T06:00:00.000Z'); // CEST
});

test('podgląd zawiera miejsce i poziom pewności odczytu', () => {
  const [ok, bad] = buildImportPreview([
    row({ location: '  Sala 118  ', confidence: 0.75 }),
    row({ id: 'r2', title: '' }),
  ]);
  assert.equal(ok?.status, 'ok');
  assert.equal(ok?.location, 'Sala 118');
  assert.equal(ok?.confidence, 0.75);
  assert.equal(bad?.status, 'error');
  assert.equal(bad?.confidence, null);
});
