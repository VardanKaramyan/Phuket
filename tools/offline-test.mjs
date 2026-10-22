// Proves the static build works offline. For each host style (plain, and one that redirects /index.html to /
// like Cloudflare Pages), it serves dist/, lets the service worker install, then STOPS the server and cuts the
// page's network, reloads, and checks the page, its photos, the map and the saved satellite tiles still render.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.kml': 'application/vnd.google-earth.kml+xml', '.json': 'application/json' }

function serve(port, redirectIndex) {
  const sockets = new Set()
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (redirectIndex && p === '/index.html') { res.writeHead(301, { Location: '/' }); return res.end() }
    if (p.endsWith('/')) p += 'index.html'
    const f = path.join(DIST, p)
    if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found') }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(f).pipe(res)
  })
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ stop: () => new Promise((d) => { sockets.forEach((s) => s.destroy()); server.close(() => d()) }) })))
}

async function run(label, port, redirectIndex, reloadPath) {
  const srv = await serve(port, redirectIndex)
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  const base = `http://127.0.0.1:${port}`
  await page.goto(base + '/', { waitUntil: 'networkidle0' })
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    for (let i = 0; i < 80; i++) {
      const keys = await caches.keys()
      const c = keys.find((k) => k.startsWith('guide-') && k !== 'guide-tiles')
      if (c) { const n = (await (await caches.open(c)).keys()).length; if (n > 20) return { cache: c, entries: n } }
      await new Promise((r) => setTimeout(r, 250))
    }
    return null
  })
  // Download fetches what is missing: drop 3 saved zoom-14 satellite tiles, reload, press it
  await page.evaluate(async (c) => { const cache = await caches.open(c); for (const k of (await cache.keys()).filter((r) => r.url.includes('/sat/14/')).slice(0, 3)) await cache.delete(k) }, cached?.cache)
  await page.goto(base + '/', { waitUntil: 'networkidle0' })
  const fill = await page.evaluate(async () => {
    const wait = async (f) => { for (let i = 0; i < 80 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); return f() }
    const text = () => document.getElementById('offline-state').textContent
    const before = (await wait(() => !document.getElementById('offline-fill-row').hidden)) && text()
    document.getElementById('offline-fill').click()
    await wait(() => /on this phone/.test(text()))
    return { before, after: text(), buttonHidden: document.getElementById('offline-fill-row').hidden }
  })
  console.log(`[${label}] Download: ${JSON.stringify(fill)}`)
  await srv.stop() // the server is gone: nothing can come from the network now
  await page.setOfflineMode(true)
  await page.goto(base + reloadPath, { waitUntil: 'load' }).catch((e) => errors.push('goto: ' + e.message))
  await new Promise((r) => setTimeout(r, 900))
  const result = await page.evaluate(async () => {
    location.hash = 'places'
    await new Promise((r) => setTimeout(r, 300))
    const imgs = Array.from(document.querySelectorAll('#places img'))
    for (const i of imgs) { i.loading = 'eager' }
    await new Promise((r) => setTimeout(r, 1500))
    const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length
    location.hash = 'areas'
    await new Promise((r) => setTimeout(r, 1500))
    const mapPaths = document.querySelectorAll('#map path').length
    // the saved satellite tiles show with no network
    document.querySelector('.basebar [data-base="satellite"]')?.click()
    await new Promise((r) => setTimeout(r, 2000))
    const satTiles = Array.from(document.querySelectorAll('#map .leaflet-tile-loaded')).filter((t) => !/arcgisonline/.test(t.src || '')).length
    return { title: document.title, cards: document.querySelectorAll('.card').length, imgs: imgs.length, imgsLoaded: loaded, mapPaths, satTiles, offlineText: document.getElementById('offline-state')?.textContent }
  }).catch((e) => ({ error: e.message }))
  await browser.close()
  // the page also reports photos missing from the cache (it compares with the build's count)
  const ok = cached && /satellite map is missing/.test(fill.before || '') && /on this phone/.test(fill.after) && fill.buttonHidden && result.cards > 100 && result.imgs > 0 && result.imgsLoaded === result.imgs && result.mapPaths > 50 && result.satTiles >= 4 && !/missing/i.test(result.offlineText || '')
  console.log(`[${label}] cache: ${cached ? cached.entries + ' files' : 'NONE'} · after reload with the server stopped: ${JSON.stringify(result)}${errors.length ? ' · errors: ' + errors.join(' | ') : ''}`)
  console.log(`[${label}] ${ok ? 'PASSED' : 'FAILED'}`)
  return ok
}

const a = await run('plain host', 8765, false, '/')
const b = await run('host redirects /index.html', 8766, true, '/index.html')
console.log(a && b ? 'OFFLINE TEST PASSED' : 'OFFLINE TEST FAILED')
process.exitCode = a && b ? 0 : 1
