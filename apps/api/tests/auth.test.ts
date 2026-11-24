// Logowanie bez bazy: zasady haseł, lista tras publicznych, kontrakt OpenAPI (bearerAuth, 401) i dzienny limit AI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { makeTestAuth, premiumTestHeaders } from './helpers/premium-auth.js';
import { isPublicRoute } from '../src/api/auth-guard.js';
import { clientAddress } from '../src/api/client-address.js';
import { parseTrustProxy } from '../src/config.js';
import { hashPassword, newRecoveryCode, newSessionToken, normalizeRecoveryCode, passwordProblem, recoveryCodeHash, sameHash, sessionTokenHash, verifyPassword }
  from '../src/auth/password.js';

test('zasady haseł: długość zamiast złożoności, odrzucone popularne, powtórzenia, ciągi klawiszy i adres e-mail', () => {
  assert.equal(passwordProblem('krotkie-11c'), 'password_too_short');
  assert.equal(passwordProblem('x'.repeat(129)), 'password_too_long');
  for (const weak of ['aaaaaaaaaaaa', 'abcabcabcabc', 'qwertyuiopas', '123456789012', 'Password1234', 'abcdefghijkl'])
    assert.equal(passwordProblem(weak), 'password_too_common', weak);
  assert.equal(passwordProblem('anna.nowak-ma-kota', 'anna.nowak@example.test'), 'password_contains_email');
  assert.equal(passwordProblem('dluga-fraza-na-wiosne', 'anna.nowak@example.test'), null);
  assert.equal(passwordProblem('zażółć gęślą jaźń'), null);
});

test('hasło: argon2id, weryfikacja i uszkodzony skrót; token sesji ma 256 bitów i jest zapisywany jako skrót', async () => {
  const stored = await hashPassword('dluga-fraza-na-wiosne');
  assert.match(stored, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword(stored, 'dluga-fraza-na-wiosne'), true);
  assert.equal(await verifyPassword(stored, 'inna-fraza-na-wiosne'), false);
  assert.equal(await verifyPassword('to-nie-jest-skrot', 'cokolwiek'), false);
  const token = newSessionToken();
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  assert.match(sessionTokenHash(token), /^[0-9a-f]{64}$/);
  assert.notEqual(sessionTokenHash(token), token);
});

test('kod odzyskiwania: 16 znaków alfabetu Crockforda w grupach po 4, wpisany dowolnie (małe litery, spacje, O zamiast 0) daje ten sam skrót', () => {
  const codes = Array.from({ length: 200 }, newRecoveryCode);
  for (const code of codes) assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.equal(new Set(codes).size, codes.length);
  // Każdy znak alfabetu się pojawia – kod korzysta z pełnych 5 bitów na znak (80 bitów razem).
  assert.equal(new Set(codes.join('').replaceAll('-', '')).size, 32);

  assert.equal(normalizeRecoveryCode(' 7f3q 9xwm-2hda\u2013k8pr '), '7F3Q9XWM2HDAK8PR');
  assert.equal(normalizeRecoveryCode('O1LI-0000-0000-0000'), '0111000000000000');
  assert.equal(normalizeRecoveryCode('UUUU-0000-0000-0000'), null);
  assert.equal(normalizeRecoveryCode('7F3Q-9XWM-2HDA'), null);
  assert.equal(normalizeRecoveryCode(''), null);

  const hash = recoveryCodeHash('7F3Q-9XWM-2HDA-K8PR');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(recoveryCodeHash('7f3q9xwm2hdak8pr'), hash);
  assert.notEqual(recoveryCodeHash('7F3Q-9XWM-2HDA-K8PS'), hash);
  assert.equal(sameHash(hash, recoveryCodeHash('7F3Q 9XWM 2HDA K8PR')), true);
  assert.equal(sameHash(hash, recoveryCodeHash('M4ZT-0QB8-XK2N-7VHD')), false);
  assert.equal(sameHash(hash, ''), false);
});

test('trasy publiczne: tylko zdrowie, dokumentacja, rejestracja, logowanie, reset hasła kodem i powroty z Google', () => {
  for (const [method, url] of [['GET', '/api/v1/health/live'], ['HEAD', '/api/v1/health/ready'], ['GET', '/api/v1/auth/config'], ['POST', '/api/v1/auth/login'],
    ['POST', '/api/v1/auth/recover'],
    ['POST', '/api/v1/auth/register'], ['GET', '/api/v1/integrations/google/callback'], ['GET', '/api/v1/import/google/callback'], ['GET', '/api/v1/docs/static/index.html']])
    assert.equal(isPublicRoute(method, url), true, `${method} ${url}`);
  for (const [method, url] of [['GET', '/api/v1/calendar/overview'], ['POST', '/api/v1/auth/logout'], ['GET', '/api/v1/auth/me'], ['DELETE', '/api/v1/auth/account'],
    ['POST', '/api/v1/integrations/google/connect'], ['POST', '/api/v1/auth/config'], ['GET', '/api/v1/assistant/conversations'], ['POST', '/api/v1/auth/recovery-code'],
    ['GET', '/api/v1/auth/recover']])
    assert.equal(isPublicRoute(method, url), false, `${method} ${url}`);
});

test('kontrakt OpenAPI: globalny bearerAuth, trasy publiczne bez wymogu sesji, każda chroniona dokumentuje 401', async () => {
  const app = buildApi(null);
  try {
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
    assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
    let protectedCount = 0;
    for (const [path, operations] of Object.entries(spec.paths) as [string, Record<string, any>][]) {
      for (const [method, operation] of Object.entries(operations)) {
        if (isPublicRoute(method.toUpperCase(), path.replace(/\{(\w+)\}/g, ':$1'))) assert.deepEqual(operation.security, [], `${method} ${path}`);
        else { assert.ok(operation.responses['401'], `${method} ${path} has no 401`); protectedCount++; }
      }
    }
    assert.ok(protectedCount > 60);
    assert.ok(spec.paths['/api/v1/auth/login'].post && spec.paths['/api/v1/auth/account'].delete);
    assert.deepEqual(spec.paths['/api/v1/auth/recover'].post.security, []);
    assert.ok(spec.paths['/api/v1/auth/recovery-code'].post.responses['401']);
    assert.ok(spec.paths['/api/v1/auth/register'].post.responses['201'].content['application/json'].schema.required.includes('recoveryCode'));
  } finally { await app.close(); }
});

test('bez usługi kont (API bez bazy) trasy logowania zwracają auth_not_configured, a reszta działa jak dotąd', async () => {
  const app = buildApi(null);
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'a@example.test', password: 'dluga-fraza-na-wiosne' } });
    assert.deepEqual([login.statusCode, login.json()], [503, { error: 'auth_not_configured' }]);
    const recover = await app.inject({ method: 'POST', url: '/api/v1/auth/recover', payload: { email: 'a@example.test', recoveryCode: '7F3Q-9XWM-2HDA-K8PR', newPassword: 'dluga-fraza-na-wiosne' } });
    assert.deepEqual([recover.statusCode, recover.json()], [503, { error: 'auth_not_configured' }]);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/health/live' })).statusCode, 200);
  } finally { await app.close(); }
});

test('limit logowania liczy adres klienta za serwerem pośredniczącym (Azure): X-Forwarded-For z portem, osobne liczniki dla różnych adresów', async () => {
  assert.deepEqual(['203.0.113.5:51234', '[2001:db8::1]:443', '2001:db8::1', '10.0.0.7', '', undefined].map(clientAddress),
    ['203.0.113.5', '2001:db8::1', '2001:db8::1', '10.0.0.7', 'unknown', 'unknown']);
  assert.deepEqual([parseTrustProxy(undefined, true), parseTrustProxy(undefined, false), parseTrustProxy('2', false), parseTrustProxy('false', true), parseTrustProxy('abc', true)],
    [1, false, 2, false, 1]);
  const app = buildApi(null, [], { trustProxy: 1, authRateLimits: { loginPerMinute: 2 } });
  const attempt = (forwardedFor: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-forwarded-for': forwardedFor },
    payload: { email: 'a@example.test', password: 'dluga-fraza-na-wiosne' } });
  try {
    // Ten sam klient z różnymi portami źródłowymi – jeden licznik.
    assert.deepEqual([(await attempt('198.51.100.1:40001')).statusCode, (await attempt('198.51.100.1:40002')).statusCode], [503, 503]);
    const limited = await attempt('198.51.100.1:40003');
    assert.deepEqual([limited.statusCode, limited.json()], [429, { error: 'too_many_attempts' }]);
    // Inny klient za tym samym serwerem pośredniczącym ma własny licznik.
    assert.equal((await attempt('198.51.100.2:40001')).statusCode, 503);
  } finally { await app.close(); }
});

test('dzienny limit AI: po wyczerpaniu 429 ai_daily_limit przed wywołaniem Azure; lokalny odczyt załącznika nie jest liczony', async () => {
  const counted: string[] = [];
  const aiRepository = { countRecentUsage: async (userId: string) => { counted.push(userId); return 5; } } as never;
  const app = buildApi(null, [], { auth: makeTestAuth({ sessionId: 'session', scope: { userId: 'U001', calendarId: 'K001' }, isPremium: true, premiumExpiresAt: '2035-01-01T00:00:00.000Z' }), aiRepository, aiDailyLimit: 5 });
  try {
    const read = await app.inject({ method: 'POST', url: '/api/v1/import/ai/read', headers: premiumTestHeaders, payload: { fileName: 'plan.pdf', dataBase64: 'JVBERi0=', source: 'classes' } });
    assert.deepEqual([read.statusCode, read.json()], [429, { error: 'ai_daily_limit' }]);
    assert.deepEqual(counted, ['U001']);
    const local = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/c1/attachments',
      headers: premiumTestHeaders, payload: { fileName: 'plan.pdf', dataBase64: 'JVBERi0=', source: 'classes', reader: 'local' } });
    assert.notEqual(local.statusCode, 429);
    const spec = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })).json();
    assert.ok(spec.paths['/api/v1/import/ai/read'].post.responses['429'].content['application/json'].examples.ai_daily_limit);
  } finally { await app.close(); }
  const unlimited = buildApi(null, [], { auth: makeTestAuth({ sessionId: 'session', scope: { userId: 'U001', calendarId: 'K001' }, isPremium: true, premiumExpiresAt: '2035-01-01T00:00:00.000Z' }), aiRepository: { countRecentUsage: async () => 999 } as never, aiDailyLimit: 0 });
  try {
    const read = await unlimited.inject({ method: 'POST', url: '/api/v1/import/ai/read', headers: premiumTestHeaders, payload: { fileName: 'plan.pdf', dataBase64: 'JVBERi0=', source: 'classes' } });
    assert.notEqual(read.statusCode, 429);
  } finally { await unlimited.close(); }
});
