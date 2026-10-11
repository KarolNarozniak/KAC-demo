import type { NotificationPreferences } from './model';
export function validateNotificationPreferences(p: NotificationPreferences): string | null {
  if (!Number.isInteger(p.classReminderMinutes) || p.classReminderMinutes < 0 || p.classReminderMinutes > 1440) return 'Class reminder must be from 0 to 1440 minutes.';
  if (!Number.isInteger(p.workReminderMinutes) || p.workReminderMinutes < 0 || p.workReminderMinutes > 1440) return 'Work reminder must be from 0 to 1440 minutes.';
  if (p.quietEnabled && (!validTime(p.quietFrom) || !validTime(p.quietTo) || p.quietFrom === p.quietTo)) return 'Choose two different quiet-hour times.';
  return null;
}
function validTime(value: string): boolean { const m = /^(\d{2}):(\d{2})$/.exec(value); return Boolean(m && Number(m[1]) <= 23 && Number(m[2]) <= 59); }
export function isNotificationAllowed(p: NotificationPreferences, time: string): boolean {
  if (!p.enabled || !validTime(time)) return false; if (!p.quietEnabled) return true;
  const mins = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const sample = mins(time); const from = mins(p.quietFrom); const to = mins(p.quietTo);
  return from < to ? sample < from || sample >= to : sample < from && sample >= to;
}
