// Offline cache for the Phuket guide. The page and every photo are saved on install;
// map tiles are kept as you view them (up to TILE_MAX), so streets you looked at stay visible offline.
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const CACHE = 'guide-' + VERSION
const TILES = 'guide-tiles'
const TILE_MAX = 400
const TILE_HOSTS = /(^|\.)arcgisonline\.com$/
const SCOPE_PATH = new URL('./', self.location).pathname

// a response that came through a redirect cannot answer a page load, so store a clean copy
async function clean(res) {
  if (!res.redirected) return res
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
}

// the page, manifest and icons must be saved for the install to count; photos are saved one by one and any that
// fail (a flaky connection) are fetched again the next time they are shown online
const CORE = PRECACHE.filter((u) => !u.startsWith('img/'))
async function save(c, u) {
  const res = await fetch(new Request(u, { cache: 'reload' }))
  if (!res.ok) throw new Error('precache failed: ' + u)
  await c.put(u, await clean(res))
}
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE)
    await Promise.all(CORE.map((u) => save(c, u)))
    await Promise.allSettled(PRECACHE.filter((u) => u.startsWith('img/')).map((u) => save(c, u)))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('guide-') && k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

async function trimTiles(cache) {
  const keys = await cache.keys()
  if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === self.location.origin) {
    const isAppPage = req.mode === 'navigate' && (url.pathname === SCOPE_PATH || url.pathname === SCOPE_PATH + 'index.html')
    if (isAppPage) {
      // offline first: answer from the cache at once, refresh it in the background
      event.respondWith((async () => {
        const c = await caches.open(CACHE)
        const cached = await c.match('./')
        const network = fetch(req).then(async (res) => { if (res.ok) await c.put('./', await clean(res.clone())); return res }).catch(() => null)
        if (cached) { event.waitUntil(network); return cached }
        return (await network) || new Response('Offline. Open the guide once with internet first.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      })())
      return
    }
    // other files (photos, icons, the KML, the single-file backup): cache first, then the network;
    // a photo that is missing from the cache is saved when it loads
    event.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true })
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && url.pathname.includes('/img/')) { const c = await caches.open(CACHE); c.put(req, res.clone()) }
      return res
    })())
    return
  }

  if (TILE_HOSTS.test(url.hostname)) {
    event.respondWith((async () => {
      const c = await caches.open(TILES)
      const hit = await c.match(req)
      if (hit) return hit
      try {
        const res = await fetch(req)
        if (res.ok) { c.put(req, res.clone()); trimTiles(c) }
        return res
      } catch {
        return Response.error()
      }
    })())
  }
})
