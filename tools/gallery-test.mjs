// Villa photo galleries: each villa card swipes through its listing photos (data/hotels.json → gallery). The first photo
// is the one saved with the guide; the others come straight from Airbnb / Booking.com, and only when you get near them.
// Remote photos are answered here with a local image (no internet needed), and the test records which were asked for.
// Usage: node tools/gallery-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const hotels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/hotels.json'), 'utf8')).items
const FAKE = fs.readFileSync(path.join(ROOT, 'dist/icon-192.png'))
const REMOTE = /muscache\.com|bstatic\.com/
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })

async function open(file, { offline = false, hash = 'stay' } = {}) {
  const p = await b.newPage(); const errors = [], asked = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await p.setRequestInterception(true)
  p.on('request', (r) => {
    if (!REMOTE.test(r.url())) return r.continue()
    asked.push(r.url())
    if (offline) return r.abort('internetdisconnected')
    r.respond({ status: 200, contentType: 'image/png', body: FAKE })
  })
  await p.goto(pathToFileURL(path.join(ROOT, file)).href + '#' + hash, { waitUntil: 'load' }); await sleep(800)
  return { p, errors, asked }
}
const ID = 'ht-mouana-breeze-mai-khao'
const state = (p, id = ID) => p.evaluate((id) => {
  const g = document.querySelector('#' + id + ' [data-gallery]'); if (!g) return null
  const imgs = [...g.querySelectorAll('img')]
  return {
    slides: imgs.length, visible: imgs.filter((i) => getComputedStyle(i).display !== 'none').length,
    loaded: imgs.map((i, n) => (i.getAttribute('src') ? n : -1)).filter((n) => n >= 0),
    count: document.querySelector('#' + id + ' .gal-count')?.textContent, at: Math.round(g.scrollLeft / g.clientWidth),
  }
}, id)

{
  // opened on Home: no villa is on screen yet
  const { p, errors, asked } = await open('dist/index.html', { hash: 'home' })
  const want = hotels.filter((h) => (h.gallery || []).length).length
  const cards = await p.evaluate(() => document.querySelectorAll('.card[id^="ht-"] [data-gallery]').length)
  check('every villa with photos has a gallery', cards === want && want > 0, `${cards} of ${want}`)
  const h = hotels.find((x) => 'ht-' + x.id === ID)
  let s = await state(p)
  check('the saved photo first, then the listing photos', s.slides === h.gallery.length + 1, `${s.slides} slides for ${h.gallery.length} listing photos`)
  check('no listing photo is loaded before you look at the villas', asked.length === 0, `${asked.length} asked`)
  await p.evaluate((id) => { location.hash = 'stay' }); await sleep(400)
  await p.evaluate((id) => document.getElementById(id).scrollIntoView(), ID); await sleep(700)
  s = await state(p)
  check('in view: only the next photo is fetched ahead', s.count === '1 / ' + s.slides && s.loaded.join() === '0,1', JSON.stringify(s))
  await p.evaluate((id) => document.querySelector('#' + id + ' .gal-btn.next').click(), ID); await sleep(900)
  s = await state(p)
  check('Next shows photo 2 and fetches photo 3', s.at === 1 && s.count === '2 / ' + s.slides && s.loaded.includes(2) && !s.loaded.includes(4), JSON.stringify(s))
  await p.evaluate((id) => { const g = document.querySelector('#' + id + ' [data-gallery]'); g.scrollTo({ left: g.clientWidth * 9, behavior: 'instant' }) }, ID); await sleep(700)
  s = await state(p)
  check('a swipe far ahead shows that photo', s.at === 9 && s.count === '10 / ' + s.slides && s.loaded.includes(9) && s.loaded.includes(10), JSON.stringify(s))
  await p.evaluate((id) => document.querySelector('#' + id + ' .gal-btn.prev').click(), ID); await sleep(900)
  s = await state(p)
  check('Previous goes back one', s.at === 8 && s.count === '9 / ' + s.slides, JSON.stringify(s))
  const sizes = asked.filter((u) => /muscache/.test(u)).every((u) => /[?&]im_w=720/.test(u))
  check('Airbnb photos are asked for at 720 px wide', sizes, asked.slice(0, 2).join(' '))
  const alts = await p.evaluate((id) => [...document.querySelectorAll('#' + id + ' [data-gallery] img')].slice(1, 4).map((i) => i.alt), ID)
  check('photos have their captions as alt text', alts.length === 3 && alts.every(Boolean), JSON.stringify(alts))
  if (errors.length) check('no page errors', false, errors.join(' | '))
  await p.close()
}
{
  // offline: the saved photo still shows, and a listing photo that cannot load says why instead of a broken image
  const { p, errors } = await open('dist/index.html', { offline: true })
  await p.evaluate((id) => { document.getElementById(id).scrollIntoView(); document.querySelector('#' + id + ' .gal-btn.next').click() }, ID); await sleep(1200)
  const r = await p.evaluate((id) => {
    const imgs = [...document.querySelectorAll('#' + id + ' [data-gallery] img')]
    return { first: imgs[0].complete && imgs[0].naturalWidth > 0, second: imgs[1].classList.contains('gal-off') && /^data:image\/svg/.test(imgs[1].src) }
  }, ID)
  check('offline: saved photo shows, others say they need internet', r.first && r.second, JSON.stringify(r))
  if (errors.length) check('no page errors (offline)', false, errors.join(' | '))
  await p.close()
}
{
  // the artifact cannot show outside photos: it keeps to the saved one
  const { p, asked } = await open('artifact/index.html')
  await p.evaluate((id) => document.getElementById(id)?.scrollIntoView(), ID); await sleep(700)
  const s = await state(p)
  check('artifact: only the saved photo, nothing fetched', s && s.visible === 1 && asked.length === 0, JSON.stringify({ visible: s && s.visible, asked: asked.length }))
  await p.close()
}
await b.close()
console.log(failed ? `GALLERY TEST FAILED: ${failed}` : 'GALLERY TEST PASSED')
process.exitCode = failed ? 1 : 0
