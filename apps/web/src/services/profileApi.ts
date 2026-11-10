export type WeeklyHourLimits = { minGodzinTydzien: number | null; celGodzinTydzien: number | null; maxGodzinTydzien: number | null };

const messages: Record<string, string> = {
  max_hours_must_be_positive: 'Limit musi być większy od zera.',
  invalid_weekly_hours: 'Wpisz poprawną liczbę godzin.',
  min_above_max: 'Limit jest mniejszy niż ustawione minimum godzin.',
  target_above_max: 'Limit jest mniejszy niż ustawiony cel godzin.',
};

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(messages[data.error] ?? 'Nie udało się zapisać limitu godzin.');
  }
  return response.json();
}

export const loadWeeklyHourLimits = (): Promise<WeeklyHourLimits> => request('/api/profile/weekly-work-limit');
export const saveMaxWeeklyHours = (maxHours: number | null): Promise<WeeklyHourLimits> =>
  request('/api/profile/weekly-work-limit', { method: 'PUT', body: JSON.stringify({ maxHours }) });