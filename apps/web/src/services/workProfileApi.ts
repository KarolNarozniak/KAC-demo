export type PreferenceInterval = { dayOfWeek: number; startTime: string; endTime: string; weight: number };
export type AvailabilityInterval = { dayOfWeek: number; startTime: string; endTime: string };
export type PreferencesSnapshot = { version: string; intervals: PreferenceInterval[]; availability: AvailabilityInterval[] };

const messages: Record<string, string> = {
  invalid_interval: 'Sprawdź dzień i godziny tego przedziału.',
  invalid_weight: 'Waga musi być liczbą ≥ 0, z maksymalnie dwoma miejscami po przecinku.',
  preference_outside_availability: 'Ten przedział wykracza poza Twoją dostępność.',
  profile_not_found: 'Nie znaleziono profilu pracy.',
};

export class WorkPreferencesError extends Error {
  constructor(code: string, public rowIndex?: number) { super(messages[code] ?? 'Nie udało się zapisać preferencji.'); }
}
export class WorkPreferencesConflictError extends Error {
  constructor() { super('Preferencje zostały zmienione w międzyczasie — wczytano najnowszą wersję.'); }
}

const baseUrl = () => {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = globalThis.location?.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:4000';
  throw new Error('Brak konfiguracji adresu API.');
};

async function request(path: string, options?: RequestInit) {
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (response.status === 409) throw new WorkPreferencesConflictError();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new WorkPreferencesError(data.error, data.rowIndex);
  }
  return response.json();
}

export const loadWorkPreferences = (): Promise<PreferencesSnapshot> => request('/api/work-profile/preferences');
export const saveWorkPreferences = (version: string, intervals: PreferenceInterval[]): Promise<PreferencesSnapshot> =>
  request('/api/work-profile/preferences', { method: 'PUT', body: JSON.stringify({ version, intervals }) });