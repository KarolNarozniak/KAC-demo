import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { PostgresCalendarRepository, pool } from '../src/database.js';
import { PostgresScheduleRepository } from '../src/scheduling/repository.js';
import { PostgresWorkProfileRepository } from '../src/profile/repository.js';
import { AiRepository } from '../src/ai/repository.js';

if (!pool || !config.azureAi.projectEndpoint) throw new Error('DATABASE_URL and AZURE_AI_PROJECT_ENDPOINT are required. Configure .env and .env.ai.local first.');
const fileName = process.argv[2] ?? 'tests/fixtures/ai-import/Plan_test_1.png';
const source = process.argv[3] === 'classes' ? 'classes' : 'work';
const absoluteFile = resolve(process.cwd(), fileName);
const base64 = (await readFile(absoluteFile)).toString('base64');
const repository = new PostgresCalendarRepository(pool);
const aiRepository = new AiRepository(pool);
const app = buildApi(repository, config.corsOrigins, { scheduleRepository: new PostgresScheduleRepository(pool),
  workProfileRepository: new PostgresWorkProfileRepository(pool), aiRepository });
let sessionId: string | undefined;
const eventsBefore = await pool.query('select count(*)::integer as count from t_wydarzenia where id_kalendarza = $1 and status = $2', [config.demoCalendarId, 'Aktywne']);
try {
  const response = await app.inject({ method: 'POST', url: '/api/v1/import/ai/read', payload: { fileName: absoluteFile.split(/[\\/]/).pop(), dataBase64: base64, source } });
  if (response.statusCode !== 201) throw new Error(`AI import returned HTTP ${response.statusCode}: ${response.json().error ?? 'unknown error'}`);
  const result = response.json();
  sessionId = result.importSessionId;
  const eventsAfter = await pool.query('select count(*)::integer as count from t_wydarzenia where id_kalendarza = $1 and status = $2', [config.demoCalendarId, 'Aktywne']);
  if (eventsAfter.rows[0].count !== eventsBefore.rows[0].count) throw new Error('AI preview changed the calendar before user confirmation.');
  console.log(JSON.stringify({ source, fileType: result.fileType, pageCount: result.filePageCount,
    importSessionCreated: Boolean(sessionId), rows: result.rows.length, previewErrors: result.preview.filter((row: { status: string }) => row.status === 'error').length,
    calendarUnchanged: true, usage: result.usage }, null, 2));
} finally {
  if (sessionId) {
    await repository.cancelImportSession?.(sessionId, config.demoUserId).catch(() => undefined);
    await pool.query('delete from t_importy where id_importu = $1', [sessionId]);
  }
  await app.close();
  await pool.end();
}
