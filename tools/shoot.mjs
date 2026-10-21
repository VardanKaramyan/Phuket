// Screenshots of each view at phone size, for visual QA. Usage: node tools/shoot.mjs <html file> <out dir> [dark] [views...]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromePath } from './chrome.mjs'
const [file, outDir, theme = 'light', ...views] = process.argv.slice(2)
const VIEWS = views.length ? views : ['home', 'events', 'places', 'areas', 'stay', 'money', 'info', 'apps', 'notes', 'spend']
fs.mkdirSync(outDir, { recursive: true })
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'dark' : 'light' }])
const W = Number(process.env.WIDTH || 390)
await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()) })
const url = pathToFileURL(path.resolve(file)).href
await page.goto(url, { waitUntil: 'load' })
for (const v of VIEWS) {
  if (!(await page.$('#' + v))) { console.log(`skipped #${v}: not in this build`); continue }
  await page.evaluate((h) => { location.hash = h }, v)
  await page.evaluate(() => document.querySelectorAll('img').forEach((i) => { i.loading = 'eager' }))
  await new Promise((r) => setTimeout(r, v === 'areas' ? 2200 : 900))
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 ? document.documentElement.scrollWidth : 0)
  // what a finger hits at the middle of each tab icon (catches overlays sitting on the tab bar)
  const hits = await page.evaluate(() => Array.from(document.querySelectorAll('.tabbar a')).map((a) => { const r = a.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 14); return a.contains(el) ? '' : a.getAttribute('href') + '->' + (el ? el.className || el.tagName : 'none') }).filter(Boolean))
  if (hits.length) errors.push(`tab bar covered on #${v}: ${hits.join(', ')}`)
  if (overflow) errors.push(`horizontal overflow on #${v}: ${overflow}px`)
  // after the tab-bar check (it needs the fixed bar): static bars, so they do not paint over the full-view shot
  const st = await page.addStyleTag({ content: '.topbar, .tabbar { position: static !important; }' })
  await page.screenshot({ path: path.join(outDir, `${theme}-${W}-${v}.png`), captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.min(h, 5200) } })
  await st.evaluate((n) => n.remove())
}
console.log(errors.length ? errors.join('\n') : 'no console errors')
process.exitCode = errors.length ? 1 : 0
await browser.close()
