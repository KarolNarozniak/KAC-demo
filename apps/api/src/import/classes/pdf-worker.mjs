// A dedicated worker bounds CPU time and heap use for untrusted PDFs.
import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let task;
try {
  task = getDocument({ data: new Uint8Array(workerData), isEvalSupported: false,
    useSystemFonts: false, useWorkerFetch: false, enableXfa: false, stopAtErrors: true });
  const document = await task.promise;
  if (document.numPages > 10) throw new Error('too-many-pages');
  const pages = [];
  let count = 0;
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();
    count += content.items.length;
    if (count > 30000) throw new Error('too-much-text');
    const viewport = page.getViewport({ scale: 1 });
    const items = content.items.filter(item => 'str' in item && item.str.trim()).map(item => ({
      text: item.str, x: item.transform[4], y: viewport.height - item.transform[5], w: item.width,
    }));
    pages.push({ width: viewport.width, items });
    page.cleanup();
  }
  parentPort.postMessage({ pages });
} catch (error) {
  parentPort.postMessage({ error: error?.name === 'PasswordException' ? 'encrypted-pdf' : 'unreadable-pdf' });
} finally {
  await task?.destroy();
}
