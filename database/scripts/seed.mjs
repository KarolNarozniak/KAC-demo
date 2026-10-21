import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
dotenv.config({ path: resolve(repoRoot, '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const sql = await readFile(resolve(here, '../seed.sql'), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('commit');
    console.log('Synthetic KAC demo records seeded.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
} finally {
  await client.end();
}
