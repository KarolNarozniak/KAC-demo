import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { AuthUser } from '../src/auth/repository.js';
import { PremiumService } from '../src/premium/service.js';
import { makeTestAuth, premiumTestHeaders } from './helpers/premium-auth.js';

const scope = { userId: 'synthetic-user', calendarId: 'synthetic-calendar' };
const session = { sessionId: 'synthetic-session', scope, isPremium: false, premiumExpiresAt: null };
const user: AuthUser = { id: scope.userId, email: 'user@example.test', firstName: 'Synthetic', lastName: 'User', timeZone: 'Europe/Warsaw',
  hasRecoveryCode: true, isPremium: true, premiumExpiresAt: '2027-11-24T12:00:00.000Z' };
const settings = { redemptionCode: 'KAC-BLACK-FRIDAY-SECRET', campaignId: 'black-friday-2026', campaignName: 'Black Friday',
  campaignEndsAt: '2099-11-30T23:59:59Z', durationDays: 365 };

test('Premium campaign config exposes terms but never the server-side redemption secret', async () => {
  const service = new PremiumService({ redeemPremiumCode: async () => ({ kind: 'redeemed', user }), hasRedeemedPremiumCampaign: async () => false } as never, settings);
  const app = buildApi(null, [], { auth: makeTestAuth(session), premiumService: service });
  try {
    const result = await app.inject({ method: 'GET', url: '/api/v1/premium/config', headers: premiumTestHeaders });
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json(), { available: true, redeemedByAccount: false, campaignName: 'Black Friday', campaignEndsAt: '2099-11-30T23:59:59.000Z', durationDays: 365 });
    assert.equal(result.body.includes(settings.redemptionCode), false);
  } finally { await app.close(); }
});

test('Premium code redemption requires a session, accepts normalized valid codes and rejects duplicate campaign use', async () => {
  let calls = 0;
  const service = new PremiumService({ redeemPremiumCode: async () => {
    calls++;
    return calls === 1 ? { kind: 'redeemed', user } : { kind: 'already_redeemed' };
  }, hasRedeemedPremiumCampaign: async () => false } as never, settings);
  const app = buildApi(null, [], { auth: makeTestAuth(session), premiumService: service });
  try {
    const missingSession = await app.inject({ method: 'POST', url: '/api/v1/premium/redeem', payload: { code: settings.redemptionCode } });
    assert.equal(missingSession.statusCode, 401);

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/premium/redeem', headers: premiumTestHeaders, payload: { code: 'wrong' } });
    assert.deepEqual([invalid.statusCode, invalid.json().error], [400, 'premium_code_invalid']);
    assert.equal(calls, 0);

    const redeemed = await app.inject({ method: 'POST', url: '/api/v1/premium/redeem', headers: premiumTestHeaders, payload: { code: '  kac-black-friday-secret  ' } });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    assert.equal(redeemed.json().user.isPremium, true);
    assert.equal(redeemed.json().user.premiumExpiresAt, user.premiumExpiresAt);

    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/premium/redeem', headers: premiumTestHeaders, payload: { code: settings.redemptionCode } });
    assert.deepEqual([duplicate.statusCode, duplicate.json().error], [409, 'premium_code_already_redeemed']);
  } finally { await app.close(); }
});

test('free sessions are blocked before assistant or AI import providers are called', async () => {
  let conversationCreates = 0;
  let modelCalls = 0;
  let importCalls = 0;
  const freeAuth = makeTestAuth(session);
  const app = buildApi({ checkConnection: async () => {}, getOverview: async () => null, getImportUserName: async () => 'Synthetic' } as never, [], {
    auth: freeAuth,
    aiRepository: { createConversation: async () => { conversationCreates++; return { id: 'should-not-create' }; } } as never,
    aiService: { sendAssistantMessage: async () => { modelCalls++; throw new Error('must not call model'); },
      extractSchedule: async () => { importCalls++; throw new Error('must not call model'); } } as never,
  });
  try {
    const assistant = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations', headers: premiumTestHeaders, payload: { title: 'Synthetic' } });
    assert.deepEqual([assistant.statusCode, assistant.json().error], [403, 'premium_required']);
    const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gU8AAAAASUVORK5CYII=';
    const importResult = await app.inject({ method: 'POST', url: '/api/v1/import/ai/read', headers: premiumTestHeaders,
      payload: { fileName: 'synthetic.png', dataBase64: imageBase64, source: 'classes' } });
    assert.deepEqual([importResult.statusCode, importResult.json().error], [403, 'premium_required']);
    const chatAttachment = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/synthetic/attachments', headers: premiumTestHeaders,
      payload: { fileName: 'synthetic.png', dataBase64: imageBase64, source: 'classes', reader: 'local' } });
    assert.deepEqual([chatAttachment.statusCode, chatAttachment.json().error], [403, 'premium_required']);
    assert.deepEqual([conversationCreates, modelCalls, importCalls], [0, 0, 0]);
  } finally { await app.close(); }
});
