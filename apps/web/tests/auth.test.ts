// Logowanie w aplikacji: walidacja formularzy, nagłówek sesji we wszystkich zapytaniach, wylogowanie po wygaśnięciu sesji
// (tylko przy 401 unauthorized – nie przy błędach Google), klient /auth/*, reset hasła kodem odzyskiwania i komunikaty dziennego limitu AI.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authErrorMessage, deviceTimeZone, displayName, hasErrors, normalizeRecoveryCode, recoveryField, registrationField, validateLogin, validatePasswordChange,
  validateRecovery, validateRegistration, type RecoveryDraft, type RegisterDraft,
} from '../src/domain/auth.ts';
import { authFetch, hasSessionToken, onSessionExpired, setSessionToken } from '../src/services/http.ts';
import { AuthApiError, deleteAccount, login, newRecoveryCode, recoverAccount, register } from '../src/services/authApi.ts';
import { AssistantApiError } from '../src/services/assistantApi.ts';
import { readAiClassSchedule } from '../src/services/importApi.ts';
import { attemptNotice } from '../src/domain/googleIntegration.ts';

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = 'http://localhost:4000';
  const calls: Call[] = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = originalUrl;
      setSessionToken(null);
    },
  };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name];

const draft = (overrides: Partial<RegisterDraft> = {}): RegisterDraft => ({
  email: 'anna.nowak@example.test', password: 'dluga-fraza-na-wiosne', confirm: 'dluga-fraza-na-wiosne', firstName: 'Anna', lastName: '', inviteCode: '', ...overrides,
});

test('walidacja logowania i rejestracji: e-mail, długość hasła, powtórzenie, imię i kod zaproszenia tylko w trybie invite', () => {
  assert.equal(hasErrors(validateLogin({ email: 'anna@example.test', password: 'cokolwiek' })), false);
  assert.match(validateLogin({ email: 'anna@', password: '' }).email!, /niepełny/);
  assert.equal(validateLogin({ email: 'anna@example.test', password: '' }).password, 'Podaj hasło.');

  assert.equal(hasErrors(validateRegistration(draft(), 'open')), false);
  assert.match(validateRegistration(draft({ password: 'krotkie', confirm: 'krotkie' }), 'open').password!, /co najmniej 12 znaków \(teraz: 7\)/);
  assert.match(validateRegistration(draft({ password: 'anna.nowak-ma-kota', confirm: 'anna.nowak-ma-kota' }), 'open').password!, /adresu e-mail/);
  assert.match(validateRegistration(draft({ confirm: 'inna-fraza-na-wiosne' }), 'open').confirm!, /różnią/);
  assert.equal(validateRegistration(draft({ firstName: '  ' }), 'open').firstName, 'Podaj imię.');
  assert.equal(validateRegistration(draft(), 'open').inviteCode, undefined);
  assert.match(validateRegistration(draft(), 'invite').inviteCode!, /kod zaproszenia/);
  assert.equal(validateRegistration(draft({ inviteCode: 'kod-zespolu' }), 'invite').inviteCode, undefined);

  const change = validatePasswordChange({ current: 'dluga-fraza-na-wiosne', next: 'dluga-fraza-na-wiosne', confirm: 'dluga-fraza-na-wiosne' }, 'anna@example.test');
  assert.match(change.next!, /różnić się od obecnego/);
  assert.equal(hasErrors(validatePasswordChange({ current: 'stare-haslo', next: 'nowa-fraza-na-lato', confirm: 'nowa-fraza-na-lato' }, 'anna@example.test')), false);
  assert.match(validatePasswordChange({ current: '', next: 'nowa-fraza-na-lato', confirm: 'inna' }, 'anna@example.test').confirm!, /różnią/);

  assert.deepEqual(['email_taken', 'invalid_email', 'password_too_common', 'invalid_name', 'invalid_invite_code', 'registration_closed'].map(registrationField),
    ['email', 'email', 'password', 'firstName', 'inviteCode', null]);
  assert.match(authErrorMessage('password_too_common'), /łatwo odgadnąć/);
  assert.match(authErrorMessage('cos_nowego'), /Spróbuj ponownie/);
  assert.ok(deviceTimeZone().length > 0);
  assert.equal(displayName({ firstName: 'Anna', lastName: ' ' }), 'Anna');
});

test('authFetch: nagłówek Bearer przy zachowaniu pozostałych nagłówków; bez sesji zapytanie idzie bez Authorization', async () => {
  const api = mockFetch(() => json(200, { ok: true }));
  try {
    await authFetch('http://localhost:4000/api/v1/calendar/overview', { headers: { Accept: 'application/json' } });
    assert.equal(header(api.calls[0]!.init, 'Authorization'), undefined);
    setSessionToken('token-123');
    await authFetch('http://localhost:4000/api/v1/calendar/overview', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
    assert.deepEqual(api.calls[1]!.init?.headers, { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token-123' });
    assert.equal(api.calls[1]!.init?.method, 'POST');
    await authFetch('http://localhost:4000/api/v1/health/live');
    assert.equal(header(api.calls[2]!.init, 'Authorization'), 'Bearer token-123');
  } finally { api.restore(); }
});

test('authFetch: 401 unauthorized wylogowuje raz (także przy równoległych zapytaniach), 401 Google i inne błędy nie wylogowują', async () => {
  let expired = 0;
  const unregister = onSessionExpired(() => { expired++; });
  const api = mockFetch((url) => url.includes('/import/google') ? json(401, { error: 'google-unauthorized' }) : url.includes('/fail') ? json(500, { error: 'x' }) : json(401, { error: 'unauthorized' }));
  try {
    setSessionToken('token-abc');
    assert.equal((await authFetch('http://localhost:4000/api/v1/import/google/connections/c1/calendars')).status, 401);
    assert.equal((await authFetch('http://localhost:4000/api/v1/fail')).status, 500);
    assert.deepEqual([expired, hasSessionToken()], [0, true]);
    const responses = await Promise.all([authFetch('http://localhost:4000/api/v1/a'), authFetch('http://localhost:4000/api/v1/b')]);
    // Wywołujący nadal może przeczytać treść odpowiedzi (sprawdzenie kodu korzysta z kopii).
    assert.deepEqual(await responses[0]!.json(), { error: 'unauthorized' });
    assert.deepEqual([expired, hasSessionToken()], [1, false]);
    // Bez sesji (np. złe hasło przy logowaniu) 401 niczego nie wylogowuje.
    await authFetch('http://localhost:4000/api/v1/c');
    assert.equal(expired, 1);
    unregister();
    setSessionToken('token-def');
    await authFetch('http://localhost:4000/api/v1/d');
    assert.equal(expired, 1);
  } finally { unregister(); api.restore(); }
});

test('klient kont: logowanie, rejestracja z kodem, polskie komunikaty błędów, brak sieci i usunięcie konta z hasłem w treści', async () => {
  const session = { user: { id: 'U1', email: 'anna@example.test', firstName: 'Anna', lastName: '', timeZone: 'Europe/Warsaw' }, token: 't', expiresAt: '2027-02-16T10:00:00.000Z' };
  const api = mockFetch((url, init) => {
    if (url.endsWith('/auth/login')) return JSON.parse(String(init?.body)).password === 'dobre-haslo-123' ? json(200, session) : json(401, { error: 'invalid_credentials' });
    if (url.endsWith('/auth/register')) return json(409, { error: 'email_taken' });
    if (url.endsWith('/auth/account')) return json(200, { deleted: true });
    throw new TypeError('Failed to fetch');
  });
  try {
    assert.deepEqual(await login(' anna@example.test ', 'dobre-haslo-123', 'web'), session);
    assert.deepEqual(JSON.parse(String(api.calls[0]!.init?.body)), { email: 'anna@example.test', password: 'dobre-haslo-123', client: 'web' });
    await assert.rejects(login('anna@example.test', 'zle-haslo-1234', 'web'), (error: unknown) =>
      error instanceof AuthApiError && error.code === 'invalid_credentials' && error.status === 401 && error.message === 'Nieprawidłowy e-mail lub hasło.');
    await assert.rejects(register({ email: 'anna@example.test', password: 'dluga-fraza-na-wiosne', firstName: ' Anna ', lastName: '', timeZone: 'Europe/Warsaw', inviteCode: ' kod ', client: 'android' }),
      (error: unknown) => error instanceof AuthApiError && error.code === 'email_taken');
    assert.deepEqual(JSON.parse(String(api.calls[2]!.init?.body)), {
      email: 'anna@example.test', password: 'dluga-fraza-na-wiosne', firstName: 'Anna', lastName: '', timeZone: 'Europe/Warsaw', client: 'android', inviteCode: 'kod' });
    await assert.rejects(fetchMe(), (error: unknown) => error instanceof AuthApiError && error.code === 'network' && /Brak połączenia/.test(error.message));

    setSessionToken('sesja-1');
    assert.deepEqual(await deleteAccount('dluga-fraza-na-wiosne'), { deleted: true });
    const removal = api.calls.at(-1)!;
    assert.deepEqual([removal.init?.method, JSON.parse(String(removal.init?.body)), header(removal.init, 'Authorization')], ['DELETE', { password: 'dluga-fraza-na-wiosne' }, 'Bearer sesja-1']);
  } finally { api.restore(); }
});
test('reset hasła kodem: kod wpisany dowolnie (małe litery, spacje, półpauza, O zamiast 0), walidacja formularza i błędy z serwera', () => {
  assert.equal(normalizeRecoveryCode(' 7f3q 9xwm\u20132hda-k8pr'), '7F3Q9XWM2HDAK8PR');
  assert.equal(normalizeRecoveryCode('O1LI-0000-0000-0000'), '0111000000000000');
  assert.equal(normalizeRecoveryCode('UUUU-0000-0000-0000'), null);
  assert.equal(normalizeRecoveryCode('7F3Q-9XWM'), null);

  const recovery = (overrides: Partial<RecoveryDraft> = {}): RecoveryDraft => ({
    email: 'anna@example.test', code: '7f3q-9xwm-2hda-k8pr', password: 'nowa-fraza-na-lato', confirm: 'nowa-fraza-na-lato', ...overrides });
  assert.equal(hasErrors(validateRecovery(recovery())), false);
  assert.match(validateRecovery(recovery({ code: '' })).code!, /Podaj kod odzyskiwania/);
  assert.match(validateRecovery(recovery({ code: '1234' })).code!, /16 znaków/);
  assert.match(validateRecovery(recovery({ password: 'krotkie', confirm: 'krotkie' })).password!, /co najmniej 12 znaków/);
  assert.match(validateRecovery(recovery({ confirm: 'inna-fraza-na-lato' })).confirm!, /różnią/);
  assert.match(validateRecovery(recovery({ email: 'anna' })).email!, /niepełny/);

  assert.deepEqual(['password_too_common', 'invalid_email', 'invalid_recovery_code', 'too_many_attempts'].map(recoveryField), ['password', 'email', null, null]);
  assert.match(authErrorMessage('invalid_recovery_code'), /Nieprawidłowy e-mail lub kod odzyskiwania.*jednorazowy/);
  assert.match(authErrorMessage('too_many_attempts'), /^Za dużo prób\./);
});

test('klient resetu hasła: kod bez sesji (bez nagłówka), nowy kod z hasłem i z sesją; 401 złego kodu nie wylogowuje', async () => {
  let expired = 0;
  const unregister = onSessionExpired(() => { expired++; });
  const session = { user: { id: 'U1', email: 'anna@example.test', firstName: 'Anna', lastName: '', timeZone: 'Europe/Warsaw', hasRecoveryCode: true },
    token: 't2', expiresAt: '2027-02-16T10:00:00.000Z', recoveryCode: 'M4ZT-0QB8-XK2N-7VHD' };
  const api = mockFetch((url, init) => {
    if (url.endsWith('/auth/recover')) return JSON.parse(String(init?.body)).recoveryCode === '7F3Q-9XWM-2HDA-K8PR' ? json(200, session) : json(401, { error: 'invalid_recovery_code' });
    if (url.endsWith('/auth/recovery-code')) return json(200, { recoveryCode: '7F3Q-9XWM-2HDA-K8PR' });
    return json(404, { error: 'not_found' });
  });
  try {
    assert.deepEqual(await recoverAccount({ email: ' anna@example.test ', code: ' 7F3Q-9XWM-2HDA-K8PR ', newPassword: 'nowa-fraza-na-lato', client: 'android' }), session);
    assert.deepEqual(JSON.parse(String(api.calls[0]!.init?.body)), { email: 'anna@example.test', recoveryCode: '7F3Q-9XWM-2HDA-K8PR', newPassword: 'nowa-fraza-na-lato', client: 'android' });
    assert.equal(header(api.calls[0]!.init, 'Authorization'), undefined);
    await assert.rejects(recoverAccount({ email: 'anna@example.test', code: 'zly', newPassword: 'nowa-fraza-na-lato', client: 'web' }),
      (error: unknown) => error instanceof AuthApiError && error.code === 'invalid_recovery_code' && error.status === 401);

    setSessionToken('sesja-2');
    assert.deepEqual(await newRecoveryCode('dluga-fraza-na-wiosne'), { recoveryCode: '7F3Q-9XWM-2HDA-K8PR' });
    const created = api.calls.at(-1)!;
    assert.deepEqual([created.init?.method, JSON.parse(String(created.init?.body)), header(created.init, 'Authorization')], ['POST', { password: 'dluga-fraza-na-wiosne' }, 'Bearer sesja-2']);
    // Zalogowany ktoś wpisał zły kod (np. na innym koncie) – sesja zostaje.
    await assert.rejects(recoverAccount({ email: 'anna@example.test', code: 'zly', newPassword: 'nowa-fraza-na-lato', client: 'web' }));
    assert.deepEqual([expired, hasSessionToken()], [0, true]);
  } finally { unregister(); api.restore(); }
});
const fetchMe = async () => (await import('../src/services/authApi.ts')).currentUser();

test('dzienny limit AI: komunikat w asystencie i przy odczycie planu przez AI; konto Google połączone z innym kontem KAC', async () => {
  assert.match(new AssistantApiError('ai_daily_limit').message, /dzienny limit asystenta AI/);
  const api = mockFetch(() => json(429, { error: 'ai_daily_limit' }));
  try {
    await assert.rejects(readAiClassSchedule('plan.pdf', 'JVBERi0='), /dzienny limit odczytu przez AI.*odczyt lokalny/);
  } finally { api.restore(); }
  assert.match(attemptNotice({ status: 'error', errorCode: 'google_account_in_use', purpose: 'connect' })!.text, /połączone z innym kontem KAC/);
});
