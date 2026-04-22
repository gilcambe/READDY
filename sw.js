/**
 * NEXIA OS — Root Service Worker v1.0
 * Criado para evitar MIME type error causado por navigator.serviceWorker.register('/sw.js')
 * no nexia-engine.js. Este SW é intencionalemente minimal — não intercepta requests.
 */
const CACHE_VERSION = 'nexia-root-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Não intercepta fetch — deixa o browser resolver normalmente
