export type AssistantTone = 'neutral' | 'friendly' | 'formal';
export type AssistantPreferences = { addressAs: string; tone: AssistantTone };
export const defaultAssistantPreferences: AssistantPreferences = { addressAs: '', tone: 'neutral' };
let preferences: AssistantPreferences = { ...defaultAssistantPreferences };

export function normalizeAssistantPreferences(value: unknown): AssistantPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    addressAs: typeof input.addressAs === 'string' ? input.addressAs.replace(/[\r\n\t]/g, ' ').trim().slice(0, 60) : '',
    tone: input.tone === 'friendly' || input.tone === 'formal' ? input.tone : 'neutral',
  };
}
export function configureAssistantPreferences(value: unknown) { preferences = normalizeAssistantPreferences(value); }
export function getAssistantPreferences(): AssistantPreferences { return { ...preferences }; }
