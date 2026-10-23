// The countdown: a departure board in the Trip page's pass (days, hours, minutes, seconds; each digit is a split flap
// that flips when it changes) and the live pill in the top bar. Before the trip it counts to the start (8 Jan, 00:00
// Phuket time), during the trip to the flight home (the pill says Day n of 19), and afterwards it is gone.
// The page's clock is moved to each moment by replacing Date before the page loads.
// Usage: node tools/countdown-test.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'
import { TRIP } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const url = pathToFileURL(path.join(ROOT, 'dist/phuket-guide-offline.html')).href + '#home'
const DAY = 86400000
const start = Date.parse(TRIP.start + 'T00:00:00+07:00'), flight = Date.parse(TRIP.flight.day + 'T' + TRIP.flight.time + ':00+07:00')
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })

async function open(at, { reduce = false, width = 320 } = {}) {
  const p = await b.newPage(); const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.setViewport({ width, height: 700, isMobile: true, hasTouch: true })
  if (reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await p.evaluateOnNewDocument((at) => {
    const shift = at - Date.now(), Real = Date
    window.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + shift])) } static now() { return Real.now() + shift } }
  }, at)
  await p.goto(url); await sleep(900)
  return { p, errors }
}
const read = (p) => p.evaluate(() => {
  const box = document.getElementById('countdown'), dig = (k) => [...box.querySelectorAll('[data-cd="' + k + '"] .flap')].map((f) => f.dataset.v).join('')
  const board = box.querySelector('.pc-board').getBoundingClientRect(), pass = document.querySelector('.pass').getBoundingClientRect()
  return {
    hidden: box.hidden, label: document.getElementById('cd-label').textContent, when: document.getElementById('cd-when').textContent,
    d: dig('d'), h: dig('h'), m: dig('m'), s: dig('s'), pill: document.getElementById('trip-status').textContent,
    top: [...document.querySelectorAll('#trip-status [data-cd]')].map((x) => [...x.querySelectorAll('.flap')].map((f) => f.dataset.v).join('')).join(':'),
    topFits: (() => { const bar = document.querySelector('.topbar-in').getBoundingClientRect(), it = [...document.querySelectorAll('.topbar-in > *')].filter((x) => x.offsetParent); return it.every((x) => { const r = x.getBoundingClientRect(); return r.left >= bar.left - 0.5 && r.right <= bar.right + 0.5 }) && it.every((x, i) => !i || x.getBoundingClientRect().left >= it[i - 1].getBoundingClientRect().right - 0.5) })(),
    topBig: document.querySelector('#trip-status .flap')?.getBoundingClientRect().height || 0,
    fits: board.left >= pass.left && board.right <= pass.right && document.documentElement.scrollWidth <= innerWidth,
  }
})

{
  // 3 days, 4 hours, 5 minutes and 9 seconds before the trip
  const { p, errors } = await open(start - (3 * DAY + 4 * 3600000 + 5 * 60000 + 9000))
  const r = await read(p)
  check('before the trip: counts down to the start', !r.hidden && r.label === 'Trip starts in' && /Fri 8 Jan/.test(r.when) && r.d === '03' && r.h === '04' && r.m === '05' && /^0[5-9]$/.test(r.s), JSON.stringify(r))
  check('the top bar has the same flaps, counting down live', r.top === r.d + ':' + r.h + ':' + r.m + ':' + r.s && r.topBig >= 17, r.top + ', ' + Math.round(r.topBig) + ' px tall')
  check('the top bar fits a 320 px phone (nothing overlaps)', r.topFits, String(r.topFits))
  check('the board fits a 320 px phone', r.fits, JSON.stringify(r.fits))
  // the next second: the seconds digit flips (its flap animates), the pill follows. Wait for the digit to change from the
  // one read: the flip before that read can still be animating (650 ms), and catching it raced the next tick
  const flipped = await p.waitForFunction((s) => [...document.querySelectorAll('#countdown [data-cd="s"] .flap')].map((f) => f.dataset.v).join('') !== s && document.querySelector('#countdown .pc-s .flap.go'), { timeout: 2500, polling: 'raf' }, r.s).then(() => true, () => false)
  await sleep(100)
  const r2 = await read(p)
  check('a second later the seconds digit flips, in the pass and the top bar', flipped && r2.s !== r.s && r2.top !== r.top && r2.top.endsWith(r2.s), r.top + ' → ' + r2.top)
  if (errors.length) check('no page errors', false, errors.join(' | '))
  await p.close()
}
{
  // reduced motion: the numbers still change, nothing flips
  const { p } = await open(start - (10 * DAY + 30000), { reduce: true })
  const s1 = (await read(p)).s
  const flipped = await p.waitForFunction(() => document.querySelector('#countdown .flap.go'), { timeout: 2000, polling: 'raf' }).then(() => true, () => false)
  const s2 = (await read(p)).s
  check('reduced motion: the digits change without flipping', !flipped && s1 !== s2, s1 + ' → ' + s2)
  await p.close()
}
{
  // during the trip (10 Jan, noon in Phuket): the board counts to the flight home, the pill says which day it is
  const at = Date.parse('2027-01-10T12:00:00+07:00')
  const { p, errors } = await open(at)
  const r = await read(p)
  const left = flight - at - 900, d = Math.floor(left / DAY), h = Math.floor(left / 3600000) % 24
  check('during the trip: counts down to the flight home', !r.hidden && r.label === 'Flight home in' && /Tue 26 Jan · 18:20/.test(r.when) && Number(r.d) === d && Number(r.h) === h, JSON.stringify(r))
  check('during the trip: the pill says Day 3 of 19 (no flaps in the top bar)', !r.top && r.pill === 'Day 3 of ' + Math.round((Date.parse(TRIP.end) - Date.parse(TRIP.start)) / DAY + 1), r.pill)
  if (errors.length) check('no page errors (during)', false, errors.join(' | '))
  await p.close()
}
{
  // the moment the trip starts, the pill switches from the countdown to Day 1
  const { p } = await open(start - 1500)
  await sleep(2200)
  const r = await read(p)
  const live = await p.evaluate(() => document.documentElement.classList.contains('cd-live')) // the brand's name comes back
  check('at the start the pill turns to Day 1 and the board to the flight home', /^Day 1 of/.test(r.pill) && !r.top && !live && r.label === 'Flight home in', JSON.stringify({ pill: r.pill, label: r.label, live }))
  await p.close()
}
{
  // after the flight home: no board
  const { p } = await open(Date.parse('2027-02-01T12:00:00+07:00'))
  const r = await read(p)
  check('after the trip: no countdown, the pill says Trip done', r.hidden && r.pill === 'Trip done', JSON.stringify({ hidden: r.hidden, pill: r.pill }))
  await p.close()
}
await b.close()
console.log(failed ? `COUNTDOWN TEST FAILED: ${failed}` : 'COUNTDOWN TEST PASSED')
process.exitCode = failed ? 1 : 0
