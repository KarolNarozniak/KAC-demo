import 'dotenv/config';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
dotenv.config({ path: resolve(repositoryRoot, '.env') });

const parsePort = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
};

export const config = {
  port: parsePort(process.env.PORT || process.env.API_PORT, 4000),
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  databaseSsl: process.env.PGSSLMODE === 'require',
  corsOrigins: (process.env.API_CORS_ORIGINS || 'http://localhost:8081,http://localhost:8080')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  demoUserId: process.env.DB_DEMO_USER_ID || 'U001',
  demoCalendarId: process.env.DB_DEMO_CALENDAR_ID || 'K001',
  /** Odczyt grafiku pracy: 'local' (PDF + OCR na serwerze) albo 'demo' (przykładowy grafik, bez OCR). */
  workScheduleReader: process.env.WORK_SCHEDULE_READER?.trim().toLowerCase() === 'demo' ? 'demo' as const : 'local' as const,
};
