// No-op service worker. Exists only to satisfy the PWA installability
// criterion (Add to Home Screen / install prompt); WARP has no offline mode.
// Deliberately NO 'fetch' handler: the browser then uses its normal network
// path for every request (auth redirects, /xhr/*, hashed bundles untouched)
// and skips SW startup overhead entirely.
// Served from the app root via the view.serviceWorker route (not /static) so
// its scope can cover the whole app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
