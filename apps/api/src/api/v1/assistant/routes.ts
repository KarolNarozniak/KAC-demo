import type { FastifyInstance } from 'fastify';
import type { ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses.js';
import { CollisionError, EventNotFoundError, EventValidationError } from '../../../collisions.js';
import { config } from '../../../config.js';
import type { ApiDependencies } from '../../contracts.js';
import { AiActionConflictError, AiActionNotFoundError, AiConversationNotFoundError } from '../../../ai/repository.js';
import { assistantTools, executeAssistantTool } from '../../../ai/tools.js';
import type { EventInput } from '../../../database.js';
import type { AiMessage } from '../../../ai/repository.js';
import { withExamples } from '../../examples.js';

const idSchema = { type: 'string', minLength: 1, maxLength: 100 } as const;
const objectResponse = { type: 'object', description: 'Sukces: obiekt JSON opisany dla danej operacji.', additionalProperties: true,
  'x-examples': { success: { summary: 'Przykładowa odpowiedź', description: 'Syntetyczny kształt bazowy; szczegóły zależą od operacji.', value: { status: 'ok' } } } } as const;
const errorResponse = { type: 'object', description: 'Błąd domenowy lub infrastrukturalny.', required: ['error'], properties: { error: { type: 'string' }, conflicts: { type: 'array', items: { type: 'object', additionalProperties: true } } }, additionalProperties: true,
  'x-examples': { error: { summary: 'Błąd operacji', description: 'Kod `error` zależy od operacji.', value: { error: 'request_failed' } } } } as const;
const conversationParams = { type: 'object', required: ['id'], properties: { id: idSchema } } as const;
const actionParams = { type: 'object', required: ['id'], properties: { id: idSchema } } as const;

function messagesToResponseInput(messages: AiMessage[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  for (const message of messages) {
    const content = message.content;
    if (message.role === 'user' && typeof content.text === 'string') {
      input.push({ role: 'user', content: content.text });
    } else if (message.role === 'assistant') {
      const calls = Array.isArray(content.toolCalls) ? content.toolCalls : [];
      for (const value of calls) {
        if (!value || typeof value !== 'object') continue;
        const call = value as Record<string, unknown>;
        if (typeof call.id === 'string' && typeof call.callId === 'string' && typeof call.name === 'string' && typeof call.arguments === 'string') {
          input.push({ type: 'function_call', id: call.id, call_id: call.callId, name: call.name, arguments: call.arguments });
        }
      }
      if (typeof content.text === 'string' && content.text) input.push({ role: 'assistant', content: content.text });
    } else if (message.role === 'tool' && typeof content.callId === 'string') {
      input.push({ type: 'function_call_output', call_id: content.callId, output: JSON.stringify(content.result ?? {}) });
    }
  }
  return input;
}

export async function assistantRoutes(app: FastifyInstance, options: Pick<ApiDependencies, 'repository' | 'aiService' | 'aiRepository' | 'scope' | 'workProfileRepository'>) {
  const { aiService, aiRepository, repository, workProfileRepository, scope } = options;

  app.get('/assistant/config', { schema: { tags: ['Assistant'], summary: 'Get assistant capability status', description: 'Returns whether the configured Foundry agent is available. Does not expose endpoint, agent, or credential details.', operationId: 'getAssistantConfig', response: { 200: objectResponse } } }, async () => ({ enabled: Boolean(aiService && aiRepository) }));

  app.get<{ Querystring: { limit?: number } }>('/assistant/conversations', { schema: { tags: ['Assistant'], summary: 'List current-scope conversations', description: 'Lists active conversations owned by the server-resolved UserScope.', operationId: 'listAssistantConversations', querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 } } }, response: { 200: objectResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiRepository) return reply.code(503).send({ error: 'ai_storage_not_configured' });
    try {
      const conversations = await aiRepository.listConversations(scope(request), request.query.limit ?? 30);
      return { conversations: conversations.map(({ id, title, modelDeployment, createdAt, updatedAt, expiresAt }) => ({ id, title, modelDeployment, createdAt, updatedAt, expiresAt })) };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI conversation list failed');
      return reply.code(503).send({ error: 'ai_storage_unavailable' });
    }
  });

  app.post<{ Body: { title?: string } }>('/assistant/conversations', { schema: { tags: ['Assistant'], summary: 'Start an assistant conversation', description: 'Creates an app-owned conversation. Each Azure Responses turn is stateless and reconstructed from recent PostgreSQL messages.', operationId: 'createAssistantConversation', body: withExamples({ type: 'object', additionalProperties: false, properties: { title: { type: 'string', maxLength: 120 } } }, { titled: { summary: 'Start with a title', description: 'Synthetic example; no user data.', value: { title: 'Plan tygodnia' } } }), response: { 201: objectResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiService || !aiRepository) return reply.code(503).send({ error: 'azure_ai_not_configured' });
    const owner = scope(request);
    const title = request.body?.title?.trim().slice(0, 120) || 'Nowa rozmowa';
    try {
      const conversation = await aiRepository.createConversation(owner, config.azureAi.modelDeployment, config.azureAi.conversationRetentionDays, title);
      return reply.code(201).send({ id: conversation.id, title: conversation.title,
        createdAt: conversation.createdAt, expiresAt: conversation.expiresAt });
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI conversation create failed');
      return reply.code(503).send({ error: 'ai_conversation_unavailable' });
    }
  });

  app.get<{ Params: { id: string } }>('/assistant/conversations/:id/messages', { schema: { tags: ['Assistant'], summary: 'Read conversation messages', description: 'Returns sanitized app-stored messages. Provider conversation identifiers and file bytes are not exposed.', operationId: 'listAssistantMessages', params: conversationParams, response: { 200: objectResponse, 404: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiRepository) return reply.code(503).send({ error: 'ai_storage_not_configured' });
    try {
      const owner = scope(request);
      const messages = await aiRepository.listMessages(owner, request.params.id);
      const pendingActions = await aiRepository.listPendingActions(owner, request.params.id);
      return { messages, pendingActions };
    } catch (error) {
      if (error instanceof AiConversationNotFoundError) return reply.code(404).send({ error: 'conversation_not_found_or_expired' });
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI conversation read failed');
      return reply.code(503).send({ error: 'ai_storage_unavailable' });
    }
  });

  app.post<{ Params: { id: string }; Body: { content: string } }>('/assistant/conversations/:id/messages', { schema: { tags: ['Assistant'], summary: 'Send a message to the assistant', description: 'Runs a bounded Responses turn with the server tool allow-list. Mutations only create pending previews; the user confirms them through a separate endpoint.', operationId: 'sendAssistantMessage', params: conversationParams,
    body: withExamples({ type: 'object', required: ['content'], additionalProperties: false, properties: { content: { type: 'string', minLength: 1, maxLength: 6000 } } }, { request: { summary: 'Send a message', description: 'Synthetic example.', value: { content: 'Pokaż mój plan na jutro.' } } }),
    response: { 200: objectResponse, 400: errorResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse },
  } }, async (request, reply) => {
    if (!aiService || !aiRepository || !repository) return reply.code(503).send({ error: 'azure_ai_not_configured' });
    const owner = scope(request);
    try {
      const conversation = await aiRepository.getConversation(owner, request.params.id);
      if (!conversation) return reply.code(404).send({ error: 'conversation_not_found_or_expired' });
      const content = request.body.content.trim();
      if (!content) return reply.code(400).send({ error: 'message_empty' });
      await aiRepository.appendMessage(owner, conversation.id, 'user', { text: content }, config.azureAi.conversationRetentionDays);
      let history = await aiRepository.listMessages(owner, conversation.id, 24);
      const startedAt = Date.now();
      let response = await aiService.sendAssistantMessage(messagesToResponseInput(history), assistantTools);
      let inputTokens = response.usage?.input_tokens ?? 0;
      let outputTokens = response.usage?.output_tokens ?? 0;
      let toolRounds = 0;
      while (toolRounds < config.azureAi.maxToolRounds) {
        const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');
        if (!calls.length) break;
        toolRounds++;
        const toolCalls = calls.map((call) => ({ id: call.id, callId: call.call_id, name: call.name, arguments: call.arguments }));
        await aiRepository.appendMessage(owner, conversation.id, 'assistant', { toolCalls }, config.azureAi.conversationRetentionDays);
        for (const call of calls) {
          const result = await executeAssistantTool(call.name, call.arguments, {
            scope: owner, conversationId: conversation.id, calendar: repository,
            workProfile: options.workProfileRepository, ai: aiRepository, actionTtlMinutes: config.azureAi.pendingActionTtlMinutes,
          });
          await aiRepository.appendMessage(owner, conversation.id, 'tool', { name: call.name, callId: call.call_id, result }, config.azureAi.conversationRetentionDays);
        }
        history = await aiRepository.listMessages(owner, conversation.id, 24);
        response = await aiService.sendAssistantMessage(messagesToResponseInput(history), assistantTools);
        inputTokens += response.usage?.input_tokens ?? 0;
        outputTokens += response.usage?.output_tokens ?? 0;
      }
      const answer = response.output_text?.trim() || 'Nie udało mi się przygotować odpowiedzi. Spróbuj przeformułować prośbę.';
      const pendingActions = await aiRepository.listPendingActions(owner, conversation.id);
      await aiRepository.appendMessage(owner, conversation.id, 'assistant', { text: answer, pendingActionIds: pendingActions.map((action) => action.id) }, config.azureAi.conversationRetentionDays);
      await aiRepository.logUsage(owner, 'assistant_chat', config.azureAi.modelDeployment, inputTokens, outputTokens, Date.now() - startedAt, 'ok');
      return { conversationId: conversation.id, message: { role: 'assistant', content: answer }, pendingActions, usage: { inputTokens, outputTokens } };
    } catch (error) {
      if (error instanceof AiConversationNotFoundError) return reply.code(404).send({ error: 'conversation_not_found_or_expired' });
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Azure assistant turn failed');
      await aiRepository.logUsage(owner, 'assistant_chat', config.azureAi.modelDeployment, 0, 0, 0, 'error', 'provider_or_tool_error').catch(() => undefined);
      return reply.code(503).send({ error: 'assistant_unavailable' });
    }
  });

  app.post<{ Params: { id: string } }>('/assistant/actions/:id/confirm', { schema: { tags: ['Assistant'], summary: 'Confirm a pending assistant action', description: 'Revalidates a pending proposal and executes it once. The action id is the idempotency key for calendar event creation.', operationId: 'confirmAssistantAction', params: actionParams, response: { 200: objectResponse, 404: errorResponse, 409: errorResponse, 422: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiRepository || !repository) return reply.code(503).send({ error: 'ai_storage_not_configured' });
    const owner = scope(request);
    let action;
    try {
      action = await aiRepository.claimAction(owner, request.params.id);
      if (action.status === 'confirmed') return { status: 'confirmed', eventId: action.eventId ?? null };
      let eventId: string | null = null;
      if (action.kind === 'calendar_event_create') {
        const event = action.payload.event as EventInput;
        if (!repository.createEvent) return reply.code(503).send({ error: 'calendar_not_configured' });
        const created = await repository.createEvent(event, owner.userId, owner.calendarId, action.id);
        eventId = created.id;
      } else if (action.kind === 'calendar_event_update') {
        const event = action.payload.event as EventInput;
        const targetId = String(action.payload.id ?? '');
        if (!repository.updateEvent || !targetId) return reply.code(503).send({ error: 'calendar_not_configured' });
        eventId = (await repository.updateEvent(targetId, event, owner.userId, owner.calendarId)).id;
      } else if (action.kind === 'calendar_event_delete') {
        const targetId = String(action.payload.id ?? '');
        if (!repository.deleteEvent || !targetId) return reply.code(503).send({ error: 'calendar_not_configured' });
        await repository.deleteEvent(targetId, owner.userId, owner.calendarId);
        // A retry after a successful delete is idempotent: the target is already absent.
        eventId = null;
      } else return reply.code(422).send({ error: 'unsupported_action' });
      await aiRepository.completeAction(owner, action.id, eventId!);
      return { status: 'confirmed', actionId: action.id, eventId };
    } catch (error) {
      if (error instanceof AiActionNotFoundError) return reply.code(404).send({ error: 'action_not_found_or_expired' });
      if (error instanceof AiActionConflictError) return reply.code(409).send({ error: error.message });
      await aiRepository.releaseAction(owner, request.params.id, error instanceof CollisionError ? 'event_collision' : 'action_validation_failed').catch(() => undefined);
      if (error instanceof CollisionError) return reply.code(409).send({ error: 'event_collision', conflicts: error.conflicts, collisionToken: error.collisionToken });
      if (error instanceof EventValidationError) return reply.code(422).send({ error: error.message });
      if (error instanceof EventNotFoundError) return reply.code(404).send({ error: error.message });
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Assistant action confirmation failed');
      return reply.code(503).send({ error: 'action_confirmation_failed' });
    }
  });

  app.post<{ Params: { id: string } }>('/assistant/actions/:id/cancel', { schema: { tags: ['Assistant'], summary: 'Cancel a pending assistant action', description: 'Cancels a proposal without changing the calendar.', operationId: 'cancelAssistantAction', params: actionParams, response: { 200: objectResponse, 404: errorResponse, 409: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiRepository) return reply.code(503).send({ error: 'ai_storage_not_configured' });
    try {
      const cancelled = await aiRepository.cancelAction(scope(request), request.params.id);
      return cancelled ? { status: 'cancelled' } : reply.code(409).send({ error: 'action_not_pending' });
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'Assistant action cancellation failed');
      return reply.code(503).send({ error: 'action_cancellation_failed' });
    }
  });

  app.delete<{ Params: { id: string } }>('/assistant/conversations/:id', { schema: { tags: ['Assistant'], summary: 'Delete an assistant conversation', description: 'Closes the app-owned conversation and cancels its pending actions. Foundry Responses calls are stateless and do not keep a remote conversation.', operationId: 'deleteAssistantConversation', params: conversationParams, response: { 200: objectResponse, 404: errorResponse, 503: errorResponse } } }, async (request, reply) => {
    if (!aiRepository) return reply.code(503).send({ error: 'ai_storage_not_configured' });
    try {
      const closed = await aiRepository.closeConversation(scope(request), request.params.id);
      if (!closed) return reply.code(404).send({ error: 'conversation_not_found' });
      await aiRepository.cancelPendingActions(scope(request), request.params.id);
      return { status: 'deleted' };
    } catch (error) {
      request.log.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI conversation deletion failed');
      return reply.code(503).send({ error: 'conversation_delete_failed' });
    }
  });
}
