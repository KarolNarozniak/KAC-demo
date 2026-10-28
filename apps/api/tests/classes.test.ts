import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { parseWatTimetable, type PdfPage } from '../src/import/classes/wat.js';
import { readClassPdf } from '../src/import/classes/reader.js';
import { buildApi } from '../src/app.js';
import { pngBytes, pdfBytes } from './fixtures.js';
const fixture = (): PdfPage[] => JSON.parse(readFileSync(new URL('./fixtures/wat-grid.json', import.meta.url), 'utf8'));

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

const sample = new URL('../../../Wojskowa Akademia Techniczna, e-Dziekanat.pdf', import.meta.url);
test('actual provided PDF is processed by the isolated local worker', { skip: !existsSync(sample) }, async () => {
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
