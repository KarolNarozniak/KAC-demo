import type { FastifyInstance } from 'fastify';
import type { PremiumService } from '../../../premium/service.js';
import { PremiumServiceError } from '../../../premium/service.js';
import type { ScopeResolver } from '../../scope.js';
import { unauthorizedResponse } from '../../auth-guard.js';
import { documented, errorExamples, withExamples } from '../../examples.js';

const userProperties = {
  id: { type: 'string' }, email: { type: 'string', format: 'email' }, firstName: { type: 'string' }, lastName: { type: 'string' },
  timeZone: { type: 'string' }, hasRecoveryCode: { type: 'boolean' }, isPremium: { type: 'boolean' }, premiumExpiresAt: { type: ['string', 'null'], format: 'date-time' },
};
const premiumUserResponse = documented({ type: 'object', additionalProperties: false, required: ['user'], properties: {
  user: { type: 'object', additionalProperties: false, required: Object.keys(userProperties), properties: userProperties },
} }, 'Updated authenticated account after redeeming a Premium code.', {
  active: { summary: 'Premium activated for one year', value: { user: { id: 'synthetic-user', email: 'user@example.test', firstName: 'Synthetic', lastName: 'User', timeZone: 'Europe/Warsaw', hasRecoveryCode: true, isPremium: true, premiumExpiresAt: '2027-11-24T12:00:00Z' } } },
});
const premiumConfigResponse = documented({ type: 'object', additionalProperties: false, required: ['available', 'redeemedByAccount', 'campaignName', 'campaignEndsAt', 'durationDays'], properties: {
  available: { type: 'boolean' }, redeemedByAccount: { type: 'boolean' }, campaignName: { type: 'string' }, campaignEndsAt: { type: ['string', 'null'], format: 'date-time' }, durationDays: { type: 'integer', minimum: 1 },
} }, 'Public campaign information only; the redemption secret is never returned.', {
  active: { summary: 'Black Friday campaign', value: { available: true, redeemedByAccount: false, campaignName: 'Black Friday', campaignEndsAt: '2026-11-30T22:59:59Z', durationDays: 365 } },
});
const codeBody = withExamples({ type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', minLength: 1, maxLength: 128 } } }, {
  synthetic: { summary: 'Redeem a code', description: 'Synthetic example only. Never use a real campaign code in OpenAPI examples.', value: { code: 'KAC-BLACK-FRIDAY-EXAMPLE' } },
});
const codeErrors = documented({ type: 'object', additionalProperties: true, required: ['error'], properties: {
  error: { type: 'string' }, message: { type: 'string' },
} }, 'Premium code is invalid, expired, already redeemed by this account, or unavailable.', {
  invalid: { summary: 'Invalid campaign code', value: { error: 'premium_code_invalid' } },
  redeemed: { summary: 'Code already used', value: { error: 'premium_code_already_redeemed' } },
  expired: { summary: 'Campaign is unavailable', value: { error: 'premium_not_configured' } },
});

export async function premiumRoutes(app: FastifyInstance, options: { service?: PremiumService; scope: ScopeResolver }) {
  app.get('/premium/config', { schema: {
    tags: ['Premium'], summary: 'Read Premium campaign information',
    description: 'Returns non-secret campaign dates and activation period for the paywall. The redemption code is never exposed.',
    operationId: 'getPremiumCampaign', response: { 200: premiumConfigResponse, 401: unauthorizedResponse, 503: codeErrors },
  } }, async (request, reply) => {
    if (!options.service) return reply.code(503).send({ error: 'premium_not_configured' });
    return options.service.publicConfig(options.scope(request).userId);
  });

  app.post<{ Body: { code: string } }>('/premium/redeem', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }, schema: {
    tags: ['Premium'], summary: 'Redeem a Premium campaign code',
    description: 'Validates a server-configured code, records one redemption per account and activates the entitlement for the campaign duration.',
    operationId: 'redeemPremiumCode', body: codeBody,
    response: { 200: premiumUserResponse, 400: codeErrors, 401: unauthorizedResponse, 404: codeErrors, 409: codeErrors, 429: codeErrors, 503: codeErrors },
  } }, async (request, reply) => {
    if (!options.service) return reply.code(503).send({ error: 'premium_not_configured' });
    try {
      const user = await options.service.redeem(options.scope(request).userId, request.body.code);
      return { user };
    } catch (error) {
      if (error instanceof PremiumServiceError) {
        const status = error.code === 'account_not_found' ? 404 : error.code === 'premium_code_already_redeemed' ? 409
          : error.code === 'premium_not_configured' ? 503 : 400;
        return reply.code(status).send({ error: error.code });
      }
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Premium code redemption failed');
      return reply.code(503).send({ error: 'premium_service_unavailable' });
    }
  });
}
