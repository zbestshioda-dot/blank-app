// Lets the game be installed as an app. It caches nothing: every request goes to the network, so updates arrive at once.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { if (e.request.method === 'GET' && e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });
// 🔔 push notifications from the town (zombie night, lifebook, streak reminders); tapping one opens the game
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'เมืองชีวิตนี้เลือกได้', {
    body: d.body || '', icon: 'assets/ui/icon192.png', badge: 'assets/ui/icon192.png', tag: d.tag || undefined, data: { url: d.url || '/' }, lang: 'th',
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
