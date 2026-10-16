// Visual QA screenshots for the parts that changed most often: the home pass (390 light, 320 dark), every day of the
// agenda, the events list filtered per trip phase, the Info sections, the Apps view and chosen cards.
// Usage: node tools/qa-shots.mjs [html, default dist/phuket-guide-offline.html] [out dir, default qa-out]
//        CARDS="ev-circoloco-thailand-2027,ht-the-slate-phuket" node tools/qa-shots.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.resolve(process.argv[2] || path.join(ROOT, 'dist/phuket-guide-offline.html'))
const out = path.resolve(process.argv[3] || 'qa-out')
const CARDS = (process.env.CARDS || 'ev-circoloco-thailand-2027,ev-wet-pool-party-haad-rin,ht-the-slate-phuket,pl-natural-restaurant-airport').split(',').filter(Boolean)
fs.mkdirSync(out, { recursive: true })
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const errors = []
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const open = async (w, theme, hash) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.setViewport({ width: w, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(pathToFileURL(file).href + '#' + hash, { waitUntil: 'load' })
  // the sticky top bar and fixed tab bar would paint over tall element shots
  await page.addStyleTag({ content: '.topbar, .tabbar { position: static !important; }' })
  await page.evaluate(() => document.querySelectorAll('img').forEach((i) => { i.loading = 'eager' }))
  await wait(600)
  return page
}
const shot = async (page, sel, name) => { const el = await page.$(sel); if (el) await el.screenshot({ path: path.join(out, name + '.png') }); else errors.push('missing ' + sel) }

// home pass at two widths, and no sideways scroll
for (const [w, theme] of [[390, 'light'], [320, 'dark']]) {
  const page = await open(w, theme, 'home')
  await shot(page, '.pass', `pass-${w}-${theme}`)
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push(`horizontal overflow at ${w}px`)
  if (w === 390) {
    // every agenda day: tap it in the pass, then capture its card
    for (const iso of await page.evaluate(() => Array.from(document.querySelectorAll('.day-btn')).map((b) => b.dataset.day))) {
      await page.click(`.day-btn[data-day="${iso}"]`); await wait(150)
      await shot(page, `#agenda .agenda-day[data-day="${iso}"]`, 'day-' + iso)
    }
  }
  await page.close()
}

// events: how many cards each phase filter shows
{
  const page = await open(390, 'light', 'events')
  for (const ph of ['group', 'duo', 'solo']) {
    const n = await page.evaluate((v) => { const c = document.querySelector(`.chip[data-group="phase"][data-value="${v}"]`); if (!c) return -1; c.click(); return Array.from(document.querySelectorAll('[data-list="events"] > .card')).filter((x) => !x.hidden).length }, ph)
    console.log(`events filter ${ph}: ${n} cards`)
  }
  await page.close()
}

// Info sections (opened) and the Apps view
{
  const page = await open(390, 'light', 'info')
  for (const id of await page.evaluate(() => Array.from(document.querySelectorAll('#info details.acc')).map((d) => d.id))) {
    await page.evaluate((i) => { document.getElementById(i).open = true }, id); await wait(80)
    await shot(page, '#' + id, id)
  }
  await page.close()
  const apps = await open(390, 'light', 'apps')
  // the Apps view in slices of 1600 px (one tall image would be unreadable): apps-1.png, apps-2.png, ...
  const box = await apps.evaluate(() => { const r = document.getElementById('apps')?.getBoundingClientRect(); return r && { y: r.top + scrollY, h: r.height } })
  if (box) for (let i = 0, y = box.y; y < box.y + box.h; i++, y += 1600) {
    await apps.screenshot({ path: path.join(out, `apps-${i + 1}.png`), captureBeyondViewport: true, clip: { x: 0, y, width: 390, height: Math.min(1600, box.y + box.h - y) } })
  }
  await apps.close()
}

// chosen cards with their 'more' blocks opened
{
  const page = await open(390, 'light', 'home')
  for (const id of CARDS) {
    const view = await page.evaluate((i) => document.getElementById(i)?.closest('.view')?.id, id)
    if (!view) { errors.push('no card ' + id); continue }
    await page.evaluate((v) => { location.hash = v }, view); await wait(300)
    await page.evaluate((i) => { const c = document.getElementById(i); c.scrollIntoView(); c.querySelectorAll('details').forEach((d) => { d.open = true }) }, id); await wait(250)
    await shot(page, '#' + id, 'card-' + id)
  }
  await page.close()
}

await browser.close()
console.log(`screenshots in ${out}`)
console.log(errors.length ? errors.join('\n') : 'no errors')
process.exitCode = errors.length ? 1 : 0
