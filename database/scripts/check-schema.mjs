import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../migrations');
const migrationFiles = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
const sql = (await Promise.all(migrationFiles.map((file) => readFile(resolve(migrationsDir, file), 'utf8')))).join('\n');
const expectedTables = [
  't_uzytkownicy', 't_kalendarze', 't_kategorie', 't_serie', 't_wydarzenia',
  't_profile_pracy', 't_dostepnosc', 't_prefer_godziny', 't_blokady', 't_miejsca',
  't_dojazdy', 't_grafiki', 't_zmiany_pracy', 't_korekty_grafiku', 't_ograniczenia_grafiku',
  't_kolizje', 't_importy', 't_pozycje_importu', 't_konta_google', 't_kalendarze_google',
  't_synchronizacje', 't_publikacje', 't_ustaw_powiadomien', 't_powiadomienia', 't_zmiany_historii', 't_szablony_zmian', 'blocks',
  't_ai_rozmowy', 't_ai_wiadomosci', 't_ai_akcje', 't_ai_uzycie', 't_event_outbox', 't_event_outbox_delivery',
];
const missing = expectedTables.filter((name) => !new RegExp(`create table if not exists ${name}\\s*\\(`, 'i').test(sql));
if (missing.length) throw new Error(`Schema missing model tables: ${missing.join(', ')}`);
const fkCount = (sql.match(/references\s+t_[a-z_]+\s*\(/gi) || []).length;
if (fkCount < 30) throw new Error(`Expected relational foreign keys; found ${fkCount}.`);
for (const field of ['target_minutes', 'existing_work_minutes', 'proposed_minutes', 'total_minutes', 'shortfall_minutes', 'solution_status', 'approved_at timestamptz', 'rejected_at timestamptz', 'max_godzin_dzien', 'event_version', 'idempotency_key', 'message_order', 'szczegoly jsonb']) {
  if (!sql.toLowerCase().includes(field.toLowerCase())) throw new Error(`Schedule persistence field is missing: ${field}.`);
}
console.log(`Schema check passed: ${expectedTables.length} model/extension tables, ${fkCount} FK constraints and schedule result fields.`);
