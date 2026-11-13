import assert from 'node:assert/strict';
import test from 'node:test';
import { readAiClassSchedule } from '../src/services/importApi.ts';

test('cancelling the file-read request aborts the upload fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  const controller = new AbortController();
  let uploadSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    uploadSignal = init?.signal;
    uploadSignal?.addEventListener('abort', () => reject(uploadSignal?.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    const request = readAiClassSchedule('synthetic.png', 'c3ludGhldGlj', controller.signal);
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(uploadSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
  }
});
