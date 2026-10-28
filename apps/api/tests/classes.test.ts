import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseWatTimetable, type PdfPage } from '../src/import/classes/wat.js';
import { readClassPdf } from '../src/import/classes/reader.js';
import { buildImportPreview } from '../src/import/preview.js';
import { buildApi } from '../src/app.js';
import { pngBytes, pdfBytes } from './fixtures.js';
const fixture = (): PdfPage[] => JSON.parse(readFileSync(new URL('./fixtures/timetables/wat-plan-lato-2025-2026.json', import.meta.url), 'utf8'));

test('WAT semester grid: 166 populated cells, calendar dates, Polish legend, split glyphs and page continuation', () => {
  const result = parseWatTimetable(fixture());
  assert.equal(result.rows.length, 166);
  assert.equal(result.academicYear, '2025/2026');
  assert.equal(result.dateFrom, '2026-03-02');
  assert.equal(result.dateTo, '2026-07-02');
  assert.equal(result.warnings.length, 0);
  assert.equal(result.rows.filter(row => row.title.endsWith('ćwiczenia')).length, 3);
  assert.equal(result.rows.filter(row => row.title.endsWith('inne')).length, 1);
  assert.ok(result.rows.some(row => row.date === '2026-03-26' && row.startTime === '13:30' && row.sourcePage === 2 && row.title.startsWith('Oprogramowanie niepożądane')));
  assert.ok(result.rows.some(row => row.location === '011 65' && row.title.startsWith('Zarządzanie środowiskiem Windows')));
  assert.equal(new Set(result.rows.map(row => `${row.date}/${row.startTime}/${row.title}`)).size, 166);
});

test('unknown subjects remain editable and flagged; missing semester or non-WAT files fail closed', () => {
  const pages = fixture();
  for (const page of pages) page.items = page.items.filter(item => item.text !== 'Sieci komputerowe II');
  assert.ok(parseWatTimetable(pages).rows.some(row => row.reviewRequired && row.title.startsWith('SKII')));
  assert.throws(() => parseWatTimetable([{ width: 595, items: [] }]), /unsupported-layout/);
});

test('PDF processing rejects corrupt input without hanging', async () => {
  await assert.rejects(readClassPdf(pdfBytes()), /unreadable-pdf/);
});

const sample = new URL('./fixtures/timetables/wat-plan-lato-2025-2026.pdf', import.meta.url);
test('actual provided PDF is processed by the isolated local worker', async () => {
  const result = await readClassPdf(readFileSync(sample));
  assert.deepEqual(result, parseWatTimetable(fixture()));
});

test('class upload rejects photos and corrupt files before creating a session', async () => {
  let writes = 0;
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
    listEventsForImport: async () => [], createImportSession: async () => { writes++; return { id: 's1', expiresAt: new Date() }; } });
  try {
    const photo = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'fake.pdf', dataBase64: pngBytes().toString('base64') } });
    assert.equal(photo.statusCode, 422); assert.equal(photo.json().error, 'pdf-only');
    const corrupt = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: { fileName: 'bad.pdf', dataBase64: pdfBytes().toString('base64') } });
    assert.equal(corrupt.statusCode, 422);
    assert.equal(writes, 0);
  } finally { await app.close(); }
});

const namedFixture = (name: string): PdfPage[] => JSON.parse(readFileSync(new URL(`./fixtures/timetables/${name}.json`, import.meta.url), 'utf8'));
const eventKey = (row: { title: string; date: string; startTime: string; endTime: string; location?: string }) =>
  [row.date, row.startTime, row.endTime, row.title, row.location].join('|');

// Manually transcribed from the 2026/2027 grid, independently of the parser output.
// The fixture name follows the printed winter semester, not its original upload name.
const autumn2026Expected = () => {
  const rows: { title: string; date: string; startTime: string; endTime: string; location: string }[] = [];
  const blocks = { 1: ['08:00', '09:35'], 2: ['09:50', '11:25'], 3: ['11:40', '13:15'], 4: ['13:30', '15:05'], 5: ['16:00', '17:35'] } as const;
  const add = (date: string, slots: (keyof typeof blocks)[], title: string, location: string) => {
    for (const slot of slots) rows.push({ date: `2026-${date}`, startTime: blocks[slot][0], endTime: blocks[slot][1], title, location });
  };
  for (const date of ['10-05', '10-08', '10-12', '10-19']) add(date, [4], 'Zabezpieczenia teleinformatyczne — wykład', '203 65');
  add('10-28', [2], 'Zabezpieczenia teleinformatyczne — wykład', '203 65');
  for (const date of ['10-15', '10-19', '11-04']) add(date, [1, 2], 'Zabezpieczenia teleinformatyczne — laboratorium', '121 65');
  for (const date of ['11-09', '11-18']) add(date, [1, 2], 'Zabezpieczenia teleinformatyczne — laboratorium', '120 65');
  const project = 'Projekt zespołowy ST — projekt';
  add('10-07', [1, 2], project, '239 S');
  add('10-09', [4, 5], project, '237 S');
  add('10-14', [3, 4], project, '237 S');
  for (const date of ['10-21', '10-29']) add(date, [1, 2], project, '237 S');
  for (const date of ['11-02', '11-05', '11-12']) add(date, [1, 2], project, '125 65');
  add('11-16', [1, 2], project, '011 65');
  add('11-20', [4, 5], project, '125 65');
  add('11-26', [3, 4], project, '125 65');
  return rows.map(eventKey).sort();
};

test('2026 PDF: all 37 exact dates, blocks, subject names and rooms match the printed grid', () => {
  const result = parseWatTimetable(namedFixture('wat-plan-zima-2026-2027'));
  assert.equal(result.academicYear, '2026/2027');
  assert.equal(result.dateFrom, '2026-10-05');
  assert.equal(result.dateTo, '2026-11-26');
  assert.deepEqual(result.rows.map(eventKey).sort(), autumn2026Expected());
  assert.deepEqual(result.warnings, []);
  assert.equal(result.rows.filter(row => row.sourcePage === 2).length, 2);
});

// Counts independently checked against the printed legend: each grid cell is
// a two-academic-hour block, including reservations and resit examinations.
const winter2025Counts: Record<string, Record<string, number>> = {
  'Bezpieczeństwo pracy i ergonomia.': { wykład: 6, laboratorium: 4, 'zaliczenie poprawkowe': 1 },
  'Eksploracja sieci teleinformatycznych': { wykład: 7, laboratorium: 10, projekt: 5, 'zaliczenie poprawkowe': 3 },
  'JavaEE Technologies': { wykład: 5, laboratorium: 10 },
  'Niezawodność systemów komputerowych': { wykład: 7, ćwiczenia: 8, 'zaliczenie poprawkowe': 2 },
  'Podstawy bezpieczeństwa informacji': { wykład: 10, laboratorium: 5, 'zaliczenie poprawkowe': 1 },
  'Podstawy symulacji': { wykład: 5, laboratorium: 10, 'zaliczenie poprawkowe': 1 },
  'Podstawy zarządzania i przedsiębiorczości': { wykład: 8, ćwiczenia: 7 },
  Rezerwacja: { 'spotkanie organizacyjne': 3 },
  'Systemy operacyjne UNIX': { wykład: 10, laboratorium: 20, egzamin: 2, 'egzamin poprawkowy': 2, 'zaliczenie poprawkowe': 1 },
  'Systemy wbudowane': { wykład: 10, laboratorium: 12, egzamin: 1, 'egzamin poprawkowy': 1 },
  'Spotkanie organizacyjne': { seminarium: 1 },
  'Zastosowania kryptografii w Internecie': { wykład: 7, laboratorium: 8 },
  'Zastosowanie kryptografii w systemach teleinformatycznych': { 'zaliczenie poprawkowe': 2 },
  'HTML i aplikacje webowe': { wykład: 7, laboratorium: 8, 'zaliczenie poprawkowe': 2 },
};

test('winter 2025 PDF: 212 cells agree with the legend, with year rollover and page continuation', () => {
  const result = parseWatTimetable(namedFixture('wat-plan-zima-2025-2026'));
  assert.equal(result.rows.length, 212);
  assert.equal(result.academicYear, '2025/2026');
  assert.equal(result.dateFrom, '2025-10-01');
  assert.equal(result.dateTo, '2026-02-20');
  assert.deepEqual(result.warnings, []);
  const expected = Object.fromEntries(Object.entries(winter2025Counts).flatMap(([name, forms]) => Object.entries(forms).map(([form, count]) => [`${name} — ${form}`, count])));
  const actual: Record<string, number> = {};
  for (const row of result.rows) {
    actual[row.title] = (actual[row.title] ?? 0) + 1;
    assert.equal(row.reviewRequired, false);
    assert.equal(Number(row.date.slice(0, 4)), Number(row.date.slice(5, 7)) >= 10 ? 2025 : 2026);
    assert.ok(![0, 6].includes(new Date(`${row.date}T12:00Z`).getUTCDay()));
    assert.equal((Date.parse(`${row.date}T${row.endTime}Z`) - Date.parse(`${row.date}T${row.startTime}Z`)) / 60000, 95);
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(result.rows.map(eventKey)).size, 212);
  const continuation = result.rows.find(row => row.date === '2025-10-02' && row.startTime === '11:40');
  assert.equal(continuation?.sourcePage, 2);
  assert.equal(continuation?.title, 'Systemy wbudowane — wykład');
  assert.equal(continuation?.location, '307 S');
  assert.deepEqual(result.rows.filter(row => row.title === 'Systemy operacyjne UNIX — egzamin poprawkowy').map(row => [row.date, row.startTime, row.location]), [
    ['2026-02-16', '08:00', '121 65, 120 65'], ['2026-02-16', '09:50', '121 65, 120 65'],
  ]);
});

for (const name of ['wat-plan-zima-2025-2026', 'wat-plan-zima-2026-2027']) {
  const path = new URL(`./fixtures/timetables/${name}.pdf`, import.meta.url);
  test(`${name}: actual PDF worker matches the regression fixture`, async () => {
    const expected = parseWatTimetable(namedFixture(name));
    assert.deepEqual(await readClassPdf(readFileSync(path)), expected);
    let sessionsCreated = 0;
    const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null,
      listEventsForImport: async () => [], createImportSession: async input => {
        sessionsCreated++;
        assert.equal(input.source, 'classes');
        assert.equal(input.rows.length, expected.rows.length);
        assert.ok(input.preview.every(row => row.status === 'ok'));
        return { id: 'semester-preview', expiresAt: new Date() };
      } });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/import/classes/read', payload: {
        fileName: `${name}.pdf`, dataBase64: readFileSync(path).toString('base64'),
      } });
      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json().rows, expected.rows);
      assert.equal(sessionsCreated, 1);
    } finally { await app.close(); }
  });
}


test('winter import preview validates all 212 rows and preserves local times across DST', () => {
  const timetable = parseWatTimetable(namedFixture('wat-plan-zima-2025-2026'));
  const preview = buildImportPreview(timetable.rows);
  assert.equal(preview.length, 212);
  assert.ok(preview.every(row => row.status === 'ok'));
  const before = timetable.rows.find(row => row.date === '2025-10-20' && row.startTime === '08:00')!;
  const after = timetable.rows.find(row => row.date === '2025-10-27' && row.startTime === '08:00')!;
  assert.equal(preview.find(row => row.id === before.id)?.start, '2025-10-20T06:00:00.000Z');
  assert.equal(preview.find(row => row.id === after.id)?.start, '2025-10-27T07:00:00.000Z');
});
