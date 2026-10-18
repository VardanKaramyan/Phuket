// New villas: the phone remembers which villas it has shown; a villa added to the guide since then gets a New badge
// (and the Stay tab a count) until it has been on screen for a moment. The first visit shows no badges.
// Two "new" villas are made by removing them from the phone's list before a reload.
// Usage: node tools/new-villas-test.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = pathToFileURL(path.join(ROOT, 'dist/phuket-guide-offline.html')).href
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const p = await b.newPage(); const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
const state = () => p.evaluate(() => ({
  badges: [...document.querySelectorAll('#stay .card .pill.new')].map((x) => x.closest('.card').dataset.stay),
  count: (() => { const d = document.querySelector('.tabbar a[href="#stay"] .tab-new'); return d && !d.hidden ? d.textContent : '' })(),
  label: document.querySelector('.tabbar a[href="#stay"]').getAttribute('aria-label') || '',
}))

await p.goto(url + '#home'); await sleep(800)
let s = await state()
const all = await p.evaluate(() => JSON.parse(localStorage.getItem('pg:knownStays') || '[]'))
check('first visit: no New badges, and the phone remembers every villa', !s.badges.length && !s.count && all.length > 5, all.length + ' remembered')

// two villas this phone has not seen: one near the top of the list, one further down
const [first, later] = await p.evaluate(() => { const c = [...document.querySelectorAll('#stay .card[data-stay]')]; return [c[0].dataset.stay, c[c.length - 1].dataset.stay] })
await p.evaluate((drop) => localStorage.setItem('pg:knownStays', JSON.stringify(JSON.parse(localStorage.getItem('pg:knownStays')).filter((id) => !drop.includes(id)))), [first, later])
await p.evaluate(() => { location.hash = 'home' }); await p.reload(); await sleep(800)
s = await state()
check('villas added since the last visit say New, and the Stay tab counts them', s.badges.length === 2 && s.badges.includes(first) && s.badges.includes(later) && s.count === '2' && /2 new villas/.test(s.label), JSON.stringify(s))

// look at the first one for 2 s: it counts as seen (the badge stays for this visit)
await p.evaluate((id) => { location.hash = 'stay'; setTimeout(() => document.getElementById('ht-' + id).scrollIntoView({ block: 'center' }), 200) }, first); await sleep(2400)
s = await state()
check('a new villa on screen for a moment is seen: the count drops, the badge stays this visit', s.count === '1' && s.badges.includes(first), JSON.stringify(s))

await p.evaluate(() => { location.hash = 'home' }); await p.reload(); await sleep(800)
s = await state()
check('next visit: no badge on the villa you saw; the other is still New', s.badges.length === 1 && s.badges[0] === later && s.count === '1', JSON.stringify(s))
if (errors.length) check('no page errors', false, errors.join(' | '))
await b.close()
console.log(failed ? `NEW VILLAS TEST FAILED: ${failed}` : 'NEW VILLAS TEST PASSED')
process.exitCode = failed ? 1 : 0
