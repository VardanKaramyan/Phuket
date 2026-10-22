// Tests the shared votes: the server (api/votes.js) against a stand-in for the Upstash Redis REST API, then the page:
// Like / Skip buttons, the name dialog, two people seeing each other's votes, removing a vote, Group picks.
// Usage: node tools/votes-test.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { chromePath } from './chrome.mjs'
import { TRIP } from './trip.mjs'

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
    else if (cmd === 'HSETNX') { result = h.has(a[0]) ? 0 : (h.set(a[0], a[1]), 1) }
    else if (cmd === 'HDEL') result = a.filter((f) => h.delete(f)).length
    else if (cmd === 'HLEN') result = h.size
    else if (cmd === 'HGET') result = h.has(a[0]) ? h.get(a[0]) : null
    else if (cmd === 'HEXISTS') result = h.has(a[0]) ? 1 : 0
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
const rawApi = await import(mod + '?store')
// a test password in place of the group's (GUIDE_PASSWORD replaces it): the checks below send it, like a signed-in
// phone (the page part sends it from its storage)
const PASSWORD = 'test-pass55'
process.env.GUIDE_PASSWORD = PASSWORD
const keyed = (f) => (req) => req.headers.has('x-guide-key') ? f(req) : f(new Request(req, { headers: { ...Object.fromEntries(req.headers), 'x-guide-key': PASSWORD } }))
const api = { ...rawApi, GET: keyed(rawApi.GET), POST: keyed(rawApi.POST) }
{
  const raw = (q, body, key) => rawApi[body ? 'POST' : 'GET'](new Request('http://x/api/votes' + q, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-guide-key': key } : {}) }, body: body && JSON.stringify(body) }))
  const s = [(await raw('')).status, (await raw('', { item: 'ht:mouana', name: 'Ani', vote: 'like' }, 'nope')).status, (await raw('?auth=1', null, ' Test-Pass55 ')).status, (await raw('', { device: 'devnokey0001', track: [{ e: 'visit' }] })).status]
  check('the password: none → 401, wrong → 401, any case → ok, visits need none', s.join() === '401,401,200,200', s.join())
}
{
  // the names used before the sign-in go to the group's names, once (on a fresh server start), and are mapped on save
  const t = Date.now(), row = (o) => JSON.stringify({ t, ...o })
  hashes.clear()
  hashes.set('guide:votes', new Map([['ht:a-villa\u001fvardan', row({ v: 'like', n: 'Vardan' })], ['ht:b-villa\u001fvirt', row({ v: 'skip', n: 'Virt' })]]))
  hashes.set('guide:notes', new Map([['n1', row({ item: 'all', text: 'hi', n: 'Vardan' })]]))
  hashes.set('guide:saved', new Map([['pl:big-buddha', row({ n: 'arshak' })]]))
  const fresh = await import(mod + '?rename')
  const j = await (await keyed(fresh.GET)(new Request('http://x/api/votes'))).json()
  const v = await (await keyed(fresh.POST)(new Request('http://x/api/votes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: 'ht:c-villa', name: ' virt ', vote: 'like' }) }))).json()
  const got = { a: j.votes['ht:a-villa']?.like.join(), b: j.votes['ht:b-villa']?.skip.join(), note: j.notes?.all?.[0]?.by, saved: j.saved?.['pl:big-buddha']?.by, c: v.votes?.['ht:c-villa']?.like.join() }
  check('old names: Vardan → Vardan K, Virt → Vardan H, Arshak → Artash, and a vote sent as Virt is Vardan H', JSON.stringify(got) === JSON.stringify({ a: 'Vardan K', b: 'Vardan H', note: 'Vardan K', saved: 'Artash', c: 'Vardan H' }), JSON.stringify(got))
  check('the server and tools/trip.mjs have the same other names', JSON.stringify(fresh.ALIASES) === JSON.stringify(TRIP.aliases), JSON.stringify(fresh.ALIASES))
  hashes.clear(); strings.clear(); lists.clear()
}
{
  let r = await call(api, 'GET')
  check('any prefix works (STORAGE_), empty at first', r.status === 200 && JSON.stringify(r.json.votes) === '{}', JSON.stringify(r.json))
  check('not cached', /no-store/.test(r.headers.get('cache-control') || ''))
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: '  Ani  ', vote: 'like' })
  check('a like is saved', r.status === 200 && r.json.votes['ht:mouana-breeze-mai-khao'].like.join() === 'Ani', JSON.stringify(r.json))
  await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Davit', vote: 'skip' })
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'ani', vote: 'skip' })
  const v = r.json.votes['ht:mouana-breeze-mai-khao']
  check('one vote per name (any case): Ani moves to Skip', v.like.length === 0 && v.skip.join() === 'Davit,ani', JSON.stringify(v))
  r = await call(api, 'POST', { item: 'ht:mouana-breeze-mai-khao', name: 'Davit', vote: null })
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
  r = await call(api, 'POST', { name: 'Davit', order: ['mouana-breeze-mai-khao', 'diamond-villa-278', 'alisa-pool-villa'] })
  check('an order is saved for everyone', r.status === 200 && r.json.order?.ids?.join() === 'mouana-breeze-mai-khao,diamond-villa-278,alisa-pool-villa' && r.json.order.by === 'Davit', JSON.stringify(r.json.order))
  r = await call(api, 'GET')
  check('GET returns the order', r.json.order?.ids?.length === 3, JSON.stringify(r.json.order))
  // shared notes: on a villa, or for the whole trip ('all'); anyone adds, the note keeps its author and time
  r = await call(api, 'POST', { name: 'Ani', note: { item: 'ht:mouana-breeze-mai-khao', text: '  Ask about the\ndeposit  ' } })
  const n1 = r.json.notes?.['ht:mouana-breeze-mai-khao']?.[0]
  check('a villa note is saved with its author', r.status === 200 && n1?.text === 'Ask about the\ndeposit' && n1.by === 'Ani' && !!n1.id, JSON.stringify(r.json.notes))
  r = await call(api, 'POST', { name: 'Davit', note: { item: 'all', text: 'Flights land 14:05' } })
  check('a note for the whole trip is saved', r.json.notes?.all?.[0]?.text === 'Flights land 14:05', JSON.stringify(r.json.notes?.all))
  r = await call(api, 'POST', { name: 'Davit', deleteNote: n1.id })
  check('refused: deleting someone else\'s note', r.status === 403, String(r.status))
  r = await call(api, 'POST', { name: 'ani', deleteNote: n1.id })
  check('the author can delete their note (any capitals)', r.status === 200 && !r.json.notes['ht:mouana-breeze-mai-khao'], JSON.stringify(r.json.notes))
  r = await call(api, 'POST', { name: 'Ani', deleteNote: n1.id })
  check('a note that is gone: 404', r.status === 404, String(r.status))
  for (const [body, why] of [[{ name: 'V', note: { item: 'all', text: '   ' } }, 'an empty note'], [{ name: 'V', note: { item: 'all', text: 'x'.repeat(501) } }, 'a note over 500 characters'], [{ name: 'V', note: { item: 'zz:x', text: 'hi' } }, 'a note on an unknown item'], [{ name: '', note: { item: 'all', text: 'hi' } }, 'a note with no name']]) {
    const x = await call(api, 'POST', body); check('refused: ' + why, x.status === 400, String(x.status))
  }
  // moved villas keep their place: { pins: { id: position | null } }, merged; two villas never share a position
  r = await call(api, 'POST', { name: 'Davit', pins: { 'alisa-pool-villa': 0, 'diamond-villa-278': 3 } })
  check('pins are saved for everyone', r.status === 200 && r.json.pins?.map?.['alisa-pool-villa'] === 0 && r.json.pins.map['diamond-villa-278'] === 3 && r.json.pins.by === 'Davit', JSON.stringify(r.json.pins))
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
  // Saved for the whole group: with who saved it, and off again for everyone
  r = await call(api, 'POST', { item: 'ev:shelter-phuket', name: 'Ani', save: true, device: 'devani000001' })
  check('a save is shared, with who saved it, and is news', r.status === 200 && r.json.saved?.['ev:shelter-phuket']?.by === 'Ani' && r.json.recent?.[0]?.e === 'save', JSON.stringify(r.json.saved))
  r = await call(api, 'POST', { item: 'ev:shelter-phuket', name: 'Gor', save: false, device: 'devgor000001' })
  check('anyone can take a save off the list', r.status === 200 && !r.json.saved?.['ev:shelter-phuket'] && r.json.recent?.[0]?.e === 'unsave', JSON.stringify(r.json.saved))
  r = await call(api, 'POST', { item: 'zz:nothing', name: 'Ani', save: true })
  check('refused: saving an unknown item', r.status === 400, String(r.status))
  // Spending: an expense with who paid and who shares it; anyone changes or deletes it; only the group's names
  check('the server and tools/trip.mjs list the same 8 people', JSON.stringify(api.PEOPLE) === JSON.stringify(TRIP.people) && TRIP.people.length === 8, TRIP.people.join(', '))
  r = await call(api, 'POST', { name: 'Ani', device: 'devani000001', spend: { what: 'Dinner at the market', amount: 2400, cur: 'THB', paid: 'Hovo', split: TRIP.people, date: '2027-01-14' } })
  const sp = r.json.spend?.[0]
  check('an expense is saved for everyone, with who added it, and is news', r.status === 200 && sp?.what === 'Dinner at the market' && sp.amount === 2400 && sp.paid === 'Hovo' && sp.split.length === 8 && sp.by === 'Ani' && r.json.recent?.[0]?.e === 'spend' && /Dinner at the market · 2,400 THB/.test(r.json.recent[0].x), JSON.stringify(sp))
  r = await call(api, 'POST', { name: 'Gor', spend: { id: sp.id, what: 'Dinner at the market', amount: 2500, cur: 'THB', paid: 'Hovo', split: ['Lara', 'Hovo', 'Hovo'], date: '2027-01-14' } })
  const sp2 = (r.json.spend || []).find((x) => x.id === sp.id)
  check('anyone can change an expense: it keeps who added it and says who changed it', r.status === 200 && sp2?.amount === 2500 && sp2.split.join() === 'Hovo,Lara' && sp2.by === 'Ani' && sp2.editedBy === 'Gor' && r.json.spend.length === 1 && r.json.recent?.[0]?.e === 'respend', JSON.stringify(sp2))
  for (const [bad, why] of [[{ paid: 'Nobody' }, 'a payer outside the group'], [{ split: [] }, 'an empty split'], [{ split: ['Hovo', 'Zed'] }, 'a split with someone outside the group'], [{ cur: 'EUR' }, 'another currency'], [{ amount: 0 }, 'a zero amount'], [{ what: 'x'.repeat(81) }, 'an 81-character description'], [{ date: 'soon' }, 'a bad date']]) {
    r = await call(api, 'POST', { name: 'Ani', spend: { what: 'Taxi', amount: 300, cur: 'THB', paid: 'Mes', split: ['Mes'], date: '2027-01-15', ...bad } })
    check('refused: ' + why, r.status === 400, String(r.status))
  }
  r = await call(api, 'POST', { name: 'Gor', deleteSpend: sp.id })
  check('anyone can delete an expense, and it is news', r.status === 200 && !r.json.spend.length && r.json.recent?.[0]?.e === 'unspend', JSON.stringify(r.json.spend))
  // AED, the rate of the day and a category; newId: the id made on the phone, so the same expense sent twice is added once
  const villa = { what: 'Patong villa', amount: 22282.88, cur: 'AED', rate: 9.14, paid: 'Vardan K', split: TRIP.people, date: '2026-10-12', cat: 'stay', newId: 'abc12345xyz' }
  r = await call(api, 'POST', { name: 'Ani', spend: villa })
  const v1 = (r.json.spend || []).find((x) => x.id === 'abc12345xyz')
  check('AED is taken, with its rate and category, under the id the phone made', r.status === 200 && r.json.id === 'abc12345xyz' && v1?.cur === 'AED' && v1.rate === 9.14 && v1.cat === 'stay' && v1.amount === 22282.88, JSON.stringify(v1))
  const newsBefore = r.json.recent?.length
  r = await call(api, 'POST', { name: 'Ani', spend: villa })
  check('the same newId again adds nothing, and is no news', r.status === 200 && r.json.id === 'abc12345xyz' && r.json.spend.filter((x) => x.what === 'Patong villa').length === 1 && r.json.recent?.length === newsBefore && r.json.recent[0].e === 'spend', String(r.json.spend?.length))
  // a phone changed it before its first send got an answer: the same newId with other content is a change
  r = await call(api, 'POST', { name: 'Gor', spend: { ...villa, amount: 22282.89 } })
  const v2 = (r.json.spend || []).filter((x) => x.what === 'Patong villa')
  check('the same newId with other content is saved as a change', r.status === 200 && v2.length === 1 && v2[0].amount === 22282.89 && v2[0].by === 'Ani' && v2[0].editedBy === 'Gor' && r.json.recent?.[0]?.e === 'respend', JSON.stringify(v2))
  // a payment: from one person to one other, news of its own
  r = await call(api, 'POST', { name: 'Ani', spend: { kind: 'pay', what: '', amount: 300, cur: 'THB', paid: 'Artash', split: ['Hovo'], date: '2027-01-15' } })
  check('a payment from one person to another is saved and is news', r.status === 200 && r.json.spend.some((x) => x.kind === 'pay' && x.paid === 'Artash' && x.split.join() === 'Hovo' && x.what === '') && r.json.recent?.[0]?.e === 'pay' && /Artash paid Hovo · 300 THB/.test(r.json.recent[0].x), JSON.stringify(r.json.recent?.[0]))
  const payRow = r.json.spend.find((x) => x.kind === 'pay')
  r = await call(api, 'POST', { name: 'Ani', spend: { kind: 'pay', what: '', amount: 350.5, cur: 'THB', paid: 'Artash', split: ['Hovo'], date: '2027-01-15', id: payRow.id } })
  check('changing a payment is news about a payment, with its cents', r.status === 200 && r.json.recent?.[0]?.e === 'repay' && /Artash paid Hovo · 350.50 THB/.test(r.json.recent[0].x), JSON.stringify(r.json.recent?.[0]))
  r = await call(api, 'POST', { name: 'Ani', deleteSpend: payRow.id })
  check('deleting a payment is news about a payment', r.status === 200 && r.json.recent?.[0]?.e === 'unpay', JSON.stringify(r.json.recent?.[0]))
  r = await call(api, 'POST', { name: 'Ani', deleteSpend: payRow.id })
  check('deleting it again: someone deleted it', r.status === 404 && r.json.error === 'Someone deleted it', JSON.stringify(r.json))
  // an uneven split: weights (shares) or exact amounts; equal shares are an equal split
  const two = { amount: 1000, cur: 'THB', paid: 'Mes', split: ['Mes', 'Lara'], date: '2027-01-16' }
  r = await call(api, 'POST', { name: 'Ani', spend: { ...two, what: 'Boat by shares', shares: { Mes: 2, Lara: 1 } } })
  const bs = (r.json.spend || []).find((x) => x.what === 'Boat by shares')
  r = await call(api, 'POST', { name: 'Ani', spend: { ...two, what: 'Spa by amounts', amounts: { Mes: 600, Lara: 400 } } })
  const ba = (r.json.spend || []).find((x) => x.what === 'Spa by amounts')
  r = await call(api, 'POST', { name: 'Ani', spend: { ...two, what: 'Even shares', shares: { Mes: 1, Lara: 1 } } })
  const be = (r.json.spend || []).find((x) => x.what === 'Even shares')
  check('shares and amounts are kept; equal shares are saved as an equal split', bs?.shares?.Mes === 2 && bs.shares.Lara === 1 && ba?.amounts?.Mes === 600 && ba.amounts.Lara === 400 && be && !be.shares, JSON.stringify({ bs: bs?.shares, ba: ba?.amounts, be: be?.shares }))
  for (const [bad, why] of [[{ kind: 'pay', split: ['Mes'] }, 'a payment to yourself'], [{ kind: 'pay', split: ['Hovo', 'Lara'] }, 'a payment to two people'], [{ kind: 'pay', split: ['Hovo'], shares: { Hovo: 2 } }, 'a payment with shares'],
    [{ kind: 'gift' }, 'an unknown kind'], [{ cat: 'casino' }, 'an unknown category'], [{ split: ['Mes'], shares: { Mes: 1, Zed: 2 } }, 'shares for someone not in the split'], [{ split: ['Mes', 'Lara'], shares: { Mes: 0, Lara: 1 } }, 'a share of 0'],
    [{ split: ['Mes', 'Lara'], amounts: { Mes: 600, Lara: 300 } }, 'amounts that do not add up'], [{ split: ['Mes', 'Lara'], amounts: { Mes: 500, Lara: 500 }, shares: { Mes: 1, Lara: 2 } }, 'both shares and amounts'], [{ cur: 'AMD', rate: -1 }, 'a rate below 0'], [{ shares: { Mes: '2' }, split: ['Mes'] }, 'a share that is not a number'],
    [{ amount: '250' }, 'an amount that is not a number'], [{ date: '2027-02-30' }, 'a day that does not exist'], [{ newId: 'Bad id!' }, 'a badly made newId'], [{ cur: 'USD', rate: 0.5 }, 'a rate far from the real one'],
    [{ kind: 'pay', split: ['Hovo'], cat: 'food' }, 'a category on a payment'], [{ what: '' }, 'an expense with no title']]) {
    r = await call(api, 'POST', { name: 'Ani', spend: { what: 'Taxi', amount: 1000, cur: 'THB', paid: 'Mes', split: ['Mes'], date: '2027-01-15', ...bad } })
    check('refused: ' + why, r.status === 400, r.status + ' ' + JSON.stringify(r.json?.error))
  }
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
  check('STATS_KEY: no key → 403, the right key → the stats', noKey.status === 403 && withKey.status === 200, noKey.status + ' / ' + withKey.status)
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
    const key = req.headers['x-guide-key'] ? { 'x-guide-key': req.headers['x-guide-key'] } : {}
    const r = await rawApi[req.method](new Request('http://x' + req.url, { method: req.method, headers: { 'Content-Type': 'application/json', ...key }, body: req.method === 'POST' ? body : undefined }))
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text())
  }
  let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html'
  if (/^\/s\/[a-z0-9-]+$/.test(p)) p += '.html' // share pages, as vercel.json rewrites them
  const f = path.join(DIST, p)
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
})
const port = await listen(site)
const base = `http://127.0.0.1:${port}/`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true })
const person = async (signedIn = true) => {
  const ctx = await b.createBrowserContext() // its own storage: another phone
  const p = await ctx.newPage(); const errors = []
  if (signedIn) await p.evaluateOnNewDocument((k) => { try { if (!localStorage.getItem('pg:guideKey')) localStorage.setItem('pg:guideKey', JSON.stringify(k)) } catch { /* a frame with no storage */ } }, PASSWORD)
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
await vote(B.p, 'skip', 'Davit')
await A.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1200) // coming back to the page refreshes
s = await bar(A.p)
check('the first phone sees the other vote after a refresh', s.like === '1' && s.skip === '1' && /Davit/.test(s.names), JSON.stringify(s))
await vote(A.p, 'like')
s = await bar(A.p)
check('tapping your own vote again takes it back', s.like === '0' && s.mine === '', JSON.stringify(s))
const picks = await B.p.evaluate(async () => { location.hash = 'stay'; await new Promise((r) => setTimeout(r, 300)); return document.getElementById('group-picks')?.textContent || '' })
check('Group picks ranks the liked villa', /Light & Hope/.test(picks) && /1 like/.test(picks), JSON.stringify(picks.slice(0, 160)))
// folded away by default; the summary says how many; a tap opens it
const fold = await B.p.evaluate(async () => {
  const box = document.getElementById('group-picks-box'), shut = !box.hidden && !box.open && !document.getElementById('group-picks').innerText.trim()
  const count = document.getElementById('group-picks-n').textContent
  box.querySelector('summary').click(); await new Promise((r) => setTimeout(r, 100))
  const opened = box.open && /Light & Hope/.test(document.getElementById('group-picks').innerText)
  box.querySelector('summary').click()
  return { shut, count, opened }
})
check('Group picks is folded away by default and opens on a tap', fold.shut && fold.count === '1 villa' && fold.opened, JSON.stringify(fold))
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
check('the offline file (no shared notes or spendings) keeps the Money tab', /href="#money"/.test(single) && !/href="#notes"/.test(single) && !/href="#spend"/.test(single), single.length + ' chars')
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
await A.p.evaluate(() => document.querySelector('#ht-alisa-pool-villa [data-note-del]').click()); await sleep(900)
const gone = await A.p.evaluate(() => ({ list: document.querySelector('#ht-alisa-pool-villa .notes-list').textContent, empty: document.querySelector('#ht-alisa-pool-villa .notes').classList.contains('empty'), label: getComputedStyle(document.querySelector('#ht-alisa-pool-villa .notes-label')).display }))
check('the author can delete a note; no notes left: just Add a note', /No notes yet/.test(gone.list) && gone.empty && gone.label === 'none', JSON.stringify(gone))
// Share: the phone's share sheet gets the villa, its price, beds, the listing and the guide link to the card
await A.p.evaluate(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d } }); document.querySelector('#ht-alisa-pool-villa [data-share-stay]').click() }); await sleep(300)
const shared = await A.p.evaluate(() => window.__shared)
check('Share sends the villa\'s share page (it has the link preview)', !!shared && shared.url === base + 's/ht-alisa-pool-villa' && !shared.text && shared.title === 'Alisa Pool Villa', JSON.stringify(shared))
// that link opens the guide on the villa, and it stays there while the votes and notes appear above it
const D2 = await person()
await D2.p.goto(base + 's/ht-bangtao-4br-villa-unit-1', { waitUntil: 'networkidle0' }); await sleep(1500)
const land = await D2.p.evaluate(() => ({ top: Math.round(document.getElementById('ht-bangtao-4br-villa-unit-1').getBoundingClientRect().top), bars: [...document.querySelectorAll('.votes')].filter((x) => !x.hidden).length }))
land.url = await D2.p.evaluate(() => location.pathname + location.hash)
check('a shared villa link opens the guide on that villa', land.url === '/#ht-bangtao-4br-villa-unit-1' && land.bars > 0 && land.top >= 0 && land.top < 160, JSON.stringify(land))
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
check('the Stats page lists people, visits and the latest activity', /Ani/.test(stats.people) && /Davit/.test(stats.people) && /People/.test(stats.tiles) && /liked Diamond Villa 278/.test(stats.log) && /opened the guide/.test(stats.log), JSON.stringify(stats).slice(0, 300))
// Saved for the whole group: A stars a villa (her name is known, so no dialog); B sees it in Saved, with her name
await A.p.evaluate(() => { location.hash = 'stay' }); await sleep(300)
await A.p.evaluate(() => document.querySelector('#ht-alisa-pool-villa .fav').click()); await sleep(900)
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1500)
const bSaved = await B.p.evaluate(() => ({ star: document.querySelector('#ht-alisa-pool-villa .fav').getAttribute('aria-pressed'), list: document.getElementById('saved-list').textContent }))
check('a starred villa is saved for everyone, with who saved it', bSaved.star === 'true' && /Alisa Pool Villa/.test(bSaved.list) && /saved by Ani/.test(bSaved.list), JSON.stringify(bSaved))
// a pasted address opens the filtered list: #stay/saved, #stay/liked
const shownStay = (p) => p.evaluate(() => [...document.querySelectorAll('#stay .list .card')].filter((c) => !c.hidden).map((c) => c.id))
await B.p.evaluate(() => { location.hash = 'stay/saved' }); await sleep(500)
const sv = { shown: await shownStay(B.p), ...(await B.p.evaluate(() => ({ chip: document.querySelector('[data-toolbar="stay"] .chip[data-group="pick"][aria-pressed="true"]')?.dataset.value, share: (() => { const x = document.querySelector('[data-toolbar="stay"] [data-share-list]'); return x.hidden ? '' : x.dataset.url })(), view: !document.getElementById('stay').hidden }))) }
check('#stay/saved opens the Stay tab on the saved villas, with a Share link', sv.view && sv.shown.join() === 'ht-alisa-pool-villa' && sv.chip === 'saved' && /\/s\/stay-saved$/.test(sv.share), JSON.stringify(sv))
await B.p.evaluate(() => { location.hash = 'stay/liked' }); await sleep(500)
const likedIds = await B.p.evaluate(() => {
  const hidden = JSON.parse(localStorage.getItem('pg:hiddenShared') || '{}')
  return Object.entries(JSON.parse(localStorage.getItem('pg:votes') || '{}')).filter(([k, v]) => k.startsWith('ht:') && v.like.length && !hidden[k] && document.getElementById(k.replace(':', '-'))).map(([k]) => k.replace(':', '-')).sort()
})
const lk = (await shownStay(B.p)).sort()
// a phone opening the shared link for the first time: the liked villas in order of likes, once the votes arrive
const D3 = await person()
await D3.p.goto(base + '#stay/liked', { waitUntil: 'networkidle0' }); await sleep(900)
const firstOrder = await shownStay(D3.p)
const expectOrder = await D3.p.evaluate((ids) => {
  const v = JSON.parse(localStorage.getItem('pg:votes') || '{}'), pins = (JSON.parse(localStorage.getItem('pg:villaPins') || 'null') || {}).map || {}
  return ids.filter((id) => !Number.isInteger(pins[id.slice(3)])).sort((a, b) => v['ht:' + b.slice(3)].like.length - v['ht:' + a.slice(3)].like.length || v['ht:' + b.slice(3)].last - v['ht:' + a.slice(3)].last)
}, firstOrder)
check('opening #stay/liked on a new phone: the liked villas in order of likes', firstOrder.filter((id) => expectOrder.includes(id)).join() === expectOrder.join() && expectOrder.length > 1, firstOrder.join() + ' vs ' + expectOrder.join())
await D3.ctx.close()
check('#stay/liked shows exactly the villas with a like', lk.length > 0 && lk.join() === likedIds.join(), lk.join() + ' vs ' + likedIds.join())
const urls = []
await B.p.evaluate(() => document.querySelector('[data-toolbar="stay"] .chip[data-group="pick"][data-value="all"]').click()); urls.push(await B.p.evaluate(() => location.hash))
await B.p.evaluate(() => document.querySelector('[data-toolbar="stay"] .chip[data-group="pick"][data-value="liked"]').click()); urls.push(await B.p.evaluate(() => location.hash))
await B.p.evaluate(() => document.querySelector('[data-toolbar="stay"] .chip[data-group="tier"][data-value="all"]').click()); urls.push(await B.p.evaluate(() => location.hash))
await B.p.evaluate(() => document.querySelector('[data-toolbar="stay"] .chip[data-group="pick"][data-value="all"]').click())
check('tapping Liked or Saved puts the link in the address bar, ready to copy', urls.join(' ') === '#stay #stay/liked #stay/liked', urls.join(' '))
// saves made on a phone before Saved was shared move into the group's list once its name is known
await C.p.evaluate(() => { localStorage.setItem('pg:favs', JSON.stringify(['pl:big-buddha'])); localStorage.setItem('pg:voterName', JSON.stringify('Lilit')); localStorage.removeItem('pg:favsMoved') })
await C.p.reload({ waitUntil: 'networkidle0' }); await sleep(1500)
const moved = (await (await api.GET(new Request('http://x/api/votes'))).json()).saved?.['pl:big-buddha']
check("a phone's old saves join the group's Saved list, under its name", moved?.by === 'Lilit', JSON.stringify(moved))
// Spending: each phone says who it is (one of the group), adds expenses in the sheet, and sees the balances and who
// pays whom; a payment from Settle up, with Undo; changing and deleting (with Undo); shares; the villas in one tap; offline
const tabsWeb = await A.p.evaluate(() => [...document.querySelectorAll('.tabbar a')].map((a) => a.getAttribute('href')).join(' '))
const tile = await A.p.evaluate(() => !!document.querySelector('#home .tile[href="#spend"]'))
check('the website has a Spend tab, and the Trip page links to it', /#notes #spend$/.test(tabsWeb) && tile, tabsWeb)
const asked = (p) => p.evaluate(async () => { location.hash = 'spend'; await new Promise((r) => setTimeout(r, 300)); return { ask: !!document.querySelector('#spend-me.ask'), add: !document.getElementById('spend-add').hidden } })
const askA = await asked(A.p), askB = await asked(B.p)
check('a voting name that is not one of the group (Ani, or Davit): Who are you, and no Add yet', askA.ask && !askA.add && askB.ask && !askB.add, JSON.stringify({ askA, askB }))
const pickMe = (p, who) => p.evaluate(async (who) => {
  document.querySelector('#spend-me [data-me="' + who + '"]').click(); await new Promise((r) => setTimeout(r, 200))
  return { me: document.querySelector('#spend-me .me-top b')?.textContent, add: !document.getElementById('spend-add').hidden, voter: JSON.parse(localStorage.getItem('pg:voterName')) }
}, who)
const meA = await pickMe(A.p, 'Lara'), meB = await pickMe(B.p, 'Hovo')
check('picking a name shows your card and Add, and keeps the voting name', meA.me === 'Lara' && meA.add && meA.voter === 'Ani' && meB.me === 'Hovo' && meB.voter === 'Davit', JSON.stringify({ meA, meB }))
// the sheet: amount, currency, what, paid by, split (equally, or shares), day, Save
const addSpend = (p, x) => p.evaluate(async (x) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  location.hash = 'spend'; await wait(150)
  document.querySelector('#spend-seg [data-pane="list"]').click()
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form')
  set(f.querySelector('#sp-amount'), String(x.amount))
  f.querySelector('[data-cur="' + x.cur + '"]').click()
  set(f.querySelector('#sp-what'), x.what)
  f.querySelector('[data-paid="' + x.paid + '"]').click()
  if (x.split) for (const b of [...f.querySelectorAll('#sp-split [data-split-p]')].map((y) => y.dataset.splitP)) {
    const el = f.querySelector('#sp-split [data-split-p="' + b + '"]')
    if ((el.getAttribute('aria-pressed') === 'true') !== x.split.includes(b)) el.click()
  }
  if (x.shares) { f.querySelector('[data-mode="shares"]').click(); for (const [n, k] of Object.entries(x.shares)) for (let i = 1; i < k; i++) f.querySelector('[data-step="1"][data-p="' + n + '"]').click() }
  set(f.querySelector('#sp-date'), x.date)
  f.querySelector('#sp-save').click(); await wait(900)
  return { open: document.getElementById('spend-sheet').open, err: f.querySelector('#sp-err').textContent }
}, x)
const titles = (p) => p.evaluate(() => [...document.querySelectorAll('#spend-list .xrow .x-main b')].map((b) => b.textContent))
const shape = await A.p.evaluate(() => ({ outside: !document.querySelector('#spend #spend-sheet') && !!document.getElementById('spend-sheet'), cats: [...document.querySelectorAll('#spend-form [data-cat]')].map((b) => b.dataset.cat) }))
check('the sheet sits outside the tab, and the page and the server take the same categories', shape.outside && JSON.stringify(shape.cats) === JSON.stringify(api.SPEND_CATS), JSON.stringify(shape))
const r1 = await addSpend(A.p, { what: 'Dinner at the market', amount: 2400, cur: 'THB', paid: 'Hovo', date: '2027-01-14' })
const r2 = await addSpend(A.p, { what: 'Taxi to the pier', amount: 1000, cur: 'AMD', paid: 'Lara', date: '2027-01-15', split: ['Lara', 'Mes'] })
const aList = { items: await titles(A.p), dialog: await A.p.evaluate(() => document.getElementById('vote-dialog').open) }
check('expenses from the sheet are saved for everyone, newest day first, with no name dialog', aList.items.join('|') === 'Taxi to the pier|Dinner at the market' && !aList.dialog && !r1.open && !r2.open, JSON.stringify({ aList, r1, r2 }))
// B shows amounts in baht, for exact numbers
await B.p.evaluate(() => { const c = document.getElementById('spend-cur'); c.value = 'THB'; c.dispatchEvent(new Event('change')); window.dispatchEvent(new Event('focus')) }); await sleep(1500)
const balOf = (p) => p.evaluate(() => {
  const thb = (t) => Number(((t || '').match(/([\d,]+)\sTHB/) || [0, '0'])[1].replace(/,/g, '')) * (/[−-]/.test(t || '') ? -1 : 1)
  const rows = Object.fromEntries([...document.querySelectorAll('#spend-bal .bal')].map((r) => { const t = r.querySelector('.bal-row b').textContent; return [r.querySelector('.bal-name').textContent, { text: t, thb: thb(t) }] }))
  const moves = [...document.querySelectorAll('#spend-settle .move')].filter((li) => li.querySelector('[data-settle-from]')).map((li) => ({ from: li.querySelector('[data-settle-from]').dataset.settleFrom, to: li.querySelector('[data-settle-from]').dataset.settleTo, thb: thb(li.querySelector('b').textContent) }))
  return { rows, moves, perAmd: JSON.parse(document.getElementById('guide-data').textContent).rates.mid.AMD, n: document.querySelectorAll('#spend-list .xrow').length,
    news: document.querySelector('.toast')?.textContent || '', me: document.querySelector('#spend-me .me-bal')?.textContent || '', tile: document.querySelector('#home .tile[href="#spend"] span')?.textContent || '' }
})
const bal = await balOf(B.p)
check('another phone sees the expenses, with the news', bal.n === 2 && /Lara added an expense: Taxi to the pier/.test(bal.news), bal.news)
const taxi = 1000 * bal.perAmd // in baht, at the guide's rate (saved with the expense)
check('balances: Hovo +2,100 THB, Artash −300, Mes −300 and half the taxi, Lara −300 and half back', bal.rows.Hovo.thb === 2100 && bal.rows.Artash.thb === -300 &&
  Math.abs(bal.rows.Mes.thb + 300 + taxi / 2) <= 1 && Math.abs(bal.rows.Lara.thb + 300 - taxi / 2) <= 1, JSON.stringify(Object.fromEntries(Object.entries(bal.rows).map(([k, v]) => [k, v.text]))).slice(0, 320))
const paidBack = bal.moves.reduce((a, m) => a + m.thb, 0)
check('settle up: 7 payments, all to Hovo, adding up to what he gets back', bal.moves.length === 7 && bal.moves.every((m) => m.to === 'Hovo') && Math.abs(paidBack - 2100) <= 7, JSON.stringify(bal.moves).slice(0, 300))
check('your card and the Trip tile say what you get back', /You get back/.test(bal.me) && /2,100\sTHB/.test(bal.me) && /You get back 2,100\sTHB/.test(bal.tile), JSON.stringify({ me: bal.me, tile: bal.tile }))
// Paid on a suggested payment: saved at once (Artash is even), and Undo takes it back
const paid = await B.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.querySelector('#spend-seg [data-pane="balances"]').click()
  document.querySelector('#spend-settle [data-settle-from="Artash"]').click(); await wait(900)
  const artash = [...document.querySelectorAll('#spend-bal .bal')].find((r) => r.querySelector('.bal-name').textContent === 'Artash')
  const out = { toast: document.querySelector('.toast')?.textContent || '', artash: artash.querySelector('.bal-row b').textContent, moves: document.querySelectorAll('#spend-settle [data-settle-from]').length, rows: [...document.querySelectorAll('#spend-list .xrow .x-main b')].map((b) => b.textContent) }
  document.querySelector('.toast .toast-btn').click(); await wait(900)
  out.undone = { moves: document.querySelectorAll('#spend-settle [data-settle-from]').length, rows: [...document.querySelectorAll('#spend-list .xrow .x-main b')].map((b) => b.textContent) }
  return out
})
check('Mark paid saves the payment at once: Artash is even, one payment less, and it is in the list', /Artash paid you 300\sTHB/.test(paid.toast) && /even/.test(paid.artash) && paid.moves === 6 && paid.rows.includes('Artash paid you'), JSON.stringify(paid).slice(0, 300))
check('Undo takes the payment back', paid.undone.moves === 7 && !paid.undone.rows.includes('Artash paid you'), JSON.stringify(paid.undone))
// a tap on an expense opens it in the sheet; the change is saved for everyone, with who changed it
const edited = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  ;[...document.querySelectorAll('#spend-list .xrow')].find((c) => /Dinner/.test(c.textContent)).click(); await wait(200)
  const f = document.getElementById('spend-form')
  const filled = { amount: f.querySelector('#sp-amount').value, paid: f.querySelector('[data-paid][aria-pressed="true"]')?.dataset.paid, title: document.getElementById('sheet-title').textContent, del: !document.getElementById('sp-delete').hidden }
  const a = f.querySelector('#sp-amount'); a.value = '3200'; a.dispatchEvent(new Event('input', { bubbles: true }))
  f.querySelector('#sp-save').click(); await wait(900)
  const row = [...document.querySelectorAll('#spend-list .xrow')].find((c) => /Dinner/.test(c.textContent))
  return { filled, text: row.textContent, n: document.querySelectorAll('#spend-list .xrow').length, by: JSON.parse(localStorage.getItem('pg:spend')).find((x) => /Dinner/.test(x.what)).editedBy }
})
check('a tap on an expense opens it filled in; the change is saved for everyone', edited.filled.amount === '2,400' && edited.filled.paid === 'Hovo' && edited.filled.title === 'Change expense' && edited.filled.del && /3,200\sTHB/.test(edited.text) && edited.n === 2 && edited.by === 'Lara', JSON.stringify(edited).slice(0, 300))
// Delete: gone for everyone at once; Undo brings it back
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1300)
const del = await B.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const names = () => [...document.querySelectorAll('#spend-list .xrow .x-main b')].map((b) => b.textContent)
  document.querySelector('#spend-seg [data-pane="list"]').click()
  ;[...document.querySelectorAll('#spend-list .xrow')].find((c) => /Taxi/.test(c.textContent)).click(); await wait(200)
  document.getElementById('sp-delete').click(); await wait(900)
  const out = { after: names(), toast: document.querySelector('.toast')?.textContent || '', sheet: document.getElementById('spend-sheet').open }
  document.querySelector('.toast .toast-btn').click(); await wait(900)
  out.back = names()
  return out
})
check('Delete removes it for everyone at once, and Undo brings it back', del.after.join('|') === 'Dinner at the market' && /Deleted: Taxi to the pier/.test(del.toast) && !del.sheet && del.back.join('|') === 'Taxi to the pier|Dinner at the market', JSON.stringify(del))
// shares: Lara 2, Mes 1; the category comes from the words
await addSpend(A.p, { what: 'Boat tour', amount: 3000, cur: 'THB', paid: 'Lara', date: '2027-01-16', split: ['Lara', 'Mes'], shares: { Lara: 2 } })
const sh = await A.p.evaluate(() => {
  const x = JSON.parse(localStorage.getItem('pg:spend')).find((y) => y.what === 'Boat tour')
  const row = [...document.querySelectorAll('#spend-list .xrow')].find((c) => /Boat tour/.test(c.textContent))
  return x && { shares: x.shares, split: x.split, cat: x.cat, icon: row?.querySelector('.x-ic')?.className, row: row?.textContent }
})
check('a split by shares is saved with the shares; the category comes from the words; the row says what you lent', sh?.shares?.Lara === 2 && sh.shares.Mes === 1 && sh.split.join() === 'Mes,Lara' && !sh.cat && /c-activities/.test(sh.icon) && /you lent [\d,]+\s(AMD|THB)/.test(sh.row), JSON.stringify(sh))
// the villas we paid: one tap fills the sheet (AED, Stay, everyone), saved with the rate of the day
const quick = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form'), chips = [...f.querySelectorAll('#sp-quick [data-quick]')].map((b) => b.textContent)
  f.querySelector('#sp-quick [data-quick]').click(); await wait(100)
  const filled = { what: f.querySelector('#sp-what').value, amount: f.querySelector('#sp-amount').value, cur: f.querySelector('[data-cur][aria-pressed="true"]').dataset.cur, cat: f.querySelector('[data-cat][aria-pressed="true"]').dataset.cat }
  f.querySelector('[data-paid="Vardan K"]').click()
  f.querySelector('#sp-save').click(); await wait(900)
  const x = JSON.parse(localStorage.getItem('pg:spend')).find((y) => y.what === 'Patong villa')
  return { chips, filled, saved: x && { amount: x.amount, cur: x.cur, rate: x.rate, cat: x.cat, split: x.split.length }, aed: JSON.parse(document.getElementById('guide-data').textContent).rates.mid.AED }
})
check('the villas we paid are one tap away, filled in AED and saved with the rate', quick.chips.length === 2 && /Patong villa · 22,282.88\sAED/.test(quick.chips[0]) && quick.filled.amount === '22,282.88' && quick.filled.cur === 'AED' && quick.filled.cat === 'stay' &&
  quick.saved?.amount === 22282.88 && quick.saved.cur === 'AED' && quick.saved.rate === quick.aed && quick.saved.split === 8, JSON.stringify(quick))
// the Rawai villa typed by hand with AMD tapped (AMD and AED sit side by side, 21 Oct 2026): Save stops once and says
// what it cost; with AED it saves; the buttons name each currency under its code
const wrongCur = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form')
  const names = [...f.querySelectorAll('#sp-curs [data-cur]')].map((b) => b.textContent)
  set(f.querySelector('#sp-amount'), '12691.51'); f.querySelector('[data-cur="AMD"]').click(); set(f.querySelector('#sp-what'), 'Rawai villa')
  f.querySelector('[data-paid="Vardan K"]').click()
  f.querySelector('#sp-save').click(); await wait(400)
  const asked = { open: document.getElementById('spend-sheet').open, err: f.querySelector('#sp-err').textContent }
  f.querySelector('[data-cur="AED"]').click(); f.querySelector('#sp-save').click(); await wait(900)
  const x = JSON.parse(localStorage.getItem('pg:spend')).find((y) => y.what === 'Rawai villa')
  return { names, asked, closed: !document.getElementById('spend-sheet').open, saved: x && { amount: x.amount, cur: x.cur } }
})
check('a villa price in the wrong currency is caught: Save says what it cost, and AED saves it', wrongCur.names.join(' ') === 'THBbaht AMDdram AEDdirham USDdollar' && wrongCur.asked.open && /Rawai villa cost 12,691.51\sAED/.test(wrongCur.asked.err) && /not AMD/.test(wrongCur.asked.err) &&
  wrongCur.closed && wrongCur.saved?.amount === 12691.51 && wrongCur.saved.cur === 'AED', JSON.stringify(wrongCur))
// a link to a part of the tab, Stats, and Share as text
const parts = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = 'spend/balances'; await wait(300)
  const balances = !document.querySelector('[data-pane-box="balances"]').hidden && document.querySelector('#spend-seg [data-pane="balances"]').getAttribute('aria-pressed') === 'true'
  document.querySelector('#spend-seg [data-pane="stats"]').click(); await wait(100)
  const stats = { tiles: document.querySelectorAll('#spend-stats .stat-tiles div').length, cats: [...document.querySelectorAll('#spend-stats .hbars .hb-name')].map((x) => x.textContent), hash: location.hash }
  document.querySelector('#spend-seg [data-pane="list"]').click()
  window.__shared = null; document.getElementById('spend-copy').click(); await wait(300)
  return { balances, stats, shared: window.__shared && window.__shared.text }
})
check('#spend/balances opens Balances; Stats has the totals and categories', parts.balances && parts.stats.tiles === 3 && parts.stats.cats.includes('Stay') && parts.stats.cats.includes('Food') && parts.stats.hash === '#spend/stats', JSON.stringify(parts.stats))
check('Share as text sends the expenses, balances and payments', /Dinner at the market/.test(parts.shared || '') && /Settle up:/.test(parts.shared || '') && /Lara/.test(parts.shared || ''), String(parts.shared).slice(0, 200))
// Back with the sheet open closes it, and the guide still works
const backSheet = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  location.hash = 'spend'; await wait(200)
  document.getElementById('spend-add').click(); await wait(200)
  const opened = document.getElementById('spend-sheet').open
  history.back(); await wait(500)
  const out = { opened, open: document.getElementById('spend-sheet').open, hash: location.hash }
  location.hash = 'events'; await wait(300)
  out.events = !document.getElementById('events').hidden
  location.hash = 'spend'; await wait(300)
  return out
})
check('Back with the sheet open closes it, and the guide still works', backSheet.opened && !backSheet.open && backSheet.hash === '#spend' && backSheet.events, JSON.stringify(backSheet))
// Enter in What was it closes the keyboard and does not save
const nBefore = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form'), set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  set(f.querySelector('#sp-amount'), '500'); set(f.querySelector('#sp-what'), 'Coffee')
  return JSON.parse(localStorage.getItem('pg:spend')).length
})
await A.p.focus('#sp-what'); await A.p.keyboard.press('Enter'); await sleep(700)
const enter = await A.p.evaluate(async (n) => {
  const out = { open: document.getElementById('spend-sheet').open, same: JSON.parse(localStorage.getItem('pg:spend')).length === n }
  document.querySelector('#spend-sheet [data-sheet-close]').click(); await new Promise((r) => setTimeout(r, 200))
  return out
}, nBefore)
check('Enter in What was it does not save', enter.open && enter.same, JSON.stringify(enter))
// Amounts: Lara 600, Mes 0 (typed), Hovo the rest; Mes is then not in it
const amounts = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form')
  set(f.querySelector('#sp-amount'), '1000'); set(f.querySelector('#sp-what'), 'Spa for three')
  f.querySelector('[data-mode="amounts"]').click()
  for (const b of [...f.querySelectorAll('#sp-split [data-split-p]')].map((y) => y.dataset.splitP)) {
    const el = f.querySelector('#sp-split [data-split-p="' + b + '"]')
    if ((el.getAttribute('aria-pressed') === 'true') !== ['Lara', 'Mes', 'Hovo'].includes(b)) el.click()
  }
  set(f.querySelector('[data-amt="Lara"]'), '600'); set(f.querySelector('[data-amt="Mes"]'), '0')
  const sum = f.querySelector('#sp-sum').textContent, hint = f.querySelector('[data-amt="Hovo"]').placeholder
  f.querySelector('#sp-save').click(); await wait(900)
  const x = JSON.parse(localStorage.getItem('pg:spend')).find((y) => y.what === 'Spa for three')
  return { sum, hint, amounts: x && x.amounts, split: x && x.split }
})
check('Amounts: a typed 0 is kept, the others share the rest, and nobody with 0 is in it', /Adds up/.test(amounts.sum) && amounts.hint === '400' && amounts.amounts?.Hovo === 400 && amounts.amounts?.Lara === 600 && amounts.split?.join() === 'Hovo,Lara', JSON.stringify(amounts))
// the same expense twice: the first Save asks, the second adds it
const dup = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })) }
  document.getElementById('spend-add').click(); await wait(150)
  const f = document.getElementById('spend-form')
  set(f.querySelector('#sp-amount'), '3200'); f.querySelector('[data-cur="THB"]').click(); set(f.querySelector('#sp-what'), 'Dinner again')
  f.querySelector('[data-paid="Hovo"]').click(); set(f.querySelector('#sp-date'), '2027-01-14')
  f.querySelector('#sp-save').click(); await wait(300)
  const asked = { open: document.getElementById('spend-sheet').open, msg: f.querySelector('#sp-err').textContent }
  f.querySelector('#sp-save').click(); await wait(900)
  return { asked, open: document.getElementById('spend-sheet').open, n: JSON.parse(localStorage.getItem('pg:spend')).filter((x) => x.what === 'Dinner again').length }
})
check('the same expense twice: Save asks once, then adds it', dup.asked.open && /Already in the list: Dinner at the market/.test(dup.asked.msg) && !dup.open && dup.n === 1, JSON.stringify(dup))
// Mark paid in drams: saved as the drams on the button, to the satang (Lara is then even)
await A.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1300)
const amdPaid = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const btn = document.querySelector('#spend-me [data-settle-from="Lara"]')
  if (!btn) return { none: true, card: document.getElementById('spend-me').textContent }
  const shown = btn.parentElement.querySelector('.move-open b').textContent, to = btn.dataset.settleTo, cents = Number(btn.dataset.cents)
  btn.click(); await wait(1000)
  const x = JSON.parse(localStorage.getItem('pg:spend')).find((y) => y.kind === 'pay' && y.paid === 'Lara' && y.split[0] === to)
  return { shown, cents, saved: x && { amount: x.amount, cur: x.cur, rate: x.rate }, paidBack: document.querySelectorAll('#spend-paid .xrow').length }
})
check('Mark paid in drams saves the drams shown, to the satang', !amdPaid.none && amdPaid.saved?.cur === 'AMD' && amdPaid.shown === amdPaid.saved.amount.toLocaleString('en-US') + '\u00a0AMD' && Math.round(amdPaid.saved.amount * amdPaid.saved.rate * 100) === amdPaid.cents && amdPaid.paidBack >= 1, JSON.stringify(amdPaid))
// a tap on a payment to settle opens it as a payment; half of it is saved, and about half is still owed
await B.p.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(1300)
const part = await B.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const thb = (t) => Number(((t || '').match(/([\d,]+)\sTHB/) || [0, '0'])[1].replace(/,/g, '')) * (/[−-]/.test(t || '') ? -1 : 1)
  const balOf = (p) => thb([...document.querySelectorAll('#spend-bal .bal')].find((r) => r.querySelector('.bal-name').textContent === p).querySelector('.bal-row b').textContent)
  document.querySelector('#spend-seg [data-pane="balances"]').click()
  const open = document.querySelector('#spend-settle .move-open')
  if (!open) return { none: true }
  const from = open.dataset.payFrom, to = open.dataset.payTo, owed = thb(open.querySelector('b').textContent), before = balOf(from)
  open.click(); await wait(200)
  const f = document.getElementById('spend-form')
  const filled = { title: document.getElementById('sheet-title').textContent, from: f.querySelector('#sp-paid-val').textContent, to: f.querySelector('[data-to][aria-pressed="true"]')?.dataset.to, amount: Number(f.querySelector('#sp-amount').value.replace(/,/g, '')) }
  const half = Math.round(owed / 2), a = f.querySelector('#sp-amount'); a.value = String(half); a.dispatchEvent(new Event('input', { bubbles: true }))
  f.querySelector('#sp-save').click(); await wait(900)
  return { from, to, owed, half, filled, before, after: balOf(from) }
})
check('a tap on a payment to settle opens it filled in; a part payment counts for that much', !part.none && part.filled.title === 'New payment' && part.filled.from.includes(part.from === 'Hovo' ? 'You' : part.from) && part.filled.to === part.to && Math.round(part.filled.amount) === part.owed && Math.abs(part.after - part.before - part.half) <= 1, JSON.stringify(part))
// filters: Mine, and With someone from a balance row
const filters = await B.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const row = [...document.querySelectorAll('#spend-bal .bal-row')].find((r) => r.dataset.p === 'Mes'); row.click(); await wait(100)
  row.parentElement.querySelector('[data-filter-person]').click(); await wait(200)
  const chip = document.querySelector('[data-spend-filter="person"]')
  const want = JSON.parse(localStorage.getItem('pg:spend')).filter((x) => x.paid === 'Mes' || x.split.includes('Mes')).length
  const out = { chip: chip.hidden ? '' : chip.textContent.trim(), list: !document.querySelector('[data-pane-box="list"]').hidden, rows: document.querySelectorAll('#spend-list .xrow').length === want, want }
  chip.click(); await wait(100)
  out.after = document.querySelector('[data-spend-filter="all"]').getAttribute('aria-pressed')
  return out
})
check('See expenses on a balance row filters the list to that person, and the chip takes it back', /^With Mes/.test(filters.chip) && filters.list && filters.rows && filters.after === 'true', JSON.stringify(filters))
// no connection: the expense stays on this phone, marked Not sent yet, and goes once the connection is back
apiDown = true
const off = await addSpend(A.p, { what: 'Water and ice', amount: 120, cur: 'THB', paid: 'Lara', date: '2027-01-16' })
const queued = await A.p.evaluate(() => ({ unsent: [...document.querySelectorAll('#spend-list .xrow')].filter((c) => c.querySelector('.unsent')).map((c) => c.querySelector('.x-main b').textContent), box: JSON.parse(localStorage.getItem('pg:spendOutbox') || '[]').length, toast: document.querySelector('.toast')?.textContent || '' }))
check('with no connection, the expense stays on the phone, marked Not sent yet', !off.open && queued.unsent.join() === 'Water and ice' && queued.box === 1 && /Saved on this phone/.test(queued.toast), JSON.stringify({ off, queued }))
apiDown = false
await A.p.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1500)
const sentNow = await A.p.evaluate(() => ({ unsent: document.querySelectorAll('#spend-list .unsent').length, box: JSON.parse(localStorage.getItem('pg:spendOutbox') || '[]').length }))
const onServer = (await (await api.GET(new Request('http://x/api/votes'))).json()).spend.filter((x) => x.what === 'Water and ice').length
check('back online, it is sent once', sentNow.unsent === 0 && sentNow.box === 0 && onServer === 1, JSON.stringify({ sentNow, onServer }))
apiDown = true
await addSpend(A.p, { what: 'Wrong one', amount: 90, cur: 'THB', paid: 'Lara', date: '2027-01-16' })
const dropped = await A.p.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  ;[...document.querySelectorAll('#spend-list .xrow')].find((c) => /Wrong one/.test(c.textContent)).click(); await wait(200)
  const meta = document.getElementById('sp-meta').textContent
  document.getElementById('sp-delete').click(); await wait(300)
  return { meta, box: JSON.parse(localStorage.getItem('pg:spendOutbox') || '[]').length, rows: document.querySelectorAll('#spend-list .unsent').length }
})
apiDown = false
await A.p.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(1200)
const neverSent = (await (await api.GET(new Request('http://x/api/votes'))).json()).spend.filter((x) => x.what === 'Wrong one').length
check('an unsent expense deleted on the phone never reaches the group', dropped.meta === 'Not sent yet' && dropped.box === 0 && dropped.rows === 0 && neverSent === 0, JSON.stringify({ dropped, neverSent }))
// a phone with no password: the server says 401, the sign-in screen comes up and takes a name of the group (or its
// other name) and the password
const G = await person(false)
await G.p.goto(base, { waitUntil: 'load' }); await sleep(1500)
const gateTry = (name, pass) => G.p.evaluate(async (name, pass) => {
  document.getElementById('gate-name').value = name; document.getElementById('gate-pass').value = pass
  document.getElementById('gate-form').requestSubmit(); await new Promise((r) => setTimeout(r, 400))
  return { shown: !document.getElementById('gate').hidden, err: document.getElementById('gate-err').textContent, me: JSON.parse(localStorage.getItem('pg:voterName') || '""') }
}, name, pass)
const gate0 = await G.p.evaluate(() => !document.getElementById('gate').hidden && document.querySelector('.gate-title').textContent)
const gates = [await gateTry('Ani', PASSWORD), await gateTry('virt', 'wrong'), await gateTry(' Virt ', 'TEST-PASS55')]
check('sign-in: DU OV ES? comes up, a stranger and a wrong password are refused, Virt is Vardan H', gate0 === 'DU OV ES?' && /Not on the list/.test(gates[0].err) && gates[1].shown && /Wrong/.test(gates[1].err) && !gates[2].shown && gates[2].me === 'Vardan H', JSON.stringify({ gate0, gates }))
for (const x of [A, B, C, G]) if (x.errors.length) check('no page errors', false, x.errors.join(' | '))
await b.close(); site.close(); upstash.close()
console.log(failed ? `VOTES TEST FAILED: ${failed}` : 'VOTES TEST PASSED')
process.exitCode = failed ? 1 : 0
