// Logowanie do KAC: rejestracja, logowanie, sesje, zmiana hasła i usunięcie konta.
//
// Założenia:
//  - konto KAC = e-mail i hasło; Google służy tylko do połączenia kalendarza i nie jest potrzebny do korzystania z aplikacji,
//  - sesja po stronie serwera z losowym tokenem w nagłówku Authorization: Bearer (web i telefon tak samo); w bazie tylko skrót tokenu,
//  - sesja wygasa po 30 dniach bez użycia albo po 90 dniach od zalogowania; wylogowanie i zmiana hasła działają natychmiast,
//  - po 10 nieudanych próbach konto jest blokowane na 15 minut (niezależnie od limitu żądań na adres IP w trasach),
//  - nieistniejący adres i złe hasło dają ten sam komunikat i podobny czas odpowiedzi,
//  - zapomniane hasło: jednorazowy kod odzyskiwania pokazany przy rejestracji (bez poczty e-mail); użycie ustawia nowe hasło,
//    wylogowuje wszystkie urządzenia, zdejmuje blokadę i daje nowy kod. Bez kodu nowe hasło ustawia administrator (scripts/set-password.ts).
import type { UserScope } from '../api/scope.js';
import { hashPassword, newRecoveryCode, newSessionToken, normalizeRecoveryCode, passwordProblem, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, recoveryCodeHash,
  sameHash, sessionTokenHash, verifyAgainstDummy, verifyPassword, type PasswordProblem } from './password.js';
import { EmailTakenError, normalizeEmail, type AuthUser, type PostgresAuthRepository } from './repository.js';

export type RegistrationMode = 'open' | 'invite' | 'closed';
export type AuthSettings = {
  registration: RegistrationMode;
  /** Kod zaproszenia dla trybu „invite”. */
  inviteCode: string;
  sessionIdleDays: number;
  sessionMaxDays: number;
  lockAfterFailures: number;
  lockMinutes: number;
};
export const DEFAULT_AUTH_SETTINGS: AuthSettings = { registration: 'open', inviteCode: '', sessionIdleDays: 30, sessionMaxDays: 90, lockAfterFailures: 10, lockMinutes: 15 };

export type AuthErrorCode = PasswordProblem | 'invalid_email' | 'invalid_name' | 'invalid_time_zone' | 'email_taken' | 'registration_closed'
  | 'invalid_invite_code' | 'invalid_credentials' | 'too_many_attempts' | 'invalid_password' | 'password_unchanged' | 'account_not_found' | 'invalid_recovery_code';
const STATUS: Record<AuthErrorCode, number> = {
  password_too_short: 400, password_too_long: 400, password_too_common: 400, password_contains_email: 400, invalid_email: 400, invalid_name: 400,
  invalid_time_zone: 400, email_taken: 409, registration_closed: 403, invalid_invite_code: 403, invalid_credentials: 401, too_many_attempts: 429,
  invalid_password: 403, password_unchanged: 400, account_not_found: 404, invalid_recovery_code: 401,
};
export class AuthError extends Error {
  readonly status: number;
  constructor(readonly code: AuthErrorCode) { super(code); this.status = STATUS[code]; }
}

/** Zalogowana sesja żądania: czyje dane obsługuje (UserScope) i którą sesję można wylogować. */
export type AuthSession = { sessionId: string; scope: UserScope; isPremium: boolean; premiumExpiresAt: string | null };
export type SessionResult = { user: AuthUser; token: string; expiresAt: string };
/** Sesja z nowym kodem odzyskiwania – po rejestracji i po resecie hasła. Kod pokazujemy tylko raz; serwer zna wyłącznie jego skrót. */
export type SessionWithCode = SessionResult & { recoveryCode: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validTimeZone = (zone: string) => { try { new Intl.DateTimeFormat('pl-PL', { timeZone: zone }); return true; } catch { return false; } };
/** Opis urządzenia w sesji: rodzaj klienta i skrócony User-Agent – tyle, ile trzeba, żeby rozpoznać swoje urządzenie. */
const deviceLabel = (client: string | undefined, userAgent: string | undefined) =>
  [client?.trim().slice(0, 20), userAgent?.trim().slice(0, 160)].filter(Boolean).join(' · ') || null;

/** Porównanie kodu zaproszenia w stałym czasie (długość nie zdradza dopasowania znak po znaku). */
function sameSecret(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

export class AuthService {
  readonly settings: AuthSettings;

  constructor(private readonly repository: PostgresAuthRepository, settings: Partial<AuthSettings> = {},
    /** Cofnięcie zgody Google przy usuwaniu konta (G03). Błąd nie zatrzymuje usunięcia – dane KAC i tak znikają. */
    private readonly disconnectGoogle?: (scope: UserScope) => Promise<unknown>) {
    this.settings = { ...DEFAULT_AUTH_SETTINGS, ...settings };
  }

  /** Publiczna konfiguracja dla ekranu rejestracji: czy rejestracja jest otwarta, czy wymaga kodu i jak długie ma być hasło. */
  publicConfig() {
    const registration: RegistrationMode = this.settings.registration === 'invite' && !this.settings.inviteCode ? 'closed' : this.settings.registration;
    return { registration, passwordMinLength: PASSWORD_MIN_LENGTH, passwordMaxLength: PASSWORD_MAX_LENGTH };
  }

  async register(input: { email: string; password: string; firstName: string; lastName?: string; timeZone?: string; inviteCode?: string; client?: string },
    userAgent?: string): Promise<SessionWithCode> {
    const mode = this.publicConfig().registration;
    if (mode === 'closed') throw new AuthError('registration_closed');
    if (mode === 'invite' && !sameSecret(input.inviteCode?.trim() ?? '', this.settings.inviteCode)) throw new AuthError('invalid_invite_code');
    const email = normalizeEmail(input.email);
    if (!EMAIL.test(email) || email.length > 254) throw new AuthError('invalid_email');
    const firstName = input.firstName.trim(); const lastName = (input.lastName ?? '').trim();
    if (!firstName || firstName.length > 60 || lastName.length > 80) throw new AuthError('invalid_name');
    const timeZone = input.timeZone?.trim() || 'Europe/Warsaw';
    if (!validTimeZone(timeZone)) throw new AuthError('invalid_time_zone');
    const problem = passwordProblem(input.password, email);
    if (problem) throw new AuthError(problem);
    const recoveryCode = newRecoveryCode();
    let user: AuthUser;
    try {
      user = await this.repository.createAccount({ email, firstName, lastName, timeZone, passwordHash: await hashPassword(input.password),
        recoveryCodeHash: recoveryCodeHash(recoveryCode) });
    } catch (error) {
      if (error instanceof EmailTakenError) throw new AuthError('email_taken');
      throw error;
    }
    return { ...(await this.startSession(user, deviceLabel(input.client, userAgent))), recoveryCode };
  }

  /**
   * Zapomniane hasło: e-mail, kod odzyskiwania i nowe hasło. Zły adres, konto bez kodu i zły kod dają ten sam błąd; wszystkie ścieżki
   * robią to samo zapytanie i szybki skrót, więc czas odpowiedzi nie zdradza, czy adres ma konto. Kod działa także przy blokadzie po
   * nieudanych logowaniach (80 bitów nie da się zgadnąć; zgadywanie ogranicza limit żądań na adres IP) i zdejmuje ją.
   */
  async recover(input: { email: string; recoveryCode: string; newPassword: string; client?: string }, userAgent?: string): Promise<SessionWithCode> {
    const email = normalizeEmail(input.email);
    const problem = passwordProblem(input.newPassword, email);
    if (problem) throw new AuthError(problem);
    const code = normalizeRecoveryCode(input.recoveryCode);
    const account = await this.repository.findRecovery(email);
    const presented = recoveryCodeHash(code ?? input.recoveryCode);
    if (!code || !account?.recoveryCodeHash || !sameHash(presented, account.recoveryCodeHash)) throw new AuthError('invalid_recovery_code');
    // Tak jak przy zmianie hasła nowe musi się różnić od obecnego. Sprawdzamy dopiero po poprawnym kodzie (wtedy odpowiedź niczego nie
    // zdradza obcemu), a kod zostaje niezużyty – skoro to obecne hasło, wystarczy się nim zalogować.
    if (await verifyPassword(account.passwordHash, input.newPassword)) throw new AuthError('password_unchanged');

    const recoveryCode = newRecoveryCode();
    const token = newSessionToken();
    const recovered = await this.repository.recoverAccount({ userId: account.userId, usedCodeHash: account.recoveryCodeHash, passwordHash: await hashPassword(input.newPassword),
      newCodeHash: recoveryCodeHash(recoveryCode), tokenHash: sessionTokenHash(token), device: deviceLabel(input.client, userAgent), maxDays: this.settings.sessionMaxDays });
    // Ten sam kod użyty równocześnie drugi raz: pierwsze żądanie wygrało, to dostaje taki sam błąd jak przy złym kodzie.
    if (!recovered) throw new AuthError('invalid_recovery_code');
    const user = await this.repository.getUser(account.userId);
    if (!user) throw new AuthError('invalid_recovery_code');
    return { user, token, expiresAt: recovered.expiresAt.toISOString(), recoveryCode };
  }

  /** Nowy kod odzyskiwania po podaniu hasła (zgubiony kod albo konto sprzed tej funkcji). Poprzedni kod przestaje działać. */
  async newRecoveryCode(session: AuthSession, password: string): Promise<{ recoveryCode: string }> {
    await this.requirePassword(session, password);
    const recoveryCode = newRecoveryCode();
    await this.repository.setRecoveryCode(session.scope.userId, recoveryCodeHash(recoveryCode));
    return { recoveryCode };
  }

  async login(input: { email: string; password: string; client?: string }, userAgent?: string): Promise<SessionResult> {
    const login = await this.repository.findLogin(input.email);
    if (!login) {
      await verifyAgainstDummy(input.password);
      throw new AuthError('invalid_credentials');
    }
    if (login.lockedUntil && login.lockedUntil.getTime() > Date.now()) throw new AuthError('too_many_attempts');
    if (!(await verifyPassword(login.passwordHash, input.password))) {
      const locked = await this.repository.recordFailure(login.userId, this.settings.lockAfterFailures, this.settings.lockMinutes);
      throw new AuthError(locked ? 'too_many_attempts' : 'invalid_credentials');
    }
    await this.repository.recordSuccess(login.userId);
    const user = await this.repository.getUser(login.userId);
    if (!user) throw new AuthError('invalid_credentials');
    await this.repository.ensureAccountDefaults(user.id);
    return this.startSession(user, deviceLabel(input.client, userAgent));
  }

  /** Sesja dla nagłówka Authorization. null – brak, wygasła albo unieważniona. Ostatnie użycie zapisujemy najwyżej raz na 10 minut. */
  async authenticate(token: string): Promise<AuthSession | null> {
    if (!token || token.length > 200) return null;
    const session = await this.repository.findSession(sessionTokenHash(token), this.settings.sessionIdleDays);
    if (!session) return null;
    if (!session.calendarId) {
      await this.repository.ensureAccountDefaults(session.userId);
      return this.authenticate(token);
    }
    if (Date.now() - session.lastUsedAt.getTime() > 10 * 60_000) await this.repository.touchSession(session.sessionId);
    return { sessionId: session.sessionId, scope: { userId: session.userId, calendarId: session.calendarId },
      isPremium: session.isPremium, premiumExpiresAt: session.premiumExpiresAt };
  }

  async logout(session: AuthSession): Promise<void> {
    await this.repository.revokeSession(session.sessionId, 'wylogowanie');
  }

  async me(session: AuthSession): Promise<AuthUser> {
    const user = await this.repository.getUser(session.scope.userId);
    if (!user) throw new AuthError('account_not_found');
    return user;
  }

  /** Zmiana hasła wymaga obecnego hasła; pozostałe urządzenia zostają wylogowane, bieżące – nie. */
  async changePassword(session: AuthSession, currentPassword: string, newPassword: string): Promise<{ otherSessionsRevoked: number }> {
    const user = await this.me(session);
    await this.requirePassword(session, currentPassword);
    if (currentPassword === newPassword) throw new AuthError('password_unchanged');
    const problem = passwordProblem(newPassword, user.email);
    if (problem) throw new AuthError(problem);
    await this.repository.setPassword(user.id, await hashPassword(newPassword));
    return { otherSessionsRevoked: await this.repository.revokeSessions(user.id, 'zmiana_hasla', session.sessionId) };
  }

  /** Usunięcie konta (RODO): potwierdzenie hasłem, cofnięcie zgody Google (najlepsza próba), potem wszystkie dane użytkownika. */
  async deleteAccount(session: AuthSession, password: string): Promise<void> {
    await this.requirePassword(session, password);
    try { await this.disconnectGoogle?.(session.scope); } catch { /* Brak sieci albo Google nie odpowiada – dane w KAC i tak usuwamy. */ }
    await this.repository.revokeSessions(session.scope.userId, 'usuniecie_konta', null);
    await this.repository.deleteAccount(session.scope.userId);
  }

  private async requirePassword(session: AuthSession, password: string) {
    const stored = await this.repository.getPasswordHash(session.scope.userId);
    if (!stored || !(await verifyPassword(stored, password))) throw new AuthError('invalid_password');
  }

  private async startSession(user: AuthUser, device: string | null): Promise<SessionResult> {
    const token = newSessionToken();
    const created = await this.repository.createSession(user.id, sessionTokenHash(token), device, this.settings.sessionMaxDays);
    return { user, token, expiresAt: created.expiresAt.toISOString() };
  }
}
