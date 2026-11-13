export type NotificationSettings = { enabled: boolean; workRemindersEnabled: boolean; eventChangesEnabled: boolean; minutesBefore: number; quietStart: string | null; quietEnd: string | null };
export type DueNotification = { id: string; eventId: string; type: string; message: string; scheduledAt: string; eventStart: string; title: string };

const apiBase = () => process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '') || 'http://localhost:4000';
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}/api/v1${path}`, { method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Nie udało się obsłużyć powiadomienia.');
  return response.json();
}

export const getNotificationSettings = () => request<NotificationSettings>('/notifications/settings');
export const updateNotificationSettings = (settings: Pick<NotificationSettings, 'enabled' | 'workRemindersEnabled' | 'minutesBefore'>) =>
  request<NotificationSettings>('/notifications/settings', 'PUT', settings);
export const claimDueNotifications = async () => (await request<{ notifications: DueNotification[] }>('/notifications/due')).notifications;
