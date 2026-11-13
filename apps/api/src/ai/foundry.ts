import { AIProjectClient } from '@azure/ai-projects';
import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';
import type OpenAI from 'openai';
import type { ResponseInputItem, Response as OpenAIResponse, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses.js';

export type FoundryConnectionConfig = {
  projectEndpoint: string;
  agentName: string;
  authMode: 'azure-cli' | 'managed-identity';
  managedIdentityClientId?: string;
  timeoutMs: number;
};
export type FoundryResponsesConfig = Omit<FoundryConnectionConfig, 'agentName'> & { modelDeployment: string };
export type FoundryResponsesRequest = Omit<ResponseCreateParamsNonStreaming, 'model'>;
export type FoundryResponsesProvider = { respond(options: FoundryResponsesRequest): Promise<OpenAIResponse> };

export class FoundryResponsesClient implements FoundryResponsesProvider {
  private readonly client: OpenAI;

  constructor(private readonly settings: FoundryResponsesConfig) {
    const credential = settings.authMode === 'managed-identity'
      ? settings.managedIdentityClientId
        ? new ManagedIdentityCredential(settings.managedIdentityClientId)
        : new ManagedIdentityCredential()
      : new AzureCliCredential();
    const project = new AIProjectClient(settings.projectEndpoint, credential);
    // No agentName is supplied: this is a stateless model Responses API client, not Hosted Agent Service.
    this.client = project.getOpenAIClient({ timeout: settings.timeoutMs, maxRetries: 0 });
  }

  respond(options: FoundryResponsesRequest) {
    return this.client.responses.create({ ...options, model: this.settings.modelDeployment, store: false });
  }
}

export type FoundryCallResult = {
  conversationId: string;
  response: OpenAIResponse;
};

export type FoundryConversationClient = {
  createConversation: (initialItems?: ResponseInputItem[], metadata?: Record<string, string>) => Promise<string>;
  respond: (conversationId: string, options?: Omit<ResponseCreateParamsNonStreaming, 'conversation'>) => Promise<OpenAIResponse>;
  deleteConversation: (conversationId: string) => Promise<void>;
};

export class FoundryProviderError extends Error {
  constructor(readonly stage: 'conversation_create' | 'response_create' | 'conversation_cleanup', readonly status?: number,
    readonly providerCode?: string, readonly requestId?: string) { super('azure_ai_provider_request_failed'); }
}

export class FoundryAgentClient implements FoundryConversationClient {
  private readonly client: OpenAI;

  constructor(private readonly settings: FoundryConnectionConfig) {
    const credential = settings.authMode === 'managed-identity'
      ? settings.managedIdentityClientId
        ? new ManagedIdentityCredential(settings.managedIdentityClientId)
        : new ManagedIdentityCredential()
      : new AzureCliCredential();
    const project = new AIProjectClient(settings.projectEndpoint, credential);
    this.client = project.getOpenAIClient({
      timeout: settings.timeoutMs,
      maxRetries: 0,
      azureConfig: { allowPreview: true, agentName: settings.agentName },
    });
  }

  async createConversation(initialItems: ResponseInputItem[] = [], metadata?: Record<string, string>) {
    try {
      const conversation = await this.client.conversations.create({ items: initialItems, metadata });
      return conversation.id;
    } catch (error) { throw this.wrapError('conversation_create', error); }
  }

  respond(conversationId: string, options: Omit<ResponseCreateParamsNonStreaming, 'conversation'> = {}) {
    return this.client.responses.create({ conversation: conversationId, ...options }).catch((error) => { throw this.wrapError('response_create', error); });
  }

  async deleteConversation(conversationId: string) {
    // The Foundry conversation delete endpoint does not delete its items, so remove them first.
    for (let attempt = 0; attempt < 10; attempt++) {
      const page = await this.client.conversations.items.list(conversationId, { limit: 100 });
      if (!page.data.length) break;
      for (const item of page.data) if (item.id) await this.client.conversations.items.delete(item.id, { conversation_id: conversationId });
    }
    try { await this.client.conversations.delete(conversationId); }
    catch (error) { throw this.wrapError('conversation_cleanup', error); }
  }

  private wrapError(stage: FoundryProviderError['stage'], error: unknown) {
    const value = error && typeof error === 'object' ? error as { status?: number; code?: string; requestID?: string } : {};
    return new FoundryProviderError(stage, value.status, value.code, value.requestID);
  }

}
