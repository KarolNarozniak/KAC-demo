import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApi } from '../src/app.js';
import type { ApiOptions } from '../src/api/contracts.js';
import type { Response as OpenAIResponse, ResponseInputItem } from 'openai/resources/responses/responses.js';

const response = (overrides: Record<string, unknown>) => ({ id: 'response-test', status: 'completed', output_text: '', output: [], usage: { input_tokens: 12, output_tokens: 8 }, ...overrides }) as unknown as OpenAIResponse;

test('assistant reconstructs stateless history, calls only registered tools and stores a final response', async () => {
  const messages: Array<{ role: string; content: Record<string, unknown> }> = [];
  let modelCalls = 0;
  const options: ApiOptions = {
    userScope: () => ({ userId: 'U001', calendarId: 'K001' }),
    aiRepository: {
      createConversation: async () => ({ id: 'conversation-1', modelDeployment: 'gpt-5-mini', title: 'Nowa rozmowa', status: 'active',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      getConversation: async () => ({ id: 'conversation-1', modelDeployment: 'gpt-5-mini', title: 'Test', status: 'active',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      listConversations: async () => [],
      appendMessage: async (_scope, _conversationId, role, content) => { messages.push({ role, content }); return { id: String(messages.length), role, content, createdAt: new Date().toISOString() }; },
      listMessages: async () => messages.map((message, index) => ({ id: String(index), ...message, createdAt: new Date().toISOString() })) as never,
      listPendingActions: async () => [], closeConversation: async () => true, logUsage: async () => {},
      createAction: async () => { throw new Error('not used'); }, getAction: async () => null, claimAction: async () => { throw new Error('not used'); },
      completeAction: async () => {}, releaseAction: async () => {}, cancelAction: async () => false, cancelPendingActions: async () => {},
    } as never,
    aiService: {
      sendAssistantMessage: async (input: ResponseInputItem[], tools) => {
        modelCalls++;
        assert.ok(tools.some((tool) => tool.name === 'work_profile_get'));
        if (modelCalls === 1) {
          assert.ok(input.some((item) => 'role' in item && item.role === 'user'));
          return response({ output: [{ type: 'function_call', id: 'fc1', call_id: 'call1', name: 'work_profile_get', arguments: '{}' }] });
        }
        assert.ok(input.some((item) => 'type' in item && item.type === 'function_call_output' && item.call_id === 'call1'));
        return response({ output_text: 'Masz profil pracy z celem 20 godzin.' });
      },
      extractSchedule: async () => { throw new Error('not used'); },
    },
  };
  const app = buildApi({
    checkConnection: async () => {}, getOverview: async () => ({ user: { timezone: 'Europe/Warsaw' }, events: [], calendar: { id: 'K001' }, counts: { events: 0, categories: 0 } } as never),
  }, [], options);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations', payload: { title: 'Test planowania' } });
    assert.equal(created.statusCode, 201, created.body);
    const sent = await app.inject({ method: 'POST', url: '/api/v1/assistant/conversations/conversation-1/messages', payload: { content: 'Ile godzin mam w celu?' } });
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal(sent.json().message.content, 'Masz profil pracy z celem 20 godzin.');
    assert.equal(modelCalls, 2);
    assert.equal(messages.filter((message) => message.role === 'user').length, 1);
    assert.equal(messages.filter((message) => message.role === 'tool').length, 1);
    assert.equal(messages.filter((message) => message.role === 'assistant').length, 2);
  } finally { await app.close(); }
});
