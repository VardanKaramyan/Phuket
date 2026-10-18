// New versions of the website: the service worker fetches the newest page first (so a new build shows on the first
// reload), falls back to the saved copy offline or when the network is slow (after NET_WAIT, 3.5 s), and a page that
// is already open checks version.json and offers Reload when a newer build is out.
// A local server plays the host; it can serve a "new" page (with a marker), a slow page, or a newer version.json.
// Usage: node tools/update-test.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.kml': 'application/vnd.google-earth.kml+xml', '.json': 'application/json' }
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const host = { marker: false, slowPage: 0, version: null } // what the "deployed" site serves right now
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/version.json' && host.version) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify({ v: host.version })) }
  if (p.endsWith('/')) p += 'index.html'
  const f = path.join(DIST, p)
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found') }
  if (p === '/index.html') {
    if (host.slowPage) await sleep(host.slowPage)
    let html = fs.readFileSync(f, 'utf8')
    if (host.marker) html = html.replace('</head>', '<meta name="test-marker" content="new">\n</head>')
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' }); return res.end(html)
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(8796, '127.0.0.1', r))
const base = 'http://127.0.0.1:8796/'

const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const p = await b.newPage(); const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await p.goto(base, { waitUntil: 'networkidle0' })
// wait until the guide is saved for offline use and the service worker controls the page
const saved = await p.evaluate(async () => {
  await navigator.serviceWorker.ready
  for (let i = 0; i < 160; i++) {
    const c = (await caches.keys()).find((k) => k.startsWith('guide-') && k !== 'guide-tiles')
    if (c && (await (await caches.open(c)).keys()).length > 20) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
})
await p.reload({ waitUntil: 'load' }); await sleep(500)
const controlled = await p.evaluate(() => !!navigator.serviceWorker.controller)
check('the guide is saved for offline use and the service worker is in charge', saved && controlled, JSON.stringify({ saved, controlled }))

// a new build is deployed: one reload shows it
host.marker = true
await p.reload({ waitUntil: 'load' }); await sleep(300)
check('a new version shows on the first reload', await p.evaluate(() => !!document.querySelector('meta[name="test-marker"]')))

// offline: the saved copy (now the new one) opens at once
await p.setOfflineMode(true)
let t0 = Date.now()
await p.reload({ waitUntil: 'load' }).catch((e) => errors.push('offline reload: ' + e.message))
let took = Date.now() - t0
check('offline: the saved copy opens at once', await p.evaluate(() => !!document.querySelector('meta[name="test-marker"]') && document.querySelectorAll('.card').length > 50) && took < 3000, took + ' ms')
await p.setOfflineMode(false)

// a very slow connection: the saved copy after about 3.5 s instead of waiting for the network
host.marker = false; host.slowPage = 9000
t0 = Date.now()
await p.reload({ waitUntil: 'domcontentloaded' })
took = Date.now() - t0
check('a slow connection: the saved copy after about 3.5 s', await p.evaluate(() => !!document.querySelector('meta[name="test-marker"]')) && took > 3000 && took < 7000, took + ' ms')
await sleep(7000) // let the slow page finish saving in the background
host.slowPage = 0

// a page that is open when a newer build is published: it offers Reload
host.version = 'newer-build'
await p.reload({ waitUntil: 'load' })
const bar = await p.waitForSelector('.update-bar', { timeout: 8000 }).then(() => true, () => false)
const text = await p.evaluate(() => document.querySelector('.update-bar')?.textContent || '')
check('an open page offers Reload when a newer version is out', bar && /new version/.test(text), text)
const nav = p.waitForNavigation({ waitUntil: 'load', timeout: 10000 }).then(() => true, () => false)
await p.evaluate(() => document.querySelector('.update-bar button').click())
check('Reload loads the page again', await nav)
host.version = null
await p.reload({ waitUntil: 'load' }); await sleep(3600)
check('no Reload offer while the page is the newest', await p.evaluate(() => !document.querySelector('.update-bar')))

if (errors.length) check('no page errors', false, errors.join(' | '))
await b.close(); server.close()
console.log(failed ? `UPDATE TEST FAILED: ${failed}` : 'UPDATE TEST PASSED')
process.exitCode = failed ? 1 : 0
