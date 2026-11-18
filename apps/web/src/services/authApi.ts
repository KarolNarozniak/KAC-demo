// Klient kont KAC: rejestracja, logowanie, reset hasła kodem odzyskiwania, wylogowanie, dane konta, nowy kod odzyskiwania,
// zmiana hasła i usunięcie konta (/api/v1/auth/*).
import { apiBaseUrl } from './importApi.ts';
import { authFetch } from './http.ts';
import { authErrorMessage, type AuthConfig, type AuthSession, type AuthUser } from '../domain/auth.ts';

export class AuthApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 0) {
    super(authErrorMessage(code));
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = `${apiBaseUrl()}${path}`;
  let response: Response;
  try {
    response = await authFetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new AuthApiError('network');
  }
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new AuthApiError(typeof result.error === 'string' ? result.error : `http_${response.status}`, response.status);
  return result as T;
}

export type RegisterInput = { email: string; password: string; firstName: string; lastName: string; timeZone: string; inviteCode?: string; client: string };

export const getAuthConfig = () => call<AuthConfig>('/api/v1/auth/config');
export const login = (email: string, password: string, client: string) =>
  call<AuthSession>('/api/v1/auth/login', 'POST', { email: email.trim(), password, client });
export const register = (input: RegisterInput) => call<AuthSession>('/api/v1/auth/register', 'POST', {
  email: input.email.trim(), password: input.password, firstName: input.firstName.trim(), lastName: input.lastName.trim(), timeZone: input.timeZone, client: input.client,
  ...(input.inviteCode?.trim() ? { inviteCode: input.inviteCode.trim() } : {}),
});
/** Zapomniane hasło: e-mail, kod odzyskiwania i nowe hasło → sesja tego urządzenia i nowy kod (stary przestaje działać). */
export const recoverAccount = (input: { email: string; code: string; newPassword: string; client: string }) => call<AuthSession>('/api/v1/auth/recover', 'POST', {
  email: input.email.trim(), recoveryCode: input.code.trim(), newPassword: input.newPassword, client: input.client,
});
export const newRecoveryCode = (password: string) => call<{ recoveryCode: string }>('/api/v1/auth/recovery-code', 'POST', { password });
export const logout = () => call<{ loggedOut: boolean }>('/api/v1/auth/logout', 'POST', {});
export const currentUser = () => call<AuthUser>('/api/v1/auth/me');
export const changePassword = (currentPassword: string, newPassword: string) =>
  call<{ otherSessionsRevoked: number }>('/api/v1/auth/change-password', 'POST', { currentPassword, newPassword });
export const deleteAccount = (password: string) => call<{ deleted: boolean }>('/api/v1/auth/account', 'DELETE', { password });
