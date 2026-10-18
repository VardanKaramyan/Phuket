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
const hashes = new Map(), strings = new Map(), lists = new Map()
const upstash = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })) }
    const [cmd, key, ...a] = JSON.parse(body)
    let result
    if (cmd === 'EXPIRE') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result: 1 })) }
    if (['GET', 'SET', 'INCR'].includes(cmd)) {
      if (cmd === 'GET') result = strings.has(key) ? strings.get(key) : null
      else if (cmd === 'SET') { if (a.includes('NX') && strings.has(key)) result = null; else { strings.set(key, String(a[0])); result = 'OK' } }
      else { const n = Number(strings.get(key) || 0) + 1; strings.set(key, String(n)); result = n }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result }))
    }
    if (['LPUSH', 'LTRIM', 'LRANGE', 'LLEN'].includes(cmd)) {
      const l = lists.get(key) || []; lists.set(key, l)
      if (cmd === 'LPUSH') { l.unshift(...a.slice().reverse()); result = l.length }
      else if (cmd === 'LTRIM') { lists.set(key, l.slice(Number(a[0]), Number(a[1]) + 1)); result = 'OK' }
      else if (cmd === 'LRANGE') result = l.slice(Number(a[0]), Number(a[1]) === -1 ? undefined : Number(a[1]) + 1)
      else result = l.length
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ result }))
    }
    const h = hashes.get(key) || new Map(); hashes.set(key, h)
    if (cmd === 'HGETALL') result = [...h].flat()
    else if (cmd === 'HSET') { h.set(a[0], a[1]); result = 1 }
    else if (cmd === 'HDEL') result = a.filter((f) => h.delete(f)).length
    else if (cmd === 'HLEN') result = h.size
    else if (cmd === 'HGET') result = h.has(a[0]) ? h.get(a[0]) : null
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
  const gv = r.json.votes['ht:mouana-breeze-mai-khao']
  check('GET sees the same votes', JSON.stringify({ like: gv.like, skip: gv.skip }) === JSON.stringify({ like: [], skip: ['ani'] }), JSON.stringify(gv))
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
  // the hidden list has a cap like the votes: a full list refuses new hides, but Show again still works
  const hiddenHash = new Map(); for (let i = 0; i < 200; i++) hiddenHash.set('ht:fake-' + i, JSON.stringify({ n: 'x', t: i }))
  hashes.set('guide:hidden', hiddenHash)
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Gor', hide: true })
  check('refused: a new hide when the hidden list is full', r.status === 507, String(r.status))
  r = await call(api, 'POST', { item: 'ht:fake-1', name: 'Gor', hide: false })
  check('Show again works on a full list', r.status === 200 && !r.json.hidden['ht:fake-1'], String(r.status))
  // the villa order, set with Move up / down, is saved for everyone with who moved last
  r = await call(api, 'POST', { name: 'Vardan', order: ['mouana-breeze-mai-khao', 'diamond-villa-278', 'alisa-pool-villa'] })
  check('an order is saved for everyone', r.status === 200 && r.json.order?.ids?.join() === 'mouana-breeze-mai-khao,diamond-villa-278,alisa-pool-villa' && r.json.order.by === 'Vardan', JSON.stringify(r.json.order))
  r = await call(api, 'GET')
  check('GET returns the order', r.json.order?.ids?.length === 3, JSON.stringify(r.json.order))
  // shared notes: on a villa, or for the whole trip ('all'); anyone adds, the note keeps its author and time
  r = await call(api, 'POST', { name: 'Ani', note: { item: 'ht:mouana-breeze-mai-khao', text: '  Ask about the\ndeposit  ' } })
  const n1 = r.json.notes?.['ht:mouana-breeze-mai-khao']?.[0]
  check('a villa note is saved with its author', r.status === 200 && n1?.text === 'Ask about the\ndeposit' && n1.by === 'Ani' && !!n1.id, JSON.stringify(r.json.notes))
  r = await call(api, 'POST', { name: 'Vardan', note: { item: 'all', text: 'Flights land 14:05' } })
  check('a note for the whole trip is saved', r.json.notes?.all?.[0]?.text === 'Flights land 14:05', JSON.stringify(r.json.notes?.all))
  r = await call(api, 'POST', { name: 'Vardan', deleteNote: n1.id })
  check('refused: deleting someone else\'s note', r.status === 403, String(r.status))
  r = await call(api, 'POST', { name: 'ani', deleteNote: n1.id })
  check('the author can delete their note (any capitals)', r.status === 200 && !r.json.notes['ht:mouana-breeze-mai-khao'], JSON.stringify(r.json.notes))
  r = await call(api, 'POST', { name: 'Ani', deleteNote: n1.id })
  check('a note that is gone: 404', r.status === 404, String(r.status))
  for (const [body, why] of [[{ name: 'V', note: { item: 'all', text: '   ' } }, 'an empty note'], [{ name: 'V', note: { item: 'all', text: 'x'.repeat(501) } }, 'a note over 500 characters'], [{ name: 'V', note: { item: 'zz:x', text: 'hi' } }, 'a note on an unknown item'], [{ name: '', note: { item: 'all', text: 'hi' } }, 'a note with no name']]) {
    const x = await call(api, 'POST', body); check('refused: ' + why, x.status === 400, String(x.status))
  }
  // moved villas keep their place: { pins: { id: position | null } }, merged; two villas never share a position
  r = await call(api, 'POST', { name: 'Vardan', pins: { 'alisa-pool-villa': 0, 'diamond-villa-278': 3 } })
  check('pins are saved for everyone', r.status === 200 && r.json.pins?.map?.['alisa-pool-villa'] === 0 && r.json.pins.map['diamond-villa-278'] === 3 && r.json.pins.by === 'Vardan', JSON.stringify(r.json.pins))
  r = await call(api, 'POST', { name: 'Ani', pins: { 'la-belle-pool-villa': 3, 'alisa-pool-villa': null } })
  check('a new pin takes the place, null unpins', r.json.pins.map['la-belle-pool-villa'] === 3 && !('diamond-villa-278' in r.json.pins.map) && !('alisa-pool-villa' in r.json.pins.map), JSON.stringify(r.json.pins.map))
  for (const [body, why] of [[{ name: 'V', pins: { a: 5, b: 5 } }, 'two villas in one place'], [{ name: 'V', pins: { 'Bad Id!': 1 } }, 'a pin with a bad id'], [{ name: 'V', pins: { a: -1 } }, 'a negative position'], [{ name: 'V', pins: { a: 1.5 } }, 'a position that is not a whole number'], [{ name: '', pins: { a: 1 } }, 'pins with no name']]) {
    const x = await call(api, 'POST', body); check('refused: ' + why, x.status === 400, String(x.status))
  }
  await call(api, 'POST', { name: 'Ani', pins: { 'la-belle-pool-villa': null } })
  // the saved pins stay one per place: many requests with new ids cannot make the list grow past the cap
  for (let k = 0; k < 4; k++) await call(api, 'POST', { name: 'X', pins: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['fake-' + k + '-' + i, i])) })
  r = await call(api, 'GET')
  check('the saved pins never grow past one per place (300)', Object.keys(r.json.pins.map).length <= 300, String(Object.keys(r.json.pins.map).length))
  await call(api, 'POST', { name: 'X', pins: Object.fromEntries(Object.keys(r.json.pins.map).map((id) => [id, null])) })
  // the time of the latest like comes with the votes (newer like = higher among equal likes)
  r = await call(api, 'POST', { item: 'ht:alisa-pool-villa', name: 'Gor', vote: 'like' })
  check('votes carry the time of the latest like', Number.isFinite(r.json.votes['ht:alisa-pool-villa']?.last), JSON.stringify(r.json.votes['ht:alisa-pool-villa']))
  await call(api, 'POST', { item: 'ht:alisa-pool-villa', name: 'Gor', vote: null })
  // live updates: every shared change bumps a version and goes in the activity log; ?ver= answers "same" cheaply
  r = await call(api, 'GET')
  const v0 = r.json.ver
  r = await call(api, 'POST', { item: 'ht:alisa-pool-villa', name: 'Gor', vote: 'like', device: 'devgor000001' })
  const ev = (r.json.recent || [])[0]
  check('a change bumps the version and is in the recent activity', r.json.ver > v0 && ev?.e === 'like' && ev.x === 'ht:alisa-pool-villa' && ev.n === 'Gor' && ev.d === 'devgor000001', JSON.stringify({ ver: r.json.ver, ev }))
  const same = await (await api.GET(new Request('http://x/api/votes?ver=' + r.json.ver))).json()
  check('?ver= with the current version just says same', same.same === true && !same.votes, JSON.stringify(same))
  const changed = await (await api.GET(new Request('http://x/api/votes?ver=' + v0))).json()
  check('?ver= with an older version sends everything', !!changed.votes && changed.ver === r.json.ver, String(changed.ver))
  await call(api, 'POST', { item: 'ht:alisa-pool-villa', name: 'Gor', vote: null, device: 'devgor000001' })
  // analytics: visits and what people did, per device (with the name once known)
  r = await call(api, 'POST', { device: 'devani000001', name: 'Ani', track: [{ e: 'visit', x: '#stay' }, { e: 'view', x: 'stay' }, { e: 'share', x: 'ht:alisa-pool-villa' }] })
  check('tracked actions are saved', r.status === 200 && r.json.ok === true, JSON.stringify(r.json))
  await call(api, 'POST', { device: 'devani000001', track: [{ e: 'visit', x: '#home' }] })
  const st = await (await api.GET(new Request('http://x/api/votes?stats=1'))).json()
  const ani = st.visitors?.devani000001
  check('stats: visitors with visits and name, and the activity log', ani?.visits === 2 && ani.n === 'Ani' && st.log.some((x) => x.e === 'share' && x.d === 'devani000001') && st.log.some((x) => x.e === 'like'), JSON.stringify({ ani, log: st.log.length }))
  check('stats send the phone type, not the browser details', ani && !('ua' in ani) && typeof ani.kind === 'string', JSON.stringify(ani))
  // with STATS_KEY set (Vercel environment variable), the stats need ?key=
  process.env.STATS_KEY = 'trip-secret'
  const noKey = await api.GET(new Request('http://x/api/votes?stats=1'))
  const withKey = await api.GET(new Request('http://x/api/votes?stats=1&key=trip-secret'))
  check('STATS_KEY: no key → 401, the right key → the stats', noKey.status === 401 && withKey.status === 200, noKey.status + ' / ' + withKey.status)
  delete process.env.STATS_KEY
  // a full visitor list: only phones idle for 14 days or more make room; recent ones are never pushed out
  const vis = hashes.get('guide:visitors')
  const day = 86400000, now0 = Date.now()
  for (let i = 0; i < 2000; i++) vis.set('fill' + String(i).padStart(8, '0'), JSON.stringify({ first: now0, last: now0 - (i < 5 ? 20 * day : 1000), visits: 1 }))
  r = await call(api, 'POST', { device: 'devnew000001', track: [{ e: 'visit', x: '#home' }] })
  check('a full list makes room only from phones idle for 14+ days', r.status === 200 && vis.has('devnew000001') && !vis.has('fill00000000') && vis.has('fill00000005') && vis.size <= 2000, r.status + ' size ' + vis.size)
  for (let i = 0; i < 5; i++) vis.set('fillnew' + i + 'aaaa', JSON.stringify({ first: now0, last: now0, visits: 1 })) // full again, all recent
  while (vis.size > 2000) vis.delete([...vis.keys()].find((k) => k.startsWith('fill0')))
  r = await call(api, 'POST', { device: 'devnew000002', track: [{ e: 'visit', x: '#home' }] })
  check('a full list of recent phones does not push anyone out', r.status === 507 && !vis.has('devnew000002'), String(r.status))
  for (const k of [...vis.keys()]) if (k.startsWith('fill')) vis.delete(k)
  // one connection can add at most 20 new phones an hour
  const ipCall = (dev) => api.POST(new Request('http://x/api/votes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ device: dev, track: [{ e: 'visit', x: '#home' }] }) }))
  let lastStatus = 0
  for (let i = 0; i < 21; i++) lastStatus = (await ipCall('devip' + String(i).padStart(7, '0'))).status
  check('refused: more than 20 new phones an hour from one connection', lastStatus === 429, String(lastStatus))
  for (const k of [...vis.keys()]) if (k.startsWith('devip')) vis.delete(k)
  for (const [body, why] of [[{ device: 'devani000001', track: [{ e: 'hack', x: '' }] }, 'an unknown action'], [{ device: 'bad device!', track: [{ e: 'visit' }] }, 'a bad device id'], [{ device: 'devani000001', track: Array.from({ length: 31 }, () => ({ e: 'view', x: 'home' })) }, 'too many actions at once']]) {
    const x = await call(api, 'POST', body); check('refused: ' + why, x.status === 400, String(x.status))
  }
  for (const [body, why] of [[{ name: 'V', order: [] }, 'an empty order'], [{ name: 'V', order: ['a', 'a'] }, 'a villa twice'], [{ name: 'V', order: ['Bad Id!'] }, 'a bad id'], [{ name: 'V', order: Array.from({ length: 301 }, (_, i) => 'v' + i) }, 'too many villas'], [{ name: '', order: ['a'] }, 'no name']]) {
    const x = await call(api, 'POST', body); check('refused: ' + why, x.status === 400, String(x.status))
  }
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
// Move up / down: the order for everyone, and once set it wins over likes
const idx = (list, id) => list.indexOf(id)
let o1 = await order(A.p)
const mover = o1[3]
// the page stays put, and the two cards slide past each other
const anim = await A.p.evaluate(async (id, above) => {
  document.getElementById(id).scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 300))
  const y = scrollY
  document.querySelector('#' + id + ' [data-move-stay="up"]').click()
  await new Promise((r) => requestAnimationFrame(r))
  const running = [id, above].map((x) => document.getElementById(x).getAnimations().length)
  await new Promise((r) => setTimeout(r, 600))
  return { scrolled: Math.round(scrollY - y), running }
}, mover, o1[2]); await sleep(600)
let o2 = await order(A.p)
check('Move up moves the villa one place up at once', idx(o2, mover) === 2 && o2[3] === o1[2], `${idx(o1, mover)} → ${idx(o2, mover)}`)
check('moving does not scroll the page, and both cards slide', anim.scrolled === 0 && anim.running.every((n) => n > 0), JSON.stringify(anim))
await A.p.evaluate((id) => document.querySelector('#' + id + ' [data-move-stay="down"]').click(), o2[0]); await sleep(900)
const o3 = await order(A.p)
await B.p.evaluate(() => { location.hash = 'home' }); await sleep(200)
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200)
await B.p.evaluate(() => { location.hash = 'stay' }); await sleep(500)
const oB = await order(B.p)
check('another phone gets the same order', oB.join() === o3.join(), oB.slice(0, 4).join(', '))
// a like on the last villa pulls it up among the liked ones, while the villas moved by hand keep their places
const last = o3.at(-1).slice(3)
await B.p.evaluate((id) => document.querySelector('#ht-' + id + ' [data-vote-btn="like"]').click(), last); await sleep(300)
await B.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(1200)
const rules = await B.p.evaluate(() => {
  const ids = [...document.querySelectorAll('[data-list="stay"] > .card')].map((c) => c.dataset.stay)
  const votes = JSON.parse(localStorage.getItem('pg:votes') || '{}'), pins = (JSON.parse(localStorage.getItem('pg:villaPins') || 'null') || {}).map || {}
  const v = (id) => votes['ht:' + id] || { like: [], last: 0 }
  const pinnedOk = Object.entries(pins).every(([id, at]) => ids[at] === id)
  const free = ids.filter((id) => !(id in pins))
  const firstUnliked = free.findIndex((id) => !v(id).like.length)
  const likedFirst = firstUnliked < 0 || free.slice(firstUnliked).every((id) => !v(id).like.length)
  const liked = free.filter((id) => v(id).like.length)
  const newerFirst = liked.every((id, i) => i === 0 || v(liked[i - 1]).like.length > v(id).like.length || (v(liked[i - 1]).last || 0) >= (v(id).last || 0))
  return { pinnedOk, likedFirst, newerFirst, likedTop: liked[0], pins, liked }
})
check('moved villas keep their places; liked villas come before the others; equal likes: the newer like first', rules.pinnedOk && rules.likedFirst && rules.newerFirst && rules.likedTop === last, JSON.stringify(rules))
// Reset position: the moved villa loses its fixed place (and the button goes); Reset all clears every fixed place
await A.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200)
const pinned0 = await A.p.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('pg:villaPins') || 'null') || {}).map || {}))
const resetId = pinned0[0]
const resetBtn = await A.p.evaluate((id) => { const b = document.querySelector('#ht-' + id + ' [data-unpin-stay]'); return { shown: !!b && !b.hidden, note: !document.getElementById('pins-note').hidden } }, resetId)
await A.p.evaluate((id) => document.querySelector('#ht-' + id + ' [data-unpin-stay]').click(), resetId); await sleep(1000)
const afterOne = await A.p.evaluate((id) => ({ map: (JSON.parse(localStorage.getItem('pg:villaPins') || 'null') || {}).map || {}, btn: document.querySelector('#ht-' + id + ' [data-unpin-stay]').hidden }), resetId)
check('Reset position takes the villa out of its fixed place', resetBtn.shown && resetBtn.note && !(resetId in afterOne.map) && afterOne.btn, JSON.stringify({ resetId, resetBtn, afterOne }))
await A.p.evaluate(() => document.getElementById('unpin-all').click()); await sleep(1000)
const afterAll = await A.p.evaluate(() => ({ n: Object.keys((JSON.parse(localStorage.getItem('pg:villaPins') || 'null') || {}).map || {}).length, note: document.getElementById('pins-note').hidden }))
check('Reset all positions clears every fixed place', afterAll.n === 0 && afterAll.note, JSON.stringify(afterAll))
const topNow = (await order(A.p))[0] // the villa at the top right now (the resets changed the order)
const topMsg = await A.p.evaluate(async (id) => { document.querySelector('#' + id + ' [data-move-stay="up"]').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.toast')?.textContent || '' }, topNow)
check('the top villa cannot move up', /top/i.test(topMsg), topMsg)
// shared notes: A adds one on a villa (A's name is known: no dialog) and one for the whole group; B sees both; A deletes
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
// opening Add a note puts the cursor in the box
await A.p.evaluate(() => document.querySelector('#ht-alisa-pool-villa details.note-add summary').click()); await sleep(300)
const focused = await A.p.evaluate(() => document.activeElement === document.querySelector('#ht-alisa-pool-villa .note-form textarea'))
check('opening Add a note focuses the text box', focused, String(focused))
const noteLine = await A.p.evaluate(() => [...document.querySelectorAll('details.note-add')].map((d) => getComputedStyle(d).borderTopWidth).filter((w) => w !== '0px').length)
check('no separator line above Add a note', noteLine === 0, noteLine + ' with a line')
await A.p.evaluate(() => {
  const d = document.querySelector('#ht-alisa-pool-villa details.note-add'); d.open = true
  d.querySelector('textarea').value = 'Ask if the pool is heated'
  d.querySelector('.note-form button[type="submit"]').click()
}); await sleep(900)
const aNote = await A.p.evaluate(() => ({ list: document.querySelector('#ht-alisa-pool-villa .notes-list').innerText, n: document.querySelector('#ht-alisa-pool-villa .notes-n').textContent, box: document.querySelector('#ht-alisa-pool-villa .note-form textarea').value, folded: !document.querySelector('#ht-alisa-pool-villa details.note-add').open }))
check('a villa note is added at once, the box empties and folds away', /Ask if the pool is heated/.test(aNote.list) && /Ani/.test(aNote.list) && aNote.n === '(1)' && aNote.box === '' && aNote.folded, JSON.stringify(aNote))
await A.p.evaluate(() => { location.hash = 'notes' }); await sleep(300)
await A.p.evaluate(() => { const g = document.getElementById('group-notes'); g.querySelector('textarea').value = 'Meet at the airport\nexit 2'; g.querySelector('.note-form button[type="submit"]').click() }); await sleep(900)
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200)
// the notes show without opening anything (innerText: only what is on screen)
const bNotes = await B.p.evaluate(() => ({ villa: document.querySelector('#ht-alisa-pool-villa .notes-list').innerText, n: document.querySelector('#ht-alisa-pool-villa .notes-n').textContent, all: document.querySelector('#group-notes .notes-list').innerHTML, mine: document.querySelectorAll('#ht-alisa-pool-villa [data-note-del]').length }))
check('another phone sees the villa note (shown open, with its count) and the group note', /pool is heated/.test(bNotes.villa) && bNotes.n === '(1)' && /Meet at the airport<br>exit 2/.test(bNotes.all) && bNotes.mine === 0, JSON.stringify(bNotes).slice(0, 220))
// My hotels: the form is folded away until Add hotel is tapped, and folds again once a hotel is saved
await B.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
const form0 = await B.p.evaluate(() => ({ form: document.getElementById('my-hotel-form').hidden, btn: !document.getElementById('my-hotel-open').closest('p').hidden }))
await B.p.evaluate(() => document.getElementById('my-hotel-open').click()); await sleep(200)
const form1 = await B.p.evaluate(() => ({ form: document.getElementById('my-hotel-form').hidden, btn: !document.getElementById('my-hotel-open').closest('p').hidden, focus: document.activeElement?.id }))
await B.p.evaluate(() => { document.getElementById('mh-name').value = 'Test Hotel'; document.querySelector('#my-hotel-form [type="submit"]').click() }); await sleep(300)
const form2 = await B.p.evaluate(() => ({ form: document.getElementById('my-hotel-form').hidden, btn: !document.getElementById('my-hotel-open').closest('p').hidden, list: document.getElementById('my-hotels').innerText }))
await B.p.evaluate(() => document.querySelector('#my-hotels [data-del]')?.click())
check('the add-hotel form is hidden until Add hotel is tapped, then folds after saving', form0.form && form0.btn && !form1.form && !form1.btn && form1.focus === 'mh-name' && form2.form && form2.btn && /Test Hotel/.test(form2.list), JSON.stringify([form0, form1, form2]).slice(0, 250))
// the Notes tab (in place of Money on the website): group notes and every villa's notes, each under a link to its villa
await B.p.evaluate(() => { location.hash = 'notes' }); await sleep(400)
const nTab = await B.p.evaluate(() => ({
  tabs: [...document.querySelectorAll('.tabbar a')].map((a) => a.getAttribute('href')).join(' '),
  current: document.querySelector('.tabbar a[aria-current="page"]')?.getAttribute('href'),
  group: document.querySelector('#notes #group-notes .notes-list')?.innerText || '',
  villas: document.getElementById('villa-notes')?.innerText || '', link: !!document.querySelector('#villa-notes a[href="#ht-alisa-pool-villa"]'),
  count: document.getElementById('villa-notes-n')?.textContent, onTrip: !!document.querySelector('#home [data-notes]'),
}))
check('website: a Notes tab instead of Money, with the group notes and the villa notes', /#notes/.test(nTab.tabs) && !/#money/.test(nTab.tabs) && nTab.current === '#notes' &&
  /Meet at the airport/.test(nTab.group) && /Alisa Pool Villa/.test(nTab.villas) && /pool is heated/.test(nTab.villas) && nTab.link && nTab.count === '1 note on 1 villa' && !nTab.onTrip, JSON.stringify(nTab).slice(0, 300))
await B.p.evaluate(() => document.querySelector('#villa-notes a[href="#ht-alisa-pool-villa"]').click()); await sleep(600)
const fromNotes = await B.p.evaluate(() => ({ hash: location.hash, stay: !document.getElementById('stay').hidden, top: Math.round(document.getElementById('ht-alisa-pool-villa').getBoundingClientRect().top) }))
check('a villa name on the Notes tab opens that villa', fromNotes.hash === '#ht-alisa-pool-villa' && fromNotes.stay && fromNotes.top < 200, JSON.stringify(fromNotes))
const money = await B.p.evaluate(() => { location.hash = 'info'; return !!document.querySelector('#info .info-tiles a[href="#money"]') })
check('Money is reached from the Essentials page', money, String(money))
const single = fs.readFileSync(path.join(DIST, 'phuket-guide-offline.html'), 'utf8').match(/<nav class="tabbar"[\s\S]*?<\/nav>/)?.[0] || ''
check('the offline file (no shared notes) keeps the Money tab', /href="#money"/.test(single) && !/href="#notes"/.test(single), single.length + ' chars')
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
await A.p.evaluate(() => document.querySelector('#ht-alisa-pool-villa [data-note-del]').click()); await sleep(900)
const gone = await A.p.evaluate(() => ({ list: document.querySelector('#ht-alisa-pool-villa .notes-list').textContent, empty: document.querySelector('#ht-alisa-pool-villa .notes').classList.contains('empty'), label: getComputedStyle(document.querySelector('#ht-alisa-pool-villa .notes-label')).display }))
check('the author can delete a note; no notes left: just Add a note', /No notes yet/.test(gone.list) && gone.empty && gone.label === 'none', JSON.stringify(gone))
// Share: the phone's share sheet gets the villa, its price, beds, the listing and the guide link to the card
await A.p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d } }); document.querySelector('#ht-alisa-pool-villa [data-share-stay]').click() }); await sleep(300)
const shared = await A.p.evaluate(() => window.__shared)
check('Share sends just the link to the villa in the guide', !!shared && shared.url === base + '#ht-alisa-pool-villa' && !shared.text && shared.title === 'Alisa Pool Villa', JSON.stringify(shared))
// that link opens the guide on the villa, and it stays there while the votes and notes appear above it
const D2 = await person()
await D2.p.goto(base + '#ht-bangtao-4br-villa-unit-1', { waitUntil: 'networkidle0' }); await sleep(1500)
const land = await D2.p.evaluate(() => ({ top: Math.round(document.getElementById('ht-bangtao-4br-villa-unit-1').getBoundingClientRect().top), bars: [...document.querySelectorAll('.votes')].filter((x) => !x.hidden).length }))
check('a shared villa link opens on that villa', land.bars > 0 && land.top >= 0 && land.top < 160, JSON.stringify(land))
await D2.ctx.close()
// live: A likes a villa, B's next check (every 5 s, or coming back to the page) shows it as news with Show
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
await A.p.evaluate(() => document.querySelector('#ht-diamond-villa-278 [data-vote-btn="like"]').click()); await sleep(300)
await A.p.evaluate(() => document.querySelector('#vote-dialog [data-vote-save]').click()); await sleep(900)
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1500)
const news = await B.p.evaluate(() => ({ text: document.querySelector('.toast')?.textContent || '', show: !!document.querySelector('.toast .toast-btn') }))
check('another phone sees the like as news, with Show', /Ani liked Diamond Villa 278/.test(news.text) && news.show, JSON.stringify(news))
const ownNews = await A.p.evaluate(async () => { window.dispatchEvent(new Event('focus')); await new Promise((r) => setTimeout(r, 1200)); return document.querySelector('.toast')?.textContent || '' })
check('your own changes do not come back as news', !/Ani liked/.test(ownNews), ownNews)
// Stats: A's actions are sent when the page is hidden; the Stats page lists people and the latest activity
await A.p.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await sleep(800)
await A.p.evaluate(() => { location.hash = 'stats' }); await sleep(1500)
const stats = await A.p.evaluate(() => ({ people: document.querySelector('#stats-body .stats-table')?.innerText || '', tiles: document.querySelector('#stats-body .stats-tiles')?.innerText || '', log: document.querySelector('#stats-body .stats-log')?.innerText || '' }))
check('the Stats page lists people, visits and the latest activity', /Ani/.test(stats.people) && /Vardan/.test(stats.people) && /People/.test(stats.tiles) && /liked Diamond Villa 278/.test(stats.log) && /opened the guide/.test(stats.log), JSON.stringify(stats).slice(0, 300))
for (const x of [A, B, C]) if (x.errors.length) check('no page errors', false, x.errors.join(' | '))
await b.close(); site.close(); upstash.close()
console.log(failed ? `VOTES TEST FAILED: ${failed}` : 'VOTES TEST PASSED')
process.exitCode = failed ? 1 : 0
