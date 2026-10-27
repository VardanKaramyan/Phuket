// Shared links: every villa, event and place has a share page (dist/s/<card id>.html) whose Open Graph tags give
// messengers a preview (photo, name, price or date), and which opens the guide on that card. The site's own page has
// a preview too. A local server maps /s/<name> to dist/s/<name>.html, as vercel.json does on Vercel.
// Usage: node tools/share-test.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const SITE = 'https://phuket-six.vercel.app'
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const meta = (html, k) => (html.match(new RegExp(`<meta property="${k}" content="([^"]*)"`)) || [])[1]
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).items

// every card has a share page with its preview, and every preview photo is a JPEG messengers take
const cards = [...read('data/hotels.json').map((x) => 'ht-' + x.id), ...read('data/events.json').map((x) => 'ev-' + x.id), ...read('data/places.json').map((x) => 'pl-' + x.id)]
const missing = cards.filter((id) => !fs.existsSync(path.join(DIST, 's', id + '.html')))
check('every villa, event and place has a share page', !missing.length && cards.length > 100, `${cards.length - missing.length} of ${cards.length}` + (missing.length ? ', missing ' + missing.slice(0, 3).join(' ') : ''))
const bad = []
const imgs = new Set()
for (const id of cards.filter((x) => !missing.includes(x))) {
  const html = fs.readFileSync(path.join(DIST, 's', id + '.html'), 'utf8')
  const img = meta(html, 'og:image') || ''
  const why = [!meta(html, 'og:title') && 'no title', !meta(html, 'og:description') && 'no description', meta(html, 'og:url') !== SITE + '/s/' + id && 'url',
    !img.startsWith(SITE + '/og/') && 'image', !html.includes(`location.replace('/#${id}')`) && 'no redirect', !html.includes(`href="/#${id}"`) && 'no link'].filter(Boolean)
  if (why.length) bad.push(id + ': ' + why.join(', '))
  imgs.add(img.slice((SITE + '/og/').length))
}
check('each share page has a title, text, photo and the way to the card', !bad.length, bad.slice(0, 3).join(' | '))
const imgBad = []
for (const f of imgs) {
  const file = path.join(DIST, 'og', f)
  if (!fs.existsSync(file)) { imgBad.push(f + ' missing'); continue }
  const m = await sharp(file).metadata(), kb = fs.statSync(file).size / 1024
  if (m.format !== 'jpeg' || m.width < 300 || m.width / m.height > 4 || kb > 600) imgBad.push(`${f} ${m.format} ${m.width}x${m.height} ${Math.round(kb)} KB`)
}
check('preview photos: JPEG, at least 300 px wide, under 600 KB (WhatsApp)', !imgBad.length && imgs.size > 100, imgs.size + ' photos' + (imgBad.length ? ', ' + imgBad.slice(0, 3).join(' | ') : ''))
const villa = fs.readFileSync(path.join(DIST, 's', 'ht-alisa-pool-villa.html'), 'utf8')
check('a villa preview gives the price in drams and baht, rooms and area', /AMD/.test(meta(villa, 'og:description')) && /THB/.test(meta(villa, 'og:description')) && /bedrooms/.test(meta(villa, 'og:description')) && meta(villa, 'og:title') === 'Alisa Pool Villa', meta(villa, 'og:description'))
const site = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const at = site.indexOf('og:image')
check("the guide's own page has a preview, early in the page (WhatsApp reads the first 300 KB)", meta(site, 'og:title') && meta(site, 'og:image') === SITE + '/og/site.jpg' && at > 0 && at < 300 * 1024 && fs.existsSync(path.join(DIST, 'og', 'site.jpg')), 'at byte ' + at)
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
check('vercel.json serves /s/<name> from s/<name>.html', (vercel.rewrites || []).some((r) => r.source === '/s/:slug' && r.destination === '/s/:slug.html'), JSON.stringify(vercel.rewrites))

// in a browser: a share page opens the guide on its card; the Share buttons give the share page's address
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  if (/^\/s\/[a-z0-9-]+$/.test(p)) p += '.html'
  const f = path.join(DIST, p)
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(8798, '127.0.0.1', r))
const base = 'http://127.0.0.1:8798/'
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const p = await b.newPage(); const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
const ev = cards.find((x) => x.startsWith('ev-'))
await p.goto(base + 's/' + ev, { waitUntil: 'networkidle0' }); await sleep(1200)
const land = await p.evaluate((id) => ({ url: location.pathname + location.hash, top: Math.round(document.getElementById(id)?.getBoundingClientRect().top ?? -1) }), ev)
check('a share page opens the guide on its card', land.url === '/#' + ev && land.top >= 0 && land.top < 200, JSON.stringify(land))
await p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d } }); location.hash = 'places' }); await sleep(600)
const pl = await p.evaluate(async () => {
  const card = document.querySelector('#places .card[id^="pl-"]')
  card.querySelector('[data-share-card]').click(); await new Promise((r) => setTimeout(r, 200))
  return { id: card.id, name: card.dataset.name, shared: window.__shared }
})
check('Share on a place gives its share page', pl.shared && pl.shared.url === base + 's/' + pl.id && pl.shared.title === pl.name, JSON.stringify(pl))
// Places → 18+: its cards stay out of All; under 18+ they show, with the Where row in place of the length row
const adult = await p.evaluate(async () => {
  const bar = document.querySelector('[data-toolbar="places"]'), chip = bar.querySelector('.chip[data-group="tier"][data-value="adult"]')
  if (!chip) return null
  const shown = () => [...document.querySelectorAll('[data-list="places"] > .card')].filter((c) => !c.hidden)
  const row = (g) => bar.querySelector(`.chip[data-group="${g}"]`).closest('.chips').hidden
  const all = shown().filter((c) => c.dataset.only).length
  chip.click(); await new Promise((r) => setTimeout(r, 150))
  const on = shown(), out = { all, adult: on.length, other: on.filter((c) => !c.dataset.only).length, where: !row('where'), dur: !row('dur') }
  bar.querySelector('.chip[data-group="tier"][data-value="all"]').click()
  return out
})
check('18+ cards only under 18+, with the Where row', !adult || (adult.all === 0 && adult.adult > 10 && adult.other === 0 && adult.where && !adult.dur), JSON.stringify(adult))
// Places → Food: its cards stay out of All; under Food the Where and Kind rows replace the length row, Pork shows only
// pork places, and a link to a food card opens it under Food
const foodTab = await p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const bar = document.querySelector('[data-toolbar="places"]'), chip = bar.querySelector('.chip[data-group="tier"][data-value="food"]')
  if (!chip) return null
  const shown = () => [...document.querySelectorAll('[data-list="places"] > .card')].filter((c) => !c.hidden)
  const row = (g) => bar.querySelector(`.chip[data-group="${g}"]`).closest('.chips').hidden
  const all = shown().filter((c) => c.dataset.tier === 'food').length
  chip.click(); await wait(150)
  // in the order on screen (CSS order: the markets' own cards sit higher in the list)
  const on = shown().map((c, i) => [c, Number(getComputedStyle(c).order) || 0, i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([c]) => c)
  const out = { all, food: on.length, other: on.filter((c) => !c.dataset.tier.split(' ').includes('food')).length, markets: on.filter((c) => !c.classList.contains('food-card') && !c.classList.contains('basics')).length, first: on[0]?.id, where: !row('fwhere'), kind: !row('fkind'), dur: !row('dur') }
  const pork = bar.querySelector('.chip[data-group="fkind"][data-value="pork"]')
  if (pork) { pork.click(); await wait(150); out.pork = shown().filter((c) => c.classList.contains('food-card')).every((c) => c.dataset.fkind.split(' ').includes('pork')); out.porkN = shown().length }
  const last = on.filter((c) => c.classList.contains('food-card')).at(-1)
  bar.querySelector('.chip[data-group="tier"][data-value="all"]').click(); await wait(150)
  out.reset = row('fwhere') && bar.querySelector('.chip[data-group="fkind"][aria-pressed="true"]').dataset.value === 'all'
  location.hash = last.id; await wait(400)
  out.link = { id: last.id, shown: !last.hidden, tab: bar.querySelector('.chip[data-group="tier"][aria-pressed="true"]').dataset.value }
  bar.querySelector('.chip[data-group="tier"][data-value="all"]').click(); location.hash = 'places'; await wait(150)
  return out
})
check('Food cards only under Food, with the Where and Kind rows; Pork shows pork places; a link to one opens it under Food', !foodTab || (foodTab.all === 0 && foodTab.food > 20 && foodTab.other === 0 && foodTab.first === 'food-basics' && foodTab.where && foodTab.kind && !foodTab.dur && foodTab.pork !== false && foodTab.porkN > 3 && foodTab.reset && foodTab.link.shown && foodTab.link.tab === 'food'), JSON.stringify(foodTab))
// Places → Food → a category: its subcategory row shows (no other), a subcategory and Good for narrow the list, a second
// tap on a Good for chip turns it off, and under All every food row goes back to its first chip (the counts too)
const foodCats = await p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const bar = document.querySelector('[data-toolbar="places"]'), q = (s) => bar.querySelector(s)
  if (!q('.chip[data-group="fkind"][data-value="pork"]') || !q('.chip[data-group="subpork"]')) return null
  const shown = () => [...document.querySelectorAll('[data-list="places"] > .card')].filter((c) => !c.hidden && !c.classList.contains('basics'))
  const has = (c, k, v) => (c.dataset[k] || '').split(' ').includes(v)
  q('.chip[data-group="tier"][data-value="food"]').click(); await wait(100)
  q('.chip[data-group="fkind"][data-value="pork"]').click(); await wait(100)
  const subs = [...bar.querySelectorAll('.chips[data-when^="fkind:"]')].filter((r) => !r.hidden).map((r) => r.dataset.when)
  const leg = q('.chip[data-group="subpork"]:not([data-value="all"])'); leg.click(); await wait(100)
  const out = { subs, sub: leg.dataset.value, subOk: shown().length > 0 && shown().every((c) => has(c, 'fkind', 'pork') && has(c, 'subpork', leg.dataset.value)) }
  const allN = Number(q('.chip[data-group="tier"][data-value="all"] .n').textContent)
  q('.chip[data-group="subpork"][data-value="all"]').click(); await wait(100)
  const good = q('.chip[data-group="fgood"]:not([data-value="all"])'); good.click(); await wait(100)
  out.good = good.dataset.value; out.goodOk = shown().length > 0 && shown().every((c) => has(c, 'fgood', good.dataset.value) && has(c, 'fkind', 'pork'))
  good.click(); await wait(100)
  out.off = q('.chip[data-group="fgood"][aria-pressed="true"]').dataset.value
  q('.chip[data-group="subpork"]:not([data-value="all"])').click(); await wait(100)
  q('.chip[data-group="tier"][data-value="all"]').click(); await wait(100)
  out.back = ['fkind', 'subpork', 'fgood'].map((g) => q(`.chip[data-group="${g}"][aria-pressed="true"]`).dataset.value).join(' ')
  out.hidden = [...bar.querySelectorAll('.chips[data-when="tier:food"], .chips[data-when^="fkind:"]')].every((r) => r.hidden)
  out.allN = allN; out.allShown = [...document.querySelectorAll('[data-list="places"] > .card')].filter((c) => !c.hidden).length
  location.hash = 'places'; await wait(100)
  return out
})
check('Food categories: one subcategory row, subcategory and Good for filter, Good for turns off, all reset under All', !foodCats || (foodCats.subs.join() === 'fkind:pork' && foodCats.subOk && foodCats.goodOk && foodCats.off === 'all' && foodCats.back === 'all all all' && foodCats.hidden && foodCats.allN === foodCats.allShown), JSON.stringify(foodCats))
const evShare = await p.evaluate(async () => {
  location.hash = 'events'; await new Promise((r) => setTimeout(r, 300))
  const card = document.querySelector('#events .card[id^="ev-"]')
  card.querySelector('[data-share-card]').click(); await new Promise((r) => setTimeout(r, 200))
  return { id: card.id, url: window.__shared && window.__shared.url }
})
check('Share on an event gives its share page', evShare.url === base + 's/' + evShare.id, JSON.stringify(evShare))
if (errors.length) check('no page errors', false, errors.join(' | '))
await b.close(); server.close()
console.log(failed ? `SHARE TEST FAILED: ${failed}` : 'SHARE TEST PASSED')
process.exitCode = failed ? 1 : 0
