// Shared votes for the guide: Like or Skip on a villa (ht:), event (ev:) or place (pl:), by name, and villas hidden for
// everyone; saved in Upstash Redis (connected to the Vercel project under Storage). Vercel runs this file as
// /api/votes; no packages needed.
//   GET  /api/votes  -> { votes: { 'ht:<id>': { like: ['Ani'], skip: [] }, ... }, hidden: { 'ht:<id>': { by: 'Gor', t } } }
//   POST /api/votes { item, name, vote: 'like' | 'skip' | null }  -> the same, after the change (null takes it back)
//   POST /api/votes { item: 'ht:<id>', name, hide: true | false } -> hides the villa for everyone, or shows it again
// One vote per name and item; names match without case ("Ani" and "ani" are the same person).
const KEY = 'guide:votes' // one Redis hash: field "<item>\u001f<name in lower case>", value { v, n, t }
const HIDDEN = 'guide:hidden' // one Redis hash: field "ht:<id>", value { n, t } (who hid it, when)
const SEP = '\u001f'
const ITEM = /^(ht|ev|pl):[a-z0-9][a-z0-9-]{0,80}$/
const MAX_VOTES = 20000

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
  for (const r of rows) (votes[r.item] ||= { like: [], skip: [] })[r.v].push(r.n)
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
const everything = async (db) => ({ votes: await allVotes(db), hidden: await hiddenVillas(db) })
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
  const item = String(body?.item || '')
  // a name as typed, without control characters or extra spaces
  const name = String(body?.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  const vote = body?.vote ?? null
  if (!ITEM.test(item)) return reply(400, { error: 'Unknown item' })
  if (!name || name.length > 40) return reply(400, { error: 'A name of 1 to 40 characters, please' })
  if (body && 'hide' in body) {
    if (!item.startsWith('ht:')) return reply(400, { error: 'Only villas can be hidden' })
    try {
      if (body.hide) await redis(db, ['HSET', HIDDEN, item, JSON.stringify({ n: name, t: Date.now() })])
      else await redis(db, ['HDEL', HIDDEN, item])
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
