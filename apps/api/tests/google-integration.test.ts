// Trwałe połączenie z Google (S23KC2S1P2-12, G01 / S23KC2S1P2-284) bez bazy danych:
// szyfrowanie tokenów, adres zgody, wymiana kodu, odświeżanie (jedno naraz), lista kalendarzy, konta makiety i logi bez kodu OAuth.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import { redactUrl } from '../src/api/log-redaction.js';
import { demoIntegrationCalendars, isDemoAccount } from '../src/integrations/google/demo.js';
import {
  accessFromScopes, exchangeIntegrationCode, GoogleIntegrationError, integrationAuthorizationUrl, listIntegrationCalendars, refreshAccessToken,
} from '../src/integrations/google/oauth-client.js';
import type { GoogleAccountRecord, StoredTokens } from '../src/integrations/google/repository.js';
import { GoogleIntegrationService, IntegrationFlowError } from '../src/integrations/google/service.js';
import { TokenCipher, TokenKeyError } from '../src/integrations/google/token-cipher.js';
import { GoogleTokenService } from '../src/integrations/google/token-service.js';
import { EVENTS_SCOPE, FakeGoogle, FULL_GRANT, idToken, OAUTH, READ_SCOPE } from './google-integration-fakes.js';

const rejects = (code: string) => (error: unknown) => (error instanceof GoogleIntegrationError || error instanceof TokenKeyError || error instanceof IntegrationFlowError) && error.code === code;

test('szyfrowanie tokenów: AES-GCM z danymi konta, inny klucz i podmiana wiersza są wykrywane', () => {
  const cipher = new TokenCipher(randomBytes(32));
  const sealed = cipher.encrypt('1//refresh-secret', 'A1:refresh');
  assert.match(sealed, /^v1\.[0-9a-f]{12}\./);
  assert.ok(!sealed.includes('refresh-secret'));
  assert.notEqual(cipher.encrypt('1//refresh-secret', 'A1:refresh'), sealed, 'losowy IV – ten sam token daje inny szyfrogram');
  assert.equal(cipher.decrypt(sealed, 'A1:refresh'), '1//refresh-secret');
  // Szyfrogram przeniesiony do innego konta albo pola nie daje się odszyfrować.
  assert.throws(() => cipher.decrypt(sealed, 'A2:refresh'), rejects('token_corrupted'));
  assert.throws(() => cipher.decrypt(sealed, 'A1:access'), rejects('token_corrupted'));
  assert.throws(() => new TokenCipher(randomBytes(32)).decrypt(sealed, 'A1:refresh'), rejects('token_key_mismatch'));
  const [version, keyId, iv, tag, data] = sealed.split('.');
  const flipped = Buffer.from(data!, 'base64url');
  flipped[0] = flipped[0]! ^ 1;
  assert.throws(() => cipher.decrypt([version, keyId, iv, tag, flipped.toString('base64url')].join('.'), 'A1:refresh'), rejects('token_corrupted'));
  assert.throws(() => cipher.decrypt('jawny-token', 'A1:refresh'), rejects('token_corrupted'));
});

test('klucz szyfrowania z konfiguracji: brak klucza, zła długość i poprawny klucz', () => {
  assert.equal(TokenCipher.fromBase64(''), null);
  assert.equal(TokenCipher.fromBase64(undefined), null);
  assert.throws(() => TokenCipher.fromBase64(Buffer.from('za-krotki').toString('base64')), rejects('token_key_invalid'));
  assert.ok(TokenCipher.fromBase64(randomBytes(32).toString('base64')) instanceof TokenCipher);
});

test('dostęp z realnie przyznanych zakresów, a nie z tych, o które prosiliśmy', () => {
  assert.deepEqual(accessFromScopes(['openid', 'email', READ_SCOPE, EVENTS_SCOPE]), { calendarsRead: true, eventsWrite: true });
  assert.deepEqual(accessFromScopes(['openid', 'email', READ_SCOPE]), { calendarsRead: true, eventsWrite: false });
  assert.deepEqual(accessFromScopes(['openid', EVENTS_SCOPE]), { calendarsRead: false, eventsWrite: true });
  assert.deepEqual(accessFromScopes(['https://www.googleapis.com/auth/calendar']), { calendarsRead: true, eventsWrite: true });
  assert.deepEqual(accessFromScopes([]), { calendarsRead: false, eventsWrite: false });
});

test('adres zgody: dostęp offline, PKCE S256, wybór konta i podpowiedź konta tylko przy ponownym logowaniu', () => {
  const url = new URL(integrationAuthorizationUrl(OAUTH, 'state-123', 'challenge-abc'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-abc');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('redirect_uri'), OAUTH.redirectUri);
  assert.deepEqual(url.searchParams.get('prompt')!.split(' ').sort(), ['consent', 'select_account']);
  assert.deepEqual(url.searchParams.get('scope')!.split(' '), ['openid', 'email', READ_SCOPE, EVENTS_SCOPE]);
  assert.equal(url.searchParams.get('login_hint'), null);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(new URL(integrationAuthorizationUrl(OAUTH, 's', 'c', 'student@example.test')).searchParams.get('login_hint'), 'student@example.test');
});

test('wymiana kodu: tożsamość z id_token, kod jednorazowy, błędy Google rozróżnione', async () => {
  const google = new FakeGoogle();
  google.grantCode('code-1', { sub: 'sub-1', email: 'student@example.test', refreshToken: '1//r1', accessToken: 'ya29.a1', scope: `openid email ${READ_SCOPE}` });
  const identity = await exchangeIntegrationCode(OAUTH, 'code-1', 'verifier-1', google.fetch);
  assert.deepEqual([identity.sub, identity.email, identity.refreshToken, identity.accessToken], ['sub-1', 'student@example.test', '1//r1', 'ya29.a1']);
  assert.deepEqual(identity.grantedScopes, ['openid', 'email', READ_SCOPE]);
  assert.ok(identity.expiresAt.getTime() > Date.now());
  const sent = google.tokenRequests[0]!;
  assert.deepEqual([sent.get('grant_type'), sent.get('code_verifier'), sent.get('redirect_uri')], ['authorization_code', 'verifier-1', OAUTH.redirectUri]);
  // Ten sam kod drugi raz (np. odświeżona strona powrotu) – Google go odrzuca.
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-1', 'verifier-1', google.fetch), rejects('authorization_code_invalid'));
  google.failCode('code-500', { status: 503, body: { error: 'backendError' } });
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-500', 'v', google.fetch), rejects('google_unavailable'));
  google.failCode('code-429', { status: 429, body: { error: 'rate_limit_exceeded' } });
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-429', 'v', google.fetch), rejects('rate_limited'));
  google.failCode('code-no-id', { body: { access_token: 'ya29.x', expires_in: 3600, scope: FULL_GRANT, refresh_token: '1//x' } });
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-no-id', 'v', google.fetch), rejects('missing_account_identity'));
  google.grantCode('code-unverified', { sub: 'sub-2', email: 'x@example.test', emailVerified: false });
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-unverified', 'v', google.fetch), rejects('missing_account_identity'));
  // id_token wystawiony dla innej aplikacji (inny odbiorca) nie potwierdza tożsamości.
  google.grantCode('code-other-client', { sub: 'sub-3', email: 'y@example.test', audience: 'inna-aplikacja.apps.googleusercontent.com' });
  await assert.rejects(exchangeIntegrationCode(OAUTH, 'code-other-client', 'v', google.fetch), rejects('missing_account_identity'));
  // Brak internetu (2a) albo przekroczony czas: błąd przejściowy.
  const offline = await exchangeIntegrationCode(OAUTH, 'c', 'v', async () => { throw new TypeError('fetch failed'); }).catch((error) => error);
  assert.ok(offline instanceof GoogleIntegrationError && offline.code === 'network_error' && offline.transient);
  assert.equal(idToken({ sub: 'x' }).split('.').length, 3);
});

test('odświeżenie tokenu: invalid_grant oznacza ponowne logowanie, brak refresh_token w odpowiedzi jest dozwolony', async () => {
  const google = new FakeGoogle();
  const grant = await refreshAccessToken(OAUTH, '1//r1', google.fetch);
  assert.match(grant.accessToken, /^ya29\./);
  assert.equal(grant.refreshToken, null);
  google.refresh = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
  const revoked = await refreshAccessToken(OAUTH, '1//r1', google.fetch).catch((error) => error);
  assert.ok(revoked instanceof GoogleIntegrationError && revoked.code === 'reconnect_required' && !revoked.transient);
  google.refresh = () => ({ status: 400, body: { error: 'invalid_client' } });
  await assert.rejects(refreshAccessToken(OAUTH, '1//r1', google.fetch), rejects('google_error'));
});

test('lista kalendarzy: wszystkie strony, rola dostępu, limit stron i kody błędów Calendar API', async () => {
  const google = new FakeGoogle();
  google.calendarPages = [
    [{ id: 'primary', summary: 'Student', primary: true, accessRole: 'owner', timeZone: 'Europe/Warsaw' }, { id: 'x', deleted: true, summary: 'Usunięty' }],
    [{ id: 'praca', summary: 'Praca', summaryOverride: 'Grafik pracy', accessRole: 'writer' }],
    [{ id: 'kolo', summary: 'Koło', accessRole: 'reader', timeZone: 'Europe/Warsaw' }, { id: 'zajety', summary: 'Zajętość', accessRole: 'freeBusyReader' }],
  ];
  const all = await listIntegrationCalendars('ya29.t', google.fetch);
  assert.equal(all.complete, true);
  assert.deepEqual(all.calendars.map((calendar) => [calendar.id, calendar.name, calendar.accessRole, calendar.primary]), [
    ['primary', 'Student', 'owner', true], ['praca', 'Grafik pracy', 'writer', false], ['kolo', 'Koło', 'reader', false], ['zajety', 'Zajętość', 'freeBusyReader', false],
  ]);
  assert.equal(all.calendars[1]!.timeZone, null);
  const capped = await listIntegrationCalendars('ya29.t', google.fetch, 2);
  assert.deepEqual([capped.complete, capped.calendars.length], [false, 2]);
  google.calendarPages = [[]];
  assert.deepEqual(await listIntegrationCalendars('ya29.t', google.fetch), { calendars: [], complete: true });

  const failing = (status: number, body: Record<string, unknown>) => { google.calendarFailure = { status, body }; return listIntegrationCalendars('ya29.t', google.fetch); };
  await assert.rejects(failing(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }), rejects('rate_limited'));
  await assert.rejects(failing(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }), rejects('insufficient_permissions'));
  await assert.rejects(failing(429, {}), rejects('rate_limited'));
  await assert.rejects(failing(500, {}), rejects('google_unavailable'));
  // Calendar API wyłączone w projekcie – błąd konfiguracji, nie „brak uprawnień” użytkownika.
  await assert.rejects(failing(403, { error: { code: 403, status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } }), rejects('api_not_enabled'));
  await assert.rejects(listIntegrationCalendars('ya29.t', async () => { throw new TypeError('fetch failed'); }), rejects('network_error'));
  google.calendarFailure = null;
  google.rejectedAccessTokens.add('ya29.old');
  await assert.rejects(listIntegrationCalendars('ya29.old', google.fetch), rejects('reconnect_required'));
});

test('konta makiety: dwa konta do wyboru, drugie bez kalendarzy (7a)', () => {
  assert.equal(isDemoAccount('student.kac.demo@gmail.com'), true);
  assert.equal(isDemoAccount('ktos@example.com'), false);
  assert.deepEqual(demoIntegrationCalendars('student.kac.demo@gmail.com').map((calendar) => calendar.accessRole), ['owner', 'writer', 'reader', 'reader']);
  assert.deepEqual(demoIntegrationCalendars('praca.kac.demo@gmail.com'), []);
  // Kopia – zmiana wyniku nie psuje danych makiety.
  demoIntegrationCalendars('student.kac.demo@gmail.com')[0]!.name = 'zmienione';
  assert.notEqual(demoIntegrationCalendars('student.kac.demo@gmail.com')[0]!.name, 'zmienione');
});

/** Repozytorium tokenów w pamięci z blokadą „jak w bazie”: prace na tym samym koncie wykonują się po kolei. */
function memoryTokens(cipher: TokenCipher, account: GoogleAccountRecord, tokens: { refresh: string | null; access?: string; expiresAt?: Date }) {
  let row: StoredTokens = {
    accountId: account.accountId, generation: account.generation, keyId: cipher.keyId,
    refreshEnc: tokens.refresh ? cipher.encrypt(tokens.refresh, `${account.accountId}:refresh`) : null,
    accessEnc: tokens.access ? cipher.encrypt(tokens.access, `${account.accountId}:access`) : null,
    accessExpiresAt: tokens.expiresAt ?? null,
  };
  let queue: Promise<unknown> = Promise.resolve();
  const state = { row: () => row, reconnectMarks: 0, connected: true };
  const repository = {
    withTokenLock: <T>(target: Pick<GoogleAccountRecord, 'accountId' | 'generation'>, work: (tokens: StoredTokens) => Promise<{ result: T; update?: Partial<StoredTokens> }>) => {
      const run = queue.then(async () => {
        if (!state.connected || target.generation !== row.generation) return null;
        const outcome = await work({ ...row });
        if (outcome.update) row = { ...row, ...outcome.update };
        return outcome.result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    markReconnectRequired: async () => { state.reconnectMarks++; },
  };
  return { repository, state };
}

const ACCOUNT: GoogleAccountRecord = {
  accountId: 'A1', userId: 'U1', email: 'student@example.test', sub: 'sub-1', mode: 'google', status: 'connected',
  grantedScopes: FULL_GRANT.split(' '), generation: 3, connectedAt: null, lastSyncAt: null,
};

test('token dostępu: ważny jest używany ponownie, wygasły odświeżany raz mimo równoległych żądań (także z dwóch procesów)', async () => {
  const cipher = new TokenCipher(randomBytes(32));
  const google = new FakeGoogle();
  const valid = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1', access: 'ya29.valid', expiresAt: new Date(Date.now() + 10 * 60_000) });
  assert.equal(await new GoogleTokenService(valid.repository, cipher, OAUTH, google.fetch).accessToken(ACCOUNT), 'ya29.valid');
  assert.equal(google.tokenRequests.length, 0);

  // Token ważny jeszcze 30 s – z marginesem 60 s traktujemy go jak wygasły.
  const expiring = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1', access: 'ya29.old', expiresAt: new Date(Date.now() + 30_000) });
  google.delayMs = 20;
  const first = new GoogleTokenService(expiring.repository, cipher, OAUTH, google.fetch);
  const second = new GoogleTokenService(expiring.repository, cipher, OAUTH, google.fetch);
  const tokens = await Promise.all([first.accessToken(ACCOUNT), first.accessToken(ACCOUNT), second.accessToken(ACCOUNT), second.accessToken(ACCOUNT)]);
  assert.equal(google.refreshCount(), 1, 'jedno odświeżenie dla wszystkich równoległych żądań');
  assert.equal(new Set(tokens).size, 1);
  assert.notEqual(tokens[0], 'ya29.old');
  assert.equal(google.tokenRequests[0]!.get('refresh_token'), '1//r1');
  // Odpowiedź bez refresh_token: zapisany token odświeżania zostaje.
  assert.equal(cipher.decrypt(expiring.state.row().refreshEnc!, 'A1:refresh'), '1//r1');
  assert.equal(cipher.decrypt(expiring.state.row().accessEnc!, 'A1:access'), tokens[0]);
  // Rotacja: Google przysłał nowy token odświeżania – zastępuje stary.
  google.delayMs = 0;
  google.refresh = () => ({ body: { access_token: 'ya29.rotated', expires_in: 3600, refresh_token: '1//r2', scope: FULL_GRANT } });
  const rotating = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1' });
  assert.equal(await new GoogleTokenService(rotating.repository, cipher, OAUTH, google.fetch).accessToken(ACCOUNT), 'ya29.rotated');
  assert.equal(cipher.decrypt(rotating.state.row().refreshEnc!, 'A1:refresh'), '1//r2');
});

test('token dostępu: cofnięta zgoda, odłączone konto, zły klucz i konto makiety', async () => {
  const cipher = new TokenCipher(randomBytes(32));
  const google = new FakeGoogle();
  google.refresh = () => ({ status: 400, body: { error: 'invalid_grant' } });
  const revoked = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1' });
  await assert.rejects(new GoogleTokenService(revoked.repository, cipher, OAUTH, google.fetch).accessToken(ACCOUNT), rejects('reconnect_required'));
  assert.equal(revoked.state.reconnectMarks, 1);

  // Konto odłączone albo zmienione w trakcie (inna generacja) – stara praca nie dostaje tokenu.
  const disconnected = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1' });
  disconnected.state.connected = false;
  await assert.rejects(new GoogleTokenService(disconnected.repository, cipher, OAUTH, google.fetch).accessToken(ACCOUNT), rejects('reconnect_required'));
  await assert.rejects(new GoogleTokenService(memoryTokens(cipher, ACCOUNT, { refresh: '1//r1' }).repository, cipher, OAUTH, google.fetch)
    .accessToken({ ...ACCOUNT, generation: 2 }), rejects('reconnect_required'));

  // Klucz zmieniono bez migracji tokenów – nie da się ich odczytać, więc trzeba połączyć konto ponownie.
  const otherKey = memoryTokens(cipher, ACCOUNT, { refresh: '1//r1' });
  await assert.rejects(new GoogleTokenService(otherKey.repository, new TokenCipher(randomBytes(32)), OAUTH, google.fetch).accessToken(ACCOUNT), rejects('reconnect_required'));
  assert.equal(otherKey.state.reconnectMarks, 1);

  await assert.rejects(new GoogleTokenService(revoked.repository, cipher, OAUTH, google.fetch).accessToken({ ...ACCOUNT, status: 'reconnect_required' }), rejects('reconnect_required'));
  assert.equal(await new GoogleTokenService(revoked.repository, null, null, google.fetch).accessToken({ ...ACCOUNT, mode: 'demo' }), 'demo');
  assert.equal(google.refreshCount(), 1);
});

test('bez klucza szyfrowania prawdziwe logowanie się nie zaczyna, a stan mówi dlaczego', async () => {
  const repository = { getActiveAccount: async () => null } as never;
  const missing = new GoogleIntegrationService(repository, { oauth: OAUTH, cipher: null });
  const status = await missing.status({ userId: 'U1', calendarId: 'K1' });
  assert.deepEqual([status.mode, status.ready, status.problem, status.status], ['google', false, 'token_key_missing', 'not_connected']);
  await assert.rejects(missing.start({ userId: 'U1', calendarId: 'K1' }, 'connect'), rejects('token_key_missing'));
  const invalid = new GoogleIntegrationService(repository, { oauth: OAUTH, cipher: null, keyProblem: 'token_key_invalid' });
  await assert.rejects(invalid.start({ userId: 'U1', calendarId: 'K1' }, 'connect'), rejects('token_key_invalid'));
  // Makieta nie ma tokenów, więc klucz nie jest potrzebny.
  const demo = await new GoogleIntegrationService(repository, { oauth: null, cipher: null }).status({ userId: 'U1', calendarId: 'K1' });
  assert.deepEqual([demo.mode, demo.ready, demo.problem], ['demo', true, null]);
  assert.deepEqual(demo.demoAccounts, ['student.kac.demo@gmail.com', 'praca.kac.demo@gmail.com']);
});

test('API bez bazy danych: integracja zgłasza brak konfiguracji, a strona powrotu jest stroną HTML', async () => {
  const app = buildApi(null, []);
  try {
    const status = await app.inject({ method: 'GET', url: '/api/v1/integrations/google' });
    assert.equal(status.statusCode, 503);
    assert.deepEqual(status.json(), { error: 'integration_not_configured' });
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/integrations/google/connect', payload: {} })).statusCode, 503);
    const callback = await app.inject({ method: 'GET', url: '/api/v1/integrations/google/callback?state=s&code=c' });
    assert.equal(callback.statusCode, 503);
    assert.match(String(callback.headers['content-type']), /text\/html/);
    // Jednorazowy import ma osobny kontrakt i nadal działa bez bazy (konto demonstracyjne).
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/import/google/connections' })).statusCode, 201);
  } finally {
    await app.close();
  }
});

test('logi żądań nie zawierają kodu autoryzacji ani state z adresu powrotu', () => {
  assert.equal(redactUrl('/api/v1/integrations/google/callback?state=abc&code=4%2F0secret&scope=email'),
    '/api/v1/integrations/google/callback?state=redacted&code=redacted&scope=email');
  assert.equal(redactUrl('/api/v1/import/google/callback?code=x&code=y'), '/api/v1/import/google/callback?code=redacted');
  assert.equal(redactUrl('/api/v1/calendar/events?from=2026-11-01'), '/api/v1/calendar/events?from=2026-11-01');
  assert.equal(redactUrl('/api/v1/health'), '/api/v1/health');
});
