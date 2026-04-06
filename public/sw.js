const CACHE = 'easylearn-v5'

// Only cache static assets and media — never intercept page navigations
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)

  // Only cache-first for immutable static assets and uploaded media
  const shouldCache =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/api/img/') ||
    url.pathname.startsWith('/api/audio/')

  if (!shouldCache) return // let browser handle everything else normally

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
    })
  )
})
