import { AIProjectClient } from '@azure/ai-projects';
import { AzureCliCredential } from '@azure/identity';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assistantTools } from '../src/ai/tools.js';
import { AiService } from '../src/ai/service.js';
import { FoundryResponsesClient } from '../src/ai/foundry.js';
import { validateAiFile } from '../src/ai/file-validation.js';
import { config } from '../src/config.js';

if (!config.azureAi.projectEndpoint) throw new Error('Set AZURE_AI_PROJECT_ENDPOINT first.');
const project = new AIProjectClient(config.azureAi.projectEndpoint, new AzureCliCredential());
const openai = project.getOpenAIClient();
const model = config.azureAi.modelDeployment;
const [mode = 'text', fileArg, source = 'work'] = process.argv.slice(2);
let request: Parameters<typeof openai.responses.create>[0] = { model, input: 'Reply in Polish with a short greeting.', store: false, max_output_tokens: 150 };

if (mode === 'tools') {
  request = { model, store: false, input: 'Read my work profile using the allowed work_profile_get tool.',
    tools: assistantTools, tool_choice: 'required', parallel_tool_calls: false, max_output_tokens: 1000 };
} else if (mode === 'structured') {
  request = { ...request, instructions: 'Return JSON with one property "reply" containing a short greeting.',
    max_output_tokens: 1000,
    text: { format: { type: 'json_schema', name: 'smoke_reply', strict: true, schema: {
      type: 'object', required: ['reply'], additionalProperties: false, properties: { reply: { type: 'string' } },
    } } } };
} else if (mode === 'file') {
  if (!fileArg || (source !== 'work' && source !== 'classes')) throw new Error('Usage: ai:smoke:responses -- file <path> [work|classes]');
  const fileName = resolve(process.cwd(), fileArg);
  const file = await validateAiFile(fileName, (await readFile(fileName)).toString('base64'), config.azureAi.maxPdfPages, config.azureAi.maxImagePixels);
  const service = new AiService(new FoundryResponsesClient(config.azureAi));
  const result = await service.extractSchedule(file, source, 'Użytkownik testowy');
  console.log(JSON.stringify({ model, mode, fileType: file.type, pageCount: file.pageCount, rows: result.rows.length,
    requiresReview: result.rows.filter((row) => Boolean(row.unresolvedFields?.length) || (row.confidence ?? 0) < 0.7).length,
    usage: result.usage }, null, 2));
} else {
  const response = await openai.responses.create(request);
  console.log(JSON.stringify({ model, mode, status: response.status, output: response.output_text, usage: response.usage,
    toolCalls: response.output.filter((item) => item.type === 'function_call').map((item) => item.name) }, null, 2));
}
