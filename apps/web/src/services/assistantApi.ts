import { apiBaseUrl } from './importApi.ts';
import type { CalendarEvent } from '../domain/model.ts';
import { dailySummaryContext } from '../domain/dailySummary.ts';
import { getAssistantPreferences } from '../domain/assistantPreferences.ts';
import { authFetch } from './http.ts';

export type AssistantMessage = { id: string; role: 'user' | 'assistant' | 'tool'; content: Record<string, unknown>; createdAt: string };
export type AssistantConversation = { id: string; title: string; modelDeployment: string; createdAt: string; updatedAt: string; expiresAt: string };
export type PendingAssistantAction = { id: string; kind: string; payload: Record<string, unknown>; expiresAt: string };
export type AssistantCollision = { id: string; title: string; start: string; end: string };
export class AssistantApiError extends Error {
  code: string;
  conflicts: AssistantCollision[];
  collisionToken?: string;
  pendingActions?: PendingAssistantAction[];
  constructor(code: string, conflicts: AssistantCollision[] = [], collisionToken?: string, pendingActions?: PendingAssistantAction[]) {
    super(aiErrorText[code] ?? 'Nie udało się wykonać operacji asystenta. Spróbuj ponownie.');
    this.code = code;
    this.conflicts = conflicts;
    this.collisionToken = collisionToken;
    this.pendingActions = pendingActions;
  }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authFetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssistantApiError(result.error ?? `http_${response.status}`, result.conflicts, result.collisionToken, result.pendingActions);
  return result as T;
}

const aiErrorText: Record<string, string> = {
  azure_ai_not_configured: 'Azure AI Foundry nie jest skonfigurowane dla API.',
  ai_storage_not_configured: 'Baza rozmów AI nie jest skonfigurowana.',
  assistant_unavailable: 'Asystent jest chwilowo niedostępny. Wiadomość pozostała w historii, możesz spróbować ponownie.',
  assistant_rate_limited: 'Azure AI ograniczył liczbę żądań. Poczekaj chwilę i spróbuj ponownie.',
  ai_daily_limit: 'Wykorzystano dzienny limit asystenta AI dla tego konta. Spróbuj ponownie jutro – kalendarz działa bez zmian.',
  assistant_timeout: 'Odpowiedź asystenta przekroczyła limit czasu. Możesz wysłać krótszą wiadomość i spróbować ponownie.',
  ai_action_stale_preview: 'Wydarzenie zmieniło się od czasu przygotowania podglądu. Poproś o nową propozycję.',
  action_not_found_or_expired: 'Ta propozycja wygasła lub nie istnieje. Poproś asystenta o przygotowanie nowej.',
  conversation_not_found_or_expired: 'Ta rozmowa wygasła lub nie istnieje. Rozpocznij nową rozmowę.',
  event_collision: 'Ta propozycja koliduje z wydarzeniem w kalendarzu. Sprawdź kalendarz i popraw propozycję.',
  ai_action_processing: 'Trwa zapis tej propozycji. Poczekaj chwilę i ponów zatwierdzenie.',
  ai_action_cancelled: 'Ta propozycja została anulowana.',
  ai_action_expired: 'Ta propozycja wygasła. Poproś o nową.',
  action_confirmation_failed: 'Nie udało się potwierdzić wyniku zapisu. Ponów zatwierdzenie tej samej propozycji — nie utworzy to duplikatu.',
  assistant_incomplete_response: 'Model nie dokończył odpowiedzi. Spróbuj ponownie za chwilę.',
  assistant_content_filtered: 'Azure zablokował tę wiadomość filtrem treści. Kalendarz nie został zmieniony.',
  assistant_refused: 'Model odmówił realizacji prośby. Kalendarz nie został zmieniony.',
  assistant_tool_limit: 'Osiągnięto limit przygotowywania propozycji. Gotowe propozycje są poniżej; kalendarz nie został zmieniony. Poproś o przygotowanie pozostałych.',
  assistant_stream_interrupted: 'Połączenie zostało przerwane przed zakończeniem odpowiedzi. Otwórz ponownie rozmowę, aby sprawdzić jej zapisany stan.',
};

export const getAssistantConfig = () => call<{ enabled: boolean }>('/api/v1/assistant/config');
const listAllConversations = () => call<{ conversations: AssistantConversation[] }>('/api/v1/assistant/conversations');
export const listAssistantConversations = async () => {
  const result = await listAllConversations();
  return { conversations: result.conversations.filter((item) => !/^Dzień w skrócie \d{4}-\d{2}-\d{2}$/.test(item.title)) };
};
export const createAssistantConversation = (title?: string) => call<AssistantConversation>('/api/v1/assistant/conversations', 'POST', title ? { title } : {});
export const listAssistantMessages = (id: string) => call<{ messages: AssistantMessage[]; pendingActions: PendingAssistantAction[] }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}/messages`);
export const sendAssistantMessage = (id: string, content: string) => call<{ conversationId: string; message: { role: string; content: string }; pendingActions: PendingAssistantAction[]; usage: { inputTokens: number; outputTokens: number } }>(
  `/api/v1/assistant/conversations/${encodeURIComponent(id)}/messages`, 'POST', { content, preferences: getAssistantPreferences() });
export type AssistantTurnResult = Awaited<ReturnType<typeof sendAssistantMessage>>;
export type AssistantStreamEvent =
  | { type: 'accepted'; message: AssistantMessage }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; result: AssistantTurnResult }
  | { type: 'error'; error: string; pendingActions?: PendingAssistantAction[] };

export async function streamAssistantMessage(id: string, content: string, onEvent: (event: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<AssistantTurnResult> {
  const timeout = AbortSignal.timeout(120_000);
  const response = await authFetch(`${apiBaseUrl()}/api/v1/assistant/conversations/${encodeURIComponent(id)}/messages?stream=true`, {
    method: 'POST', headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, preferences: getAssistantPreferences() }), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new AssistantApiError(result.error ?? `http_${response.status}`, [], undefined, result.pendingActions);
  }
  let result: AssistantTurnResult | undefined;
  let buffer = '';
  const consume = (text: string) => {
    buffer += text;
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AssistantStreamEvent;
      if (event.type === 'error') throw new AssistantApiError(event.error, [], undefined, event.pendingActions);
      if (event.type === 'done') result = event.result;
      onEvent(event);
    }
  };
  const reader = response.body?.getReader();
  try {
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        consume(decoder.decode(chunk.value, { stream: true }));
      }
      consume(decoder.decode());
    } else consume(await response.text());
    if (buffer.trim()) consume('\n');
    if (!result) throw new AssistantApiError('assistant_stream_interrupted');
    return result;
  } finally { await reader?.cancel().catch(() => undefined); reader?.releaseLock(); }
}
export const confirmAssistantAction = (id: string, collisionToken?: string) => call<{ status: string; actionId?: string; eventId: string | null }>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/confirm`, 'POST', collisionToken ? { collisionToken } : {});
export async function confirmAssistantActions(ids: string[], onConfirmed: (id: string) => void, collisionToken?: string) {
  for (const id of ids) {
    await confirmAssistantAction(id, collisionToken);
    onConfirmed(id);
  }
}
export const cancelAssistantAction = (id: string) => call<{ status: string }>(`/api/v1/assistant/actions/${encodeURIComponent(id)}/cancel`, 'POST', {});
export const deleteAssistantConversation = (id: string) => call<{ status: string }>(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`, 'DELETE');

export const dailySummaryPrompt = 'Podsumuj krótko wydarzenia na dziś, korzystając z kalendarza i zaufanej bieżącej daty oraz strefy czasu konta. Napisz po polsku 2–4 zdania: podaj najważniejsze wydarzenia z godzinami oraz dłuższe wolne okna. Nie wypisuj daty, nagłówka ani powitania — aplikacja wyświetla powitanie odpowiednie do pory dnia. Jeśli kalendarz jest pusty, powiedz to wprost. Nie twórz ani nie zmieniaj wydarzeń i nie przygotowuj żadnych akcji.';

export async function getDailySummary(dateKey: string, refresh = false) {
  const title = `Dzień w skrócie ${dateKey}`;
  const { conversations } = await listAllConversations();
  let conversation = conversations.find((item) => item.title === title);
  if (conversation && !refresh) {
    const history = await listAssistantMessages(conversation.id);
    let lastPrompt = -1;
    history.messages.forEach((message, index) => {
      if (message.role === 'user' && message.content.text === dailySummaryPrompt) lastPrompt = index;
    });
    if (lastPrompt >= 0) {
      const saved = history.messages.slice(lastPrompt + 1).reverse().find((message) => message.role === 'assistant' && typeof message.content.text === 'string');
      if (saved && !String(saved.content.text).startsWith('Nie udało mi się przygotować odpowiedzi')) return { conversationId: conversation.id, text: String(saved.content.text).trim() };
      conversation = undefined;
    }
  }
  // A fresh conversation prevents the model from treating an earlier tool result as current calendar data.
  if (!conversation || refresh) conversation = await createAssistantConversation(title);
  const response = await sendAssistantMessage(conversation.id, dailySummaryPrompt);
  await Promise.allSettled(response.pendingActions.map((action) => cancelAssistantAction(action.id)));
  return { conversationId: conversation.id, text: response.message.content.trim() };
}

let calendarSummaryCache: { key: string; result: Promise<{ text: string }> } | undefined;

/** Wylogowanie: zapamiętane podsumowanie dnia należało do poprzedniego konta. */
export function forgetDailySummary() { calendarSummaryCache = undefined; }

/** Reuse an unchanged day's result; an empty day never contacts the assistant API. */
export function getDailySummaryForCalendar(events: CalendarEvent[], now: Date): Promise<{ text: string }> {
  const context = dailySummaryContext(events, now);
  if (context.empty) {
    calendarSummaryCache = undefined;
    return Promise.resolve({ text: 'Nie masz dziś zaplanowanych wydarzeń. Możesz spokojnie zaplanować swój dzień.' });
  }
  if (calendarSummaryCache?.key === context.key) return calendarSummaryCache.result;
  const result = (async () => {
    const config = await getAssistantConfig();
    if (!config.enabled) throw new Error('Asystent AI jest niedostępny. Sprawdź konfigurację Azure AI.');
    return getDailySummary(context.date, true);
  })();
  calendarSummaryCache = { key: context.key, result };
  void result.catch(() => {
    if (calendarSummaryCache?.result === result) calendarSummaryCache = undefined;
  });
  return result;
}
