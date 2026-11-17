import { config } from './config.js';
import { pool } from './database.js';
import { AiRepository } from './ai/repository.js';
import { PostgresEventOutboxWorker } from './events/outbox-worker.js';
import { createGoogleIntegrationService } from './integrations/google/service.js';
import { WebPushNotificationWorker } from './notifications/web-push-worker.js';

if (!pool) throw new Error('DATABASE_URL is required to run the outbox worker.');

// Korekty opublikowanych zmian (G09) – te same zasady i tokeny co w API: prawdziwy zapis dla kont Google, symulacja dla demonstracyjnych.
const google = createGoogleIntegrationService(pool, config.googleIntegration);
const outbox = new PostgresEventOutboxWorker(pool, config.outboxBatchSize, undefined, google.correctionEngine);
const ai = new AiRepository(pool);
const webPush = config.webPush.enabled ? new WebPushNotificationWorker(pool, config.webPush) : null;
let stopped = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { stopped = true; });
}

console.log('KAC transactional outbox worker started.');
while (!stopped) {
  try {
    const processed = await outbox.runOnce();
    const pushed = await webPush?.runOnce() ?? 0;
    await ai.expireConversationRetention(100);
    await ai.expirePendingActions(500);
    if (processed === 0 && pushed === 0) await new Promise((resolve) => setTimeout(resolve, config.outboxPollIntervalMs));
  } catch (error) {
    console.error('Outbox worker iteration failed', { name: error instanceof Error ? error.name : 'unknown' });
    await new Promise((resolve) => setTimeout(resolve, config.outboxPollIntervalMs));
  }
}

await pool.end();
console.log('KAC transactional outbox worker stopped.');
