// Our villas (TRIP.bases in tools/trip.mjs): the nights in each, Our villas on the Stay tab, the Booked badges, the
// villa line under each day, driving times on the cards, Koh Phangan left out of the villa nights, the labelled pins on
// the map, and Directions that ask where from (either villa, or where you are). The page's clock is set to 15 Jan 2027,
// a night in the Rawai villa.
// Usage: node tools/bases-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'
import { TRIP, baseOf, leavingOn } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = pathToFileURL(path.join(ROOT, 'dist/phuket-guide-offline.html')).href
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))

// the nights
const nights = ['2027-01-08', '2027-01-13', '2027-01-14', '2027-01-17', '2027-01-18'].map((d) => baseOf(d)?.key || '-').join(' ')
check('each night belongs to the right villa', nights === 'patong patong rawai rawai -' && leavingOn('2027-01-14')?.key === 'patong' && leavingOn('2027-01-18')?.key === 'rawai', nights)
const stays = read('data/stays.json').items
check('both booked villas are in the villa list', TRIP.bases.every((b) => stays.some((h) => h.id === b.id)), TRIP.bases.map((b) => b.id).join(', '))

// driving times for every place you drive to
const drive = read('data/drive-times.json').items
const ISLANDS = new Set(['phi-phi', 'koh-yao', 'koh-lanta', 'koh-lipe', 'koh-phangan', 'koh-samui', 'koh-tao', 'krabi', 'surat-thani', 'trang', 'other'])
const want = read('data/places.json').items.filter((p) => !ISLANDS.has(p.area) && p.coordConfidence !== 'low' && Number.isFinite(+p.lat))
const noTime = want.filter((p) => !TRIP.bases.every((b) => drive['pl:' + p.id]?.[b.key]?.min >= 0)).map((p) => p.id)
check('driving times from both villas for every place on Phuket and the mainland', !noTime.length && want.length > 50, `${want.length - noTime.length} of ${want.length}` + (noTime.length ? ', missing ' + noTime.slice(0, 4).join(' ') + ' (run node tools/drive-times.mjs)' : ''))

const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const p = await b.newPage(); const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
await p.evaluateOnNewDocument(() => {
  const at = Date.parse('2027-01-15T10:00:00+07:00'), shift = at - Date.now(), R = Date
  window.Date = class extends R { constructor(...a) { super(...(a.length ? a : [R.now() + shift])) } static now() { return R.now() + shift } }
  let real; Object.defineProperty(window, 'L', { configurable: true, get: () => real, set: (v) => { real = v; v.Map.addInitHook(function () { if (this.getContainer().id === 'map') window.__map = this }) } })
})
await p.goto(url + '#home'); await sleep(900)

const page = await p.evaluate(() => {
  const t = (s) => document.querySelector(s)?.textContent.replace(/\s+/g, ' ').trim() || ''
  return {
    strip: t('.bases-strip'), cards: [...document.querySelectorAll('#our-villas .base-card')].map((c) => c.textContent.replace(/\s+/g, ' ')),
    badges: [...document.querySelectorAll('.pill.booked')].map((x) => x.closest('.card').id + ' ' + x.textContent),
    d8: t('#day-2027-01-08 .day-base'), d10: t('#day-2027-01-10 .day-base'), d14: t('#day-2027-01-14 .day-base'), d18: t('#day-2027-01-18 .day-base'), d20: t('#day-2027-01-20 .day-base'),
    phangan14: [...document.querySelectorAll('#day-2027-01-14 a[href^="#ev-"]')].filter((a) => /Phangan|Haad Rin/i.test(a.parentElement.textContent)).length,
    phangan20: [...document.querySelectorAll('#day-2027-01-20 a[href^="#ev-"]')].filter((a) => /Phangan|Haad Rin/i.test(a.parentElement.textContent)).length,
    byCar: [...document.querySelectorAll('#pl-big-buddha .facts dt')].find((d) => d.textContent === 'By car')?.nextElementSibling.textContent || '',
    tourCar: [...document.querySelectorAll('.card[id^="pl-tour-"] .facts dt')].some((d) => d.textContent === 'By car'),
  }
})
check('the Trip page shows our two villas and their dates', /Patong villa.*8.*14 Jan/.test(page.strip) && /Rawai villa.*14.*18 Jan/.test(page.strip), page.strip)
check('Our villas on the Stay tab: both, with check-in and checkout', page.cards.length === 2 && /Fri 8 Jan check-in from 15:00/.test(page.cards[0]) && /Thu 14 Jan checkout by 11:00/.test(page.cards[0]) && /Mon 18 Jan checkout by 12:00/.test(page.cards[1]), page.cards.map((c) => c.slice(0, 90)).join(' | '))
check('the two villa cards say Booked, with their dates', page.badges.length === 2 && page.badges.some((x) => /136-pool-villa.*8–14 Jan/.test(x)) && page.badges.some((x) => /luxurious-seaview.*14–18 Jan/.test(x)), page.badges.join(' | '))
check('each day says which villa you are in', /Check in at the Patong villa from 15:00/.test(page.d8) && /Night at the Patong villa/.test(page.d10) && /out of the Patong villa by 11:00, into the Rawai villa from 16:00/.test(page.d14) && /Check out of the Rawai villa by 12:00/.test(page.d18) && !page.d20, JSON.stringify([page.d8, page.d14, page.d18]))
check('villa nights leave out Koh Phangan parties; full-moon week keeps them', page.phangan14 === 0 && page.phangan20 > 0, `14 Jan: ${page.phangan14}, 20 Jan: ${page.phangan20}`)
check('cards give the drive from both villas; boat tours do not', /min from the Patong villa · \d+ min from the Rawai villa \(no traffic\)/.test(page.byCar) && !page.tourCar, page.byCar)

// Directions: where from? tonight's villa first (15 Jan: Rawai), then the other, then where you are now
const dir = await p.evaluate(async () => {
  location.hash = 'pl-big-buddha'; await new Promise((r) => setTimeout(r, 300))
  document.querySelector('#pl-big-buddha a[data-dir]').click(); await new Promise((r) => setTimeout(r, 200))
  const dlg = document.getElementById('dir-dialog')
  const opts = [...dlg.querySelectorAll('.dir-opt')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') }))
  const what = document.getElementById('dir-what').textContent, open = dlg.open
  dlg.close()
  return { open, what, opts, dest: document.querySelector('#pl-big-buddha a[data-dir]').dataset.dir }
})
const bases = await p.evaluate(() => (window.__guideData = JSON.parse(document.getElementById('guide-data').textContent)).bases)
const rawai = bases.find((x) => x.key === 'rawai'), patong = bases.find((x) => x.key === 'patong')
check('Directions asks where from: tonight\'s villa first, the other villa, then where you are', dir.open && dir.what === 'To Big Buddha' && dir.opts.length === 3 &&
  /From the Rawai villa.*where you sleep tonight/.test(dir.opts[0].text) && /From the Patong villa/.test(dir.opts[1].text) && /From where I am now/.test(dir.opts[2].text), dir.opts.map((o) => o.text).join(' | '))
check('the links start at the villa (or at you) and end at the place', dir.opts[0].href.includes('origin=' + rawai.lat + ',' + rawai.lng) && dir.opts[1].href.includes('origin=' + patong.lat + ',' + patong.lng) && !dir.opts[2].href.includes('origin=') && dir.opts.every((o) => o.href.includes('destination=' + dir.dest)), dir.opts[0].href)
const own = await p.evaluate(async () => {
  location.hash = 'our-villas'; await new Promise((r) => setTimeout(r, 300))
  document.querySelector('#base-rawai a[data-dir]').click(); await new Promise((r) => setTimeout(r, 200))
  const t = [...document.querySelectorAll('#dir-dialog .dir-opt')].map((a) => a.textContent)
  document.getElementById('dir-dialog').close(); return t
})
check("directions to a villa do not offer starting from that villa", own.length === 2 && /Patong villa/.test(own[0]) && !own.some((t) => /Rawai villa/.test(t)), own.join(' | '))

// the map: our villas have their own labelled pins, above the others
await p.evaluate(() => { location.hash = 'areas' }); await sleep(1500)
const map = await p.evaluate(() => ({ tips: [...document.querySelectorAll('.leaflet-tooltip.base-tip')].map((t) => t.textContent), pane: document.querySelectorAll('.leaflet-base-pane path').length }))
check('the map labels our two villas, on top of the other pins', map.tips.length === 2 && map.tips.some((t) => /Patong villa · 8–14 Jan/.test(t)) && map.tips.some((t) => /Rawai villa · 14–18 Jan/.test(t)) && map.pane === 2, JSON.stringify(map))
const popupDir = await p.evaluate(async () => {
  const m = Object.values(__map._layers).find((l) => l instanceof L.CircleMarker && l.options.pane !== 'basePane' && /place|event/.test(l.kind || '') && typeof l.getPopup()?._content === 'function' && /data-dir=/.test(l.getPopup()._content(l)))
  if (!m) return 'no popup with directions'
  m.openPopup(); await new Promise((r) => setTimeout(r, 300))
  document.querySelector('.leaflet-popup a[data-dir]').click(); await new Promise((r) => setTimeout(r, 200))
  const n = document.querySelectorAll('#dir-dialog .dir-opt').length; document.getElementById('dir-dialog').close(); return n
})
check('Directions in a map pop-up asks too', popupDir === 3, String(popupDir))
if (errors.length) check('no page errors', false, errors.join(' | '))
await b.close()
console.log(failed ? `BASES TEST FAILED: ${failed}` : 'BASES TEST PASSED')
process.exitCode = failed ? 1 : 0
