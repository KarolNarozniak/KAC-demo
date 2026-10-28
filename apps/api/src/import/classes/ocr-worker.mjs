import { parentPort, workerData } from 'node:worker_threads';
import { recognizeMiniature } from './ocr.mjs';
try {
  parentPort.postMessage({ timetable: await recognizeMiniature(Buffer.from(workerData)) });
} catch (error) {
  const allowed = ['unsupported-image-layout', 'unreadable-image-dates', 'unreadable-image-times', 'empty-image-timetable'];
  parentPort.postMessage({ error: allowed.includes(error?.message) ? error.message : 'unreadable-image' });
}
