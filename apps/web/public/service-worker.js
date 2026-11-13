self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const title = typeof payload.title === 'string' ? payload.title : 'KAC: przypomnienie';
  const body = typeof payload.body === 'string' ? payload.body : 'Masz nadchodzącą zmianę.';
  event.waitUntil(self.registration.showNotification(title, { body, tag: payload.tag || data.notificationId || 'kac-reminder', data, renotify: false }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = new URL('/', self.location.origin);
  for (const [key, value] of Object.entries({
    notificationId: data.notificationId,
    notificationEventId: data.eventId,
    notificationEventStart: data.eventStart,
    notificationEventEnd: data.eventEnd,
    notificationTitle: data.title,
    notificationBody: data.body,
  })) if (typeof value === 'string' && value) target.searchParams.set(key, value);

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((item) => 'focus' in item && 'navigate' in item);
    if (client && 'navigate' in client) {
      await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  }));
});
