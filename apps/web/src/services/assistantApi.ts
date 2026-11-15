import { apiBaseUrl } from './importApi.ts';

export type AssistantMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: Record<string, unknown>; createdAt: string };
export type AssistantConversation = { id: string; title: string; modelDeployment: string; createdAt: string; updatedAt: string; expiresAt: string };
export type PreviewCollision = { id: string; title: string; category: 'Class' | 'Work' | 'Personal'; startLocal: string; endLocal: string };
export type PendingAssistantAction = { id: string; kind: string; payload: Record<string, unknown>; expiresAt: string;
  /** S23KC2S1P2-263: kolizje liczone przez API przy każdym odczycie; niepusta lista blokuje zatwierdzenie. */
  collisions?: PreviewCollision[]; validationError?: string };

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
  assistant_rate_limited: 'Azure AI ograniczył liczbę żądań. Poczekaj chwilę i spróbuj ponownie.',
  assistant_timeout: 'Odpowiedź asystenta przekroczyła limit czasu. Możesz wysłać krótszą wiadomość i spróbować ponownie.',
  ai_action_stale_preview: 'Wydarzenie zmieniło się od czasu przygotowania podglądu. Poproś o nową propozycję.',
  action_not_found_or_expired: 'Ta propozycja wygasła lub nie istnieje. Poproś asystenta o przygotowanie nowej.',
  conversation_not_found_or_expired: 'Ta rozmowa wygasła lub nie istnieje. Rozpocznij nową rozmowę.',
  invalid_date: 'Nieprawidłowa data podsumowania.',
  calendar_unavailable: 'Nie udało się odczytać kalendarza. Spróbuj ponownie.',
  calendar_not_configured: 'Kalendarz nie jest skonfigurowany w API.',
  calendar_not_found: 'Nie znaleziono kalendarza.',
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

export type DaySummary = {
  date: string; timeZone: string; status: 'ai' | 'local' | 'empty'; text: string; aiAvailable: boolean; cached: boolean;
  generatedAt: string; fingerprint: string; aiError?: string;
  facts: {
    events: Array<{ id: string; title: string; category: 'Class' | 'Work' | 'Personal'; location: string; mandatory: boolean; repeatWeekly: boolean;
      startLocal: string; endLocal: string; startsBeforeDay: boolean; endsAfterDay: boolean }>;
    gaps: Array<{ date: string; startLocal: string; endLocal: string; minutes: number; label: string }>;
    totals: { classMinutes: number; workMinutes: number; personalMinutes: number; busyMinutes: number };
  };
};

/** S23KC2S1P2-271: podsumowanie dnia z faktami wyliczonymi przez backend; refresh wymusza nowe wywołanie modelu. */
export const getDaySummary = (date: string, refresh = false) =>
  call<DaySummary>(`/api/v1/assistant/day-summary?date=${encodeURIComponent(date)}${refresh ? '&refresh=true' : ''}`);
