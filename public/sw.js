// Lets the game be installed as an app. It caches nothing: every request goes to the network, so updates arrive at once.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { if (e.request.method === 'GET' && e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });
