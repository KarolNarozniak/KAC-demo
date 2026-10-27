import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi, type DemoRepository } from '../src/app.js';
import type { AcceptedRow, ConfirmResult } from '../src/import/session.js';

// Atrapa bazy danych: zapamiętuje, co API próbowało zapisać.
function fakeRepository(result: ConfirmResult = { kind: 'ok', saved: [], summary: { added: 0, replaced: 0, skipped: 0, rejected: 0 } }) {
  const calls: { confirmed: AcceptedRow[][]; touched: string[] } = { confirmed: [], touched: [] };
  const repository: DemoRepository = {
    checkConnection: async () => {},
    getOverview: async () => null,
    createImportSession: async () => ({ id: 'IMP-TEST', expiresAt: new Date('2026-10-24T18:15:00Z') }),
    touchImportSession: async (id) => {
      calls.touched.push(id);
    },
    confirmImportSession: async (_id, rows) => {
      calls.confirmed.push(rows);
      return result;
    },
  };
  return { repository, calls };
}

const classRow = { id: 'p1', title: 'Warsztaty baz danych', date: '2026-10-22', startTime: '13:00', endTime: '15:00', category: 'Class' as const, location: 'Pracownia 3', confidence: 0.9 };

test('podgląd sprawdza wiersze bez bazy danych i niczego nie zapisuje', async () => {
  const app = buildApi(null);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/preview', payload: { rows: [classRow, { ...classRow, id: 'p2', endTime: '12:00' }] } });
    assert.equal(response.statusCode, 200);
    const [first, second] = response.json().rows;
    assert.equal(first.status, 'ok');
    assert.equal(first.location, 'Pracownia 3');
    assert.deepEqual(second.issues, ['end-not-after-start']);
  } finally {
    await app.close();
  }
});

test('podgląd z identyfikatorem sesji przedłuża sesję', async () => {
  const { repository, calls } = fakeRepository();
  const app = buildApi(repository);
  try {
    await app.inject({ method: 'POST', url: '/api/import/preview', payload: { rows: [classRow], importSessionId: 'IMP-TEST' } });
    assert.deepEqual(calls.touched, ['IMP-TEST']);
  } finally {
    await app.close();
  }
});

test('podgląd odrzuca niepoprawne żądanie (400)', async () => {
  const app = buildApi(null);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/preview', payload: { rows: [{ id: 'x', title: 'a'.repeat(500) }] } });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('utworzenie sesji zwraca identyfikator i podgląd (201)', async () => {
  const app = buildApi(fakeRepository().repository);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/sessions', payload: { source: 'classes', format: 'PDF', rows: [classRow] } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().importSessionId, 'IMP-TEST');
    assert.equal(response.json().rows[0].confidence, 0.9);
  } finally {
    await app.close();
  }
});

test('bez bazy danych sesji nie da się utworzyć (503), więc ekran wraca do trybu lokalnego', async () => {
  const app = buildApi(null);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/sessions', payload: { source: 'classes', format: 'PDF', rows: [classRow] } });
    assert.equal(response.statusCode, 503);
  } finally {
    await app.close();
  }
});

test('zatwierdzenie z błędnym wierszem jest odrzucane (422) i nic nie trafia do bazy', async () => {
  const { repository, calls } = fakeRepository();
  const app = buildApi(repository);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/sessions/IMP-TEST/confirm', payload: { rows: [classRow, { ...classRow, id: 'p2', title: '' }] } });
    assert.equal(response.statusCode, 422);
    assert.equal(calls.confirmed.length, 0);
  } finally {
    await app.close();
  }
});

test('zatwierdzenie przekazuje do zapisu termin, kategorię i miejsce (201)', async () => {
  const saved = [{ id: 'E-NEW', rowId: 'p1', action: 'added' as const, title: 'Warsztaty baz danych', start: '2026-10-22T11:00:00.000Z', end: '2026-10-22T13:00:00.000Z', category: 'Class' as const, location: 'Pracownia 3' }];
  const summary = { added: 1, replaced: 0, skipped: 0, rejected: 1 };
  const { repository, calls } = fakeRepository({ kind: 'ok', saved, summary });
  const app = buildApi(repository);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/import/sessions/IMP-TEST/confirm', payload: { rows: [classRow] } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), { saved: 1, rejected: 1, summary, events: saved });
    const row = calls.confirmed[0]?.[0];
    assert.equal(row?.category, 'Class');
    assert.equal(row?.location, 'Pracownia 3');
    assert.equal(row?.start.toISOString(), '2026-10-22T11:00:00.000Z');
  } finally {
    await app.close();
  }
});

test('wygasła sesja zwraca 410, zamknięta 409, nieznana 404', async () => {
  for (const [kind, status] of [['expired', 410], ['closed', 409], ['not-found', 404]] as const) {
    const app = buildApi(fakeRepository({ kind }).repository);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/import/sessions/IMP-TEST/confirm', payload: { rows: [classRow] } });
      assert.equal(response.statusCode, status);
    } finally {
      await app.close();
    }
  }
});
