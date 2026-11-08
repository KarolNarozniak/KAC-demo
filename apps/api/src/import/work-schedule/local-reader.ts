// Prawdziwy odczyt grafiku pracy (S23KC2S1P2-44, SUB-03).
//
// PDF: tekst z warstwy tekstowej (ten sam bezpieczny czytnik PDF co w imporcie planu zajęć – historyjka 38).
// Zdjęcie JPG/PNG: lokalny OCR w osobnym wątku (ocr.mjs), z limitem czasu i jednym odczytem OCR naraz
// dla całego serwera (wspólny z importem planu zajęć).
// Tekst trafia do parseScheduleLines, a stamtąd na podgląd (historyjka 32) – nic nie jest zapisywane bez sprawdzenia.

import { Worker } from 'node:worker_threads';
import { PdfReadError, readPdfPages } from '../classes/reader.js';
import type { PdfPage } from '../classes/wat.js';
import { tryAcquireRecognition } from '../recognition-slot.js';
import { parseScheduleLines, type TextLine } from './parse.js';
import type { RawShift, ReadContext, ScheduleFile, ScheduleReader } from './reader.js';

/** Kody błędów odczytu zwracane do aplikacji (HTTP 422, a „reader-busy” – 429). */
export type ScheduleReadErrorCode =
  | 'reader-busy' | 'read-timeout' | 'unreadable-image' | 'unreadable-pdf' | 'encrypted-pdf' | 'scanned-pdf';

export class ScheduleReadError extends Error {
  constructor(readonly code: ScheduleReadErrorCode) {
    super(code);
  }
}

const OCR_TIMEOUT_MS = 60_000;
/** Tekst z PDF jest odczytany dokładnie – niepewność dotyczy tylko interpretacji, którą użytkownik sprawdza na podglądzie. */
const PDF_TEXT_CONFIDENCE = 0.95;

/** Składa elementy tekstu PDF w linie: elementy o (prawie) tej samej wysokości, ułożone od lewej do prawej. */
export function pdfPagesToLines(pages: PdfPage[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const page of pages) {
    const items = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
    let current: typeof items = [];
    const flush = () => {
      if (!current.length) return;
      const sorted = current.sort((a, b) => a.x - b.x);
      const text = sorted.map((item) => item.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
      const words = sorted.map((item) => ({ text: item.text, x0: item.x, x1: item.x + item.w }));
      if (text) lines.push({ text, confidence: PDF_TEXT_CONFIDENCE, words });
      current = [];
    };
    for (const item of items) {
      if (current.length && Math.abs(item.y - current[0]!.y) > 3) flush();
      current.push(item);
    }
    flush();
  }
  return lines;
}

async function pdfLines(bytes: Buffer): Promise<TextLine[]> {
  let pages: PdfPage[];
  try {
    pages = await readPdfPages(bytes);
  } catch (error) {
    const code = error instanceof PdfReadError ? error.message : 'unreadable-pdf';
    throw new ScheduleReadError(code === 'encrypted-pdf' || code === 'read-timeout' || code === 'reader-busy' ? code : 'unreadable-pdf');
  }
  const lines = pdfPagesToLines(pages);
  // PDF bez warstwy tekstowej to skan – prosimy o zdjęcie/zrzut ekranu, który przejdzie przez OCR.
  if (lines.length === 0) throw new ScheduleReadError('scanned-pdf');
  return lines;
}

type OcrVariant = { name: string; lines: TextLine[] };

/**
 * Wybiera wariant OCR, z którego odczytano najwięcej pełnych zmian (data + godziny), potem najwięcej zmian w ogóle,
 * a przy remisie – z wyższą średnią pewnością. Dzięki temu zdjęcie z telefonu i czysty zrzut ekranu dają najlepszy wynik.
 */
export function bestVariant(variants: OcrVariant[], now?: Date): RawShift[] {
  const better = (a: number[], b: number[]) => {
    const i = a.findIndex((value, index) => value !== b[index]);
    return i >= 0 && a[i]! > b[i]!;
  };
  let best: { shifts: RawShift[]; score: number[] } | null = null;
  for (const variant of variants) {
    const shifts = parseScheduleLines(variant.lines, { now });
    const complete = shifts.filter((shift) => shift.date && shift.startTime && shift.endTime).length;
    const confidence = shifts.length ? shifts.reduce((sum, shift) => sum + shift.confidence, 0) / shifts.length : 0;
    const score = [complete, shifts.length, confidence];
    if (!best || better(score, best.score)) best = { shifts, score };
  }
  return best?.shifts ?? [];
}

async function imageVariants(bytes: Buffer): Promise<OcrVariant[]> {
  const release = tryAcquireRecognition();
  if (!release) throw new ScheduleReadError('reader-busy');
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL('./ocr-worker.mjs', import.meta.url), {
      workerData: bytes, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    return await new Promise<OcrVariant[]>((resolve, reject) => {
      timer = setTimeout(() => reject(new ScheduleReadError('read-timeout')), OCR_TIMEOUT_MS);
      worker!.once('message', (message: { variants?: OcrVariant[]; error?: string }) => {
        if (message.variants) resolve(message.variants);
        else reject(new ScheduleReadError('unreadable-image'));
      });
      worker!.once('error', () => reject(new ScheduleReadError('unreadable-image')));
      worker!.once('exit', () => reject(new ScheduleReadError('unreadable-image')));
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    release();
  }
}

export type ReaderOptions = {
  /** Podgląd surowego tekstu do diagnozy (WORK_SCHEDULE_DEBUG=1). Domyślnie wyłączony – treść grafiku nie trafia do logów. */
  onText?: (source: string, lines: TextLine[]) => void;
};

export class LocalScheduleReader implements ScheduleReader {
  readonly real = true;

  constructor(private readonly options: ReaderOptions = {}) {}

  async read(file: ScheduleFile, context: ReadContext): Promise<RawShift[]> {
    if (file.type === 'PDF') {
      const lines = await pdfLines(file.bytes);
      this.options.onText?.('pdf', lines);
      return parseScheduleLines(lines, { now: context.now });
    }
    const variants = await imageVariants(file.bytes);
    for (const variant of variants) this.options.onText?.(`ocr:${variant.name}`, variant.lines);
    return bestVariant(variants, context.now);
  }
}
