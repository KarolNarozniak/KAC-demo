import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { pool } from '../src/database.js';
import { PostgresAuthRepository } from '../src/auth/repository.js';
import { config } from '../src/config.js';

test('Premium code redemption is unique per user/campaign and entitlement status is live in auth reads', { skip: !config.databaseUrl }, async () => {
  assert.ok(pool);
  const auth = new PostgresAuthRepository(pool);
  const email = `premium-test-${Date.now()}@example.invalid`;
  let userId = '';
  try {
    const user = await auth.createAccount({ email, firstName: 'Premium', lastName: 'Synthetic', timeZone: 'Europe/Warsaw',
      passwordHash: 'test-password-hash', recoveryCodeHash: 'test-recovery-hash' });
    userId = user.id;
    assert.equal(user.isPremium, false);
    assert.equal(user.premiumExpiresAt, null);

    const campaignId = `test-campaign-${randomBytes(4).toString('hex')}`;
    const redemptions = await Promise.all([
      auth.redeemPremiumCode(userId, campaignId, 365),
      auth.redeemPremiumCode(userId, campaignId, 365),
    ]);
    assert.deepEqual(redemptions.map((result) => result.kind).sort(), ['already_redeemed', 'redeemed']);

    let current = await auth.findUserByEmail(email);
    assert.equal(current?.isPremium, true);
    assert.ok(current?.premiumExpiresAt);
    const firstExpiry = current!.premiumExpiresAt!;

    const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const session = await auth.createSession(userId, tokenHash, 'premium-integration-test', 30);
    assert.equal((await auth.findSession(tokenHash, 30))?.isPremium, true);

    await pool.query(`update t_premium_entitlements set wygasa_at = now() - interval '1 second' where id_uzytkownika = $1`, [userId]);
    current = await auth.findUserByEmail(email);
    assert.equal(current?.isPremium, false);
    assert.equal((await auth.findSession(tokenHash, 30))?.isPremium, false);

    const granted = await auth.grantPremiumByEmail(email, 365);
    assert.equal(granted?.isPremium, true);
    assert.notEqual(granted?.premiumExpiresAt, firstExpiry);
    const repeatedGrant = await auth.grantPremiumByEmail(email, 365);
    assert.equal(repeatedGrant?.premiumExpiresAt, granted?.premiumExpiresAt);
    assert.equal((await auth.findSession(tokenHash, 30))?.isPremium, true);
    assert.ok(session.sessionId);
  } finally {
    if (userId) await pool.query('delete from t_uzytkownicy where id_uzytkownika = $1', [userId]);
    await pool.end();
  }
});
