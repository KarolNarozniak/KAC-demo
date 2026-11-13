import { FoundryAgentClient } from '../src/ai/foundry.js';
import { config } from '../src/config.js';

if (!config.azureAi.projectEndpoint || !config.azureAi.agentName) throw new Error('Set AZURE_AI_PROJECT_ENDPOINT and AZURE_AI_AGENT_NAME to test the separate hosted preview agent.');
const client = new FoundryAgentClient(config.azureAi);
const prompt = process.argv.slice(2).join(' ') || 'Reply in Polish with a short greeting.';
const conversationId = await client.createConversation([{ type: 'message', role: 'user', content: prompt }]);
try {
  const response = await client.respond(conversationId);
  console.log(JSON.stringify({ status: response.status, output: response.output_text, model: response.model }, null, 2));
} finally {
  await client.deleteConversation(conversationId).catch(() => undefined);
}
