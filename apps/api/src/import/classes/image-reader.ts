import { Worker } from 'node:worker_threads';
import { PdfReadError } from './reader.js';
import type { Timetable } from './wat.js';

let active = false;
/** One local OCR worker at a time, no upload persistence or model downloads. */
export async function readClassImage(bytes: Buffer): Promise<Timetable> {
  if (active) throw new PdfReadError('reader-busy');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new PdfReadError('file-too-large');
  active = true;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = new Worker(new URL('./ocr-worker.mjs', import.meta.url), {
      workerData: bytes, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    return await new Promise<Timetable>((resolve, reject) => {
      timer = setTimeout(() => reject(new PdfReadError('read-timeout')), 60000);
      worker!.once('message', (message: { timetable?: Timetable; error?: string }) => {
        if (message.timetable) resolve(message.timetable);
        else reject(new PdfReadError(message.error ?? 'unreadable-image'));
      });
      worker!.once('error', () => reject(new PdfReadError('unreadable-image')));
      worker!.once('exit', () => reject(new PdfReadError('unreadable-image')));
    });
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    active = false;
  }
}
