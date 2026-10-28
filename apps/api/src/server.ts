import { buildApi } from './app.js';
import { config } from './config.js';
import { pool, PostgresCalendarRepository } from './database.js';
import { LocalScheduleReader } from './import/work-schedule/local-reader.js';
import { DemoScheduleReader } from './import/work-schedule/reader.js';

const repository = pool ? new PostgresCalendarRepository(pool) : null;
// Odczyt grafiku pracy (S23KC2S1P2-44): domyślnie prawdziwy (PDF + lokalny OCR), WORK_SCHEDULE_READER=demo włącza przykładowe dane.
// WORK_SCHEDULE_DEBUG=1 wypisuje w terminalu API odczytany tekst (tylko do diagnozy na własnym komputerze).
const printText = (source: string, lines: { text: string; confidence: number }[]) =>
  console.log(`[grafik ${source}]\n${lines.map((line) => `${Math.round(line.confidence * 100)}% ${line.text}`).join('\n')}`);
const scheduleReader = config.workScheduleReader === 'demo'
  ? new DemoScheduleReader()
  : new LocalScheduleReader(process.env.WORK_SCHEDULE_DEBUG === '1' ? { onText: printText } : {});
const app = buildApi(repository, config.corsOrigins, { scheduleReader });

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(`KAC API listening on 0.0.0.0:${config.port}`);
} catch (error) {
  app.log.error(error);
  await pool?.end();
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await pool?.end();
};

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
