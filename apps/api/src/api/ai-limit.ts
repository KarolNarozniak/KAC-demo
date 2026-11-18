// Dzienny limit wywołań Azure AI na użytkownika (AI_DAILY_LIMIT, domyślnie 200 na 24 godziny, 0 – bez limitu).
// Z logowaniem każdy może założyć konto, a każde wywołanie asystenta i odczytu AI kosztuje – limit chroni budżet przed jednym kontem.
// Liczone są zapisy w t_ai_uzycie z ostatnich 24 godzin (także nieudane wywołania – też trafiają do Azure).
import type { FastifyInstance, RouteOptions } from 'fastify';
import type { AiRepositoryContract } from './contracts.js';
import type { ScopeResolver } from './scope.js';

const AI_ROUTES = new Set([
  'POST /api/v1/assistant/conversations/:id/messages',
  'POST /api/v1/assistant/conversations/:id/attachments',
  'POST /api/v1/import/ai/read',
]);
const isAiRoute = (method: string, url: string) => AI_ROUTES.has(`${method} ${url}`);

const LIMIT_EXAMPLE = {
  summary: 'Dzienny limit AI wyczerpany',
  description: 'Konto wykorzystało dzienny limit wywołań Azure AI (AI_DAILY_LIMIT w ciągu ostatnich 24 godzin). Kalendarz nie został zmieniony; spróbuj jutro albo użyj importu bez AI.',
  value: { error: 'ai_daily_limit' },
};

/** Dopisuje kod ai_daily_limit do udokumentowanej odpowiedzi 429 tras AI (albo dodaje ją, jeśli jej nie było). */
export function documentAiLimit(app: FastifyInstance) {
  app.addHook('onRoute', (route: RouteOptions) => {
    if (!route.schema || !isAiRoute(String(route.method), route.url)) return;
    const response = (route.schema.response ?? {}) as Record<string, any>;
    const current = response['429'] ? JSON.parse(JSON.stringify(response['429'])) : {
      type: 'object', required: ['error'], additionalProperties: true, properties: { error: { type: 'string' } }, description: 'Za dużo żądań.',
    };
    const values = current.properties?.error?.enum;
    if (Array.isArray(values) && !values.includes('ai_daily_limit')) current.properties.error.enum = [...values, 'ai_daily_limit'];
    current['x-examples'] = { ...(current['x-examples'] ?? {}), ai_daily_limit: LIMIT_EXAMPLE };
    route.schema = { ...route.schema, response: { ...response, 429: current } };
  });
}

/** Sprawdza limit przed wywołaniem AI. Bez repozytorium AI (testy, API bez bazy) albo przy limicie 0 nic nie robi. */
export function enforceAiLimit(app: FastifyInstance, options: { repository?: AiRepositoryContract; scope: ScopeResolver; dailyLimit: number }) {
  const repository = options.repository;
  if (!repository?.countRecentUsage || options.dailyLimit <= 0) return;
  app.addHook('preHandler', async (request, reply) => {
    const url = request.routeOptions.url;
    if (!url || !isAiRoute(request.method, url)) return;
    // Załącznik czytany lokalnym parserem (bez AI) nie zużywa limitu.
    if (url.endsWith('/attachments') && (request.body as { reader?: string } | undefined)?.reader !== 'ai') return;
    const used = await repository.countRecentUsage!(options.scope(request).userId, 24);
    if (used >= options.dailyLimit) return reply.code(429).send({ error: 'ai_daily_limit' });
  });
}
