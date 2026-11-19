// Żądania bez treści zmienione przez serwer pośredniczący (Azure App Service) na „Transfer-Encoding: chunked” bez Content-Type
// nie mogą kończyć się 415 – np. „Odłącz konto Google” (DELETE bez treści).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';

test('pusta treść bez Content-Type (chunked od serwera pośredniczącego) działa jak brak treści; niepusta nadal 415', async () => {
  const app = buildApi(null);
  try {
    const chunked = { 'transfer-encoding': 'chunked' };
    const disconnect = await app.inject({ method: 'DELETE', url: '/api/v1/integrations/google', headers: chunked, payload: '' });
    assert.notEqual(disconnect.statusCode, 415, disconnect.body);
    const plain = await app.inject({ method: 'DELETE', url: '/api/v1/integrations/google' });
    assert.equal(disconnect.statusCode, plain.statusCode);

    const withBody = await app.inject({ method: 'DELETE', url: '/api/v1/integrations/google', payload: Buffer.from('{"a":1}') });
    assert.deepEqual([withBody.statusCode, withBody.json().error], [415, 'Unsupported Media Type']);
    const form = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a' });
    assert.equal(form.statusCode, 415);
    // JSON działa jak dotąd.
    const json = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@example.test', password: 'dluga-fraza-na-wiosne' } });
    assert.deepEqual([json.statusCode, json.json()], [503, { error: 'auth_not_configured' }]);
  } finally { await app.close(); }
});
