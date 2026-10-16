// Builds the photo-search list from raw research results (research/raw/*.json), so photo hunting can start
// while fact-checking is still running. Keys match the ids the final data will use.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = path.join(ROOT, 'research/raw')
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const load = (f) => { const p = path.join(RAW, f); return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')).items || []) : [] }
const site = (it) => (it.website && /^https?:/.test(it.website) ? it.website : ((it.links || []).find((l) => l && /^https?:/.test(l.url)) || {}).url)
const where = (it) => [it.venue, it.area, it.island].filter(Boolean).join(', ')
const out = []
const seen = new Set()
const push = (key, o) => { if (seen.has(key)) return; seen.add(key); out.push({ key, ...o }) }
for (const f of ['research_events-dated.json', 'research_events-venues.json'])
  for (const e of load(f)) push('events:' + slug(e.id || e.name), { kind: 'music event / venue', name: e.name, where: where(e), gmapsQuery: e.gmapsQuery, website: site(e), candidates: e.imageCandidates || [] })
for (const f of ['research_places-must-see.json', 'research_places-hidden-gems.json', 'research_places-daytrips-food.json'])
  for (const p of load(f)) push('places:' + slug(p.id || p.name), { kind: `${p.tier} / ${p.category}`, name: p.name, where: where(p), gmapsQuery: p.gmapsQuery, website: site(p), candidates: p.imageCandidates || [] })
for (const a of load('research_areas.json')) push('areas:' + a.id, { kind: 'area of Phuket (show its main beach or town)', name: a.name, where: a.id, gmapsQuery: a.gmapsQuery, website: site(a), candidates: a.imageCandidates || [] })
for (const h of load('research_hotels.json')) push('hotels:' + slug(h.id || h.name), { kind: `hotel (${h.tier})`, name: h.name, where: where(h), gmapsQuery: h.gmapsQuery, website: site(h), candidates: h.imageCandidates || [] })
const dest = path.join(ROOT, 'data/photo-items.json')
fs.writeFileSync(dest, JSON.stringify(out, null, 1))
const by = out.reduce((m, x) => { const k = x.key.split(':')[0]; m[k] = (m[k] || 0) + 1; return m }, {})
console.log(dest, out.length, by)
