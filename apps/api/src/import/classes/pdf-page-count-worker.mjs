import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let task;
try {
  task = getDocument({ data: new Uint8Array(workerData.bytes), isEvalSupported: false, useSystemFonts: false, useWorkerFetch: false, enableXfa: false, stopAtErrors: true });
  const document = await task.promise;
  if (document.numPages > workerData.maximumPages) throw new Error('too-many-pages');
  parentPort.postMessage({ pageCount: document.numPages });
} catch (error) {
  const code = error?.name === 'PasswordException' ? 'encrypted-pdf' : error?.message === 'too-many-pages' ? 'too-many-pages' : 'unreadable-pdf';
  parentPort.postMessage({ error: code });
} finally {
  await task?.destroy();
}
