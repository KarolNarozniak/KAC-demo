import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(resolve(here, '../migrations/001_initial_model.sql'), 'utf8');
const expectedTables = [
  't_uzytkownicy', 't_kalendarze', 't_kategorie', 't_serie', 't_wydarzenia',
  't_profile_pracy', 't_dostepnosc', 't_prefer_godziny', 't_blokady', 't_miejsca',
  't_dojazdy', 't_grafiki', 't_zmiany_pracy', 't_korekty_grafiku', 't_ograniczenia_grafiku',
  't_kolizje', 't_importy', 't_pozycje_importu', 't_konta_google', 't_kalendarze_google',
  't_synchronizacje', 't_publikacje', 't_ustaw_powiadomien', 't_powiadomienia', 't_zmiany_historii',
];
const missing = expectedTables.filter((name) => !new RegExp(`create table if not exists ${name}\\s*\\(`, 'i').test(sql));
if (missing.length) throw new Error(`Schema missing model tables: ${missing.join(', ')}`);
const fkCount = (sql.match(/references\s+t_[a-z_]+\s*\(/gi) || []).length;
if (fkCount < 30) throw new Error(`Expected relational foreign keys; found ${fkCount}.`);
console.log(`Schema check passed: ${expectedTables.length} model tables, ${fkCount} FK constraints.`);
