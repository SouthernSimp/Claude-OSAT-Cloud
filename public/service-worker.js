const CACHE = 'osat-field-shell-v1'
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './pwa-register.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
]

async function cacheShell() {
  const cache = await caches.open(CACHE)
  await cache.addAll(SHELL)
  const index = await cache.match('./index.html')
  const markup = await index.text()
  const assets = [...markup.matchAll(/(?:href|src)="(\.\/assets\/[^"#?]+)"/g)].map((match) => match[1])
  await cache.addAll([...new Set(assets)])
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheShell().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Vite source modules change without hashed URLs. Never freeze a live preview.
  if (/^\/(?:src\/|node_modules\/|\.vite|@vite\/|@react-refresh)/.test(url.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) await (await caches.open(CACHE)).put('./index.html', response.clone())
          return response
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true })) || caches.match('./index.html')),
    )
    return
  }

  if (!['font', 'image', 'manifest', 'script', 'style'].includes(request.destination)) return
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then(async (response) => {
      if (response.ok) await (await caches.open(CACHE)).put(request, response.clone())
      return response
    })),
  )
})
