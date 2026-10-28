import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('@tesseract.js-data/eng');
const MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const DAY_MS = 86_400_000;
const DAYS = 7;
const SLOTS = 7;
const ROWS_PER_DAY = SLOTS + 1; // Date header followed by seven time blocks.
const GRID_LINES = DAYS * ROWS_PER_DAY + 1;
const FIRST_DATE_COLUMN = 2; // Skip the weekday and block/time columns.
const clusters = values => values.filter((value, i) => !i || value - values[i - 1] > 2);

/** Locate the ruled miniature table independently of screenshot size and browser chrome. */
function locateGrid(data, width, height) {
  const groups = new Map();
  for (let y = 0; y < height; y++) {
    let run = 0, longest = 0, end = 0;
    for (let x = 0; x < width; x++) {
      run = data[y * width + x] < 90 ? run + 1 : 0;
      if (run > longest) { longest = run; end = x; }
    }
    if (longest < width * .3) continue;
    // All table rules have the same right edge; their left edges differ at day boundaries.
    const key = Math.round(end / 4);
    const list = groups.get(key) ?? [];
    list.push(y);
    groups.set(key, list);
  }
  for (const values of groups.values()) {
    const ys = clusters(values);
    if (ys.length !== GRID_LINES) continue;
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    if (Math.min(...gaps) < 10 || Math.max(...gaps) > Math.min(...gaps) * 1.6) continue;
    const columns = [];
    const bottom = ys.at(-1);
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = ys[0]; y <= bottom; y++) {
        if (data[y * width + x] < 90) count++;
      }
      if (count > (bottom - ys[0]) * .98) columns.push(x);
    }
    const xs = clusters(columns);
    if (xs.length >= 18 && xs.length <= 32) return { xs, ys };
  }
  throw new Error('unsupported-image-layout');
}

function hasInk(data, width, left, top, right, bottom) {
  let dark = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (data[y * width + x] < 90 && ++dark > 6) return true;
    }
  }
  return false;
}

async function readDates(read, xs, ys, semester) {
  const dates = [];
  let verifiedDates = 0;
  for (let column = FIRST_DATE_COLUMN; column < xs.length - 1; column++) {
    const result = await read(xs[column] + 3, ys[0] + 3, xs[column + 1] - 2, ys[1] - 2);
    const match = result.text.trim().toUpperCase().match(/^(\d{1,2})\s+([IVX]+)$/);
    const month = match ? MONTHS.indexOf(match[2]) + 1 : 0;
    const year = semester[3].toLowerCase() === 'letni' || month < 9 ? +semester[2] : +semester[1];
    const recognized = match ? new Date(Date.UTC(year, month - 1, +match[1])) : null;
    if (!dates.length && (!recognized || !month || recognized.getUTCMonth() !== month - 1 || recognized.getUTCDay() !== 1)) {
      throw new Error('unreadable-image-dates');
    }
    const date = dates.length ? new Date(+dates.at(-1) + 7 * DAY_MS) : recognized;
    if (recognized && +recognized === +date) verifiedDates++;
    dates.push(date);
  }
  // Recover damaged glyphs (e.g. 11 → 1) only with a corroborated weekly sequence.
  // All output rows still require manual review, including inferred header dates.
  if (verifiedDates < dates.length * .7) throw new Error('unreadable-image-dates');
  return dates;
}

/** Offline, cell-aware OCR. No fixture or PDF data is used by the reader. */
export async function recognizeMiniature(bytes) {
  const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning', animated: false }).autoOrient();
  const metadata = await image.metadata();
  if (!['png', 'jpeg'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || metadata.width > 6000 || metadata.height > 8000) {
    throw new Error('unreadable-image');
  }
  const { data, info: { width, height } } = await image
    .flatten({ background: 'white' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { xs, ys } = locateGrid(data, width, height);
  const source = sharp(data, { raw: { width, height, channels: 1 } });
  const worker = await createWorker('eng', 1, { langPath: model.langPath, cacheMethod: 'none', gzip: true });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: 300 });
    const read = async (left, top, right, bottom, threshold = true) => {
      let crop = source.clone().extract({ left, top, width: right - left, height: bottom - top })
        .resize({ width: Math.min((right - left) * 4, 6000), height: Math.min((bottom - top) * 4, 1000), fit: 'inside' });
      if (threshold) crop = crop.threshold(110);
      const buffer = await crop.extend({ top: 12, bottom: 12, left: 12, right: 12, background: 'white' })
        .withMetadata({ density: 300 }).png().toBuffer();
      return (await worker.recognize(buffer)).data;
    };
    const headerTop = Math.max(0, ys[0] - Math.round((ys[ROWS_PER_DAY] - ys[0]) * .7));
    const header = await read(xs[0], headerTop, width, ys[0] - 3, false);
    const semester = header.text.match(/(20\d{2})\s*\/\s*(20\d{2})\s+semestr\s+(letni|zimowy)/i);
    if (!semester || +semester[2] !== +semester[1] + 1) throw new Error('unsupported-image-layout');
    const dates = await readDates(read, xs, ys, semester);
    const rows = [];
    for (let day = 0; day < DAYS; day++) {
      for (let slot = 0; slot < SLOTS; slot++) {
        const y = day * ROWS_PER_DAY + slot + 1;
        const occupied = [];
        for (let column = FIRST_DATE_COLUMN; column < xs.length - 1; column++) {
          // Exclude grid borders. Preserve occupied cells even when OCR cannot read their text.
          if (hasInk(data, width, xs[column] + 3, ys[y] + 3, xs[column + 1] - 2, ys[y + 1] - 2)) occupied.push(column);
        }
        if (!occupied.length) continue;
        const timeLeft = xs[1] + Math.round((xs[2] - xs[1]) * .15);
        const time = await read(timeLeft, ys[y] + 3, xs[2] - 2, ys[y + 1] - 2);
        const times = time.text.match(/\d{2}:\d{2}/g);
        if (times?.length !== 2) throw new Error('unreadable-image-times');
        for (const column of occupied) {
          const result = await read(xs[column] + 3, ys[y] + 3, xs[column + 1] - 2, ys[y + 1] - 2);
          const title = result.text.replace(/\s+/g, '').trim();
          const date = new Date(+dates[column - FIRST_DATE_COLUMN] + day * DAY_MS).toISOString().slice(0, 10);
          rows.push({
            id: `ocr-${day}-${slot}-${column}`,
            title: /^[\p{L}\d.]{1,30}$/u.test(title) ? title : '',
            date, startTime: times[0], endTime: times[1], category: 'Class', location: '',
            confidence: Math.max(0, Math.min(1, result.confidence / 100)), reviewRequired: true, sourcePage: 1,
          });
        }
      }
    }
    if (!rows.length) throw new Error('empty-image-timetable');
    return {
      rows, academicYear: `${semester[1]}/${semester[2]}`,
      dateFrom: dates[0].toISOString().slice(0, 10),
      dateTo: new Date(+dates.at(-1) + 6 * DAY_MS).toISOString().slice(0, 10),
      warnings: ['Odczyt OCR wymaga sprawdzenia każdego wpisu. Miniatura zawiera skróty przedmiotów, bez sal i form zajęć. Uzupełnij te dane przed zapisem.'],
    };
  } finally { await worker.terminate(); }
}
