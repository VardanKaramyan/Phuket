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
    if (base) try { localStorage.setItem('pg:mapBase', JSON.stringify(base)) } catch {}
    let real
    Object.defineProperty(window, 'L', { configurable: true, get: () => real, set: (v) => {
      real = v
      // the big map only (the villa cards' small maps are Leaflet maps too)
      v.Map.addInitHook(function () { if (this.getContainer().id !== 'map') return; window.__map = this; window.__zooms = []; this.on('zoom', () => window.__zooms.push(this.getZoom())) })
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
    attribution: document.getElementById('map-credit')?.textContent || '',
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

// 4. villas: every villa has a pin, shown by default; popup → card → Back to map → the same popup
{
  const { p, errors } = await open()
  const startBase = await p.evaluate(() => document.querySelector('.basebar [aria-pressed="true"]')?.dataset.base)
  check('the big map starts on Satellite', startBase === 'satellite', String(startBase))
  await p.evaluate(() => { location.hash = 'stay' }); await sleep(400)
  await p.evaluate(() => document.querySelector('#ht-alisa-pool-villa [data-open-map]').click()); await sleep(1200)
  const viaBtn = await p.evaluate(() => { const d = document.querySelector('#ht-alisa-pool-villa details.mapacc'); const r = d.getBoundingClientRect(); return { open: d.open, drawn: !!d.querySelector('.leaflet-pane'), onScreen: r.top >= 0 && r.top < innerHeight } })
  check('the Map button opens the villa map and shows it', viaBtn.open && viaBtn.drawn && viaBtn.onScreen, JSON.stringify(viaBtn))
  await p.evaluate(() => { location.hash = 'areas' }); await sleep(800)
  const pins = await p.evaluate(() => {
    const villas = document.querySelectorAll('.card[id^="ht-"]').length
    const villaPins = Object.values(__map._layers).filter((l) => l instanceof L.CircleMarker && l.getPopup && /See villa/.test(typeof l.getPopup()._content === 'function' ? l.getPopup()._content(l) : ''))
    // our booked villas have a second, labelled pin of their own (basePane)
    const onMap = villaPins.filter((l) => l.options.pane !== 'basePane').length, ours = villaPins.filter((l) => l.options.pane === 'basePane').length
    return { villas, onMap, ours, chip: document.querySelector('.layerbar [data-layer="hotel"]').getAttribute('aria-pressed') }
  })
  check('every villa is on the map by default, and our two villas have labelled pins too', pins.villas > 0 && pins.onMap === pins.villas && pins.ours === 2 && pins.chip === 'true', JSON.stringify(pins))
  const pop = await p.evaluate(async () => {
    const m = Object.values(__map._layers).find((l) => l instanceof L.CircleMarker && l.getPopup && /mouana/.test(typeof l.getPopup()._content === 'function' ? l.getPopup()._content(l) : ''))
    m.openPopup(); await new Promise((r) => setTimeout(r, 500))
    const el = document.querySelector('.leaflet-popup')
    return { price: el.querySelector('.pop-price b')?.textContent, amd: el.querySelector('.pop-price span')?.textContent, see: el.querySelector('[data-from-map]')?.textContent, web: [...el.querySelectorAll('.btn')].map((x) => x.textContent).join('/') }
  })
  check('villa popup: total in drams (bold), then dollars and the baht price, See villa, Airbnb', /^≈[\d,]+ AMD$/.test(pop.price || '') && /\$/.test(pop.amd || '') && /THB/.test(pop.amd || '') && pop.see === 'See villa' && /Airbnb/.test(pop.web), JSON.stringify(pop))
  await p.evaluate(() => document.querySelector('.leaflet-popup [data-from-map]').click()); await sleep(800)
  const atCard = await p.evaluate(() => ({ hash: location.hash, back: !document.getElementById('back-to-map').hidden, top: Math.round(document.getElementById('ht-mouana-breeze-mai-khao').getBoundingClientRect().top) }))
  check('See villa opens the card, with Back to map', atCard.hash === '#ht-mouana-breeze-mai-khao' && atCard.back && atCard.top < 200, JSON.stringify(atCard))
  await p.click('#back-to-map'); await sleep(1500)
  const back = await p.evaluate(() => ({ hash: location.hash, popup: document.querySelector('.leaflet-popup h4')?.textContent, btn: !document.getElementById('back-to-map').hidden }))
  check('Back to map reopens the same villa', back.hash === '#areas' && /Mouana/.test(back.popup || '') && !back.btn, JSON.stringify(back))
  await p.evaluate(() => { __map.closePopup(); location.hash = 'stay' }); await sleep(500)
  // Show on map: the card's own small map, drawn when the accordion opens, then the big map from there
  await p.evaluate(() => { const d = document.querySelector('#ht-patong-villa-5br-game-room details.mapacc'); d.scrollIntoView(); d.open = true }); await sleep(1500)
  const mini = await p.evaluate(() => {
    const box = document.querySelector('#ht-patong-villa-5br-game-room .mini-map'), r = box.getBoundingClientRect()
    return { drawn: !!box.querySelector('.leaflet-pane'), pin: box.querySelectorAll('path.leaflet-interactive, svg path').length, h: Math.round(r.height), w: Math.round(r.width) }
  })
  check('Show on map draws the villa on a small map in the card', mini.drawn && mini.pin >= 2 && mini.h >= 300 && mini.w > 200, JSON.stringify(mini))
  const miniSat = await p.evaluate(() => [...document.querySelectorAll('#ht-patong-villa-5br-game-room .mini-map img.leaflet-tile')].some((i) => /World_Imagery/.test(i.src)))
  check('the small map is satellite by default', miniSat, String(miniSat))
  await p.evaluate(() => document.querySelector('#ht-patong-villa-5br-game-room .mapacc [data-on-map]').click()); await sleep(1500)
  const fromCard = await p.evaluate(() => ({ hash: location.hash, popup: document.querySelector('.leaflet-popup h4')?.textContent }))
  check('Open the big map opens the villa on the Areas map', fromCard.hash === '#areas' && /Patong Villa/.test(fromCard.popup || ''), JSON.stringify(fromCard))
  // the popup's own link now says Back to villa; the floating button hides while the popup is open, then shows
  const inPopup = await p.evaluate(() => document.querySelector('.leaflet-popup [data-from-map]')?.textContent)
  await p.evaluate(() => __map.closePopup()); await sleep(300)
  const backCard = await p.evaluate(() => { const b = document.getElementById('back-to-card'); return { shown: !b.hidden && getComputedStyle(b).display !== 'none', text: b.textContent.trim(), popupLink: null } })
  backCard.popupLink = inPopup
  await p.click('#back-to-card'); await sleep(1000)
  const atVilla = await p.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('ht-patong-villa-5br-game-room').getBoundingClientRect().top), btn: !document.getElementById('back-to-card').hidden }))
  check('Back to villa (in the popup, and floating once it closes) returns to the card', backCard.popupLink === 'Back to villa' && backCard.shown && backCard.text === 'Back to villa' && atVilla.hash === '#ht-patong-villa-5br-game-room' && atVilla.top < 200 && !atVilla.btn, JSON.stringify({ backCard, atVilla }))
  if (errors.length) check('no page errors (villas)', false, errors.join(' | '))
  await p.close()
}

// no credit box on the map; online, the line under it is empty (the user removed the Esri and OpenStreetMap credits)
{
  const { p } = await open()
  const r = await p.evaluate(() => ({ onMap: document.querySelectorAll('.leaflet-control-attribution').length, under: document.getElementById('map-credit')?.textContent || '' }))
  check('no credit box on the map, and no Esri or OpenStreetMap credit under it', r.onMap === 0 && !/Esri|OpenStreetMap|EOX/.test(r.under), JSON.stringify(r))
  await p.close()
}

// 5. a refresh keeps your place: the same villa at the same spot on the page, the map where you left it
{
  const { p, errors } = await open()
  await p.evaluate(() => { location.hash = 'stay' }); await sleep(500)
  const want = await p.evaluate(() => { const c = document.querySelectorAll('[data-list="stay"] > .card')[5]; window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); return c.id })
  await sleep(500)
  await p.reload({ waitUntil: 'load' }); await sleep(1500)
  const after = await p.evaluate((id) => ({ hash: location.hash, top: Math.round(document.getElementById(id).getBoundingClientRect().top) }), want)
  check('a refresh keeps the same villa at the same spot', after.hash === '#stay' && Math.abs(after.top - 120) <= 4, JSON.stringify({ want, after }))
  await p.evaluate(() => { location.hash = 'areas' }); await sleep(800)
  await p.evaluate(() => __map.setView([7.9, 98.3], 13, { animate: false })); await sleep(500)
  await p.reload({ waitUntil: 'load' }); await sleep(1500)
  const mv = await p.evaluate(() => { const c = __map.getCenter(); return { lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3), z: __map.getZoom() } })
  check('a refresh keeps the map where it was', mv.lat === 7.9 && mv.lng === 98.3 && mv.z === 13, JSON.stringify(mv))
  if (errors.length) check('no page errors (refresh)', false, errors.join(' | '))
  await p.close()
}

await b.close()
const failed = results.filter((x) => !x).length
console.log(failed ? `MAP TEST FAILED: ${failed} checks` : 'MAP TEST PASSED')
process.exitCode = failed ? 1 : 0
