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
//   POST /api/votes { device, name?, track: [{ e, x }] }        -> visits and actions for the Stats page
//   GET  /api/votes?ver=<n>  -> { ver, same: true } when nothing changed since version n (one cheap read), else everything
//   GET  /api/votes?stats=1  -> { visitors: { <device>: { n, first, last, visits, kind } }, log: [...] } for the Stats page;
//        with a STATS_KEY environment variable set, it also needs &key=<that key>
// GET and every POST answer with { votes, hidden, pins: { map, by, t } | null, order, notes: { '<item>': [{ id, text, by, t }] },
// ver, recent: [the latest shared changes] }; each votes entry also has last: the time of its latest like.
// One vote per name and item; names match without case ("Ani" and "ani" are the same person).
const KEY = 'guide:votes' // one Redis hash: field "<item>\u001f<name in lower case>", value { v, n, t }
const HIDDEN = 'guide:hidden' // one Redis hash: field "ht:<id>", value { n, t } (who hid it, when)
const META = 'guide:meta' // one Redis hash: field "pins", value { map: { id: position }, n, t } (who moved last); "order" (old)
const VILLA = /^[a-z0-9][a-z0-9-]{0,80}$/
const MAX_ORDER = 300
const NOTES = 'guide:notes' // one Redis hash: field "<note id>", value { item, text, n, t }
const NOTE_ITEM = /^(all|ht:[a-z0-9][a-z0-9-]{0,80})$/
const MAX_NOTES = 2000
const NOTE_LEN = 500
const VER = 'guide:ver' // a number, +1 on every shared change (phones poll it to know when to reload)
const LOG = 'guide:log' // a list, newest first: { t, e, x, n, d } (when, what, on which item, name, device)
const LOG_MAX = 5000
const VISITORS = 'guide:visitors' // one Redis hash: field "<device>", value { n, first, last, visits, ua }
const MAX_VISITORS = 2000
const IDLE_DAYS = 14 // a full visitor list only makes room from phones not seen for this long
const NEW_PER_HOUR = 20 // new phone ids one connection may add in an hour
const DEVICE = /^[a-z0-9]{8,32}$/
const phoneKind = (ua) => (/iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device')
const TRACKED = new Set(['visit', 'view', 'card', 'map', 'share', 'photos']) // actions the page reports
const SHARED = new Set(['like', 'skip', 'unvote', 'hide', 'show', 'move', 'reset', 'note', 'unnote']) // shared changes
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
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS })
async function hiddenVillas(db) {
  const flat = (await redis(db, ['HGETALL', HIDDEN])) || []
  const hidden = {}
  for (let i = 0; i < flat.length; i += 2) { try { const x = JSON.parse(flat[i + 1]); hidden[flat[i]] = { by: x.n, t: x.t } } catch { /* skip a broken row */ } }
  return hidden
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
  votes: await allVotes(db), hidden: await hiddenVillas(db), ...(await meta(db)), notes: await allNotes(db),
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

export async function GET(request) {
  const db = storage()
  if (!db) return NO_DB()
  const q = new URL(request?.url || 'http://x/').searchParams
  try {
    if (q.has('stats')) {
      const key = process.env.STATS_KEY
      if (key && q.get('key') !== key) return reply(401, { error: 'The stats need the key' })
      const flat = (await redis(db, ['HGETALL', VISITORS])) || []
      const visitors = {}
      // the phone type only, not the whole browser string
      for (let i = 0; i < flat.length; i += 2) { try { const { ua, ...v } = JSON.parse(flat[i + 1]); visitors[flat[i]] = { ...v, kind: phoneKind(ua || '') } } catch { /* broken */ } }
      return reply(200, { visitors, log: await logRows(db, 2000), ver: await version(db) })
    }
    if (q.has('ver')) { const v = await version(db); if (String(v) === q.get('ver')) return reply(200, { ver: v, same: true }) }
    return reply(200, await everything(db))
  } catch (e) { return reply(502, { error: e.message }) }
}

export async function POST(request) {
  const db = storage()
  if (!db) return NO_DB()
  let body
  try { body = await request.json() } catch { return reply(400, { error: 'Send JSON: { item, name, vote }' }) }
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
        const ip = String(request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 64)
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
      if (who) v.n = who
      v.ua = String(request.headers.get('user-agent') || '').slice(0, 160)
      await redis(db, ['HSET', VISITORS, device, JSON.stringify(v)])
      await logPush(db, rows.map((r) => ({ t: now, e: r.e, x: String(r.x || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100), n: v.n || '', d: device })))
      return reply(200, { ok: true })
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
