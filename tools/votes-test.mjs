// Tests the shared votes: the server (api/votes.js) against a stand-in for the Upstash Redis REST API, then the page:
// Like / Skip buttons, the name dialog, two people seeing each other's votes, removing a vote, Group picks.
// Usage: node tools/votes-test.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))

// ---- a stand-in for Upstash: POST a Redis command as a JSON array, get { result } back ----
const hashes = new Map()
const upstash = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })) }
    const [cmd, key, ...a] = JSON.parse(body)
    const h = hashes.get(key) || new Map(); hashes.set(key, h)
    let result
    if (cmd === 'HGETALL') result = [...h].flat()
    else if (cmd === 'HSET') { h.set(a[0], a[1]); result = 1 }
    else if (cmd === 'HDEL') result = h.delete(a[0]) ? 1 : 0
    else if (cmd === 'HLEN') result = h.size
    else { res.writeHead(400); return res.end(JSON.stringify({ error: 'unknown command ' + cmd })) }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result }))
  })
})
const upPort = await listen(upstash)

// the server module, first with no storage set up, then with it (the Vercel names: KV_ prefix)
const mod = pathToFileURL(path.join(ROOT, 'api/votes.js')).href
const call = async (api, method, body) => {
  const req = new Request('http://x/api/votes', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  const res = await api[method](req)
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers }
}
{
  const api = await import(mod + '?nostore')
  const r = await call(api, 'GET')
  check('no storage set up: 503', r.status === 503, String(r.status))
}
{
  // only a connection string (STORAGE_URL style): the REST address and token come from it
  const api0 = await import(mod + '?url')
  process.env.STORAGE_URL = 'rediss://default:abc%3D@example-db-12345.upstash.io:6379'
  const st = api0.storage()
  check('a rediss:// URL is enough', st && st.url === 'https://example-db-12345.upstash.io' && st.token === 'abc=', JSON.stringify(st))
  delete process.env.STORAGE_URL
}
process.env.STORAGE_REST_API_URL = `http://127.0.0.1:${upPort}`
process.env.STORAGE_REST_API_TOKEN = 'test-token'
const api = await import(mod + '?store')
{
  let r = await call(api, 'GET')
  check('any prefix works (STORAGE_), empty at first', r.status === 200 && JSON.stringify(r.json.votes) === '{}', JSON.stringify(r.json))
  check('not cached', /no-store/.test(r.headers.get('cache-control') || ''))
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: '  Ani  ', vote: 'like' })
  check('a like is saved', r.status === 200 && r.json.votes['ht:mouana-breeze-mai-khao'].like.join() === 'Ani', JSON.stringify(r.json))
  await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Vardan', vote: 'skip' })
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'ani', vote: 'skip' })
  const v = r.json.votes['ht:mouana-breeze-mai-khao']
  check('one vote per name (any case): Ani moves to Skip', v.like.length === 0 && v.skip.join() === 'Vardan,ani', JSON.stringify(v))
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Vardan', vote: null })
  check('a vote can be taken back', r.json.votes['ht:mouana-breeze-mai-khao'].skip.join() === 'ani', JSON.stringify(r.json.votes))
  r = await call(api, 'GET')
  check('GET sees the same votes', JSON.stringify(r.json.votes['ht:mouana-breeze-mai-khao']) === JSON.stringify({ like: [], skip: ['ani'] }))
  const bad = [
    [{ item: 'xx:nope', name: 'Ani', vote: 'like' }, 'unknown item kind'],
    [{ item: 'ht:mouana', name: '', vote: 'like' }, 'empty name'],
    [{ item: 'ht:mouana', name: 'x'.repeat(41), vote: 'like' }, 'name too long'],
    [{ item: 'ht:mouana', name: 'Ani', vote: 'love' }, 'unknown vote'],
    ['not json', 'not JSON'],
  ]
  for (const [body, why] of bad) { const b = await call(api, 'POST', body); check('refused: ' + why, b.status === 400, String(b.status)) }
  // hiding a villa for everyone: who hid it is kept, Show again takes it out, only villas can be hidden
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Gor', hide: true })
  check('a hide is saved for everyone, with the name', r.status === 200 && r.json.hidden['ht:mouana-breeze-mai-khao']?.by === 'Gor', JSON.stringify(r.json.hidden))
  r = await call(api, 'GET')
  check('GET lists the hidden villas', !!r.json.hidden['ht:mouana-breeze-mai-khao'] && !!r.json.votes, JSON.stringify(r.json.hidden))
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Ani', hide: false })
  check('Show again takes it out for everyone', r.status === 200 && JSON.stringify(r.json.hidden) === '{}', JSON.stringify(r.json.hidden))
  r = await call(api, 'POST', { item: 'ev:shelter-phuket', name: 'Gor', hide: true })
  check('refused: hiding something that is not a villa', r.status === 400, String(r.status))
  hashes.clear()
}

// ---- the page: dist/ with /api/votes answered by the same server code ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.kml': 'application/vnd.google-earth.kml+xml', '.json': 'application/json' }
let apiDown = false
const site = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/votes') {
    if (apiDown) { res.writeHead(503); return res.end('{}') }
    let body = ''
    for await (const c of req) body += c
    const r = await api[req.method](new Request('http://x' + req.url, { method: req.method, headers: { 'Content-Type': 'application/json' }, body: req.method === 'POST' ? body : undefined }))
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text())
  }
  let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html'
  const f = path.join(DIST, p)
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
})
const port = await listen(site)
const base = `http://127.0.0.1:${port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const person = async () => {
  const ctx = await b.createBrowserContext() // its own storage: another phone
  const p = await ctx.newPage(); const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  return { p, ctx, errors }
}
const ID = 'ht-mouana-breeze-mai-khao'
const bar = (p, id = ID) => p.evaluate((id) => {
  const el = document.querySelector('#' + id + ' .votes'); if (!el) return null
  const btn = (v) => el.querySelector(`[data-vote-btn="${v}"]`)
  return { shown: !el.hidden && el.offsetParent !== null, like: btn('like')?.querySelector('b')?.textContent, skip: btn('skip')?.querySelector('b')?.textContent, mine: [...el.querySelectorAll('[aria-pressed="true"]')].map((x) => x.dataset.voteBtn).join(), names: el.querySelector('.voters')?.textContent || '' }
}, id)
const vote = async (p, v, name) => {
  await p.evaluate((id, v) => document.querySelector(`#${id} [data-vote-btn="${v}"]`).click(), ID, v); await sleep(300)
  const open = await p.evaluate(() => document.getElementById('vote-dialog')?.open)
  if (name !== undefined) await p.evaluate((n) => { const i = document.getElementById('vote-name'); i.value = n }, name)
  await p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(800)
  return open
}

// the villa list order: cards in the list, top first
const order = (p) => p.evaluate(() => [...document.querySelectorAll('[data-list="stay"] > .card')].map((c) => c.id))
const A = await person()
await A.p.goto(base + '#stay', { waitUntil: 'networkidle0' }); await sleep(800)
const first = await order(A.p)
check('no votes yet: the pinned villa leads', first[0] === 'ht-luxurious-seaview-villa-rawai', first.slice(0, 2).join(', '))
let s = await bar(A.p)
check('vote buttons show once votes load', s && s.shown && s.like === '0' && s.skip === '0', JSON.stringify(s))
const counts = await A.p.evaluate(() => ['ev', 'pl', 'ht'].map((k) => document.querySelectorAll(`.card[id^="${k}-"] .votes`).length))
check('on villa, event and place cards', counts.every((n) => n > 0), 'events ' + counts[0] + ', places ' + counts[1] + ', villas ' + counts[2])
const opened = await vote(A.p, 'like', 'Ani')
s = await bar(A.p)
check('Like opens the name dialog and saves', opened && s.like === '1' && s.mine === 'like' && /Ani/.test(s.names), JSON.stringify(s))
const name2 = await A.p.evaluate(() => { document.querySelector(`#ht-light-hope-laguna-6br-villa [data-vote-btn="like"]`).click(); return document.getElementById('vote-name').value })
await A.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(800)
check('the name is remembered for the next vote', name2 === 'Ani', JSON.stringify(name2))

const B = await person()
await B.p.goto(base + '#stay', { waitUntil: 'networkidle0' }); await sleep(800)
s = await bar(B.p)
check('another phone sees the vote', s.like === '1' && s.mine === '' && /Ani/.test(s.names), JSON.stringify(s))
await vote(B.p, 'skip', 'Vardan')
await A.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200) // coming back to the page refreshes
s = await bar(A.p)
check('the first phone sees the other vote after a refresh', s.like === '1' && s.skip === '1' && /Vardan/.test(s.names), JSON.stringify(s))
await vote(A.p, 'like')
s = await bar(A.p)
check('tapping your own vote again takes it back', s.like === '0' && s.mine === '', JSON.stringify(s))
const picks = await B.p.evaluate(async () => { location.hash = 'stay'; await new Promise((r) => setTimeout(r, 300)); return document.getElementById('group-picks')?.innerText || '' })
check('Group picks ranks the liked villa', /Light & Hope/.test(picks) && /1 like/.test(picks), JSON.stringify(picks.slice(0, 160)))
const dialogEsc = await B.p.evaluate(async () => {
  document.querySelector('#pl-big-buddha [data-vote-btn="like"]').click()
  await new Promise((r) => setTimeout(r, 200))
  document.querySelector('#vote-dialog [data-vote-cancel]').click()
  await new Promise((r) => setTimeout(r, 400))
  return { open: document.getElementById('vote-dialog').open, like: document.querySelector('#pl-big-buddha [data-vote-btn="like"] b').textContent }
})
check('Cancel closes the dialog without voting', !dialogEsc.open && dialogEsc.like === '0', JSON.stringify(dialogEsc))

// voting when the server is down says so, and keeps the old counts
apiDown = true
const before = await bar(B.p, 'ht-light-hope-laguna-6br-villa')
await B.p.evaluate(() => document.querySelector('#ht-light-hope-laguna-6br-villa [data-vote-btn="like"]').click()); await sleep(300)
await B.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(800)
const after = await bar(B.p, 'ht-light-hope-laguna-6br-villa')
const toast = await B.p.evaluate(() => document.querySelector('.toast')?.textContent || '')
check('a failed vote says so and changes nothing', after.like === before.like && /could not|internet/i.test(toast), JSON.stringify({ before, after, toast }))
apiDown = false
// someone new opens the guide: the liked villa leads the list, the skipped one goes to the end
const C = await person()
await C.p.goto(base + '#home', { waitUntil: 'networkidle0' }); await sleep(800)
await C.p.evaluate(() => { location.hash = 'stay' }); await sleep(500)
const liked = await order(C.p)
check('more likes move a villa up, skips move it down', liked[0] === 'ht-light-hope-laguna-6br-villa' && liked.at(-1) === 'ht-mouana-breeze-mai-khao' && liked[1] === 'ht-luxurious-seaview-villa-rawai', liked.slice(0, 2).join(', ') + ' … ' + liked.at(-1))
// Hide is for everyone on the website: A hides a villa, B no longer sees it (list or map), B shows it again for A too
const seen = (p, id) => p.evaluate((id) => { const c = document.getElementById(id); return { card: !!c && !c.hidden, hiddenList: document.getElementById('hidden-stays-list')?.innerText || '' } }, id)
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
await A.p.evaluate(() => document.querySelector('#ht-diamond-villa-278 [data-hide-stay]').click()); await sleep(300)
const hideDlg = await A.p.evaluate(() => ({ open: document.getElementById('vote-dialog').open, title: document.getElementById('vote-title').textContent }))
await A.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(900)
const aSees = await seen(A.p, 'ht-diamond-villa-278')
check('Hide asks the name, then hides the villa', hideDlg.open && /everyone/i.test(hideDlg.title) && !aSees.card && /Hidden by Ani/.test(aSees.hiddenList), JSON.stringify({ hideDlg, aSees }))
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200)
const bSees = await seen(B.p, 'ht-diamond-villa-278')
check('another phone no longer sees the hidden villa', !bSees.card && /Hidden by Ani/.test(bSees.hiddenList), JSON.stringify(bSees))
await B.p.evaluate(() => document.querySelector('#hidden-stays-list [data-unhide-stay="diamond-villa-278"]').click()); await sleep(300)
await B.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(900)
await A.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200)
const back = await seen(A.p, 'ht-diamond-villa-278')
check('Show again brings it back for everyone', back.card && !/Diamond/.test(back.hiddenList), JSON.stringify(back))
for (const x of [A, B, C]) if (x.errors.length) check('no page errors', false, x.errors.join(' | '))
await b.close(); site.close(); upstash.close()
console.log(failed ? `VOTES TEST FAILED: ${failed}` : 'VOTES TEST PASSED')
process.exitCode = failed ? 1 : 0
