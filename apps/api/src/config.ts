import 'dotenv/config';
import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
dotenv.config({ path: resolve(repositoryRoot, '.env') });
if (process.env.NODE_ENV !== 'production') {
  const localAi = dotenv.config({ path: resolve(repositoryRoot, '.env.ai.local') }).parsed ?? {};
  for (const key of ['AZURE_AI_PROJECT_ENDPOINT', 'AZURE_AI_MODEL_DEPLOYMENT', 'AZURE_AI_AUTH_MODE', 'AZURE_AI_CLIENT_ID']) {
    if (!process.env[key]?.trim() && localAi[key]?.trim()) process.env[key] = localAi[key];
  }
}

const parsePort = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
};

const positiveInt = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
};

export const config = {
  port: parsePort(process.env.PORT || process.env.API_PORT, 4000),
  databaseUrl: process.env.DATABASE_URL?.trim() || '',
  databaseSsl: process.env.PGSSLMODE === 'require',
  outboxPollIntervalMs: positiveInt(process.env.OUTBOX_POLL_INTERVAL_MS, 5_000, 60_000),
  outboxBatchSize: positiveInt(process.env.OUTBOX_BATCH_SIZE, 20, 200),
  webPush: {
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? '',
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? '',
    subject: process.env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? '',
    get enabled() { return Boolean(this.publicKey && this.privateKey && this.subject); },
  },
  corsOrigins: (process.env.API_CORS_ORIGINS || 'http://localhost:8081,http://localhost:8080,http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  demoUserId: process.env.DB_DEMO_USER_ID || 'U001',
  demoCalendarId: process.env.DB_DEMO_CALENDAR_ID || 'K001',
  /** Odczyt grafiku pracy: 'local' (PDF + OCR na serwerze) albo 'demo' (przykładowy grafik, bez OCR). */
  workScheduleReader: process.env.WORK_SCHEDULE_READER?.trim().toLowerCase() === 'demo' ? 'demo' as const : 'local' as const,
  azureAi: {
    projectEndpoint: process.env.AZURE_AI_PROJECT_ENDPOINT?.trim() ?? '',
    agentName: process.env.AZURE_AI_AGENT_NAME?.trim() ?? '',
    modelDeployment: process.env.AZURE_AI_MODEL_DEPLOYMENT?.trim() || 'gpt-5-mini',
    authMode: process.env.AZURE_AI_AUTH_MODE?.trim().toLowerCase() === 'managed-identity' ? 'managed-identity' as const : 'azure-cli' as const,
    managedIdentityClientId: process.env.AZURE_AI_CLIENT_ID?.trim() || undefined,
    timeoutMs: positiveInt(process.env.AZURE_AI_TIMEOUT_MS, 60_000, 180_000),
    maxFileBytes: positiveInt(process.env.AZURE_AI_MAX_FILE_BYTES, 5 * 1024 * 1024, 20 * 1024 * 1024),
    maxPdfPages: positiveInt(process.env.AZURE_AI_MAX_PDF_PAGES, 10, 100),
    maxImagePixels: positiveInt(process.env.AZURE_AI_MAX_IMAGE_PIXELS, 20_000_000, 100_000_000),
    maxToolRounds: positiveInt(process.env.AZURE_AI_MAX_TOOL_ROUNDS, 3, 8),
    conversationRetentionDays: positiveInt(process.env.AI_CONVERSATION_RETENTION_DAYS, 30, 3650),
    pendingActionTtlMinutes: positiveInt(process.env.AI_ACTION_TTL_MINUTES, 15, 240),
  },
  /**
   * Import z Google Calendar (S23KC2S1P2-27). Bez GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET działa konto demonstracyjne.
   * GOOGLE_REDIRECT_URI musi być dodany w Google Cloud Console jako „Authorized redirect URI”.
   */
  google: process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
    ? {
      clientId: process.env.GOOGLE_CLIENT_ID.trim(),
      clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
      redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:4000/api/v1/import/google/callback',
    }
    : null,
};
