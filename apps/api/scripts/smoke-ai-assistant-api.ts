import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { demoScope } from '../src/api/scope.js';
import { pool, PostgresCalendarRepository } from '../src/database.js';
import { AiRepository } from '../src/ai/repository.js';
import { PostgresScheduleRepository } from '../src/scheduling/repository.js';
import { PostgresWorkProfileRepository } from '../src/profile/repository.js';
import { DemoScheduleReader } from '../src/import/work-schedule/reader.js';

if (!pool || !config.azureAi.projectEndpoint) throw new Error('DATABASE_URL and AZURE_AI_PROJECT_ENDPOINT are required.');
const repository = new PostgresCalendarRepository(pool);
const aiRepository = new AiRepository(pool);
const app = buildApi(repository, config.corsOrigins, { scheduleReader: new DemoScheduleReader(), scheduleRepository: new PostgresScheduleRepository(pool),
  workProfileRepository: new PostgresWorkProfileRepository(pool), aiRepository, userScope: demoScope });
let conversationId: string | undefined;
try {
  const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations', payload: { title: 'Smoke test (synthetic)' } });
  if (created.statusCode !== 201) throw new Error(`Conversation creation failed with HTTP ${created.statusCode}.`);
  conversationId = created.json().id;
  const response = await app.inject({ method: 'POST', url: `/api/v1/assistant/conversations/${conversationId}/messages`,
    payload: { content: 'Sprawdź mój profil pracy narzędziem work_profile_get i odpowiedz tylko: „Profil odczytany”. Nie zmieniaj żadnych danych.' } });
  if (response.statusCode !== 200) throw new Error(`Assistant request failed with HTTP ${response.statusCode}: ${response.json().error ?? 'unknown'}.`);
  const storedMessages = await aiRepository.listMessages(demoScope({} as never), conversationId);
  console.log(JSON.stringify({ modelDeployment: config.azureAi.modelDeployment, status: response.statusCode,
    response: response.json().message.content, pendingActions: response.json().pendingActions.length,
    toolCallsExecuted: storedMessages.filter((message) => message.role === 'tool').length,
    usage: response.json().usage }, null, 2));
} finally {
  if (conversationId) await aiRepository.closeConversation(demoScope({} as never), conversationId).catch(() => false);
  await app.close();
  await pool.end();
}
