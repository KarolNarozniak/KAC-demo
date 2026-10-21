export type DemoCalendarOverview = {
  source: 'postgresql';
  user: { id: string; name: string; timezone: string };
  calendar: { id: string; name: string };
  counts: { events: number; categories: number };
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    category: string;
    color: string;
    mandatory: boolean;
  }>;
};

export type DemoConnection = {
  api: 'connected';
  database: 'connected' | 'not-configured' | 'unavailable';
  overview: DemoCalendarOverview | null;
};

function apiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const hostname = (globalThis as { location?: { hostname?: string } }).location?.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4000';
  return null;
}

export async function getDemoConnection(signal?: AbortSignal): Promise<DemoConnection> {
  const base = apiBaseUrl();
  if (!base) throw new Error('Adres API nie jest skonfigurowany dla tego wdrożenia.');
  const response = await fetch(`${base}/api/demo/connection`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`API zwróciło status ${response.status}.`);
  return response.json() as Promise<DemoConnection>;
}
