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
// GET and every POST answer with { votes, hidden, pins: { map, by, t } | null, order, notes: { '<item>': [{ id, text, by, t }] } };
// each votes entry also has last: the time of its latest like.
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
const everything = async (db) => ({ votes: await allVotes(db), hidden: await hiddenVillas(db), ...(await meta(db)), notes: await allNotes(db) })
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
const NO_DB = () => reply(503, { error: 'Voting is not set up: connect an Upstash Redis database to the Vercel project.' })

export async function GET() {
  const db = storage()
  if (!db) return NO_DB()
  try { return reply(200, await everything(db)) } catch (e) { return reply(502, { error: e.message }) }
}

export async function POST(request) {
  const db = storage()
  if (!db) return NO_DB()
  let body
  try { body = await request.json() } catch { return reply(400, { error: 'Send JSON: { item, name, vote }' }) }
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
      } else {
        const item = String(body.note.item || '')
        // keep line breaks, drop other control characters
        const text = String(body.note.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim()
        if (!NOTE_ITEM.test(item)) return reply(400, { error: 'Notes go on a villa or on the whole trip' })
        if (!text || text.length > NOTE_LEN) return reply(400, { error: 'A note of 1 to 500 characters, please' })
        if ((await redis(db, ['HLEN', NOTES])) >= MAX_NOTES) return reply(507, { error: 'Too many notes saved' })
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        await redis(db, ['HSET', NOTES, id, JSON.stringify({ item, text, n: who, t: Date.now() })])
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
    try {
      const map = { ...((await meta(db)).pins?.map || {}) }
      for (const [id, at] of changes) {
        delete map[id]
        if (at === null) continue
        for (const [other, p] of Object.entries(map)) if (p === at && !(other in body.pins)) delete map[other]
        map[id] = at
      }
      await redis(db, ['HSET', META, 'pins', JSON.stringify({ map, n: who, t: Date.now() })])
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
    return reply(200, await everything(db))
  } catch (e) { return reply(502, { error: e.message }) }
}

export function OPTIONS() { return new Response(null, { status: 204, headers: HEADERS }) }
