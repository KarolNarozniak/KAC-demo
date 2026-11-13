import { pool } from '../src/database.js';
if (!pool) throw new Error('DATABASE_URL is required.');
try {
  const columns = await pool.query(`select column_name from information_schema.columns
    where table_schema = current_schema() and table_name = 't_ai_rozmowy' order by ordinal_position`);
  const migration = await pool.query(`select checksum from schema_migrations where version = '009_ai_assistant_imports.sql'`);
  console.log(JSON.stringify({ columns: columns.rows.map((row) => row.column_name), migration: migration.rows[0]?.checksum }, null, 2));
} finally { await pool.end(); }
