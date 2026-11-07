import 'dotenv/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
dotenv.config({ path: resolve(repoRoot, '.env') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query('select exists(select 1 from t_profile_pracy) as has_profiles');
  if (result.rows[0].has_profiles) {
    console.log('Existing work profiles found; preserving current database data.');
  } else {
    await import('./seed.mjs');
  }
} finally {
  await client.end();
}
