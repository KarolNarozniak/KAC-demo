// Logowanie do KAC: walidacja formularzy przed wysłaniem (te same zasady co serwer – serwer i tak sprawdza wszystko sam)
// i komunikaty kodów błędów API. Hasło: długość zamiast wymogów typu „wielka litera i cyfra”; popularne hasła odrzuca serwer.
// Zapomniane hasło: jednorazowy kod odzyskiwania pokazany przy rejestracji (16 znaków, np. 7F3Q-9XWM-2HDA-K8PR).

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export type RegistrationMode = 'open' | 'invite' | 'closed';
export type AuthConfig = { registration: RegistrationMode; passwordMinLength: number; passwordMaxLength: number };
export type AuthUser = { id: string; email: string; firstName: string; lastName: string; timeZone: string; hasRecoveryCode: boolean };
/** recoveryCode – tylko po rejestracji i po resecie hasła; aplikacja pokazuje go raz, z prośbą o zapisanie. */
export type AuthSession = { user: AuthUser; token: string; expiresAt: string; recoveryCode?: string };

export type LoginDraft = { email: string; password: string };
export type RegisterDraft = { email: string; password: string; confirm: string; firstName: string; lastName: string; inviteCode: string };
export type RecoveryDraft = { email: string; code: string; password: string; confirm: string };
export type PasswordChangeDraft = { current: string; next: string; confirm: string };
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const hasErrors = (errors: Record<string, string | undefined>) => Object.values(errors).some(Boolean);

function emailError(email: string): string | undefined {
  const value = email.trim();
  if (!value) return 'Podaj adres e-mail.';
  if (!EMAIL.test(value) || value.length > 254) return 'Adres e-mail wygląda na niepełny, np. anna@example.com.';
  return undefined;
}

/** Zasady nowego hasła, które da się sprawdzić bez serwera. */
export function newPasswordError(password: string, email = ''): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków (teraz: ${password.length}). Najłatwiej zapamiętać kilka niepowiązanych słów.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Hasło może mieć najwyżej ${PASSWORD_MAX_LENGTH} znaków.`;
  const local = email.trim().split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return authErrorMessage('password_contains_email');
  return undefined;
}

export function validateLogin(draft: LoginDraft): FieldErrors<LoginDraft> {
  return { email: emailError(draft.email), password: draft.password ? undefined : 'Podaj hasło.' };
}

export function validateRegistration(draft: RegisterDraft, mode: RegistrationMode): FieldErrors<RegisterDraft> {
  const firstName = draft.firstName.trim();
  return {
    firstName: !firstName ? 'Podaj imię.' : firstName.length > 60 ? 'Imię może mieć najwyżej 60 znaków.' : undefined,
    lastName: draft.lastName.trim().length > 80 ? 'Nazwisko może mieć najwyżej 80 znaków.' : undefined,
    email: emailError(draft.email),
    password: newPasswordError(draft.password, draft.email),
    confirm: draft.confirm !== draft.password ? 'Hasła różnią się – wpisz to samo hasło dwa razy.' : undefined,
    inviteCode: mode === 'invite' && !draft.inviteCode.trim() ? 'Podaj kod zaproszenia od zespołu.' : undefined,
  };
}

/**
 * Kod odzyskiwania w postaci kanonicznej (jak na serwerze): bez spacji i myślników, wielkie litery, O→0, I i L→1.
 * null – to nie może być kod (16 znaków alfabetu bez I, L, O i U).
 */
export function normalizeRecoveryCode(input: string): string | null {
  const value = input.toUpperCase().replace(/[\s\p{Pd}]+/gu, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(value) ? value : null;
}

export function validateRecovery(draft: RecoveryDraft): FieldErrors<RecoveryDraft> {
  return {
    email: emailError(draft.email),
    code: !draft.code.trim() ? 'Podaj kod odzyskiwania zapisany przy zakładaniu konta.'
      : normalizeRecoveryCode(draft.code) ? undefined : 'Kod ma 16 znaków (litery i cyfry), np. 7F3Q-9XWM-2HDA-K8PR. Myślniki i spacje możesz pominąć.',
    password: newPasswordError(draft.password, draft.email),
    confirm: draft.confirm !== draft.password ? 'Hasła różnią się – wpisz nowe hasło dwa razy.' : undefined,
  };
}

export function validatePasswordChange(draft: PasswordChangeDraft, email: string): FieldErrors<PasswordChangeDraft> {
  return {
    current: draft.current ? undefined : 'Podaj obecne hasło.',
    next: newPasswordError(draft.next, email) ?? (draft.next && draft.next === draft.current ? authErrorMessage('password_unchanged') : undefined),
    confirm: draft.confirm !== draft.next ? 'Hasła różnią się – wpisz nowe hasło dwa razy.' : undefined,
  };
}

const messages: Record<string, string> = {
  invalid_credentials: 'Nieprawidłowy e-mail lub hasło.',
  too_many_attempts: 'Za dużo prób. Odczekaj kilkanaście minut i spróbuj ponownie.',
  invalid_recovery_code: 'Nieprawidłowy e-mail lub kod odzyskiwania. Kod jest jednorazowy – po użyciu działa tylko nowy, pokazany wtedy w aplikacji.',
  email_taken: 'Konto z tym adresem e-mail już istnieje. Zaloguj się albo użyj innego adresu.',
  invalid_email: 'Adres e-mail wygląda na niepełny, np. anna@example.com.',
  invalid_name: 'Podaj imię (do 60 znaków); nazwisko może mieć do 80 znaków.',
  invalid_time_zone: 'Serwer nie rozpoznał strefy czasowej urządzenia.',
  password_too_short: `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`,
  password_too_long: `Hasło może mieć najwyżej ${PASSWORD_MAX_LENGTH} znaków.`,
  password_too_common: 'To hasło łatwo odgadnąć (popularne hasło, powtórzenia albo ciąg klawiszy). Użyj kilku niepowiązanych słów.',
  password_contains_email: 'Hasło nie może zawierać nazwy z adresu e-mail.',
  password_unchanged: 'Nowe hasło musi różnić się od obecnego.',
  invalid_password: 'Hasło jest nieprawidłowe.',
  registration_closed: 'Zakładanie kont jest wyłączone. Konto może założyć administrator KAC.',
  invalid_invite_code: 'Nieprawidłowy kod zaproszenia.',
  account_not_found: 'To konto już nie istnieje.',
  unauthorized: 'Sesja wygasła albo została zakończona na innym urządzeniu. Zaloguj się ponownie.',
  auth_not_configured: 'Serwer KAC działa bez bazy danych, więc logowanie jest niedostępne.',
  database_unavailable: 'Baza danych KAC jest chwilowo niedostępna. Spróbuj ponownie za chwilę.',
  network: 'Brak połączenia z internetem albo z serwerem KAC. Sprawdź połączenie i spróbuj ponownie.',
};

export const authErrorMessage = (code: string) => messages[code] ?? 'Nie udało się wykonać operacji na koncie. Spróbuj ponownie.';

/** Pole rejestracji, którego dotyczy błąd z serwera (komunikat trafia pod nie); null – komunikat nad przyciskiem. */
export function registrationField(code: string): keyof RegisterDraft | null {
  if (code === 'email_taken' || code === 'invalid_email') return 'email';
  if (code.startsWith('password_')) return 'password';
  if (code === 'invalid_name') return 'firstName';
  if (code === 'invalid_invite_code') return 'inviteCode';
  return null;
}

/** Pole formularza resetu hasła, którego dotyczy błąd z serwera; null – komunikat nad przyciskiem (np. zły e-mail lub kod). */
export function recoveryField(code: string): keyof RecoveryDraft | null {
  if (code.startsWith('password_')) return 'password';
  if (code === 'invalid_email') return 'email';
  return null;
}

/** Strefa czasowa urządzenia dla nowego konta (np. Europe/Warsaw). */
export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw'; } catch { return 'Europe/Warsaw'; }
}

export const displayName = (user: Pick<AuthUser, 'firstName' | 'lastName'>) => [user.firstName, user.lastName].map((part) => part.trim()).filter(Boolean).join(' ');
