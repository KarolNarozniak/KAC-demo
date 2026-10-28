import assert from 'node:assert/strict';
import test from 'node:test';
import { readPickedTimetable } from '../src/services/readPickedTimetable.ts';

test('provider files are read without deleting the original; actual size comes from content', async () => {
  let deleted = false;
  const original = { name: 'plan.pdf', size: 99, base64: async () => 'UERG', delete: () => { deleted = true; } };
  assert.deepEqual(await readPickedTimetable(original), { name: 'plan.pdf', size: 3, base64: 'UERG' });
  assert.equal(deleted, false);
});

test('oversized files are rejected before reading and temporary copies are cleaned up', async () => {
  let read = false, cleaned = false;
  await assert.rejects(readPickedTimetable({ name: 'large.png', size: 6 * 1024 * 1024,
    base64: async () => { read = true; return ''; } }, () => { cleaned = true; }), /5 MB/);
  assert.equal(read, false);
  assert.equal(cleaned, true);
});

test('cleanup failure preserves the original read error', async () => {
  const permissionError = new Error('Missing Read Permission');
  await assert.rejects(readPickedTimetable({ name: 'plan.pdf', size: 3,
    base64: async () => { throw permissionError; } }, () => { throw new Error('cleanup'); }), error => error === permissionError);
});

test('malformed or oversized encoded content is rejected even with a small reported size', async () => {
  for (const encoded of ['', '@@@@', 'A'.repeat(4 * Math.ceil(6 * 1024 * 1024 / 3))]) {
    await assert.rejects(readPickedTimetable({ name: 'plan.png', size: 1, base64: async () => encoded }));
  }
});
