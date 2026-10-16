// Offline cache for the Phuket guide. The page and every photo are saved on install;
// map tiles are kept as you view them (up to TILE_MAX), so streets you looked at stay visible offline.
const VERSION = 'd721225ebb'
const PRECACHE = ["./","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png","phuket-areas.kml","img/areas-ao-po.webp","img/areas-bang-tao.webp","img/areas-cape-panwa.webp","img/areas-chalong.webp","img/areas-kamala.webp","img/areas-karon.webp","img/areas-kata-noi.webp","img/areas-kata.webp","img/areas-kathu.webp","img/areas-layan.webp","img/areas-mai-khao.webp","img/areas-nai-harn.webp","img/areas-nai-thon.webp","img/areas-nai-yang.webp","img/areas-natai.webp","img/areas-patong.webp","img/areas-phuket-town.webp","img/areas-rawai.webp","img/areas-surin.webp","img/areas-thalang.webp","img/events-armania-phuket.webp","img/events-bambu-sunday-session-haad-yuan.webp","img/events-blondish-cafe-del-mar-2027.webp","img/events-boa-phuket.webp","img/events-cafe-del-mar-phuket.webp","img/events-cafe-del-mar-pyramid-2027-01-08.webp","img/events-carl-cox-cafe-del-mar-2027.webp","img/events-chill-up-phangan.webp","img/events-circoloco-thailand-2027.webp","img/events-courage-bar-phuket-town.webp","img/events-daft-funk-live-phuket-2027.webp","img/events-dnb-allstars-thailand-2027.webp","img/events-eden-garden-phangan.webp","img/events-enthusiast-place-open-doors.webp","img/events-francis-mercier-cafe-del-mar-2027.webp","img/events-full-moon-party-2027-01.webp","img/events-halfmoon-festival-jan-2027.webp","img/events-hollystone-saturday-phangan.webp","img/events-illuzion-phuket.webp","img/events-jungle-experience-2027-01.webp","img/events-levitate-sunset-connections.webp","img/events-lighthouse-party-phangan.webp","img/events-lost-jungle-parvati-2027.webp","img/events-macan-live-phuket-2027.webp","img/events-marco-carola-cafe-del-mar-2027.webp","img/events-o-beach-ibiza-barra-cuda-2027.webp","img/events-oxa-jungle-party.webp","img/events-pangea-beach-bar-lanta.webp","img/events-retro-mountain-phangan.webp","img/events-sabaii-friday-beach-party-phangan.webp","img/events-seaside-pre-full-moon-haad-rin.webp","img/events-shelter-phuket.webp","img/events-sound-club-samui.webp","img/events-spiritgust-2027.webp","img/events-summerset-lounge-experemint.webp","img/events-unclave-phangan.webp","img/events-utopia-events-phangan.webp","img/events-waterfall-festival-phangan.webp","img/events-wet-pool-party-haad-rin.webp","img/events-zamna-phuket-2027.webp","img/hotels-alisa-pool-villa.webp","img/hotels-bangtao-3br-pool-villa-laguna.webp","img/hotels-brand-new-4br-villa-bangtao.webp","img/hotels-chill-beach-bangla-patong.webp","img/hotels-diamond-villa-278.webp","img/hotels-fantastic-seaview-villa-rawai.webp","img/hotels-kata-v2-sea-view-villa.webp","img/hotels-la-belle-pool-villa.webp","img/hotels-laguna-park-5br-villa.webp","img/hotels-lux-laguna-park-5br-rooftop-pool.webp","img/hotels-luxpride-2-wallaya-v7.webp","img/hotels-luxurious-seaview-villa-rawai.webp","img/hotels-luxury-4br-pool-villa-rawai.webp","img/hotels-modern-4br-villa-laguna.webp","img/hotels-sawansa-34a-patong.webp","img/hotels-spacious-4br-home-bluetree.webp","img/money-lion-currency-exchange.webp","img/money-mamy-exchange.webp","img/money-money-shop.webp","img/money-phuket-airport-counters.webp","img/money-superrich-1965-phuket.webp","img/money-thai-bank-booths.webp","img/money-value-plus.webp","img/places-ao-yon-beach.webp","img/places-banana-beach.webp","img/places-bang-pae-waterfall.webp","img/places-bang-rong-mangroves.webp","img/places-bangla-boxing-stadium.webp","img/places-bangla-road.webp","img/places-big-buddha.webp","img/places-black-rock-viewpoint.webp","img/places-blue-elephant-cooking-school.webp","img/places-chalong-bay-rum.webp","img/places-chillva-market.webp","img/places-coral-island-koh-hey.webp","img/places-freedom-beach.webp","img/places-gibbon-rehabilitation-project.webp","img/places-go-benz.webp","img/places-hong-by-starlight.webp","img/places-kamala-beach.webp","img/places-karon-beach.webp","img/places-karon-temple-market.webp","img/places-karon-viewpoint.webp","img/places-kata-beach.webp","img/places-kata-noi-beach.webp","img/places-khai-islands.webp","img/places-khao-khad-viewpoint.webp","img/places-khao-rang-viewpoint.webp","img/places-khao-sok-cheow-lan-lake.webp","img/places-koh-hong-krabi.webp","img/places-koh-phangan-rave-trip.webp","img/places-koh-racha-yai.webp","img/places-koh-sirey.webp","img/places-koh-yao-noi.webp","img/places-kruvit-raft.webp","img/places-laem-krating-viewpoint.webp","img/places-laem-singh-beach.webp","img/places-layan-beach.webp","img/places-lock-tien.webp","img/places-mai-khao-plane-spotting.webp","img/places-malin-plaza-night-market.webp","img/places-mee-ton-poe.webp","img/places-mor-mu-dong.webp","img/places-naam-yoi.webp","img/places-nai-harn-beach.webp","img/places-nai-thon-beach.webp","img/places-nai-yang-beach.webp","img/places-naka-weekend-market.webp","img/places-natural-restaurant-airport.webp","img/places-one-chun.webp","img/places-patong-beach.webp","img/places-phang-nga-bay-james-bond.webp","img/places-phi-phi-maya-bay.webp","img/places-phuket-elephant-sanctuary.webp","img/places-phuket-mining-museum.webp","img/places-phuket-old-town.webp","img/places-promthep-cape.webp","img/places-railay-krabi.webp","img/places-rawai-seafood-market.webp","img/places-renew-sauna-ice-bath.webp","img/places-sabai-massage-airport.webp","img/places-sai-kaew-beach.webp","img/places-samet-nangshe-viewpoint.webp","img/places-similan-islands.webp","img/places-soi-dog-foundation.webp","img/places-summore-day-cafe.webp","img/places-sunday-walking-street.webp","img/places-surin-beach.webp","img/places-tri-trang-beach.webp","img/places-view-cafe-phuket.webp","img/places-wat-chalong.webp","img/places-wat-phra-thong.webp","img/places-windmill-viewpoint.webp","img/places-ya-nui-beach.webp"]
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
