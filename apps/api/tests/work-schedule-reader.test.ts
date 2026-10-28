// Prawdziwy odczyt grafiku pracy (S23KC2S1P2-44, SUB-03): interpretacja tekstu, PDF z warstwą tekstową i OCR zdjęcia.
import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { buildApi, type CalendarRepository } from '../src/app.js';
import { tryAcquireRecognition } from '../src/import/recognition-slot.js';
import { LocalScheduleReader, pdfPagesToLines, ScheduleReadError } from '../src/import/work-schedule/local-reader.js';
import { mapShiftsToRows, sameEmployee } from '../src/import/work-schedule/mapping.js';
import { alignToColumns, parseScheduleLines, type PositionedWord } from '../src/import/work-schedule/parse.js';
import type { ScheduleReader } from '../src/import/work-schedule/reader.js';
import { jpgBytes, pdfBytes, toBase64 } from './fixtures.js';

const now = new Date('2026-10-28T12:00:00Z');
const lines = (...texts: string[]) => texts.map((text) => ({ text, confidence: 0.9 }));
const brief = (shifts: ReturnType<typeof parseScheduleLines>) =>
  shifts.map((shift) => `${shift.employee ?? '?'}|${shift.date ?? '?'}|${shift.startTime ?? '?'}-${shift.endTime ?? '?'}`);

// --- Interpretacja tekstu ---

test('lista: data, pracownik i godziny w jednym wierszu; dni wolne są pomijane', () => {
  const shifts = parseScheduleLines(lines(
    'Grafik pracy - Kawiarnia Zachodnia, listopad 2026',
    'Data  Pracownik  Godziny',
    '02.11.2026 Jan Kowalski 16:00-20:00',
    '2026-11-02 Anna Nowak 08:00 – 14:00',
    '04.11.2026 Jan Kowalski 22:00-06:00',
    '07.11.2026 Jan Kowalski wolne',
  ), { now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Anna Nowak|2026-11-02|08:00-14:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
  ]);
  assert.ok(shifts.every((shift) => shift.title === 'Praca' && shift.confidence === 0.9));
});

test('grupy dat i grupy osób: data lub pracownik z nagłówka obowiązuje w kolejnych wierszach', () => {
  assert.deepEqual(brief(parseScheduleLines(lines('Poniedziałek 02.11', 'Jan Kowalski 16-20', 'Anna Nowak 8-14', 'Wtorek 3 listopada', 'Jan Kowalski 22-6'), { now })), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Anna Nowak|2026-11-02|08:00-14:00',
    'Jan Kowalski|2026-11-03|22:00-06:00',
  ]);
  assert.deepEqual(brief(parseScheduleLines(lines('Jan Kowalski', 'pon 02.11 16:00-20:00', 'śr 04.11 16.00 - 20.00'), { now })), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Jan Kowalski|2026-11-04|16:00-20:00',
  ]);
});

test('tabela tygodniowa: komórki przypisane do dat z nagłówka; przy niezgodnej liczbie kolumn data zostaje do uzupełnienia', () => {
  const shifts = parseScheduleLines(lines(
    'Pracownik | pon 02.11 | wt 03.11 | śr 04.11',
    'Jan Kowalski | 16-20 | wolne | 22-6',
    'Piotr Zieliński | 8-14 | 10-18',
  ), { now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
    'Piotr Zieliński|?|08:00-14:00',
    'Piotr Zieliński|?|10:00-18:00',
  ]);
  assert.equal(shifts[2]?.confidence, 0.5);
});

/** Linia ze słowami w podanych miejscach (jak z OCR): [tekst, x] – każde słowo ma 40 px szerokości. */
const placed = (confidence: number, ...words: [string, number][]) => ({
  text: words.map(([text]) => text).join(' '), confidence,
  words: words.map(([text, x]): PositionedWord => ({ text, x0: x, x1: x + 40 })),
});

test('tabela tygodniowa: gdy OCR zgubi komórkę, daty są dobierane według położenia kolumn', () => {
  const shifts = parseScheduleLines([
    placed(0.9, ['Pracownik', 10], ['pon', 200], ['02.11', 240], ['wt', 400], ['03.11', 430], ['śr', 600], ['04.11', 630], ['czw', 800], ['05.11', 840]),
    // „wolne” we wtorek nie zostało odczytane – zostały 3 komórki na 4 kolumny.
    placed(0.9, ['Jan', 10], ['Kowalski', 60], ['16-20', 205], ['22-6', 605], ['8-14', 805]),
    // Pierwsza kolumna pusta – tylko dzięki przesunięciu z poprzedniego wiersza wiadomo, które to dni.
    placed(0.9, ['Anna', 10], ['Nowak', 60], ['8-14', 205], ['8-14', 405], ['X', 605], ['10-18', 805]),
    placed(0.9, ['Piotr', 10], ['Zieliński', 60], ['12-18', 405], ['12-18', 605]),
  ], { now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
    'Jan Kowalski|2026-11-05|08:00-14:00',
    'Anna Nowak|2026-11-02|08:00-14:00',
    'Anna Nowak|2026-11-03|08:00-14:00',
    'Anna Nowak|2026-11-05|10:00-18:00',
    'Piotr Zieliński|2026-11-03|12:00-18:00',
    'Piotr Zieliński|2026-11-04|12:00-18:00',
  ]);
  assert.ok(shifts.filter((shift) => shift.employee !== 'Anna Nowak').every((shift) => shift.confidence <= 0.65), 'dopasowanie po położeniu jest oznaczane do sprawdzenia');
});

test('dopasowanie do kolumn: zachowuje kolejność, a przy niepewnym położeniu nie zgaduje', () => {
  assert.deepEqual(alignToColumns([105, 505], [100, 300, 500]), [0, 2]);
  // Dwie komórki w równych odstępach na trzy kolumny – bez znanego przesunięcia to remis, więc brak zgadywania.
  assert.equal(alignToColumns([210, 410], [100, 300, 500]), null);
  assert.deepEqual(alignToColumns([210, 410], [100, 300, 500], 90), [1, 2]);
  assert.deepEqual(alignToColumns([210, 410], [100, 300, 500], -110), [0, 1]);
  assert.equal(alignToColumns([100, 200], [100, 300, 500]), null);
  assert.equal(alignToColumns([1, 2, 3, 4], [100, 300, 500]), null);
});

test('podejrzanie długa zmiana (np. „12-18” odczytane jako „02-18”) jest oznaczana do sprawdzenia', () => {
  const [shift] = parseScheduleLines(lines('02.11.2026 Jan Kowalski 02:00-18:00'), { now });
  assert.equal(shift?.confidence, 0.5);
});

test('typowe pomyłki OCR w godzinach są poprawiane, a brak godziny końca daje zmianę częściową', () => {
  const shifts = parseScheduleLines(lines('O2.11.2026 Jan Kowalski 16:OO-2O:00', '06.11.2026 Jan Kowalski 15:00'), { now });
  assert.deepEqual(brief(shifts), ['Jan Kowalski|2026-11-02|16:00-20:00', 'Jan Kowalski|2026-11-06|15:00-?']);
  const { readStatus } = mapShiftsToRows(shifts, 'Jan Kowalski');
  assert.equal(readStatus, 'partial');
});

test('rok w datach bez roku: z dokumentu (także przez przełom roku) albo najbliższy względem dzisiejszej daty', () => {
  assert.deepEqual(brief(parseScheduleLines(lines('Grafik grudzień 2026', '30.12 Jan Kowalski 16-20', '02.01 Jan Kowalski 8-14'), { now })), [
    'Jan Kowalski|2026-12-30|16:00-20:00',
    'Jan Kowalski|2027-01-02|08:00-14:00',
  ]);
  assert.deepEqual(brief(parseScheduleLines(lines('05.01 Jan Kowalski 10:00 18:00'), { now })), ['Jan Kowalski|2027-01-05|10:00-18:00']);
});

test('nazwiska z błędami OCR: sklejone słowa, śmieci z sąsiedniej kolumny, pomylona litera', () => {
  const shifts = parseScheduleLines(lines(
    '02.11.2026 pan SZ Użytkowniklokalny 16:00-20:00',
    '02.11.2026 pom Anna Nowak | 08:00-14:00',
    '04.11.2026 sr Uzytkownik Lokalnv 22:00-06:00',
  ), { now });
  const { rows } = mapShiftsToRows(shifts, 'Użytkownik Lokalny');
  assert.deepEqual(rows.map((row) => row.isOwn), [true, false, true]);
  assert.equal(rows[1]?.employee, 'Anna Nowak');
  assert.equal(sameEmployee('Anna Nowak', 'Użytkownik Lokalny'), false);
  assert.equal(sameEmployee('Lokalny Użytkownik', 'Użytkownik Lokalny'), true);
});

test('tekst bez dat i godzin nie daje zmian (scenariusz 4b)', () => {
  assert.deepEqual(parseScheduleLines(lines('Regulamin pracy', 'Przerwa 15 minut'), { now }), []);
});

// --- PDF z warstwą tekstową ---

/** Prosty PDF z tekstem (Helvetica), budowany w teście, żeby nie trzymać plików binarnych. */
function textPdf(rows: string[]): Buffer {
  const stream = ['BT', '/F1 12 Tf', ...rows.map((row, i) => `1 0 0 1 50 ${780 - i * 20} Tm (${row.replace(/[()\\]/g, '\\$&')}) Tj`), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(body, 'latin1');
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('PDF: linie są składane z elementów tekstu według wysokości i kolejności od lewej', () => {
  const page = { width: 595, items: [
    { text: '16:00-20:00', x: 300, y: 100.5, w: 60 }, { text: '02.11.2026', x: 50, y: 100, w: 60 }, { text: 'Jan Kowalski', x: 150, y: 101, w: 70 },
    { text: 'Anna Nowak', x: 150, y: 120, w: 70 },
  ] };
  assert.deepEqual(pdfPagesToLines([page]).map((line) => line.text), ['02.11.2026 Jan Kowalski 16:00-20:00', 'Anna Nowak']);
});

test('PDF z tekstem jest odczytywany naprawdę, a PDF bez tekstu (skan) jest odrzucany', async () => {
  const reader = new LocalScheduleReader();
  const pdf = textPdf(['Grafik pracy - listopad 2026', '02.11.2026   Jan Kowalski   16:00-20:00', '03.11.2026   Anna Nowak   08:00-14:00']);
  const shifts = await reader.read({ name: 'grafik.pdf', type: 'PDF', bytes: pdf }, { userName: 'Jan Kowalski', now });
  assert.deepEqual(brief(shifts), ['Jan Kowalski|2026-11-02|16:00-20:00', 'Anna Nowak|2026-11-03|08:00-14:00']);
  await assert.rejects(reader.read({ name: 'skan.pdf', type: 'PDF', bytes: textPdf([]) }, { userName: '', now }),
    (error) => error instanceof ScheduleReadError && error.code === 'scanned-pdf');
  await assert.rejects(reader.read({ name: 'zly.pdf', type: 'PDF', bytes: pdfBytes() }, { userName: '', now }),
    (error) => error instanceof ScheduleReadError && error.code === 'unreadable-pdf');
});

// --- Zdjęcie (OCR) ---

async function scheduleImage(rows: string[], format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${80 + rows.length * 42}">`
    + '<rect width="100%" height="100%" fill="white"/>'
    + rows.map((row, i) => `<text x="30" y="${55 + i * 42}" font-family="DejaVu Sans, sans-serif" font-size="24" xml:space="preserve">${escape(row)}</text>`).join('')
    + '</svg>';
  const image = sharp(Buffer.from(svg));
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 85 }).toBuffer();
}

test('zdjęcie grafiku jest odczytywane lokalnym OCR (także polskie znaki w nazwiskach)', { timeout: 120_000 }, async () => {
  const reader = new LocalScheduleReader();
  const image = await scheduleImage([
    'Grafik pracy - Kawiarnia Zachodnia, listopad 2026',
    '02.11.2026    Jan Kowalski       16:00-20:00',
    '02.11.2026    Anna Nowak         08:00-14:00',
    '04.11.2026    Jan Kowalski       22:00-06:00',
    '06.11.2026    Łukasz Żółć        12:00-18:00',
    '07.11.2026    Jan Kowalski       wolne',
  ], 'jpeg');
  const shifts = await reader.read({ name: 'grafik.jpg', type: 'JPG', bytes: image }, { userName: 'Jan Kowalski', now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Anna Nowak|2026-11-02|08:00-14:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
    'Łukasz Żółć|2026-11-06|12:00-18:00',
  ]);
  assert.ok(shifts.every((shift) => shift.confidence > 0.6 && shift.confidence <= 1));
  const { rows } = mapShiftsToRows(shifts, 'Jan Kowalski');
  assert.deepEqual(rows.map((row) => row.isOwn), [true, false, true, false]);
});

/** Tabela z obramowaniem komórek – tak wygląda większość grafików z Excela. */
async function borderedTable(title: string, rows: string[][], widths: number[]): Promise<Buffer> {
  const rowHeight = 54, top = 100, left = 30, width = widths.reduce((a, b) => a + b, 0);
  const height = top + rowHeight * rows.length + 40;
  const parts = [`<rect width="100%" height="100%" fill="white"/>`, `<text x="${left}" y="60" font-family="DejaVu Sans" font-size="28" font-weight="bold">${title}</text>`];
  rows.forEach((row, r) => {
    let x = left;
    row.forEach((cell, c) => {
      parts.push(`<rect x="${x}" y="${top + r * rowHeight}" width="${widths[c]}" height="${rowHeight}" fill="${r === 0 ? '#e6e6e6' : 'white'}" stroke="#444" stroke-width="2"/>`);
      parts.push(`<text x="${x + 12}" y="${top + r * rowHeight + 36}" font-family="DejaVu Sans" font-size="24">${cell}</text>`);
      x += widths[c]!;
    });
  });
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2 * left}" height="${height}">${parts.join('')}</svg>`)).png().toBuffer();
}

test('tabela z obramowaniem (np. z Excela): linie siatki nie przeszkadzają w odczycie', { timeout: 120_000 }, async () => {
  const image = await borderedTable('Grafik zmian - tydzień 02.11-04.11.2026', [
    ['Pracownik', 'pon 02.11', 'wt 03.11', 'śr 04.11'],
    ['Jan Kowalski', '16-20', 'wolne', '22-6'],
    ['Anna Nowak', '8-14', '8-14', 'X'],
  ], [300, 170, 170, 170]);
  const shifts = await new LocalScheduleReader().read({ name: 'tabela.png', type: 'PNG', bytes: image }, { userName: 'Jan Kowalski', now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
    'Anna Nowak|2026-11-02|08:00-14:00',
    'Anna Nowak|2026-11-03|08:00-14:00',
  ]);
});

test('zdjęcie z telefonu: nierówne światło, ciemne tło, przekrzywienie i rozmycie', { timeout: 120_000 }, async () => {
  const table = await borderedTable('Grafik pracy - listopad 2026', [
    ['Data', 'Pracownik', 'Godziny'],
    ['02.11.2026', 'Jan Kowalski', '16:00-20:00'],
    ['03.11.2026', 'Anna Nowak', '08:00-14:00'],
    ['04.11.2026', 'Jan Kowalski', '22:00-06:00'],
  ], [220, 320, 220]);
  const meta = await sharp(table).metadata();
  const width = meta.width! * 2 + 600, height = meta.height! * 2 + 600;
  // Ciemne tło (stół), kartka lekko przekrzywiona, z jednej strony cień.
  const sheet = await sharp(table).resize(meta.width! * 2).rotate(2, { background: '#3a3632' }).toBuffer();
  const shadow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const photo = await sharp({ create: { width, height, channels: 3, background: '#3a3632' } })
    .composite([{ input: sheet, left: 250, top: 250 }, { input: shadow, left: 0, top: 0 }])
    .blur(1.5).jpeg({ quality: 60 }).toBuffer();
  const shifts = await new LocalScheduleReader().read({ name: 'zdjecie.jpg', type: 'JPG', bytes: photo }, { userName: 'Jan Kowalski', now });
  assert.deepEqual(brief(shifts), [
    'Jan Kowalski|2026-11-02|16:00-20:00',
    'Anna Nowak|2026-11-03|08:00-14:00',
    'Jan Kowalski|2026-11-04|22:00-06:00',
  ]);
});

test('uszkodzony obraz i zajęty OCR dają czytelne kody błędów', { timeout: 60_000 }, async () => {
  const reader = new LocalScheduleReader();
  await assert.rejects(reader.read({ name: 'a.jpg', type: 'JPG', bytes: jpgBytes() }, { userName: '', now }),
    (error) => error instanceof ScheduleReadError && error.code === 'unreadable-image');
  const release = tryAcquireRecognition();
  assert.ok(release);
  try {
    await assert.rejects(reader.read({ name: 'b.png', type: 'PNG', bytes: await scheduleImage(['x']) }, { userName: '', now }),
      (error) => error instanceof ScheduleReadError && error.code === 'reader-busy');
  } finally { release(); }
});

// --- API: błąd odczytu to problem z plikiem (422/429), a nie z bazą (503) ---

test('API: błędy odczytu grafiku zwracają 422 lub 429 i nie tworzą sesji importu', async () => {
  let sessions = 0;
  const repository: CalendarRepository = {
    checkConnection: async () => {}, getOverview: async () => null, getImportUserName: async () => 'Jan Kowalski',
    listEventsForImport: async () => [], createImportSession: async () => { sessions += 1; return { id: 'IMP', expiresAt: new Date() }; },
  };
  const failing = (code: ScheduleReadError['code']): ScheduleReader => ({ real: true, read: async () => { throw new ScheduleReadError(code); } });
  for (const [code, status] of [['scanned-pdf', 422], ['read-timeout', 422], ['reader-busy', 429]] as const) {
    const app = buildApi(repository, [], { scheduleReader: failing(code) });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/import/work-schedule/read', payload: { fileName: 'g.pdf', dataBase64: toBase64(pdfBytes()) } });
      assert.equal(response.statusCode, status);
      assert.equal(response.json().error, code);
    } finally { await app.close(); }
  }
  assert.equal(sessions, 0);
});

test('API: prawdziwy czytnik przekazuje nazwisko użytkownika i nie jest oznaczony jako demonstracyjny', async () => {
  const repository: CalendarRepository = {
    checkConnection: async () => {}, getOverview: async () => null, getImportUserName: async () => 'Jan Kowalski',
    listEventsForImport: async () => [], createImportSession: async () => ({ id: 'IMP', expiresAt: new Date() }),
  };
  const pdf = textPdf(['02.11.2026 Jan Kowalski 16:00-20:00', '02.11.2026 Anna Nowak 08:00-14:00']);
  const app = buildApi(repository, [], { scheduleReader: new LocalScheduleReader() });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/work-schedule/read', payload: { fileName: 'g.pdf', dataBase64: toBase64(pdf) } });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.readerIsDemo, false);
    assert.equal(body.readStatus, 'all');
    assert.deepEqual(body.rows.map((row: { isOwn: boolean }) => row.isOwn), [true, false]);
  } finally { await app.close(); }
});
