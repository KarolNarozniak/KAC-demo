import { buildApi } from './app.js';
import { config } from './config.js';
import { pool, PostgresCalendarRepository } from './database.js';

const repository = pool ? new PostgresCalendarRepository(pool) : null;
const app = buildApi(repository, config.corsOrigins);

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
