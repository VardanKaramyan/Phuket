// Map regression test, on a phone-sized page:
// 1. trackpad / mouse-wheel zoom glides (many small zoom changes), instead of jumping in fixed steps;
// 2. the full-screen button makes the map fill the screen, and the same button (or Esc) brings it back;
// 3. with the Esri servers unreachable, Satellite still shows the offline satellite tiles (not the plain map).
// Usage: node tools/map-test.mjs [html build, default dist/index.html]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.resolve(process.argv[2] || path.join(ROOT, 'dist/index.html'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const results = []
const check = (name, ok, detail) => { results.push(ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`) }

async function open({ blockEsri = false, base = null, w = 390, h = 844 } = {}) {
  const p = await b.newPage()
  await p.setViewport({ width: w, height: h, isMobile: true, hasTouch: true })
  // keep a handle on the Leaflet map, and record every zoom change
  await p.evaluateOnNewDocument((base) => {
    if (base) try { localStorage.setItem('pg:base', JSON.stringify(base)) } catch {}
    let real
    Object.defineProperty(window, 'L', { configurable: true, get: () => real, set: (v) => {
      real = v
      v.Map.addInitHook(function () { window.__map = this; window.__zooms = []; this.on('zoom', () => window.__zooms.push(this.getZoom())) })
    } })
  }, base)
  if (blockEsri) {
    await p.setRequestInterception(true)
    p.on('request', (r) => (/arcgisonline\.com/.test(r.url()) ? r.abort('internetdisconnected') : r.continue()))
  }
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(pathToFileURL(file).href + '#areas', { waitUntil: 'load' })
  await sleep(1500)
  return { p, errors }
}

// 1. wheel zoom
{
  const { p, errors } = await open()
  const cdp = await p.createCDPSession()
  const z0 = await p.evaluate(() => { window.__zooms = []; return __map.getZoom() })
  for (let i = 0; i < 40; i++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 195, y: 400, deltaX: 0, deltaY: -6 }); await sleep(16) }
  await sleep(1200)
  const { zs, z1 } = await p.evaluate(() => ({ zs: __zooms, z1: __map.getZoom() }))
  const distinct = new Set(zs.map((z) => z.toFixed(3))).size
  const jump = Math.max(0, ...zs.slice(1).map((z, i) => Math.abs(z - zs[i])))
  check('wheel zoom glides', distinct >= 15 && jump <= 0.3 && z1 - z0 >= 0.5,
    `${distinct} zoom changes, largest jump ${jump.toFixed(2)}, zoomed ${z0.toFixed(2)} → ${z1.toFixed(2)}`)
  if (errors.length) check('no page errors (wheel)', false, errors.join(' | '))
  await p.close()
}

// 2. full screen
{
  const { p, errors } = await open()
  const box = () => p.evaluate(() => {
    const r = document.querySelector('.mapbox').getBoundingClientRect(); const s = __map.getSize()
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), mapW: s.x, mapH: s.y, vw: innerWidth, vh: innerHeight }
  })
  const before = await box()
  const hasBtn = await p.evaluate(() => !!document.querySelector('#map-full'))
  if (!hasBtn) check('full-screen button', false, 'no #map-full button')
  else {
    await p.click('#map-full'); await sleep(600)
    const full = await box()
    const fills = full.top === 0 && full.left === 0 && full.w === full.vw && full.h === full.vh && full.mapW === full.vw && full.mapH === full.vh
    check('full screen fills the screen', fills, JSON.stringify(full))
    // a popup on top of the full-screen map stays tappable (not covered by the tab bar or other page parts)
    const tappable = await p.evaluate(async () => {
      const m = Object.values(__map._layers).find((l) => l.getPopup && l.getPopup() && l instanceof L.CircleMarker)
      if (!m) return 'no pin'
      m.openPopup(); await new Promise((r) => setTimeout(r, 500))
      const btn = document.querySelector('.leaflet-popup .btn'); if (!btn) return 'no popup'
      const r = btn.getBoundingClientRect(); return btn.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) ? 'ok' : 'covered'
    })
    check('popup tappable in full screen', tappable === 'ok', tappable)
    await p.click('#map-full'); await sleep(600)
    const back = await box()
    check('button exits full screen', back.h === before.h && back.w === before.w && back.mapH === before.mapH, `before ${before.w}x${before.h}, after ${back.w}x${back.h}`)
    // Esc: with a popup open it closes the popup first, then a second Esc leaves full screen
    await p.click('#map-full'); await sleep(400)
    await p.evaluate(() => Object.values(__map._layers).find((l) => l.getPopup && l.getPopup() && l instanceof L.CircleMarker).openPopup()); await sleep(300)
    await p.keyboard.press('Escape'); await sleep(300)
    const mid = await box(); const popupGone = await p.evaluate(() => !document.querySelector('.leaflet-popup'))
    await p.keyboard.press('Escape'); await sleep(600)
    const esc = await box()
    check('Esc closes the popup, then full screen', popupGone && mid.h === mid.vh && esc.h === before.h, `popup closed: ${popupGone}, still full: ${mid.h === mid.vh}, height after 2nd Esc ${esc.h} (was ${before.h})`)
  }
  if (errors.length) check('no page errors (full screen)', false, errors.join(' | '))
  await p.close()
}

// 3. satellite with no Esri access (as offline)
{
  const { p, errors } = await open({ blockEsri: true, base: 'satellite' })
  // loaded map tiles that did not come from Esri (an <img> or a <div> with a background)
  await p.evaluate(() => {
    const tiles = () => Array.from(document.querySelectorAll('#map .leaflet-tile-loaded')).filter((t) => !/arcgisonline/.test(t.src || ''))
    window.offlineTiles = () => tiles().length
    // share of the map (sampled on a 20 px grid) that has an offline tile under it
    window.offlineCover = () => {
      const m = document.getElementById('map').getBoundingClientRect(), rs = tiles().map((t) => t.getBoundingClientRect())
      let n = 0, hit = 0
      for (let x = m.left + 5; x < m.right; x += 20) for (let y = m.top + 5; y < m.bottom; y += 20) { n++; if (rs.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) hit++ }
      return hit / n
    }
  })
  await p.evaluate(() => document.querySelector('.basebar [data-base="satellite"]')?.click())
  await sleep(2500)
  const r = await p.evaluate(() => ({
    base: document.querySelector('.basebar [aria-pressed="true"]')?.dataset.base,
    satTiles: offlineTiles(), cover: offlineCover(),
    attribution: document.querySelector('.leaflet-control-attribution')?.textContent || '',
  }))
  check('offline satellite tiles show', r.base === 'satellite' && r.satTiles >= 4 && r.cover >= 0.99, `base ${r.base}, ${r.satTiles} offline tiles loaded, ${Math.round(r.cover * 100)}% of the map covered`)
  check('offline satellite credit shown', /EOX/.test(r.attribution), r.attribution.slice(0, 120))
  // zoomed in past the offline detail (zoom 16) it still shows something (the zoom-14 tiles, enlarged)
  await p.evaluate(() => __map.setView([7.8965, 98.2965], 16, { animate: false })); await sleep(1500)
  const deep = await p.evaluate(() => ({ n: offlineTiles(), cover: offlineCover() }))
  check('offline satellite at zoom 16', deep.n >= 1 && deep.cover >= 0.99, `${deep.n} offline tiles, ${Math.round(deep.cover * 100)}% of the map covered`)
  // outside the zoom-14 areas (Krabi at zoom 13 has no zoom-13 tiles) a lower-zoom tile is enlarged, so no gaps
  await p.evaluate(() => __map.setView([8.03, 98.83], 13, { animate: false })); await sleep(1500)
  const krabi = await p.evaluate(() => ({ n: offlineTiles(), cover: offlineCover() }))
  check('offline satellite fills gaps from lower zooms', krabi.n >= 1 && krabi.cover >= 0.99, `${krabi.n} offline tiles, ${Math.round(krabi.cover * 100)}% of the map covered`)
  if (errors.length) check('no page errors (satellite)', false, errors.join(' | '))
  await p.close()
}

await b.close()
const failed = results.filter((x) => !x).length
console.log(failed ? `MAP TEST FAILED: ${failed} checks` : 'MAP TEST PASSED')
process.exitCode = failed ? 1 : 0
