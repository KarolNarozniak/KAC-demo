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

const requiredColumns = async (table, columns) => {
  const result = await client.query(`select column_name from information_schema.columns
    where table_schema = current_schema() and table_name = $1 and column_name = any($2::text[])`, [table, columns]);
  return new Set(result.rows.map((row) => row.column_name)).size === columns.length;
};
const hasIndex = async (name) => {
  const result = await client.query('select 1 from pg_indexes where schemaname = current_schema() and indexname = $1', [name]);
  return Boolean(result.rowCount);
};
const hasConstraint = async (name) => {
  const result = await client.query('select 1 from pg_constraint where conname = $1', [name]);
  return Boolean(result.rowCount);
};
const verifyKnownAppliedSchema = async (file) => {
  switch (file) {
    case '003_schedule_persistence.sql':
      return await requiredColumns('t_grafiki', ['min_godzin','max_godzin','target_minutes','existing_work_minutes','proposed_minutes','total_minutes','shortfall_minutes','version','generator_version','input_snapshot','tryb_pracy']) &&
        await requiredColumns('t_zmiany_pracy', ['candidate_id','template_id','optional_lecture_ids','soft_penalty']) &&
        await requiredColumns('t_ograniczenia_grafiku', ['kod','szczegoly']) && await hasIndex('idx_t_grafiki_profile_week_version');
    case '004_solution_status.sql':
      return await requiredColumns('t_grafiki', ['solution_status']) && await hasConstraint('t_grafiki_solution_status_check') && await hasIndex('idx_t_grafiki_solution_status');
    case '005_work_modes.sql':
      return await requiredColumns('t_profile_pracy', ['tryb_pracy','min_slot_min','max_slot_min']) &&
        await hasConstraint('t_profile_pracy_work_mode_check') && await hasConstraint('t_profile_pracy_slot_bounds_check') &&
        await hasIndex('idx_t_szablony_zmian_profile_active');
    case '006_schedule_approval.sql':
      return await requiredColumns('t_grafiki', ['approved_at']) && await hasIndex('idx_t_grafiki_calendar_week_approved');
    case '007_daily_hours_and_rejection.sql':
      return await requiredColumns('t_profile_pracy', ['max_godzin_dzien']) && await requiredColumns('t_grafiki', ['rejected_at']) &&
        await hasIndex('idx_t_grafiki_calendar_week_pending');
    case '008_schedule_workflow_status.sql': {
      const invalid = await client.query(`select 1 from t_grafiki where status not in ('proposed','accepted','rejected','superseded') limit 1`);
      return !(invalid.rowCount ?? 0);
    }
    case '009_ai_assistant_imports.sql':
      return await requiredColumns('t_ai_rozmowy', ['model_deployment','title','status','expires_at']) &&
        await requiredColumns('t_ai_wiadomosci', ['id_rozmowy','rola','tresc']) &&
        await requiredColumns('t_ai_akcje', ['id_rozmowy','typ','argumenty','status','idempotency_key','updated_at','blad_kod']) &&
        await requiredColumns('t_ai_uzycie', ['operacja','model','tokeny_we','tokeny_wy','czas_ms','status']) &&
        await requiredColumns('t_pozycje_importu', ['source_page','source_snippet','unresolved_fields']) &&
        await requiredColumns('t_wydarzenia', ['id_ai_akcji']);
    default:
      return false;
  }
};

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
      if (prior.rows[0].checksum !== checksum) {
        const verified = await verifyKnownAppliedSchema(file);
        if (!verified) throw new Error(`Applied migration changed and its schema postconditions could not be verified: ${file}. Do not repair checksums until the live schema has been reconciled.`);
        await client.query('update schema_migrations set checksum = $2 where version = $1', [file, checksum]);
        console.warn(`reconciled checksum for ${file} after verifying all expected schema objects`);
      }
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
