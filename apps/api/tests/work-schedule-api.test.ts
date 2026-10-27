import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type DemoRepository } from '../src/app.js';
import type { ScheduleReader } from '../src/import/work-schedule/reader.js';
import type { ConfirmResult } from '../src/import/session.js';
import { jpgBytes, pdfBytes, toBase64 } from './fixtures.js';

const okResult: ConfirmResult = { kind: 'ok', saved: [], summary: { added: 0, replaced: 0, skipped: 0, rejected: 0 } };

function fakeRepository(confirm: () => Promise<ConfirmResult> = async () => okResult) {
  const calls = { sessions: 0, cancelled: [] as string[] };
  const repository: DemoRepository = {
    checkConnection: async () => {},
    getOverview: async () => null,
    getImportUserName: async () => 'Student Demo',
    listEventsForImport: async () => [{ id: 'E002', title: 'Praca', start: new Date('2026-02-23T15:00:00Z') }],
    createImportSession: async () => {
      calls.sessions += 1;
      return { id: 'IMP-44', expiresAt: new Date('2026-10-27T21:00:00Z') };
    },
    touchImportSession: async () => {},
    confirmImportSession: confirm,
    cancelImportSession: async (id) => {
      calls.cancelled.push(id);
      return id === 'IMP-44';
    },
  };
  return { repository, calls };
}

const read = (app: ReturnType<typeof buildApi>, fileName: string, bytes: Buffer) =>
  app.inject({ method: 'POST', url: '/api/import/work-schedule/read', payload: { fileName, dataBase64: toBase64(bytes) } });

test('wczytanie grafiku: sesja, wynik odczytu, własne zmiany i duplikat z kalendarza (201)', async () => {
  const { repository, calls } = fakeRepository();
  const app = buildApi(repository);
  try {
    const response = await read(app, 'grafik.pdf', pdfBytes());
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.importSessionId, 'IMP-44');
    assert.equal(body.fileType, 'PDF');
    assert.equal(body.readStatus, 'partial'); // przykładowy grafik ma jedną niepełną zmianę
    assert.equal(body.readStatusLabel, 'Odczytano część zmian');
    assert.equal(body.readerIsDemo, true);
    assert.ok(body.rows.some((row: { isOwn: boolean }) => !row.isOwn));
    assert.ok(body.preview.some((row: { overnight: boolean }) => row.overnight));
    assert.ok(body.preview.some((row: { duplicateOfEvents: unknown[] }) => row.duplicateOfEvents.length > 0));
    assert.equal(calls.sessions, 1);
  } finally {
    await app.close();
  }
});

test('zły plik: 422 z powodem i bez zakładania sesji (4a)', async () => {
  const { repository, calls } = fakeRepository();
  const app = buildApi(repository);
  try {
    const response = await read(app, 'grafik.jpg', Buffer.from('GIF89a', 'latin1'));
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, 'unsupported-format');
    assert.equal(calls.sessions, 0);
  } finally {
    await app.close();
  }
});

test('nic nie odczytano: 422 „Nie odczytano zmian” (4b)', async () => {
  const empty: ScheduleReader = { real: true, read: async () => [] };
  const app = buildApi(fakeRepository().repository, [], { scheduleReader: empty });
  try {
    const response = await read(app, 'grafik.jpg', jpgBytes());
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, 'nothing_recognized');
  } finally {
    await app.close();
  }
});

test('bez bazy danych import grafiku jest niedostępny (503)', async () => {
  const app = buildApi(null);
  try {
    assert.equal((await read(app, 'grafik.pdf', pdfBytes())).statusCode, 503);
  } finally {
    await app.close();
  }
});

const night = { id: 'z3', title: 'Praca', date: '2026-11-04', startTime: '22:00', endTime: '06:00', category: 'Work' as const };
const confirm = (app: ReturnType<typeof buildApi>, rows: unknown[]) =>
  app.inject({ method: 'POST', url: '/api/import/sessions/IMP-44/confirm', payload: { rows } });

test('niepotwierdzona zmiana nocna blokuje zapis (422)', async () => {
  const app = buildApi(fakeRepository().repository);
  try {
    const response = await confirm(app, [night]);
    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.json(), { error: 'overnight_not_confirmed', rowIds: ['z3'] });
    assert.equal((await confirm(app, [{ ...night, overnightConfirmed: true }])).statusCode, 201);
  } finally {
    await app.close();
  }
});

test('brak decyzji dla duplikatu: 422 z listą wierszy (6b)', async () => {
  const app = buildApi(fakeRepository(async () => ({ kind: 'needs-decision', missingDecisions: ['z6'], invalidDecisions: [] })).repository);
  try {
    const response = await confirm(app, [{ ...night, overnightConfirmed: true }]);
    assert.equal(response.statusCode, 422);
    assert.deepEqual(response.json().missingDecisions, ['z6']);
  } finally {
    await app.close();
  }
});

test('błąd zapisu: 503 i możliwość ponowienia (6c)', async () => {
  let attempts = 0;
  const flaky = async (): Promise<ConfirmResult> => {
    attempts += 1;
    if (attempts === 1) throw new Error('chwilowa awaria bazy');
    return okResult;
  };
  const app = buildApi(fakeRepository(flaky).repository);
  try {
    const row = { ...night, overnightConfirmed: true };
    assert.equal((await confirm(app, [row])).statusCode, 503);
    assert.equal((await confirm(app, [row])).statusCode, 201);
  } finally {
    await app.close();
  }
});

test('anulowanie importu (5a)', async () => {
  const { repository, calls } = fakeRepository();
  const app = buildApi(repository);
  try {
    const ok = await app.inject({ method: 'POST', url: '/api/import/sessions/IMP-44/cancel' });
    assert.equal(ok.statusCode, 200);
    const again = await app.inject({ method: 'POST', url: '/api/import/sessions/INNY/cancel' });
    assert.equal(again.statusCode, 409);
    assert.deepEqual(calls.cancelled, ['IMP-44', 'INNY']);
  } finally {
    await app.close();
  }
});
