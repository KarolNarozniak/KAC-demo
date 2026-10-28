import { Worker } from 'node:worker_threads';
import { parseWatTimetable, type PdfPage, type Timetable } from './wat.js';

export class PdfReadError extends Error {}
let activeReaders = 0;

/** No URL input, OCR, external service or file persistence. Always release the worker. */
export async function readClassPdf(bytes: Buffer): Promise<Timetable> {
  if (activeReaders >= 2) throw new PdfReadError('reader-busy');
  activeReaders++;
  try {
    const pages = await new Promise<PdfPage[]>((resolve, reject) => {
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
    return parseWatTimetable(pages);
  } finally { activeReaders--; }
}
