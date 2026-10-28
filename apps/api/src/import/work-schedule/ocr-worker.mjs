// Osobny wątek dla OCR grafiku: ogranicza pamięć i pozwala przerwać zbyt długi odczyt.
import { parentPort, workerData } from 'node:worker_threads';
import { recognizeScheduleLines } from './ocr.mjs';

try {
  parentPort.postMessage({ variants: await recognizeScheduleLines(Buffer.from(workerData)) });
} catch (error) {
  parentPort.postMessage({ error: 'unreadable-image' });
}
