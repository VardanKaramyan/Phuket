// Regression test: tap "On map" on several cards in a row and check each map popup is fully tappable.
// Usage: node tools/popup-test.mjs [html build, default dist/phuket-guide-offline.html]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = pathToFileURL(path.resolve(process.argv[2] || path.join(ROOT, 'dist/phuket-guide-offline.html'))).href
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
let failures = 0
for (const [w, h] of [[390, 844], [360, 780], [320, 640]]) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h, isMobile: true, hasTouch: true })
  await p.goto(url + '#events'); await new Promise((r) => setTimeout(r, 800))
  const seq = ['ev-circoloco-thailand-2027', 'ev-shelter-phuket', 'ev-courage-bar-phuket-town', 'ev-summerset-lounge-experemint', 'pl-phi-phi-maya-bay', 'pl-big-buddha', 'pl-natural-restaurant-airport', 'ht-chill-beach-bangla-patong', 'ht-luxury-4br-pool-villa-rawai']
  const out = []
  for (const id of seq) {
    const view = id.startsWith('ev') ? 'events' : id.startsWith('pl') ? 'places' : 'stay'
    await p.evaluate((v) => { location.hash = v }, view); await new Promise((r) => setTimeout(r, 300))
    await p.evaluate((id) => document.querySelector('#' + id + ' [data-on-map]').click(), id)
    await new Promise((r) => setTimeout(r, 1200))
    const r = await p.evaluate(() => {
      const pop = document.querySelector('.leaflet-popup'); if (!pop) return 'no popup'
      const btns = Array.from(pop.querySelectorAll('.btn'))
      const bad = btns.filter((bt) => { const rr = bt.getBoundingClientRect(); const el = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2); return !bt.contains(el) }).map((bt) => bt.textContent.trim())
      const t = pop.querySelector('h4').getBoundingClientRect(); const tel = document.elementFromPoint(t.left + 10, t.top + t.height / 2)
      const titleOk = pop.contains(tel)
      const pr = pop.getBoundingClientRect()
      // a villa: Google Maps at the pin's exact coordinates
      const card = pop.querySelector('[data-from-map]')?.getAttribute('href') || ''
      let gm = ''
      if (card.startsWith('#ht-')) {
        const pt = JSON.parse(document.getElementById('guide-data').textContent).points.find((x) => x.t === 'hotel' && '#' + x.card === card)
        const href = pop.querySelector('a[data-gmaps-pin]')?.getAttribute('href') || ''
        if (!pt || href !== 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(pt.lat + ',' + pt.lng)) gm = ' · Google Maps link wrong: ' + href
      }
      return (bad.length ? 'covered: ' + bad.join('/') : 'buttons ok') + gm + (titleOk ? '' : ' · title covered') + (pr.right > window.innerWidth || pr.left < 0 ? ' · off-screen' : '')
    })
    if (r !== 'buttons ok') failures++
    out.push(id.replace(/^(ev|pl|ht)-/, '') + ': ' + r)
  }
  console.log(`${w}x${h}\n  ` + out.join('\n  '))
  await p.close()
}
await b.close()
console.log(failures ? `POPUP TEST FAILED: ${failures} popups` : 'POPUP TEST PASSED')
process.exitCode = failures ? 1 : 0
