import type { AuthService, AuthSession } from '../../src/auth/service.js';

export const premiumTestToken = 'test-session-token';
export const premiumTestHeaders = { authorization: `Bearer ${premiumTestToken}` };

export function makeTestAuth(session: AuthSession | null): AuthService {
  return {
    authenticate: async (token: string) => token === premiumTestToken ? session : null,
    publicConfig: () => ({ registration: 'open', inviteRequired: false, passwordMinLength: 12 }),
  } as unknown as AuthService;
}
