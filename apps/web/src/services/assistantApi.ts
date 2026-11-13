import { apiBaseUrl } from './importApi';

export type AssistantMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: Record<string, unknown>; createdAt: string };
export type AssistantConversation = { id: string; title: string; modelDeployment: string; createdAt: string; updatedAt: string; expiresAt: string };
export type PendingAssistantAction = { id: string; kind: string; payload: Record<string, unknown>; expiresAt: string };

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(aiErrorText[result.error] ?? `Asystent API zwróciło HTTP ${response.status}.`);
  return result as T;
}

const aiErrorText: Record<string, string> = {
  azure_ai_not_configured: 'Azure AI Foundry nie jest skonfigurowane dla API.',
  ai_storage_not_configured: 'Baza rozmów AI nie jest skonfigurowana.',
  assistant_unavailable: 'Asystent jest chwilowo niedostępny. Wiadomość pozostała w historii, możesz spróbować ponownie.',
  conversation_not_found_or_expired: 'Ta rozmowa wygasła lub nie istnieje. Rozpocznij nową rozmowę.',
  event_collision: 'Ta propozycja koliduje z wydarzeniem w kalendarzu. Sprawdź kalendarz i popraw propozycję.',
};

export const getAssistantConfig = () => call<{ enabled: boolean }>('/api/v1/assistant/config');
export const listAssistantConversations = () => call<{ conversations: AssistantConversation[] }>('/api/v1/assistant/conversations');
export const createAssistantConversation = (title?: string) => call<AssistantConversation>('/api/v1/assistant/conversations', 'POST', title ? { title } : {});
export const listAssistantMessages = (id: string) => call<{ messages: AssistantMessage[]; pendingActions: PendingAssistantAction[] }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}/messages`);
export const sendAssistantMessage = (id: string, content: string) => call<{ conversationId: string; message: { role: string; content: string }; pendingActions: PendingAssistantAction[]; usage: { inputTokens: number; outputTokens: number } }>(
  `/api/v1/assistant/conversations/${encodeURIComponent(id)}/messages`, 'POST', { content });
export const confirmAssistantAction = (id: string) => call<{ status: string; actionId?: string; eventId: string | null }>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/confirm`, 'POST', {});
export const cancelAssistantAction = (id: string) => call<{ status: string }>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/cancel`, 'POST', {});
export const deleteAssistantConversation = (id: string) => call<{ status: string }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`, 'DELETE');
