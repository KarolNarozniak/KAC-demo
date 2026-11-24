import 'dotenv/config';
import { Client } from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
const days = Number(process.argv[3] ?? process.env.PREMIUM_DURATION_DAYS ?? 365);
const campaignId = process.env.PREMIUM_CAMPAIGN_ID?.trim() || 'black-friday-2026';
if (!email) throw new Error('Usage: npm run premium:grant -- <email> [days]');
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Premium grant duration must be an integer from 1 to 3650 days.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to grant Premium.');

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  await client.query('begin');
  const account = await client.query('select id_uzytkownika from t_uzytkownicy where lower(email) = $1 for update', [email]);
  if (!account.rowCount) throw new Error('Premium grant target account was not found. The account must register first.');
  const userId = String(account.rows[0].id_uzytkownika);
  const result = await client.query(`insert into t_premium_entitlements (id_uzytkownika, wygasa_at, zrodlo, campaign_id)
    values ($1, now() + make_interval(days => $2), 'manual', null)
    on conflict (id_uzytkownika) do update set
      wygasa_at = case when t_premium_entitlements.wygasa_at > now() then t_premium_entitlements.wygasa_at else now() + make_interval(days => $2) end,
      zrodlo = 'manual', campaign_id = null, updated_at = now()
    returning wygasa_at`, [userId, days]);
  await client.query(`insert into t_premium_redemptions (id_uzytkownika, campaign_id, zrodlo, premium_until)
    values ($1, $2, 'manual', $3) on conflict (id_uzytkownika, campaign_id) do nothing`, [userId, campaignId, result.rows[0].wygasa_at]);
  await client.query('commit');
  console.log(`Premium granted to account ${userId} until ${new Date(result.rows[0].wygasa_at).toISOString()}.`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
