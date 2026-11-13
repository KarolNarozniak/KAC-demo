import { Worker } from 'node:worker_threads';
import { parseWatTimetable, type PdfPage, type Timetable } from './wat.js';

export class PdfReadError extends Error {}
let activeReaders = 0;

/** No URL input, OCR, external service or file persistence. Always release the worker. */
export async function readClassPdf(bytes: Buffer): Promise<Timetable> {
  return parseWatTimetable(await readPdfPages(bytes));
}

/** Text items of a PDF read in an isolated worker. Shared with the work-schedule import (S23KC2S1P2-44). */
export async function readPdfPages(bytes: Buffer): Promise<PdfPage[]> {
  if (activeReaders >= 2) throw new PdfReadError('reader-busy');
  activeReaders++;
  try {
    return await new Promise<PdfPage[]>((resolve, reject) => {
      const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), {
        workerData: bytes, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      });
      let settled = false;
      const finish = (error?: Error, pages?: PdfPage[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error); else resolve(pages!);
      };
      const timer = setTimeout(() => finish(new PdfReadError('read-timeout')), 15000);
      worker.once('message', (message: { pages?: PdfPage[]; error?: string }) => {
        if (message.pages) finish(undefined, message.pages);
        else finish(new PdfReadError(message.error ?? 'unreadable-pdf'));
      });
      worker.once('error', () => finish(new PdfReadError('unreadable-pdf')));
      worker.once('exit', () => finish(new PdfReadError('unreadable-pdf')));
    });
  } finally { activeReaders--; }
}

/** Reads page count only, without extracting text or persisting the document. */
export async function countPdfPages(bytes: Buffer, maximumPages = 10): Promise<number> {
  if (activeReaders >= 2) throw new PdfReadError('reader-busy');
  activeReaders++;
  try {
    return await new Promise<number>((resolve, reject) => {
      const worker = new Worker(new URL('./pdf-page-count-worker.mjs', import.meta.url), {
        workerData: { bytes, maximumPages }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      });
      let settled = false;
      const finish = (error?: Error, pageCount?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error); else resolve(pageCount!);
      };
      const timer = setTimeout(() => finish(new PdfReadError('read-timeout')), 15_000);
      worker.once('message', (message: { pageCount?: number; error?: string }) => {
        if (message.pageCount !== undefined) finish(undefined, message.pageCount);
        else finish(new PdfReadError(message.error ?? 'unreadable-pdf'));
      });
      worker.once('error', () => finish(new PdfReadError('unreadable-pdf')));
      worker.once('exit', () => finish(new PdfReadError('unreadable-pdf')));
    });
  } finally { activeReaders--; }
}
