import type { UserScope } from '../api/scope.js';
import type { AiMessage, AiPendingAction, AiRepository } from './repository.js';

/** Historical tool outputs describe a past preview, not its current confirmation state. */
export async function refreshActionHistory(
  messages: AiMessage[], scope: UserScope, conversationId: string,
  repository: Pick<AiRepository, 'getAction'>, pendingActions: AiPendingAction[],
): Promise<AiMessage[]> {
  const states = new Map<string, AiPendingAction | null>(pendingActions.map((action) => [action.id, action]));
  const actionIdOf = (message: AiMessage): string | undefined => {
    if (message.role !== 'tool' || !message.content.result || typeof message.content.result !== 'object') return;
    const id = (message.content.result as Record<string, unknown>).actionId;
    return typeof id === 'string' ? id : undefined;
  };
  const missing = [...new Set(messages.map(actionIdOf).filter((id): id is string => Boolean(id) && !states.has(id!)))];
  await Promise.all(missing.map(async (id) => {
    const action = await repository.getAction(scope, id);
    states.set(id, action?.conversationId === conversationId ? action : null);
  }));
  return messages.map((message) => {
    const id = actionIdOf(message);
    if (!id) return message;
    const action = states.get(id);
    const status = action?.status ?? 'unavailable';
    return { ...message, content: { ...message.content, result: {
      ...(message.content.result as Record<string, unknown>),
      status: status === 'pending' ? 'awaiting_user_confirmation' : status,
      ...(action ? { expiresAt: action.expiresAt, preview: action.payload, eventId: action.eventId ?? null } : {}),
      ...(!['pending', 'confirmed'].includes(status) ? { error: `action_${status}`, requiresNewProposal: status !== 'processing' } : {}),
    } } };
  });
}
