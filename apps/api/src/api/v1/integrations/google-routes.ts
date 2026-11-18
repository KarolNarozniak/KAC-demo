import type { FastifyInstance } from 'fastify';
import type { IntegrationsRepository } from '../../../integrations/google/repository.js';
import { NoRefreshTokenError } from '../../../integrations/google/repository.js';
import type { ScopeResolver } from '../../scope.js';
import { PendingGoogleConnections } from '../../../integrations/google/pendingConnections.js';
import { authorizationUrl, createPkce, exchangeCode, refreshAccessToken, GoogleTokenError, type FetchLike, type GoogleOAuthConfig } from '../../../integrations/google/oauth.js';
import { GoogleCalendarApi } from '../../../import/google/oauth.js'; // reużyty klient HTTP (bez cyklu życia jednorazowego importu)
import { GoogleApiError } from '../../../import/google/types.js';

export type GoogleIntegrationOptions = { oauth?: GoogleOAuthConfig | null; fetch?: FetchLike; pending?: PendingGoogleConnections };

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } } as const;
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const page = (title: string, message: string) => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;background:#0B111B;color:#F2F5FC;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:420px;text-align:center}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>Możesz zamknąć tę kartę i wrócić do aplikacji KAC.</p></main><script>setTimeout(()=>window.close(),1500)</script></body></html>`;

export function registerGoogleIntegration(app: FastifyInstance, repository: IntegrationsRepository | null, scope: ScopeResolver, options: GoogleIntegrationOptions = {}) {
  const pending = options.pending ?? new PendingGoogleConnections();
  const oauth = options.oauth ?? null;
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  const googleError = (error: unknown) => {
    if (error instanceof GoogleApiError) return { status: error.code === 'google-unavailable' ? 502 : 401, code: error.code };
    if (error instanceof GoogleTokenError) return { status: error.code === 'google-unavailable' ? 502 : 401, code: error.code };
    return { status: 502, code: 'google-unavailable' };
  };

  // 1a: stan trwałego połączenia (nigdy tokenów).
  app.get('/integrations/google', { schema: { tags: ['Integrations'], summary: 'Get persistent Google connection status' } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    return (await repository.getGoogleAccount(scope(request).userId)) ?? { status: 'disconnected' };
  });

  // 2-3: start połączenia (zwykły connect ORAZ "Zmień konto" — to samo wywołanie, prompt wymusza wybór konta).
  app.post('/integrations/google/connections', { schema: { tags: ['Integrations'], summary: 'Start persistent Google connection' } }, async (request, reply) => {
    if (!oauth) return reply.code(503).send({ error: 'google_not_configured' });
    const pkce = createPkce();
    const connection = pending.create(scope(request).userId, pkce.verifier);
    return reply.code(201).send({ connectionId: connection.id, authUrl: authorizationUrl(oauth, connection.id, pkce.challenge) });
  });

  // Odpytywanie w trakcie logowania w Google (ta sama rola co GoogleCalendarImport, inny magazyn stanu).
  app.get<{ Params: { id: string } }>('/integrations/google/connections/:id', { schema: { tags: ['Integrations'], summary: 'Poll pending Google connection status', params: idParams } }, async (request, reply) => {
    const connection = pending.get(request.params.id);
    if (!connection) return reply.code(404).send({ error: 'connection-not-found' });
    return { status: connection.status, email: connection.email };
  });

  // 4-7: powrót z Google. 5a (odmowa) i "wygasły/reużyty state" obsłużone niżej.
  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/integrations/google/callback', { schema: { tags: ['Integrations'], summary: 'Complete persistent Google OAuth callback' } }, async (request, reply) => {
    reply.type('text/html; charset=utf-8');
    const { state, code, error } = request.query;
    const connection = state ? pending.get(state) : null;
    if (!connection || connection.status !== 'pending') return reply.code(400).send(page('Połączenie wygasło', 'Rozpocznij łączenie z Google Calendar ponownie w aplikacji.'));
    const verifier = pending.consumeVerifier(connection.id);
    if (!verifier) return reply.code(400).send(page('Połączenie już użyte', 'Ten link został już przetworzony. Rozpocznij łączenie ponownie.'));
    if (error || !code) { pending.setStatus(connection.id, 'denied'); return reply.send(page('Brak zgody', 'Bez zgody na dostęp do kalendarza nie można połączyć konta.')); }
    if (!repository || !oauth) { pending.setStatus(connection.id, 'error'); return reply.code(503).send(page('Serwer nieskonfigurowany', 'Integracja z Google nie jest dostępna.')); }
    try {
      const tokens = await exchangeCode(oauth, code, verifier, fetchImpl);
      if (!tokens.refreshToken || !tokens.googleSub) {
        pending.setStatus(connection.id, 'error');
        return reply.code(502).send(page('Nie udało się połączyć', 'Google nie wydał tokenu odświeżania albo nie potwierdził tożsamości konta. Spróbuj ponownie.'));
      }
      await repository.saveGoogleAccount(connection.userId, {
        accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        email: tokens.email, googleSub: tokens.googleSub, scopes: tokens.grantedScopes, // realnie przyznane, nie żądane
      });
      pending.setStatus(connection.id, 'connected', tokens.email);
      return reply.send(page('Połączono z Google', `Konto ${tokens.email ?? ''} jest teraz trwale połączone.`));
    } catch (err) { // 6a
      request.log.warn({ err }, 'Persistent Google token exchange failed');
      pending.setStatus(connection.id, 'error');
      return reply.code(502).send(page('Nie udało się połączyć', 'Google nie potwierdził połączenia. Spróbuj ponownie w aplikacji.'));
    }
  });

  // 7: lista kalendarzy połączonego konta. 7a: pusta lista — zwyczajnie calendars: [], połączenie bez zmian.
  app.get('/integrations/google/calendars', { schema: { tags: ['Integrations'], summary: 'List calendars on the connected Google account' } }, async (request, reply) => {
    if (!repository || !oauth) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const accessToken = await repository.getValidAccessToken(scope(request).userId, async (refreshToken) => {
        const refreshed = await refreshAccessToken(oauth, refreshToken, fetchImpl);
        return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000) };
      });
      return { calendars: await new GoogleCalendarApi(fetchImpl).listCalendars(accessToken) };
    } catch (error) {
      if (error instanceof NoRefreshTokenError) return reply.code(409).send({ error: 'not-connected' });
      const failure = googleError(error);
      request.log.warn({ err: error }, 'Google calendars not read (integration)');
      return reply.code(failure.status).send({ error: failure.code });
    }
  });

  // Odłączenie — jedyne miejsce, które faktycznie usuwa tokeny.
  app.delete('/integrations/google', { schema: { tags: ['Integrations'], summary: 'Disconnect Google account' } }, async (request, reply) => {
    if (!repository) return reply.code(503).send({ error: 'database_not_configured' });
    await repository.disconnectGoogleAccount(scope(request).userId);
    return reply.code(204).send();
  });
}