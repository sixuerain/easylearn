const CACHE = 'easylearn-v3'

// Assets to pre-cache on install (the bare minimum app shell)
const PRECACHE = ['/', '/login']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Never cache API calls or NextAuth
  if (url.pathname.startsWith('/api/')) return

  // Cache-first for uploaded images and audio (large static assets)
  if (url.pathname.startsWith('/api/img/') || url.pathname.startsWith('/api/audio/') || url.pathname.startsWith('/uploads/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
      })
    )
    return
  }

  // Cache-first for static assets (JS, CSS, icons, fonts)
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
      })
    )
    return
  }

  // Network-first for HTML pages — fall back to cache when offline
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok && request.method === 'GET') {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
        }
        return res
      })
      .catch(() => caches.match(request))
  )
})
