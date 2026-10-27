// Reads Google Maps place pages (the plain view Google serves a headless browser) for a list of searches: the food
// research of 27 Oct 2026 checked every place with it. Re-check the food places before the trip with it.
// Usage: node tools/gmaps-read.mjs queries.json out.json      (queries.json: ["Mee Ton Poe, Phuket Town", ...] or [{ id, q }, ...])
//        node tools/gmaps-read.mjs "Mee Ton Poe, Phuket Town"  (one search, printed)
// Each result: name, nameLocal, rating (no review count: Google does not show it in this view), category, address,
// status (open/closed now, or Permanently / Temporarily closed), hours (the week, when Google shows it), website, phone,
// lat/lng (the pin from the page URL), mapsUrl, placeId (ChIJ…, when the URL has it: open a list result's url to get it). A search that lands on a list returns `list`: the first results
// (name, rating, category, link), to search again more precisely.
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'
const [a1, a2] = process.argv.slice(2)
const one = a1 && !a1.endsWith('.json')
const queries = (one ? [a1] : JSON.parse(fs.readFileSync(a1, 'utf8'))).map((x, i) => (typeof x === 'string' ? { id: String(i), q: x } : x))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--lang=en-US', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
async function read(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForFunction(() => document.querySelector('h1') || document.querySelector('[role="feed"]'), { timeout: 15000 }).catch(() => {})
  await sleep(1500)
  if (await page.$('[role="feed"]') && !(await page.$('button[data-item-id="address"]'))) {
    return { list: await page.evaluate(() => [...document.querySelectorAll('[role="feed"] a[href*="/maps/place/"]')].slice(0, 6).map((a) => {
      const card = a.closest('[jsaction]')?.parentElement || a.parentElement
      const t = (card?.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean)
      return { name: a.getAttribute('aria-label'), placeId: (a.href.match(/!19s(ChIJ[\w-]+)/) || [])[1] || '', rating: Number((t.find((s) => /^\d\.\d/.test(s)) || '').slice(0, 3)) || null, line: t.slice(1, 4).join(' | '), url: a.href.split('?')[0] }
    })) }
  }
  // the name, rating and the rest first: the week's hours open a panel with a heading of its own ("Hours")
  const out = await page.evaluate(() => {
    const txt = (s) => document.querySelector(s)?.innerText?.trim() || ''
    const h1 = document.querySelector('h1')
    const head = h1?.closest('div')?.parentElement?.innerText?.split('\n').map((s) => s.trim()).filter(Boolean) || []
    const ratingLabel = [...document.querySelectorAll('[aria-label$="stars "], [aria-label$=" stars"], [role="img"][aria-label*="stars"]')].map((e) => e.getAttribute('aria-label')).find((l) => /\d/.test(l)) || ''
    const hours = [...document.querySelectorAll('table.eK4R0e tr, table tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()).filter(Boolean).join(' ').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').replace('Copy open hours', '').trim()).filter((s) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(s))
    const body = document.body.innerText.replace(/[\ue000-\uf8ff]/g, '')
    const status = (body.match(/Permanently closed|Temporarily closed/) || [])[0] || (body.split('\n').map((l) => l.trim()).find((l) => /^(Open|Closed|Opens|Closes)\b/.test(l)) || '')
    const cat = document.querySelector('button[jsaction*="category"]')?.innerText || ''
    return {
      name: h1?.innerText?.trim() || '', nameLocal: head[1] && head[1] !== head[0] && !/^\d\.\d/.test(head[1]) ? head[1] : '',
      rating: Number((ratingLabel.match(/\d\.\d/) || [])[0]) || null, category: cat,
      address: txt('button[data-item-id="address"]').replace(/^\W+/, ''), status: status.replace(/\s+/g, ' ').trim(),
      hours, website: document.querySelector('a[data-item-id="authority"]')?.href || '', phone: txt('button[data-item-id^="phone"]').replace(/^\W+/, ''),
      limited: /limited view of Google Maps/.test(body),
    }
  })
  if (await page.evaluate(() => { const el = document.querySelector('[aria-label="Show open hours for the week"], [data-item-id="oh"]'); if (el) el.click(); return !!el })) {
    await sleep(600)
    const week = await page.evaluate(() => [...document.querySelectorAll('table.eK4R0e tr, table tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()).filter(Boolean).join(' ').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').replace('Copy open hours', '').trim()).filter((s) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(s)))
    if (week.length > out.hours.length) out.hours = week
  }
  // the pin comes with the place's own URL, a moment after the page
  await page.waitForFunction(() => /!3d-?\d|@-?\d/.test(location.href), { timeout: 6000 }).catch(() => {})
  const u = page.url(), m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  return { ...out, placeId: (u.match(/!19s(ChIJ[\w-]+)/) || [])[1] || '', lat: m ? Number(m[1]) : null, lng: m ? Number(m[2]) : null, mapsUrl: u.split('?')[0] }
}
const res = []
const pages = await Promise.all((one ? [0] : [0, 1, 2]).map(async () => { const p = await b.newPage(); await p.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }); await p.setViewport({ width: 1280, height: 900 }); return p }))
let next = 0, blocked = false
await Promise.all(pages.map(async (page) => {
  while (next < queries.length) {
    const it = queries[next++]
    const url = /^https:\/\/www\.google\.com\/maps\//.test(it.q) ? it.q + (it.q.includes('?') ? '&' : '?') + 'hl=en' : 'https://www.google.com/maps/search/?api=1&hl=en&query=' + encodeURIComponent(it.q)
    let r
    for (let t = 0; t < 2 && !r; t++) { try { r = await read(page, url) } catch (e) { if (t) r = { error: e.message } } }
    // Google's unusual-traffic page: stop at once (do not try to get past it); read the rest another day, in small batches
    if (/\/sorry\//.test(page.url())) { blocked = true; next = queries.length; console.error('Google showed its unusual-traffic page after ' + res.length + ' reads: stopped. Try the rest another day.'); break }
    res.push({ id: it.id, q: it.q, readOn: new Date().toISOString().slice(0, 10), ...r })
    await sleep(800)
  }
}))
await b.close()
res.sort((x, y) => queries.findIndex((q) => q.id === x.id) - queries.findIndex((q) => q.id === y.id))
if (one) console.log(JSON.stringify(res[0], null, 1))
else { fs.writeFileSync(a2, JSON.stringify(res, null, 1)); console.log(`${res.length} read, ${res.filter((r) => r.list).length} lists, ${res.filter((r) => r.error).length} errors${blocked ? ', stopped by Google' : ''} → ${a2}`) }
