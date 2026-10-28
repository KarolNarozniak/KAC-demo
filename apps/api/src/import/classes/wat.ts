import { resolveRow, type ImportRow } from '../rules.js';

export type PdfText = { text: string; x: number; y: number; w: number };
export type PdfPage = { width: number; items: PdfText[] };
export type ClassRow = ImportRow & { category: 'Class'; reviewRequired: boolean; sourcePage: number };
export type Timetable = { rows: ClassRow[]; academicYear: string; dateFrom: string; dateTo: string; warnings: string[] };
const MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const FORMS: Record<string, string> = { w: 'wykład', L: 'laboratorium', P: 'projekt', 'ć': 'ćwiczenia', S: 'seminarium', E: 'egzamin', Ep: 'egzamin poprawkowy', SO: 'spotkanie organizacyjne', Zp: 'zaliczenie poprawkowe', IN: 'inne' };
const center = (item: PdfText) => item.x + item.w / 2;

/** Join adjacent glyph runs without inserting spaces inside Polish words. */
function lineText(items: PdfText[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  return sorted.map((item, i) => {
    const prev = sorted[i - 1];
    return `${prev && item.x - (prev.x + prev.w) > 1 ? ' ' : ''}${item.text}`;
  }).join('').trim().replace(/\s+/g, ' ');
}

/** Fixed mini e-D layout: date columns, numbered time blocks and a subject legend.
 * Coordinates are normalized to A4 width. Dates come from the academic semester,
 * never the export/update timestamp. A header carries across a printed page break.
 */
export function parseWatTimetable(input: PdfPage[]): Timetable {
  const pages = input.map(page => ({ items: page.items.map(item => ({ ...item,
    x: item.x * 595 / page.width, y: item.y * 595 / page.width, w: item.w * 595 / page.width })) }));
  const all = pages.flatMap(page => page.items);
  const semester = all.map(item => item.text).join(' ').match(/(20\d{2})\/(20\d{2})\s+semestr\s+(letni|zimowy)/i);
  if (!semester || Number(semester[2]) !== Number(semester[1]) + 1) throw new Error('unsupported-layout');
  const academicYear = `${semester[1]}/${semester[2]}`;
  const names = new Map<string, string>();
  let legendStarted = false;
  for (const page of pages) {
    const legend = page.items.find(item => item.text.includes('Suma godzin'));
    for (const item of page.items) {
      if (!legendStarted && (!legend || item.y < legend.y)) continue;
      if (item.x < 80 || item.x > 96 || !/^[\p{L}\d.]+$/u.test(item.text.trim())) continue;
      // PDF text runs can cross table cells (e.g. subject + 'Laboratorium').
      // Read the complete line before removing its form/instructor/hour columns;
      // a fixed right-hand coordinate truncates narrow legends and leaks columns.
      const line = lineText(page.items.filter(other => Math.abs(other.y - item.y) < 1 && other.x >= 100));
      const name = line.replace(/\s+(?:Wykład|Laboratorium|Projekt|Ćwiczenia|Seminarium|Egzamin(?: poprawkowy)?|zal popr|INNE|Spotkanie organizacy(?:jne)?)(?:\s.*)?$/u, '').trim();
      if (name) names.set(item.text.trim(), name);
    }
    if (legend) legendStarted = true;
  }
  if (!names.size) throw new Error('unsupported-layout');
  const rows: ClassRow[] = [];
  let columns: { x: number; date: string }[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const legendY = page.items.find(item => item.text.includes('Suma godzin'))?.y ?? Infinity;
    if (pageIndex > 0 && !page.items.some(item => /^\d{2}:\d{2}$/.test(item.text) && item.x > 110 && item.x < 130)) break;
    const items = page.items.filter(item => item.y < legendY);
    const headers = items.filter(item => item.text.trim() === 'czas' && item.x > 105 && item.x < 130).sort((a,b) => a.y - b.y);
    const times = items.filter(item => /^\d{2}:\d{2}$/.test(item.text) && item.x > 110 && item.x < 130).sort((a,b) => a.y - b.y);
    if (times.length % 2) throw new Error('unsupported-layout');
    const slots = times.filter((_, i) => i % 2 === 0).map((start, i) => ({ start, end: times[i * 2 + 1]! }));
    let headerIndex = 0;
    for (const slot of slots) {
      while (headers[headerIndex] && headers[headerIndex]!.y < slot.start.y) {
        const header = headers[headerIndex++]!;
        columns = items.filter(item => Math.abs(item.y - header.y) < 1 && item.x > 130 && MONTHS.includes(item.text.trim())).map(month => {
          const day = items.find(item => /^\d{2}$/.test(item.text) && Math.abs(center(item) - center(month)) < 2 && Math.abs(item.y - (header.y - 6.75)) < 1);
          if (!day) throw new Error('unsupported-layout');
          const monthNumber = MONTHS.indexOf(month.text.trim()) + 1;
          const year = semester[3]!.toLowerCase() === 'letni' || monthNumber < 8 ? semester[2] : semester[1];
          return { x: center(month), date: `${year}-${String(monthNumber).padStart(2,'0')}-${day.text}` };
        }).sort((a,b) => a.x - b.x);
        if (columns.length < 2) throw new Error('unsupported-layout');
      }
      const forms = items.filter(item => item.text.startsWith('(') && item.x > 130
        && Math.abs(item.y - slot.start.y) < 7).map(item => {
          const fragments = items.filter(other => Math.abs(other.y - item.y) < 1 && other.x >= item.x - 0.1 && other.x < item.x + 14).sort((a,b) => a.x - b.x);
          const closing = fragments.findIndex(part => part.text.includes(')'));
          const parts = closing >= 0 ? fragments.slice(0, closing + 1) : [item];
          return { ...item, text: lineText(parts), w: parts.at(-1)!.x + parts.at(-1)!.w - item.x };
        });
      for (const form of forms) {
        const column = columns.reduce<typeof columns[number] | undefined>((best, col) => !best || Math.abs(col.x - center(form)) < Math.abs(best.x - center(form)) ? col : best, undefined);
        if (!column || Math.abs(column.x - center(form)) > 8) throw new Error('unsupported-layout');
        const atLine = (y: number) => lineText(items.filter(item => Math.abs(item.y - y) < 1 && Math.abs(center(item) - column.x) < 8));
        const code = atLine(form.y - 5.63);
        const formCode = form.text.trim().slice(1, -1);
        const fullName = names.get(code);
        const locations = [atLine(form.y + 5.07)];
        // Resit cells may list several rooms before the instructor abbreviation.
        // Preserve each room, stopping at instructor/sequence text or an empty line.
        for (let line = 2; line <= 8; line++) {
          const extraRoom = atLine(form.y + line * 5.067);
          if (!/^\d[\p{L}\d .\/-]*$/u.test(extraRoom)) break;
          locations.push(extraRoom);
        }
        const location = locations.filter(Boolean).join(', ');
        const reviewRequired = !fullName || !FORMS[formCode] || !location;
        const row: ClassRow = {
          id: `class-${rows.length + 1}`, title: `${fullName ?? code}${FORMS[formCode] ? ` — ${FORMS[formCode]}` : ` (${formCode})`}`,
          date: column.date, startTime: slot.start.text, endTime: slot.end.text,
          category: 'Class', location, confidence: reviewRequired ? 0.5 : 1, reviewRequired, sourcePage: pageIndex + 1,
        };
        if (!resolveRow(row).ok) row.reviewRequired = true;
        rows.push(row);
      }
    }
  }
  if (!rows.length || rows.length > 1000) throw new Error('unsupported-layout');
  rows.sort((a,b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  return { rows, academicYear, dateFrom: rows[0]!.date, dateTo: rows.at(-1)!.date,
    warnings: rows.some(row => row.reviewRequired) ? ['Część danych wymaga sprawdzenia. Popraw lub odznacz oznaczone zajęcia.'] : [] };
}
