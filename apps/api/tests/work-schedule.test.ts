import assert from 'node:assert/strict';
import test from 'node:test';
import { checkScheduleFile, MAX_SCHEDULE_FILE_BYTES } from '../src/import/work-schedule/file-check.js';
import { mapShiftsToRows, sameEmployee } from '../src/import/work-schedule/mapping.js';
import { planImport } from '../src/import/plan.js';
import { DemoScheduleReader } from '../src/import/work-schedule/reader.js';
import { resolveRow } from '../src/import/rules.js';
import { buildImportPreview } from '../src/import/preview.js';
import { jpgBytes, pdfBytes, pngBytes, toBase64 } from './fixtures.js';

// --- SUB-02: walidacja pliku ---

test('rozpoznaje JPG, PNG i PDF po zawartości pliku', () => {
  assert.deepEqual(
    [jpgBytes(), pngBytes(), pdfBytes()].map((bytes) => {
      const result = checkScheduleFile(toBase64(bytes));
      return result.ok ? result.type : result.reason;
    }),
    ['JPG', 'PNG', 'PDF'],
  );
});

test('odrzuca nieobsługiwany format, nawet z „dobrym” rozszerzeniem (4a)', () => {
  const gif = Buffer.from('GIF89a', 'latin1');
  const textPretendingToBeJpg = Buffer.from('to nie jest zdjęcie', 'utf8');
  assert.deepEqual(checkScheduleFile(toBase64(gif)), { ok: false, reason: 'unsupported-format' });
  assert.deepEqual(checkScheduleFile(toBase64(textPretendingToBeJpg)), { ok: false, reason: 'unsupported-format' });
});

test('odrzuca plik uszkodzony lub ucięty (4a)', () => {
  const cut = (bytes: Buffer) => toBase64(bytes.subarray(0, bytes.length - 3));
  assert.deepEqual(checkScheduleFile(cut(jpgBytes())), { ok: false, reason: 'corrupted-file' });
  assert.deepEqual(checkScheduleFile(cut(pngBytes())), { ok: false, reason: 'corrupted-file' });
  assert.deepEqual(checkScheduleFile(toBase64(Buffer.from('%PDF-1.4\nucięty', 'latin1'))), { ok: false, reason: 'corrupted-file' });
  assert.deepEqual(checkScheduleFile('to-nie-jest-base64!!'), { ok: false, reason: 'corrupted-file' });
});

test('odrzuca pusty plik i plik większy niż 5 MB', () => {
  assert.deepEqual(checkScheduleFile(''), { ok: false, reason: 'empty-file' });
  const tooBig = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_SCHEDULE_FILE_BYTES)]);
  assert.deepEqual(checkScheduleFile(toBase64(tooBig)), { ok: false, reason: 'file-too-large' });
});

// --- SUB-04 i SUB-05: odczyt i mapowanie na zmiany pracy ---

test('rozpoznaje zmiany użytkownika w grafiku wielu pracowników', () => {
  assert.equal(sameEmployee('demo  STUDENT', 'Student Demo'), true);
  assert.equal(sameEmployee('Anna Nowak', 'Student Demo'), false);
  const { rows } = mapShiftsToRows(
    [
      { employee: 'Student Demo', date: '2026-11-02', startTime: '16:00', endTime: '20:00', confidence: 0.9 },
      { employee: 'Anna Nowak', date: '2026-11-02', startTime: '08:00', endTime: '14:00', confidence: 0.9 },
      { date: '2026-11-03', startTime: '10:00', endTime: '12:00', confidence: 0.9 },
    ],
    'Student Demo',
  );
  assert.deepEqual(rows.map((row) => row.isOwn), [true, false, true]);
  assert.ok(rows.every((row) => row.category === 'Work' && row.title === 'Praca'));
});

test('wynik odczytu: wszystkie, część albo żadna zmiana (4b, 4c)', () => {
  const full = { date: '2026-11-02', startTime: '16:00', endTime: '20:00', confidence: 0.9 };
  assert.equal(mapShiftsToRows([full], 'X').readStatus, 'all');
  const partial = mapShiftsToRows([full, { date: '2026-11-03', startTime: '10:00', confidence: 0.5 }], 'X');
  assert.equal(partial.readStatus, 'partial');
  assert.equal(partial.rows[1]?.incomplete, true);
  assert.equal(mapShiftsToRows([], 'X').readStatus, 'none');
});

test('czytnik demonstracyjny: „pusty” plik nie daje zmian, inne dają przykładowy grafik', async () => {
  const reader = new DemoScheduleReader(async () => 'Student Demo');
  assert.equal(reader.real, false);
  assert.deepEqual(await reader.read({ name: 'grafik-pusty.jpg', type: 'JPG', bytes: jpgBytes() }), []);
  const shifts = await reader.read({ name: 'grafik.pdf', type: 'PDF', bytes: pdfBytes() });
  assert.ok(shifts.some((shift) => shift.employee === 'Student Demo'));
  assert.ok(shifts.some((shift) => shift.employee !== 'Student Demo'));
});

// --- Reguły zmian pracy: zmiana nocna i duplikaty ---

test('zmiana nocna w pracy kończy się następnego dnia i wymaga potwierdzenia', () => {
  const result = resolveRow({ id: 'z1', title: 'Praca', date: '2026-11-04', startTime: '22:00', endTime: '06:00', category: 'Work' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.overnight, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.end.toISOString(), '2026-11-05T05:00:00.000Z'); // 06:00 czasu polskiego (CET)
});

test('dla zajęć koniec przed początkiem nadal jest błędem (historyjka 32 bez zmian)', () => {
  const result = resolveRow({ id: 'p1', title: 'Wykład', date: '2026-11-04', startTime: '22:00', endTime: '06:00', category: 'Class' });
  assert.deepEqual(result, { ok: false, id: 'p1', issues: ['end-not-after-start'] });
});

test('podgląd oznacza duplikat w kalendarzu i powtórzenie w imporcie dla wszystkich kategorii', () => {
  const existing = [{ id: 'E002', title: 'Praca', start: new Date('2026-02-23T15:00:00Z') }];
  const work = { title: ' praca ', date: '2026-02-23', startTime: '16:00', endTime: '20:00', category: 'Work' as const };
  const preview = buildImportPreview(
    [
      { id: 'z1', ...work },
      { id: 'z2', ...work },
      { id: 'p1', ...work, category: 'Class' },
    ],
    existing,
  );
  assert.deepEqual(preview[0]?.duplicateOfEvents.map((event) => event.id), ['E002']);
  assert.deepEqual(preview[1]?.duplicateOfRows, ['z1']);
  assert.equal(preview[2]?.duplicateOfEvents.length, 1);
});

// --- SUB-10: plan zapisu z decyzjami dla duplikatów ---

const start = new Date('2026-11-02T15:00:00Z');
const existing = [{ id: 'E-OLD', title: 'Praca', start }];

test('duplikat bez decyzji blokuje zapis (6b)', () => {
  const plan = planImport([{ id: 'z1', title: 'Praca', start }], existing);
  assert.deepEqual(plan, { ok: false, missingDecisions: ['z1'], invalidDecisions: [] });
});

test('decyzje Pomiń, Zastąp i Zachowaj oba dają odpowiednie akcje', () => {
  const plan = planImport(
    [
      { id: 'z1', title: 'Praca', start, duplicateDecision: 'replace' },
      { id: 'z2', title: 'Praca', start, duplicateDecision: 'skip' },
      { id: 'z3', title: 'Praca', start, duplicateDecision: 'keepBoth' },
      { id: 'z4', title: 'Praca', start: new Date('2026-11-03T15:00:00Z') },
    ],
    existing,
  );
  assert.deepEqual(plan, {
    ok: true,
    actions: [
      { kind: 'replace', rowId: 'z1', eventId: 'E-OLD' },
      { kind: 'skip', rowId: 'z2' },
      { kind: 'insert', rowId: 'z3' },
      { kind: 'insert', rowId: 'z4' },
    ],
  });
});

test('„Zastąp” zastępuje wcześniejszy wiersz w tym samym imporcie', () => {
  const other = new Date('2026-11-05T15:00:00Z');
  const plan = planImport(
    [
      { id: 'z1', title: 'Praca', start: other },
      { id: 'z2', title: 'Praca', start: other, duplicateDecision: 'replace' },
    ],
    [],
  );
  assert.deepEqual(plan, { ok: true, actions: [{ kind: 'skip', rowId: 'z1' }, { kind: 'insert', rowId: 'z2' }] });
});


test('ambiguous replacements require an explicit matching target', () => {
  const events = [...existing, { ...existing[0]!, id: 'E-OTHER' }];
  assert.equal(planImport([{ id: 'r', title: 'Praca', start, duplicateDecision: 'replace' }], events).ok, false);
  assert.deepEqual(planImport([{ id: 'r', title: 'Praca', start, duplicateDecision: 'replace', replacementId: 'E-OTHER' }], events), {
    ok: true, actions: [{ kind: 'replace', rowId: 'r', eventId: 'E-OTHER' }],
  });
});
