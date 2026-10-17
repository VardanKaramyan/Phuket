// Collects each villa's listing photos (addresses only, nothing is downloaded) into data/stays.json → gallery,
// so the villa cards can swipe through them online. Airbnb: the photo tour of the listing page (in Airbnb's order,
// with its captions); Booking.com: the property's own photo list. Run it after adding a villa: npm run gallery,
// then npm run data and npm run build.
// Usage: node tools/stay-gallery.mjs [villa id …] (default: every villa)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'data/stays.json')
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const only = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 140)

async function airbnb(page, id) {
  await page.goto(`https://www.airbnb.com/rooms/${id}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(2000)
  return page.evaluate(() => {
    // the longest mediaItems list in the page data is the photo tour
    let best = []
    const walk = (o) => {
      if (!o || typeof o !== 'object') return
      if (Array.isArray(o.mediaItems) && o.mediaItems.length > best.length) best = o.mediaItems
      for (const v of Object.values(o)) walk(v)
    }
    for (const s of document.querySelectorAll('script[type="application/json"]')) { try { walk(JSON.parse(s.textContent)) } catch { /* not JSON */ } }
    return best.filter((m) => m && m.baseUrl).map((m) => ({ url: m.baseUrl, alt: m.accessibilityLabel || m.imageMetadata?.caption || '' }))
  })
}
async function booking(page, url) {
  await page.goto(url.split('?')[0] + '?lang=en-us', { waitUntil: 'networkidle2', timeout: 90000 })
  await sleep(2500)
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML
    const blk = (html.match(/hotelPhotos\s*:\s*\[([\s\S]*?)\]\s*,\s*\n/) || [])[1] || ''
    return blk.split(/\n\{/).map((x) => ({
      url: (x.match(/large_url\s*:\s*'([^']+)'/) || [])[1],
      alt: (x.match(/alt\s*:\s*"([^"]*)"/) || [])[1] || '',
    })).filter((x) => x.url)
  })
}

const b = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--lang=en-US'] })
let changed = 0
for (const v of doc.items) {
  if (only.length && !only.includes(v.id)) continue
  const page = await b.newPage()
  await page.setUserAgent(UA)
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  await page.setViewport({ width: 1280, height: 1000 })
  let photos = []
  try {
    const aid = (String(v.website).match(/airbnb\.[a-z.]+\/rooms\/(\d+)/) || [])[1]
    if (aid) photos = await airbnb(page, aid)
    else if (/booking\.com\/hotel\//.test(v.website)) photos = await booking(page, v.website)
  } catch (e) { console.log(`  ${v.id}: ${e.message}`) }
  await page.close()
  // the card's own photo (saved with the guide) is the first slide already
  const cover = String((v.imageCandidates || [])[0]?.url || '').split('?')[0]
  photos = photos.filter((x, i, a) => x.url.split('?')[0] !== cover && a.findIndex((y) => y.url === x.url) === i).map((x) => ({ url: x.url, alt: tidy(x.alt) }))
  if (photos.length) { v.gallery = photos; changed++ }
  console.log(`${v.id}: ${photos.length ? photos.length + ' photos' : 'none found (kept ' + ((v.gallery || []).length) + ')'}`)
  await sleep(1200)
}
await b.close()
fs.writeFileSync(FILE, JSON.stringify(doc, null, 1) + '\n')
console.log(`galleries updated: ${changed}`)
