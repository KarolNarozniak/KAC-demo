import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
  const directory = resolve(here, '../migrations');
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = await client.query('select checksum from schema_migrations where version = $1', [file]);
    if (prior.rowCount) {
      if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
      console.log(`skip ${file} (already applied)`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations(version, checksum) values ($1, $2)', [file, checksum]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
} finally {
  await client.end();
}
