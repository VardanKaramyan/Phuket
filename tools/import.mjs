// Imports the research workflow result into data/*.json (normalized), keeps the verification log,
// and writes the photo-search list for the image workflow.
// Usage: node tools/import.mjs <workflow-result.json>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { windowOf } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, ...a)
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const R = src.result || src

const AREA_IDS = ['patong', 'kamala', 'surin', 'bang-tao', 'layan', 'nai-thon', 'nai-yang', 'mai-khao', 'karon', 'kata', 'kata-noi', 'nai-harn', 'promthep', 'rawai', 'chalong', 'phuket-town', 'kathu', 'cape-panwa', 'ao-po', 'thalang', 'natai']
const OFF = ['phang-nga', 'khao-lak', 'krabi', 'phi-phi', 'koh-yao', 'koh-lanta', 'koh-phangan', 'koh-samui', 'koh-kaew', 'other']
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : s)
const cleanText = (o) => {
  if (Array.isArray(o)) return o.map(cleanText)
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, cleanText(v)]))
  return strip(o)
}
function normArea(a) {
  const s = slug(a)
  if (AREA_IDS.includes(s) || OFF.includes(s)) return s
  const map = { 'ko-phangan': 'koh-phangan', 'ko-pha-ngan': 'koh-phangan', phangan: 'koh-phangan', 'ko-samui': 'koh-samui', samui: 'koh-samui', 'phi-phi-islands': 'phi-phi', 'koh-phi-phi': 'phi-phi', 'old-town': 'phuket-town', 'phuket-old-town': 'phuket-town', 'bangtao': 'bang-tao', 'laguna': 'bang-tao', 'kalim': 'patong', 'ya-nui': 'promthep', 'cape-yamu': 'ao-po', 'khok-kloi': 'natai', 'khao-pilai': 'natai' }
  return map[s] || s || 'other'
}
const log = { removed: {}, changes: {}, unverified: {} }

function items(key) {
  const d = R[key]
  if (!d) { console.warn('missing domain', key); return [] }
  log.removed[key] = d.removed || []
  log.changes[key] = d.changes || []
  const list = (d.items || []).map(cleanText)
  // a fact-check batch that read a saved file and failed: fall back to the saved items for that range, marked unverified
  for (const j of d.unverifiedFiles || []) {
    const saved = JSON.parse(fs.readFileSync(j.file, 'utf8')).items || []
    saved.slice(j.from, j.to + 1).forEach((it) => list.push({ ...cleanText(it), unverified: true }))
  }
  log.unverified[key] = list.filter((x) => x.unverified).map((x) => x.id)
  return list
}

// events
const events = items('events').map((e) => {
  const dates = Array.from(new Set((e.dates || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))).sort()
  let window = e.window
  if (dates.length) window = windowOf(dates)
  return { ...e, id: slug(e.id || e.name), dates, window, area: normArea(e.area || e.island), kind: ['dated', 'recurring', 'venue'].includes(e.kind) ? e.kind : 'venue' }
})
// places
const DUR = ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening']
const places = items('places').map((p) => ({ ...p, id: slug(p.id || p.name), area: normArea(p.area), durationLabel: DUR.includes(p.durationLabel) ? p.durationLabel : 'half-day', days: (p.days || []).filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x)) }))
// areas
const areasRaw = items('areas')
const areas = AREA_IDS.map((id) => areasRaw.find((a) => a.id === id)).filter(Boolean)
// hotels
const TIERS = ['luxury', 'boutique', 'mid-range', 'budget', 'hostel']
const hotels = items('hotels').map((h) => ({ ...h, id: slug(h.id || h.name), area: normArea(h.area), tier: TIERS.includes(h.tier) ? h.tier : 'mid-range' }))
// money + essentials
const ex = R.exchanges || {}
const money = cleanText(ex.data || (ex.file ? JSON.parse(fs.readFileSync(ex.file, 'utf8')) : {}))
log.changes.exchanges = ex.changes || []; log.removed.exchanges = ex.removed || []
;(money.brands || []).forEach((b) => {
  b.id = slug(b.id || b.name)
  ;(b.branches || []).forEach((x) => { x.area = /koh kaew|ko kaeo/i.test(x.name + ' ' + (x.address || '')) ? 'koh-kaew' : normArea(x.area) })
})
const es = R.essentials || {}
const info = cleanText(es.data || (es.file ? JSON.parse(fs.readFileSync(es.file, 'utf8')) : {}))
log.changes.essentials = es.changes || []; log.removed.essentials = es.removed || []

const write = (f, o) => fs.writeFileSync(P('data', f), JSON.stringify(o, null, 1))
write('events.json', { items: events })
write('places.json', { items: places })
write('areas.json', { items: areas, recommendation: R.areas && R.areas.recommendation ? strip(R.areas.recommendation) : '' })
write('hotels.json', { items: hotels })
write('exchanges.json', money)
write('essentials.json', info)
write('research-log.json', log)

// photo search list
const site = (it) => (it.website && /^https?:/.test(it.website) ? it.website : ((it.links || []).find((l) => l && /^https?:/.test(l.url)) || {}).url)
const where = (it) => [it.venue, it.area, it.island].filter(Boolean).join(', ')
const photoItems = [
  ...events.map((e) => ({ key: 'events:' + e.id, kind: 'music event / venue', name: e.name, where: where(e), gmapsQuery: e.gmapsQuery, website: site(e), candidates: e.imageCandidates || [] })),
  ...places.map((p) => ({ key: 'places:' + p.id, kind: p.tier + ' / ' + p.category, name: p.name, where: where(p), gmapsQuery: p.gmapsQuery, website: site(p), candidates: p.imageCandidates || [] })),
  ...areas.map((a) => ({ key: 'areas:' + a.id, kind: 'area of Phuket (show its main beach or town)', name: a.name, where: a.id, gmapsQuery: a.gmapsQuery, website: site(a), candidates: a.imageCandidates || [] })),
  ...hotels.map((h) => ({ key: 'hotels:' + h.id, kind: 'hotel (' + h.tier + ')', name: h.name, where: where(h), gmapsQuery: h.gmapsQuery, website: site(h), candidates: h.imageCandidates || [] })),
]
write('photo-items.json', photoItems)
console.log(`events ${events.length} · places ${places.length} · areas ${areas.length}/20 · hotels ${hotels.length} · brands ${(money.brands || []).length} · essentials sections ${(info.sections || []).length}`)
console.log('removed:', Object.fromEntries(Object.entries(log.removed).map(([k, v]) => [k, v.length])), 'unverified:', Object.fromEntries(Object.entries(log.unverified).map(([k, v]) => [k, v.length])))
console.log('photo items:', photoItems.length)
