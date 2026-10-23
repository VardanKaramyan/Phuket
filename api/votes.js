// Shared votes for the guide: Like or Skip on a villa (ht:), event (ev:) or place (pl:), by name, and villas hidden for
// everyone; saved in Upstash Redis (connected to the Vercel project under Storage). Vercel runs this file as
// /api/votes; no packages needed.
//   GET  /api/votes  -> { votes: { 'ht:<id>': { like: ['Ani'], skip: [] }, ... }, hidden: { 'ht:<id>': { by: 'Gor', t } } }
//   POST /api/votes { item, name, vote: 'like' | 'skip' | null }  -> the same, after the change (null takes it back)
//   POST /api/votes { item: 'ht:<id>', name, hide: true | false } -> hides the villa for everyone, or shows it again
//   POST /api/votes { name, pins: { '<villa id>': position | null } } -> villas moved by hand keep that place (Move up / down)
//   POST /api/votes { name, order: ['<villa id>', …] }           -> the old whole-list order (older copies of the page)
//   POST /api/votes { name, note: { item: 'ht:<id>' | 'all', text } } -> a shared note on a villa, or for the whole trip
//   POST /api/votes { name, deleteNote: '<note id>' }            -> deletes a note
//   POST /api/votes { name, spend: { id?, what, amount, cur, paid, split: [names], date, cat?, rate?, shares?, amounts?,
//        kind? } } -> adds an expense (or changes it, with its id); paid and split are names of the group (PEOPLE), cur
//        THB, AMD, USD or AED; rate: baht for 1 unit when it was added; shares { name: weight } or amounts { name: amount }
//        for an uneven split; kind 'pay': a payment from paid to the one person in split; newId: the id for a new one,
//        made on the phone (sent again, it is added once, or saved as a change when it differs); with keep: { by, t,
//        editedBy, editedT } (Undo after a delete) it comes back with who added it and when
//   POST /api/votes { name, deleteSpend: '<expense id>' }         -> deletes an expense (who added it, who paid it, or the admin)
//   POST /api/votes { name, confirm: '<id>' } / { name, reject: '<id>' } -> a payment's receiver says they got it (or not);
//        the admin approves (or rejects) any expense or payment. An expense counts once the admin approved it, a payment
//        once its receiver and the admin both did (ok, got, no on the row: { by, t })
//   POST /api/votes { device, name?, key?, info?, track: [{ e, x }] } -> visits and actions for the Stats page and the log
//   GET  /api/votes?ver=<n>  -> { ver, same: true } when nothing changed since version n (one cheap read), else everything
//   GET  /api/votes?stats=1  -> { visitors: { <device>: { n, first, last, visits, kind } }, log: [...] } for the Stats page
//   GET  /api/votes?audit=1&from=<i>&n=<count> -> { audit: [...], total, visitors } the activity log (the admin only)
//   GET  /api/votes?auth=1  -> { ok: true, name, admin } when the name and password are right (the sign-in screen)
// Everything but the visits (track) needs the password in an X-Guide-Key header, or it answers 401: the group's, or for
// Vardan K (the admin) his own. The page also sends the signed-in name (X-Guide-Name) and its device id (X-Guide-Device).
// The stats and the activity log answer only the admin (403 for anyone else). Every request goes into the activity log
// (guide:audit) with the name, the IP, the place from Vercel's headers (country, region, city, coordinates, time zone),
// the browser and the device.
// GET and every POST answer with { votes, hidden, pins: { map, by, t } | null, order, notes: { '<item>': [{ id, text, by, t }] },
// spend: [expenses, newest day first], ver, recent: [the latest shared changes] }; each votes entry also has last: the time
// of its latest like. Saving an expense also answers with its id.
// One vote per name and item; names match without case ("Ani" and "ani" are the same person).
import { createHash, scrypt, timingSafeEqual } from 'node:crypto'

// the group's password, asked with the name on the sign-in screen: kept as its SHA-256 (any case, spaces trimmed), so
// the password itself is not in the code; a GUIDE_PASSWORD environment variable on Vercel replaces it
const PASSWORD_SHA = '2cb2d46750539012abd550eace6da18bd934fea18e4da729ad182fce874a4df9'
const sha = (s) => createHash('sha256').update(String(s ?? '').trim().toLowerCase()).digest('hex')
const groupKeyOk = (k) => !!k && sha(k) === (process.env.GUIDE_PASSWORD ? sha(process.env.GUIDE_PASSWORD) : PASSWORD_SHA)
// Vardan K, the admin (the user, 23 Oct 2026): he signs in with his own password, approves every expense and payment,
// and is the only one who sees the stats and the activity log. His password is kept as a slow scrypt hash with its salt
// (any case, spaces trimmed), so this public file does not give it away; an ADMIN_PASSWORD environment variable replaces it
export const ADMIN = 'Vardan K'
const ADMIN_SALT = 'be25e6483c2dea7ec3eeb272584fb057'
const ADMIN_HASH = 'ffdfa26b7f577853bf1a698fa90c6d48c45fb73033bd33e86e709b8bd09c84d8'
const SCRYPT = { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 }
const slowHash = (k) => new Promise((ok, no) => scrypt(String(k).trim().toLowerCase(), ADMIN_SALT, 32, SCRYPT, (e, key) => (e ? no(e) : ok(key))))
const adminSeen = new Map() // a password tried (its SHA-256) → right or not: the slow hash once per server start
const ADMIN_TRIES = 10 // different wrong admin passwords one IP may try in an hour (the same one again does not count)
// the admin's password: a password not tried yet on this server costs the slow hash, so one IP gets ADMIN_TRIES new
// wrong ones an hour, counted before the hash runs; limited: true once they are used up
async function adminKeyOk(db, request, k) {
  if (!k) return { ok: false }
  if (process.env.ADMIN_PASSWORD) return { ok: sha(k) === sha(process.env.ADMIN_PASSWORD) }
  const h = sha(k)
  if (adminSeen.has(h)) return { ok: adminSeen.get(h) }
  const rate = 'guide:adminfail:' + (ipOf(request) || 'x')
  if (db && Number((await redis(db, ['GET', rate])) || 0) >= ADMIN_TRIES) return { ok: false, limited: true }
  const ok = timingSafeEqual(await slowHash(k), Buffer.from(ADMIN_HASH, 'hex'))
  if (adminSeen.size > 200) adminSeen.clear()
  adminSeen.set(h, ok)
  if (!ok && db) { await redis(db, ['SET', rate, 0, 'EX', 3600, 'NX']); await redis(db, ['INCR', rate]) }
  return { ok }
}
const header = (request, k) => request?.headers?.get?.(k) || ''
// the caller's IP: the header Vercel sets itself first (it replaces any X-Forwarded-For a client sends)
const ipOf = (request) => (header(request, 'x-vercel-forwarded-for') || header(request, 'x-real-ip') || header(request, 'x-forwarded-for')).split(',')[0].trim().slice(0, 64)
const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }
// one of the group, from a name as typed or an old alias; '' for anyone else
const personOf = (n) => { const s = cleanName(n); return aliasOf(s) || PEOPLE.find((p) => p.toLowerCase() === s.toLowerCase()) || '' }
// who is calling: the name signed in on the phone (X-Guide-Name; older pages send it only in the body) and the password.
// Vardan K only with his own password, the others with the group's; name is '' for a name outside the group (an older page).
// A header name outside the group does not hide the body's name: whoever the request would act as is the one checked
async function authOf(db, request, bodyName) {
  const k = header(request, 'x-guide-key'), h = header(request, 'x-guide-name')
  const name = personOf(h ? decode(h) : '') || personOf(bodyName)
  if (name === ADMIN) { const a = await adminKeyOk(db, request, k); return { ok: a.ok, name, admin: a.ok, limited: !!a.limited } }
  return { ok: groupKeyOk(k), name, admin: false }
}
const KEY = 'guide:votes' // one Redis hash: field "<item>\u001f<name in lower case>", value { v, n, t }
const HIDDEN = 'guide:hidden' // one Redis hash: field "ht:<id>", value { n, t } (who hid it, when)
const SAVED = 'guide:saved' // one Redis hash: field "<item>", value { n, t } (who saved it for the group, when)
const MAX_SAVED = 500
const META = 'guide:meta' // one Redis hash: field "pins", value { map: { id: position }, n, t } (who moved last); "order" (old)
const VILLA = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_ORDER = 300
const NOTES = 'guide:notes' // one Redis hash: field "<note id>", value { item, text, n, t }
const NOTE_ITEM = /^(all|ht:[a-z0-9][a-z0-9-]{0,80})$/
const MAX_NOTES = 2000
const NOTE_LEN = 500
const SPEND = 'guide:spend' // one Redis hash: field "<expense id>", value { what, amount, cur, paid, split, date, cat, rate, shares, amounts, kind, n, t, en, et, ok, got, no }
const MAX_SPEND = 2000
// the group, for the Spend tab (the same list as TRIP.people in tools/trip.mjs; votes-test checks they match)
export const PEOPLE = ['Vardan K', 'Artash', 'Hovo', 'Vahik', 'Vardan H', 'Mes', 'Armen', 'Lara']
// the names some of them used before the sign-in (TRIP.aliases in tools/trip.mjs): a name sent as one of these is saved
// as the group's name, and the votes, notes and saves made under them were renamed once (renameOld)
export const ALIASES = { Virt: 'Vardan H', Vardan: 'Vardan K', Arshak: 'Artash' }
const aliasOf = (n) => { const a = Object.keys(ALIASES).find((k) => k.toLowerCase() === String(n || '').trim().toLowerCase()); return a ? ALIASES[a] : '' }
const CURRENCIES = new Set(['THB', 'AMD', 'USD', 'AED'])
const RATE_BAND = { AMD: [0.01, 1], USD: [5, 200], AED: [1, 50] } // baht for 1 unit: far outside is a typo
const NEW_ID = /^[a-z0-9]{8,24}$/
export const SPEND_CATS = ['food', 'drinks', 'groceries', 'transport', 'activities', 'stay', 'shopping', 'other']
const VER = 'guide:ver' // a number, +1 on every shared change (phones poll it to know when to reload)
const LOG = 'guide:log' // a list, newest first: { t, e, x, n, d } (when, what, on which item, name, device)
const LOG_MAX = 5000
// the activity log for the admin: every request, newest first: { t, e, x, n, v (the name was signed in), d, s (the answer's
// status), ip, ua, c, r, ci, la, lo, tz (country, region, city, coordinates, time zone), lang, ref, info (the screen and so on) }
const AUDIT = 'guide:audit'
const AUDIT_MAX = 20000
const VISITORS = 'guide:visitors' // one Redis hash: field "<device>", value { n, first, last, visits, ua }
const MAX_VISITORS = 2000
const IDLE_DAYS = 14 // a full visitor list only makes room from phones not seen for this long
const NEW_PER_HOUR = 20 // new phone ids one connection may add in an hour
const DEVICE = /^[a-z0-9]{8,32}$/
const phoneKind = (ua) => (/iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device')
const TRACKED = new Set(['visit', 'view', 'card', 'map', 'share', 'photos', 'tap', 'link', 'search']) // actions the page reports
const SHARED = new Set(['like', 'skip', 'unvote', 'hide', 'show', 'move', 'reset', 'note', 'unnote', 'save', 'unsave', 'spend', 'pay', 'respend', 'repay', 'unspend', 'unpay', 'got', 'approve', 'reject']) // shared changes
const SEP = '\u001f'
const ITEM = /^(ht|ev|pl):[a-z0-9][a-z0-9-]{0,80}$/
const MAX_VOTES = 20000
const MAX_HIDDEN = 200 // far more than the villas on the list

// Vercel names the variables after the prefix chosen when the database was connected (KV_ by default)
export function storage() {
  const env = process.env
  const pairs = [['KV_REST_API_URL', 'KV_REST_API_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']]
  for (const k of Object.keys(env).sort()) if (k.endsWith('_REST_API_URL')) pairs.push([k, k.slice(0, -4) + '_TOKEN'])
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u].replace(/\/$/, ''), token: env[t] }
  // or only the connection string, rediss://default:<token>@<name>.upstash.io:6379 (Upstash's REST token is the password)
  for (const k of Object.keys(env).sort()) {
    const m = /^rediss?:\/\/[^:]*:([^@]+)@([^:/]+\.upstash\.io)/.exec(k.endsWith('_URL') ? env[k] || '' : '')
    if (m) return { url: 'https://' + m[2], token: decodeURIComponent(m[1]) }
  }
  return null
}
async function redis(db, command) {
  const res = await fetch(db.url, { method: 'POST', headers: { Authorization: 'Bearer ' + db.token, 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out.error) throw new Error('storage: ' + (out.error || res.status))
  return out.result
}
async function allVotes(db) {
  const flat = (await redis(db, ['HGETALL', KEY])) || []
  const rows = []
  for (let i = 0; i < flat.length; i += 2) {
    const item = flat[i].split(SEP)[0]
    try { const x = JSON.parse(flat[i + 1]); if (x && (x.v === 'like' || x.v === 'skip')) rows.push({ item, ...x }) } catch { /* skip a broken row */ }
  }
  rows.sort((a, b) => a.t - b.t) // names in the order people voted
  const votes = {}
  for (const r of rows) {
    const it = (votes[r.item] ||= { like: [], skip: [], last: 0 })
    it[r.v].push(r.n)
    if (r.v === 'like') it.last = Math.max(it.last, r.t || 0)
  }
  return votes
}
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Guide-Key, X-Guide-Name, X-Guide-Device' }
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS })
async function hiddenVillas(db) {
  const flat = (await redis(db, ['HGETALL', HIDDEN])) || []
  const hidden = {}
  for (let i = 0; i < flat.length; i += 2) { try { const x = JSON.parse(flat[i + 1]); hidden[flat[i]] = { by: x.n, t: x.t } } catch { /* skip a broken row */ } }
  return hidden
}
// the expenses, newest day first (then the newest added)
async function allSpend(db) {
  const flat = (await redis(db, ['HGETALL', SPEND])) || []
  const out = []
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const x = JSON.parse(flat[i + 1])
      out.push({ id: flat[i], what: x.what, amount: x.amount, cur: x.cur, paid: x.paid, split: x.split, date: x.date, by: x.n, t: x.t,
        ...(x.cat ? { cat: x.cat } : {}), ...(x.rate ? { rate: x.rate } : {}), ...(x.shares ? { shares: x.shares } : {}), ...(x.amounts ? { amounts: x.amounts } : {}),
        ...(x.kind ? { kind: x.kind } : {}), ...(x.en ? { editedBy: x.en, editedT: x.et } : {}),
        ...Object.fromEntries(['ok', 'got', 'no'].filter((k) => x[k] && x[k].n).map((k) => [k, { by: x[k].n, t: x[k].t }])) })
    } catch { /* skip a broken row */ }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.t - a.t)
}
const spendLabel = (x) => `${x.kind === 'pay' ? `${x.paid} paid ${(x.split || [])[0] || ''}` : x.what || 'an expense'} · ${Number(x.amount || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(x.amount)) ? 0 : 2, maximumFractionDigits: 2 })} ${x.cur || ''}`.trim()
// a saved row without who and when (and the approvals), to compare with what a phone sends again
const spendBody = ({ n, t, en, et, ok, got, no, ...row }) => row
// an uneven split: { name: number } for exactly the people in split, each at most 2 decimals; null when it is not one
function splitMap(m, split, max) {
  if (m == null) return null
  if (typeof m !== 'object' || Array.isArray(m)) return false
  const keys = Object.keys(m)
  if (keys.length !== split.length || !split.every((p) => Object.hasOwn(m, p))) return false
  const out = {}
  for (const p of split) {
    const v = typeof m[p] === 'number' ? m[p] : NaN
    if (!Number.isFinite(v) || v <= 0 || v > max || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return false
    out[p] = Math.round(v * 100) / 100
  }
  return out
}
async function savedItems(db) {
  const flat = (await redis(db, ['HGETALL', SAVED])) || []
  const saved = {}
  for (let i = 0; i < flat.length; i += 2) { try { const x = JSON.parse(flat[i + 1]); saved[flat[i]] = { by: x.n, t: x.t } } catch { /* skip a broken row */ } }
  return saved
}
async function meta(db) {
  const flat = (await redis(db, ['HGETALL', META])) || []
  const out = { order: null, pins: null }
  for (let i = 0; i < flat.length; i += 2) {
    try {
      const x = JSON.parse(flat[i + 1])
      if (flat[i] === 'order') out.order = { ids: x.ids, by: x.n, t: x.t }
      if (flat[i] === 'pins') out.pins = { map: x.map || {}, by: x.n, t: x.t }
    } catch { /* broken */ }
  }
  return out
}
async function allNotes(db) {
  const flat = (await redis(db, ['HGETALL', NOTES])) || []
  const rows = []
  for (let i = 0; i < flat.length; i += 2) { try { const x = JSON.parse(flat[i + 1]); rows.push({ id: flat[i], item: x.item, text: x.text, by: x.n, t: x.t }) } catch { /* broken */ } }
  rows.sort((a, b) => a.t - b.t) // oldest first, like a chat
  const notes = {}
  for (const r of rows) (notes[r.item] ||= []).push({ id: r.id, text: r.text, by: r.by, t: r.t })
  return notes
}
async function logRows(db, n) {
  return ((await redis(db, ['LRANGE', LOG, 0, n - 1])) || []).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean)
}
const version = async (db) => Number((await redis(db, ['GET', VER])) || 0)
const everything = async (db) => ({
  votes: await allVotes(db), hidden: await hiddenVillas(db), saved: await savedItems(db), ...(await meta(db)), notes: await allNotes(db), spend: await allSpend(db),
  ver: await version(db), recent: (await logRows(db, 60)).filter((x) => SHARED.has(x.e)).slice(0, 30),
})
async function logPush(db, rows) {
  if (!rows.length) return
  await redis(db, ['LPUSH', LOG, ...rows.map((r) => JSON.stringify(r))])
  await redis(db, ['LTRIM', LOG, 0, LOG_MAX - 1])
}
// a shared change: in the activity log, and the version goes up so every phone reloads
async function changed(db, e, x, name, device) {
  await logPush(db, [{ t: Date.now(), e, x: String(x || '').slice(0, 100), n: name, d: DEVICE.test(device || '') ? device : '' }])
  await redis(db, ['INCR', VER])
}
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
const NO_DB = () => reply(503, { error: 'Voting is not set up: connect an Upstash Redis database to the Vercel project.' })
const NO_KEY = () => reply(401, { error: 'Wrong password' })
// once: votes, notes, saves, hidden villas and the villa moves made under an alias go to the group's name (a vote that
// person already made under that name wins). Marked done in guide:meta, and checked once per server start
const RENAMED = 'aliasesRenamed'
let renamed = false
async function renameOld(db) {
  if (renamed) return
  if (await redis(db, ['HGET', META, RENAMED])) { renamed = true; return }
  const cmds = []
  const flat = (await redis(db, ['HGETALL', KEY])) || []
  const fields = new Set(flat.filter((_, i) => i % 2 === 0))
  for (let i = 0; i < flat.length; i += 2) {
    const [item, n] = flat[i].split(SEP), p = aliasOf(n)
    if (!p) continue
    const to = item + SEP + p.toLowerCase()
    try { if (!fields.has(to)) cmds.push(['HSET', KEY, to, JSON.stringify({ ...JSON.parse(flat[i + 1]), n: p })]) } catch { /* a broken row: dropped */ }
    cmds.push(['HDEL', KEY, flat[i]])
  }
  for (const H of [NOTES, SAVED, HIDDEN, META]) {
    const f = (await redis(db, ['HGETALL', H])) || []
    for (let i = 0; i < f.length; i += 2) {
      try { const v = JSON.parse(f[i + 1]), p = v && aliasOf(v.n); if (p) cmds.push(['HSET', H, f[i], JSON.stringify({ ...v, n: p })]) } catch { /* not a row with a name */ }
    }
  }
  await Promise.all(cmds.map((c) => redis(db, c)))
  await redis(db, ['HSET', META, RENAMED, String(Date.now())])
  renamed = true
}
// once (the user, 23 Oct 2026: "everything was marked as paid. reset that. nobody actually paid"): every payment is
// deleted; the expenses saved before approvals existed have none, so they wait for the admin
const PAYS_RESET = 'paysReset'
let paysReset = false
async function resetPays(db) {
  if (paysReset) return
  if (await redis(db, ['HGET', META, PAYS_RESET])) { paysReset = true; return }
  const flat = (await redis(db, ['HGETALL', SPEND])) || []
  const drop = []
  for (let i = 0; i < flat.length; i += 2) { try { if (JSON.parse(flat[i + 1]).kind === 'pay') drop.push(flat[i]) } catch { /* a broken row stays */ } }
  if (drop.length) await redis(db, ['HDEL', SPEND, ...drop])
  await redis(db, ['HSET', META, PAYS_RESET, JSON.stringify({ t: Date.now(), deleted: drop.length })])
  if (drop.length) await changed(db, 'reset-pays', drop.length + ' payments', ADMIN, '')
  paysReset = true
}
const once = async (db) => { await renameOld(db); await resetPays(db) }

// where a request came from, from the headers Vercel adds: the IP, the place (country, region, city, coordinates, time
// zone), the browser, the languages and the page it came from (empty fields left out)
function clientOf(request) {
  const h = (k) => header(request, k)
  const out = { ip: ipOf(request), ua: h('user-agent').slice(0, 300), c: h('x-vercel-ip-country').slice(0, 4), r: h('x-vercel-ip-country-region').slice(0, 8),
    ci: decode(h('x-vercel-ip-city')).slice(0, 60), la: h('x-vercel-ip-latitude').slice(0, 12), lo: h('x-vercel-ip-longitude').slice(0, 12), tz: h('x-vercel-ip-timezone').slice(0, 40), lang: h('accept-language').slice(0, 40), ref: h('referer').slice(0, 160) }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}
// rows for the activity log, with where the request came from; the log never breaks a request
async function audit(db, request, rows) {
  if (!rows.length) return
  const base = { t: Date.now(), ...clientOf(request) }
  try {
    await redis(db, ['LPUSH', AUDIT, ...rows.map((r) => JSON.stringify({ ...base, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null)) }))])
    await redis(db, ['LTRIM', AUDIT, 0, AUDIT_MAX - 1])
  } catch { /* storage trouble: the request itself still answers */ }
}
// what the page says about the phone (sent with its visits): a few short values only
const INFO = ['sw', 'sh', 'dpr', 'vw', 'vh', 'tz', 'lang', 'langs', 'plat', 'mob', 'touch', 'pwa', 'mem', 'cores', 'conn', 'theme']
const infoOf = (o) => (o && typeof o === 'object' ? Object.fromEntries(INFO.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, typeof o[k] === 'number' || typeof o[k] === 'boolean' ? o[k] : String(o[k]).slice(0, 80)])) : null)
// what a POST does, for the log: the action and its item
function actionOf(b) {
  if (!b || typeof b !== 'object') return ['bad', '']
  if (b.spend) { const s = b.spend; return [(s.id ? 're' : '') + (s.kind === 'pay' ? 'pay' : 'spend'), s.kind === 'pay' || s.what ? spendLabel({ kind: s.kind, paid: s.paid, split: s.split, what: s.what, amount: s.amount, cur: s.cur }) : ''] }
  if (b.deleteSpend) return ['unspend', String(b.deleteSpend)]
  if (b.confirm) return ['confirm', String(b.confirm)]
  if (b.reject) return ['reject', String(b.reject)]
  if (b.note) return ['note', String(b.note.item || '') + ': ' + String(b.note.text || '').slice(0, 80)]
  if (b.deleteNote) return ['unnote', String(b.deleteNote)]
  if (b.pins) return ['move', Object.keys(b.pins).join(', ')]
  if (Array.isArray(b.order)) return ['order', '']
  if ('save' in b) return [b.save ? 'save' : 'unsave', String(b.item || '')]
  if ('hide' in b) return [b.hide ? 'hide' : 'show', String(b.item || '')]
  return [b.vote || 'unvote', String(b.item || '')]
}

export async function GET(request) {
  const db = storage()
  if (!db) return NO_DB()
  const q = new URL(request?.url || 'http://x/').searchParams
  let auth
  try { auth = await authOf(db, request, '') } catch (e) { return reply(502, { error: e.message }) }
  const dev = DEVICE.test(header(request, 'x-guide-device')) ? header(request, 'x-guide-device') : ''
  const tried = auth.name || cleanName(decode(header(request, 'x-guide-name'))).slice(0, 40)
  if (!auth.ok) {
    // failed sign-ins go in the log (at most 30 an hour from one IP); other refused calls once an hour per IP (an old
    // page keeps asking)
    try {
      const ip = ipOf(request) || 'x'
      let log = false
      if (q.has('auth')) { await redis(db, ['SET', 'guide:signinfail:' + ip, 0, 'EX', 3600, 'NX']); log = (await redis(db, ['INCR', 'guide:signinfail:' + ip])) <= 30 }
      else log = !!(await redis(db, ['SET', 'guide:denied:' + ip, 1, 'EX', 3600, 'NX']))
      if (log) await audit(db, request, [{ e: q.has('auth') ? 'signin-fail' : 'denied', x: auth.limited ? 'too many tries' : '', n: tried, d: dev, s: auth.limited ? 429 : 401 }])
    } catch { /* storage trouble: still refused */ }
    return auth.limited ? reply(429, { error: 'Too many wrong passwords from here. Try again in an hour.' }) : NO_KEY()
  }
  if (q.has('auth')) { await audit(db, request, [{ e: 'signin', n: auth.name, v: 1, d: dev, s: 200 }]); return reply(200, { ok: true, name: auth.name, admin: auth.admin }) }
  try {
    await once(db)
    if ((q.has('stats') || q.has('audit')) && !auth.admin) { await audit(db, request, [{ e: 'denied', x: q.has('audit') ? 'log' : 'stats', n: auth.name, v: auth.name ? 1 : 0, d: dev, s: 403 }]); return reply(403, { error: 'Only ' + ADMIN + ' can see this' }) }
    if (q.has('audit')) {
      // the activity log, newest first, a page at a time; the phones (with their full browser string) on the first page
      const from = Math.max(0, Math.floor(Number(q.get('from')) || 0)), n = Math.min(2000, Math.max(1, Math.floor(Number(q.get('n')) || 500)))
      const rows = ((await redis(db, ['LRANGE', AUDIT, from, from + n - 1])) || []).map((x) => { try { return JSON.parse(x) } catch { return null } }).filter(Boolean)
      const out = { audit: rows, from, total: Number(await redis(db, ['LLEN', AUDIT])) || 0 }
      if (!from) {
        const flat = (await redis(db, ['HGETALL', VISITORS])) || []
        out.visitors = {}
        for (let i = 0; i < flat.length; i += 2) { try { out.visitors[flat[i]] = JSON.parse(flat[i + 1]) } catch { /* broken */ } }
      }
      return reply(200, out)
    }
    if (q.has('stats')) {
      const flat = (await redis(db, ['HGETALL', VISITORS])) || []
      const visitors = {}
      // the phone type only, not the whole browser string
      for (let i = 0; i < flat.length; i += 2) { try { const { ua, ...v } = JSON.parse(flat[i + 1]); visitors[flat[i]] = { ...v, kind: phoneKind(ua || '') } } catch { /* broken */ } }
      return reply(200, { visitors, log: await logRows(db, 2000), ver: await version(db) })
    }
    if (q.has('ver')) { const v = await version(db); if (String(v) === q.get('ver')) return reply(200, { ver: v, same: true }) }
    else await audit(db, request, [{ e: 'open', n: auth.name, v: auth.name ? 1 : 0, d: dev, s: 200 }]) // a page's first load
    return reply(200, { ...(await everything(db)), you: { name: auth.name, admin: auth.admin } })
  } catch (e) { return reply(502, { error: e.message }) }
}

export async function POST(request) {
  const db = storage()
  if (!db) return NO_DB()
  let body
  try { body = await request.json() } catch { return reply(400, { error: 'Send JSON: { item, name, vote }' }) }
  let auth
  try { auth = await authOf(db, request, body?.name) } catch (e) { return reply(502, { error: e.message }) }
  const ctx = {} // what the handler found out for the log (the row a confirm or delete was about)
  const res = await handle(db, request, body, auth, ctx)
  // every request in the activity log (the visits log their own rows, with the phone's details)
  if (!(body && Array.isArray(body.track))) {
    const [e, x] = actionOf(body), dev = String(body?.device || header(request, 'x-guide-device') || '')
    await audit(db, request, [{ e, x: ctx.x || x, n: auth.ok && auth.name ? auth.name : cleanName(body?.name).slice(0, 40), v: auth.ok && auth.name ? 1 : 0, d: DEVICE.test(dev) ? dev : '', s: res.status }])
  }
  return res
}

async function handle(db, request, body, auth, ctx) {
  // visits and actions for the Stats page (not a shared change: no new version)
  if (body && Array.isArray(body.track)) {
    const device = String(body.device || '')
    const rows = body.track.slice(0, 31)
    if (!DEVICE.test(device) || !rows.length || body.track.length > 30 || !rows.every((r) => r && TRACKED.has(r.e))) return reply(400, { error: 'Send { device, track: [{ e, x }] }' })
    const who = cleanName(body.name).slice(0, 40)
    const now = Date.now()
    try {
      const raw = await redis(db, ['HGET', VISITORS, device])
      let v = null
      try { v = raw ? JSON.parse(raw) : null } catch { v = null }
      if (!v) {
        // a new phone: at most NEW_PER_HOUR from one connection, so nobody can flood the list with made-up ids
        const ip = ipOf(request) || 'unknown'
        const rate = 'guide:newdev:' + ip
        await redis(db, ['SET', rate, 0, 'EX', 3600, 'NX']) // the counter and its 1-hour expiry in one step
        const n = await redis(db, ['INCR', rate])
        if (n > NEW_PER_HOUR) return reply(429, { error: 'Too many new phones from here, try later' })
        if ((await redis(db, ['HLEN', VISITORS])) >= MAX_VISITORS) {
          // full: make room only from phones idle for IDLE_DAYS or more; recent visitors are never pushed out
          const all = (await redis(db, ['HGETALL', VISITORS])) || []
          const idle = now - IDLE_DAYS * 86400000, seen = []
          for (let i = 0; i < all.length; i += 2) { let t = 0; try { t = JSON.parse(all[i + 1]).last || 0 } catch { /* broken: counts as idle */ } seen.push([all[i], t]) }
          const drop = seen.filter(([, t]) => t < idle).sort((a, b) => a[1] - b[1]).slice(0, seen.length - MAX_VISITORS + 1).map(([d]) => d)
          if (seen.length - drop.length >= MAX_VISITORS) return reply(507, { error: 'Too many visitors saved' })
          await redis(db, ['HDEL', VISITORS, ...drop])
        }
      }
      v = v || { first: now, visits: 0 }
      v.last = now
      v.visits += rows.filter((r) => r.e === 'visit').length
      // the name signed in on that phone (its password sent along: a beacon cannot send headers), or the name it gave
      const ta = await authOf(db, { headers: new Headers({ 'x-guide-key': String(body.key || '').slice(0, 100), 'x-guide-name': encodeURIComponent(String(body.name || '').slice(0, 40)), 'x-real-ip': ipOf(request) }) }, '')
      const signed = ta.ok && ta.name ? ta.name : ''
      if (signed || who) v.n = signed || who
      if (signed) v.names = [...new Set([...(Array.isArray(v.names) ? v.names : []), signed])].slice(-8)
      const where = clientOf(request), info = infoOf(body.info)
      v.ua = where.ua || ''
      v.ip = where.ip || ''
      v.place = [where.ci, where.r, where.c].filter(Boolean).join(', ')
      if (info) v.info = info
      await redis(db, ['HSET', VISITORS, device, JSON.stringify(v)])
      const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100)
      await logPush(db, rows.map((r) => ({ t: now, e: r.e, x: clean(r.x), n: v.n || '', d: device })))
      await audit(db, request, rows.map((r) => ({ e: r.e, x: clean(r.x), n: signed || who, v: signed ? 1 : 0, d: device, ...(r.e === 'visit' && info ? { info } : {}) })))
      return reply(200, { ok: true })
    } catch (e) { return reply(502, { error: e.message }) }
  }
  if (!auth.ok) return auth.limited ? reply(429, { error: 'Too many wrong passwords from here. Try again in an hour.' }) : NO_KEY()
  // the signed-in name is the name for everything (an older page: the name in the body, an old alias mapped)
  if (body && auth.name) body.name = auth.name
  else if (body && aliasOf(body.name)) body.name = aliasOf(body.name)
  try { await once(db) } catch (e) { return reply(502, { error: e.message }) }
  // Spending: add an expense or a payment (with who added it), change one, delete one, or confirm or reject one. A payment
  // is added only by who paid it; an expense by anyone. Who added it, who paid it and the admin may change or delete it.
  // An expense counts once the admin approved it (ok), a payment once its receiver (got) and the admin did; a change by
  // anyone but the admin sends it back to waiting. The row keeps who added it and who changed it last
  if (body && (body.spend || body.deleteSpend || body.confirm || body.reject)) {
    const who = cleanName(body.name)
    if (!who || who.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
    const admin = !!auth.admin, same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()
    const mayChange = (x) => admin || same(x.paid, who) || (x.kind !== 'pay' && same(x.n, who))
    const onlyWho = (x) => 'Only ' + [...new Set([...(x.kind !== 'pay' && x.n ? [x.n] : []), x.paid, ADMIN].filter(Boolean))].join(', ').replace(/, ([^,]*)$/, ' or $1')
    const mark = () => ({ n: who, t: Date.now() })
    try {
      if (body.confirm || body.reject) {
        const id = String(body.confirm || body.reject).slice(0, 40)
        const raw = await redis(db, ['HGET', SPEND, id])
        if (!raw) return reply(404, { error: 'Someone deleted it' })
        let x = {}
        try { x = JSON.parse(raw) } catch { return reply(404, { error: 'Someone deleted it' }) }
        ctx.x = spendLabel(x)
        const pay = x.kind === 'pay', to = pay ? (x.split || [])[0] : '', receiver = pay && same(to, who)
        if (!admin && !receiver) return reply(403, { error: pay ? 'Only ' + to + ' or ' + ADMIN + ' can confirm this payment' : 'Only ' + ADMIN + ' can approve expenses' })
        if (body.confirm) {
          if (receiver) x.got = mark()
          if (admin) x.ok = mark()
          delete x.no
        } else { x.no = mark(); delete x.ok; delete x.got }
        await redis(db, ['HSET', SPEND, id, JSON.stringify(x)])
        await changed(db, body.reject ? 'reject' : admin ? 'approve' : 'got', spendLabel(x), who, body.device)
        return reply(200, await everything(db))
      }
      if (body.deleteSpend) {
        const id = String(body.deleteSpend).slice(0, 40)
        const raw = await redis(db, ['HGET', SPEND, id])
        if (!raw) return reply(404, { error: 'Someone deleted it' })
        let x = {}
        try { x = JSON.parse(raw) } catch { /* a broken row: anyone may clear it */ }
        ctx.x = spendLabel(x)
        if (x.paid && !mayChange(x)) return reply(403, { error: onlyWho(x) + ' can delete this' })
        await redis(db, ['HDEL', SPEND, id])
        await changed(db, x.kind === 'pay' ? 'unpay' : 'unspend', spendLabel(x), who, body.device)
        return reply(200, await everything(db))
      }
      const s = body.spend || {}
      const pay = s.kind === 'pay'
      const what = String(s.what ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
      const amount = typeof s.amount === 'number' ? Math.round(s.amount * 100) / 100 : NaN
      const cur = String(s.cur || ''), paid = String(s.paid || ''), date = String(s.date || '')
      const split = Array.isArray(s.split) ? s.split.map(String) : []
      const people = PEOPLE.filter((p) => split.includes(p)) // each once, in the group's order
      if (s.kind != null && !pay) return reply(400, { error: 'An expense or a payment, please' })
      if (what.length > 80 || (!what && !pay)) return reply(400, { error: 'Say what it was, in 1 to 80 characters' })
      if (!(amount > 0 && amount <= 100000000)) return reply(400, { error: 'An amount above 0, please' })
      if (!CURRENCIES.has(cur)) return reply(400, { error: 'Baht, drams, dollars or dirhams, please' })
      if (!PEOPLE.includes(paid)) return reply(400, { error: 'Who paid? One of the group, please' })
      if (!split.length || !split.every((p) => PEOPLE.includes(p))) return reply(400, { error: 'Split it between people of the group' })
      if (pay && (people.length !== 1 || people[0] === paid)) return reply(400, { error: 'A payment goes from one person to another' })
      const day = new Date(date + 'T00:00:00Z') // a real day: not 2027-02-30
      if (!/^20\d\d-\d\d-\d\d$/.test(date) || isNaN(day) || day.toISOString().slice(0, 10) !== date) return reply(400, { error: 'A date, please' })
      const cat = s.cat == null || s.cat === '' ? '' : String(s.cat)
      if (cat && (pay || !SPEND_CATS.includes(cat))) return reply(400, { error: 'Unknown category' })
      // the rate when it was added (baht for 1 unit): a later rate update does not move balances that were settled
      const rate = cur === 'THB' || s.rate == null ? 0 : typeof s.rate === 'number' ? s.rate : NaN
      if (rate !== 0 && !(rate >= RATE_BAND[cur][0] && rate <= RATE_BAND[cur][1])) return reply(400, { error: 'That rate looks wrong' })
      if (s.newId != null && !NEW_ID.test(String(s.newId))) return reply(400, { error: 'A bad id' })
      // an uneven split: weights (shares) or exact amounts in the expense's currency, for exactly the people in it
      const shares = splitMap(s.shares, people, 100), amounts = splitMap(s.amounts, people, amount)
      if (shares === false || amounts === false || (shares && amounts) || (pay && (shares || amounts))) return reply(400, { error: 'Shares or amounts above 0 for exactly the people in the split' })
      if (amounts && Math.round(Object.values(amounts).reduce((a, v) => a + v, 0) * 100) !== Math.round(amount * 100)) return reply(400, { error: 'The amounts must add up to the total' })
      if (pay && !admin && !same(paid, who)) return reply(403, { error: 'You can only add a payment you made' })
      const row = { what, amount, cur, paid, split: people, date, ...(cat ? { cat } : {}), ...(rate ? { rate } : {}), ...(shares && new Set(Object.values(shares)).size > 1 ? { shares } : {}), ...(amounts ? { amounts } : {}), ...(pay ? { kind: 'pay' } : {}) }
      // the approvals a saved row gets: the admin's own approval, and his "got it" when a payment is to him; anyone
      // else's save waits for them
      const marks = () => (admin ? { ok: mark(), ...(pay && people[0] === ADMIN ? { got: mark() } : {}) } : {})
      let id = ''
      if (s.id) {
        id = String(s.id).slice(0, 40)
        const raw = await redis(db, ['HGET', SPEND, id])
        if (!raw) return reply(404, { error: 'Someone deleted it' })
        let old = {}
        try { old = JSON.parse(raw) } catch { /* a broken row */ }
        if (old.paid && !mayChange(old)) return reply(403, { error: onlyWho(old) + ' can change this' })
        await redis(db, ['HSET', SPEND, id, JSON.stringify({ ...row, n: old.n || who, t: old.t || Date.now(), en: who, et: Date.now(), ...marks() })])
        await changed(db, pay ? 'repay' : 'respend', spendLabel(row), who, body.device)
      } else {
        // newId: made on the phone, so the same expense sent twice (a retry, or a phone that saved it offline and lost
        // the answer) is added once; sent again with other content (changed on that phone meanwhile), it is a change
        id = s.newId ? String(s.newId) : Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        if ((await redis(db, ['HLEN', SPEND])) >= MAX_SPEND) return reply(507, { error: 'Too many expenses saved' })
        // keep: Undo after a delete puts it back as it was, with who added (and changed) it and when
        const k = body.keep && typeof body.keep === 'object' ? body.keep : {}, past = (t) => Number.isFinite(t) && t > 0 && t <= Date.now()
        const by = cleanName(k.by).slice(0, 40), eb = cleanName(k.editedBy).slice(0, 40)
        const meta = { n: by || who, t: by && past(k.t) ? k.t : Date.now(), ...(by && eb && past(k.editedT) ? { en: eb, et: k.editedT } : {}), ...marks() }
        if (await redis(db, ['HSETNX', SPEND, id, JSON.stringify({ ...row, ...meta })])) await changed(db, pay ? 'pay' : 'spend', spendLabel(row), who, body.device)
        else {
          let old = {}
          try { old = JSON.parse((await redis(db, ['HGET', SPEND, id])) || '{}') } catch { /* a broken row */ }
          if (JSON.stringify(spendBody(old)) !== JSON.stringify(row)) {
            if (old.paid && !mayChange(old)) return reply(403, { error: onlyWho(old) + ' can change this' })
            await redis(db, ['HSET', SPEND, id, JSON.stringify({ ...row, n: old.n || who, t: old.t || Date.now(), en: who, et: Date.now(), ...marks() })])
            await changed(db, pay ? 'repay' : 'respend', spendLabel(row), who, body.device)
          }
        }
      }
      return reply(200, { ...(await everything(db)), id }) // id: the expense saved (Undo deletes it)
    } catch (e) { return reply(502, { error: e.message }) }
  }
  // shared notes: add one (with the author's name), or delete one by its id
  if (body && (body.note || body.deleteNote)) {
    const who = cleanName(body.name)
    if (!who || who.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
    try {
      if (body.deleteNote) {
        // only under the name that wrote it (names are typed, not accounts: this stops mix-ups, not a determined person)
        const id = String(body.deleteNote).slice(0, 40)
        const raw = await redis(db, ['HGET', NOTES, id])
        if (!raw) return reply(404, { error: 'That note is gone' })
        let author = ''
        try { author = String(JSON.parse(raw).n || '') } catch { /* a broken row: anyone may clear it */ }
        if (author && author.toLowerCase() !== who.toLowerCase()) return reply(403, { error: 'Only ' + author + ' can delete this note' })
        await redis(db, ['HDEL', NOTES, id])
        let noteItem = ''
        try { noteItem = String(JSON.parse(raw).item || '') } catch { /* a broken row */ }
        await changed(db, 'unnote', noteItem, who, body.device)
      } else {
        const item = String(body.note.item || '')
        // keep line breaks, drop other control characters
        const text = String(body.note.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()
        if (!NOTE_ITEM.test(item)) return reply(400, { error: 'Notes go on a villa or on the whole trip' })
        if (!text || text.length > NOTE_LEN) return reply(400, { error: 'A note of 1 to 500 characters, please' })
        if ((await redis(db, ['HLEN', NOTES])) >= MAX_NOTES) return reply(507, { error: 'Too many notes saved' })
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        await redis(db, ['HSET', NOTES, id, JSON.stringify({ item, text, n: who, t: Date.now() })])
        await changed(db, 'note', item, who, body.device)
      }
      return reply(200, await everything(db))
    } catch (e) { return reply(502, { error: e.message }) }
  }
  // villas moved by hand: { id: position } merged into the saved pins (null unpins); a position goes to one villa only
  if (body && body.pins && typeof body.pins === 'object' && !Array.isArray(body.pins)) {
    const who = cleanName(body.name)
    if (!who || who.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
    const changes = Object.entries(body.pins)
    if (!changes.length || changes.length > MAX_ORDER || !changes.every(([id, at]) => VILLA.test(id) && (at === null || (Number.isInteger(at) && at >= 0 && at < MAX_ORDER)))) return reply(400, { error: 'Pins are villa ids with a position (0, 1, …) or null' })
    // one villa per place, in the request too, so the saved pins can never hold more than MAX_ORDER villas
    const places = changes.map(([, at]) => at).filter((at) => at !== null)
    if (new Set(places).size !== places.length) return reply(400, { error: 'Two villas cannot have the same place' })
    try {
      const map = { ...((await meta(db)).pins?.map || {}) }
      for (const [id, at] of changes) {
        delete map[id]
        if (at === null) continue
        for (const [other, p] of Object.entries(map)) if (p === at) delete map[other]
        map[id] = at
      }
      if (Object.keys(map).length > MAX_ORDER) return reply(400, { error: 'Too many pinned villas' })
      await redis(db, ['HSET', META, 'pins', JSON.stringify({ map, n: who, t: Date.now() })])
      const moved = changes.filter(([, at]) => at !== null).map(([id]) => id), reset = changes.filter(([, at]) => at === null).map(([id]) => id)
      if (moved.length) await changed(db, 'move', 'ht:' + moved[0], who, body.device)
      else await changed(db, 'reset', reset.length === 1 ? 'ht:' + reset[0] : 'all', who, body.device)
      return reply(200, await everything(db))
    } catch (e) { return reply(502, { error: e.message }) }
  }
  // the old whole-list order (older copies of the page still send it)
  if (body && Array.isArray(body.order)) {
    const ids = body.order.map(String)
    const who = String(body.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
    if (!who || who.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
    if (!ids.length || ids.length > MAX_ORDER || new Set(ids).size !== ids.length || !ids.every((x) => VILLA.test(x))) return reply(400, { error: 'The order is a list of villa ids, each once' })
    try {
      await redis(db, ['HSET', META, 'order', JSON.stringify({ ids, n: who, t: Date.now() })])
      return reply(200, await everything(db))
    } catch (e) { return reply(502, { error: e.message }) }
  }
  const item = String(body?.item || '')
  // a name as typed, without control characters or extra spaces
  const name = String(body?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  const vote = body?.vote ?? null
  if (!ITEM.test(item)) return reply(400, { error: 'Unknown item' })
  if (!name || name.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
  // Saved: one list for the whole group (an event, place or villa, with who saved it); tapping the star again takes it off
  if (body && 'save' in body) {
    try {
      if (body.save) {
        if (!(await redis(db, ['HEXISTS', SAVED, item])) && (await redis(db, ['HLEN', SAVED])) >= MAX_SAVED) return reply(507, { error: 'Too many saved' })
        await redis(db, ['HSET', SAVED, item, JSON.stringify({ n: name, t: Date.now() })])
      } else await redis(db, ['HDEL', SAVED, item])
      await changed(db, body.save ? 'save' : 'unsave', item, name, body.device)
      return reply(200, await everything(db))
    } catch (e) { return reply(502, { error: e.message }) }
  }
  if (body && 'hide' in body) {
    if (!item.startsWith('ht:')) return reply(400, { error: 'Only villas can be hidden' })
    try {
      if (body.hide) {
        if ((await redis(db, ['HLEN', HIDDEN])) >= MAX_HIDDEN) return reply(507, { error: 'Too many hidden villas saved' })
        await redis(db, ['HSET', HIDDEN, item, JSON.stringify({ n: name, t: Date.now() })])
      } else await redis(db, ['HDEL', HIDDEN, item])
      await changed(db, body.hide ? 'hide' : 'show', item, name, body.device)
      return reply(200, await everything(db))
    } catch (e) { return reply(502, { error: e.message }) }
  }
  if (vote !== null && vote !== 'like' && vote !== 'skip') return reply(400, { error: 'The vote is like, skip or null' })
  const field = item + SEP + name.toLowerCase()
  try {
    if (vote === null) await redis(db, ['HDEL', KEY, field])
    else {
      if ((await redis(db, ['HLEN', KEY])) >= MAX_VOTES) return reply(507, { error: 'Too many votes saved' })
      await redis(db, ['HSET', KEY, field, JSON.stringify({ v: vote, n: name, t: Date.now() })])
    }
    await changed(db, vote || 'unvote', item, name, body.device)
    return reply(200, await everything(db))
  } catch (e) { return reply(502, { error: e.message }) }
}

export function OPTIONS() { return new Response(null, { status: 204, headers: HEADERS }) }
