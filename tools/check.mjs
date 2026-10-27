// Sanity checks on data/*.json before building: coordinates on land / near the coast, inside the stated area,
// dates inside January 2027, enums, duplicate ids, missing fields. Prints a report; exits 1 when it finds a problem.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as turf from '@turf/turf'
import { TRIP, inTrip } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, ...a)
const rd = (p, d) => (fs.existsSync(P(p)) ? JSON.parse(fs.readFileSync(P(p), 'utf8')) : d)
const areasGeo = rd('data/geo/areas.geojson')
const land = rd('data/geo/land.geojson')
const phuket = land.features.find((f) => f.properties.name === 'Phuket')
const areaPoly = Object.fromEntries(areasGeo.features.map((f) => [f.properties.id, f]))

const BOXES = { // rough boxes for off-island areas [minLng, minLat, maxLng, maxLat]
  'koh-phangan': [99.9, 9.6, 100.15, 9.85], 'koh-samui': [99.85, 9.35, 100.15, 9.6], 'phi-phi': [98.7, 7.6, 98.85, 7.8],
  krabi: [98.6, 7.7, 99.2, 8.2], 'koh-lanta': [98.95, 7.4, 99.2, 7.75], 'koh-yao': [98.5, 7.85, 98.7, 8.2],
  'koh-kaew': [98.34, 7.92, 98.42, 7.99], 'phang-nga': [98.2, 8.0, 98.8, 8.8], 'khao-lak': [98.2, 8.5, 98.4, 8.95], natai: [98.22, 8.2, 98.33, 8.36],
  bangkok: [99.8, 13.3, 101.0, 14.2], ayutthaya: [100.4, 14.2, 100.7, 14.5],
  'koh-tao': [99.78, 10.04, 99.88, 10.14], 'koh-lipe': [99.25, 6.45, 99.33, 6.53], trang: [99.15, 7.2, 99.75, 7.7], 'surat-thani': [98.8, 8.9, 99.85, 9.45],
}
const problems = []
const warn = (where, msg) => problems.push(`${where}: ${msg}`)

function checkPoint(where, it) {
  const { lat, lng, area } = it
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return warn(where, 'missing coordinates')
  const pt = turf.point([lng, lat])
  if (BOXES[area]) {
    const [a, b, c, d] = BOXES[area]
    if (lng < a || lng > c || lat < b || lat > d) warn(where, `coords ${lat},${lng} outside ${area} box`)
    return
  }
  if (area === 'other') return
  const onIsland = land.features.some((f) => turf.booleanPointInPolygon(pt, f))
  const coastKm = turf.pointToLineDistance(pt, turf.polygonToLine(phuket).features ? turf.polygonToLine(phuket).features[0] : turf.polygonToLine(phuket), { units: 'kilometers' })
  if (!onIsland && coastKm > 0.6) warn(where, `in the sea ${coastKm.toFixed(2)} km from Phuket coast (${lat},${lng})`)
  if (!areaPoly[area]) { if (area && area !== 'other') warn(where, `unknown area "${area}"`); return }
  const inArea = turf.booleanPointInPolygon(pt, areaPoly[area])
  if (!inArea) {
    // an area can be several polygons (islets) and rings: measure to the nearest one
    const lines = turf.polygonToLine(areaPoly[area])
    const d = Math.min(...(lines.type === 'FeatureCollection' ? lines.features : [lines]).map((l) => turf.pointToLineDistance(pt, l, { units: 'kilometers' })))
    const actual = Object.keys(areaPoly).find((id) => turf.booleanPointInPolygon(pt, areaPoly[id]))
    if (d > 1.0) warn(where, `${d.toFixed(1)} km outside its area "${area}"${actual ? ` (falls in "${actual}")` : ''}`)
  }
}
const ids = new Map()
function checkIds(kind, items) {
  for (const it of items) {
    const k = kind + ':' + it.id
    if (ids.has(k)) warn(k, 'duplicate id')
    ids.set(k, true)
    if (!/^[a-z0-9-]+$/.test(it.id || '')) warn(k, 'id is not kebab-case')
  }
}

const TRIP_MONTHS = new Set([TRIP.start.slice(0, 7), TRIP.end.slice(0, 7)])
const ev = rd('data/events.json', { items: [] }).items
checkIds('events', ev)
for (const e of ev) {
  const w = 'events:' + e.id
  checkPoint(w, e)
  for (const d of e.dates || []) {
    const t = Date.parse(d + 'T00:00:00Z')
    const real = /^\d{4}-\d\d-\d\d$/.test(d) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d
    if (!real || !TRIP_MONTHS.has(d.slice(0, 7))) warn(w, `date ${d} is not a real day in the trip's month (${[...TRIP_MONTHS].join(', ')})`)
  }
  const inWin = (e.dates || []).some(inTrip)
  if (e.window === 'in' && !inWin && e.kind === 'dated') warn(w, `window=in but no date in the trip (${TRIP.start} to ${TRIP.lastNight})`)
  if (e.window !== 'in' && inWin) warn(w, `window=${e.window} but has a date in the trip`)
  if (!e.description) warn(w, 'no description')
}
const pl = rd('data/places.json', { items: [] }).items
checkIds('places', pl)
for (const p of pl) {
  const w = 'places:' + p.id
  // day trips and boat tours may sit at sea or far away; piers and everything else must be where their area says
  if (p.tier !== 'day-trip' && p.tier !== 'tour') checkPoint(w, p)
  else if (!Number.isFinite(p.lat)) warn(w, 'missing coordinates')
  if (!p.description) warn(w, 'no description')
  if ((p.category === 'market') && !(p.days || []).length) warn(w, 'market without days')
}
// Places → Food (tools/merge-food.mjs): what to order and what people say, in the guide's plain style
for (const p of pl.filter((x) => x.category === 'food' && x.foodKind)) {
  const w = 'places:' + p.id
  if (!(p.dishes || []).length) warn(w, 'a food place with no dishes (what to order)')
  if (!p.praise) warn(w, 'a food place with nothing on what people say')
  const text = [p.name, p.description, p.praise, p.watchOut, p.feeText, p.openText, ...(p.dishes || []), ...(p.tips || [])].filter(Boolean).join(' ')
  if (/!|\p{Extended_Pictographic}/u.test(text)) warn(w, 'an exclamation mark or an emoji in the copy')
  if (/\u2014/.test(text)) warn(w, 'an em dash in the copy')
}
// Places → Clubs & festivals: where they are, and their nights are in the guide
const cl = rd('data/clubs.json', { items: [] }).items
checkIds('clubs', cl)
for (const c of cl) {
  checkPoint('clubs:' + c.id, c)
  if (!c.description) warn('clubs:' + c.id, 'no description')
  for (const id of c.events || []) if (!ev.some((e) => e.id === id)) warn('clubs:' + c.id, `night ${id} is not in data/events.json`)
}
// every night and club has its underground score by the user's taste (data/underground.json)
const ug = rd('data/underground.json', { events: {}, clubs: {} })
for (const e of ev) if (!(ug.events || {})[e.id]) warn('events:' + e.id, 'no score in data/underground.json')
for (const c of cl) if (!(ug.clubs || {})[c.id]) warn('clubs:' + c.id, 'no score in data/underground.json')
const ar = rd('data/areas.json', { items: [] }).items
checkIds('areas', ar)
for (const id of Object.keys(areaPoly)) if (!ar.find((a) => a.id === id)) warn('areas', `no write-up for area "${id}"`)
for (const a of ar) checkPoint('areas:' + a.id, Object.assign({}, a, { area: a.id }))
const ho = rd('data/hotels.json', { items: [] }).items
checkIds('hotels', ho)
for (const h of ho) checkPoint('hotels:' + h.id, h)
// the villa cards rate the beds for the group, and read the trip total from the start of priceText
for (const h of ho) {
  if (!(h.bedrooms > 0 && h.beds > 0)) warn('hotels:' + h.id, 'needs bedrooms and beds (numbers, from the listing)')
  if (!h.noRoomsOnTrip && !/^[\d,]+ THB for \d+ nights/.test(h.priceText || '')) warn('hotels:' + h.id, 'priceText must start with "<total> THB for <nights> nights"')
}
const mx = rd('data/exchanges.json', { brands: [] })
for (const b of mx.brands || []) for (const [i, x] of (b.branches || []).entries()) checkPoint(`money:${b.id}#${i} ${x.name}`, Object.assign({}, x, { area: areaPoly[x.area] || BOXES[x.area] ? x.area : '' }))
// the hand-kept rates (data/extra.json → rates: baht for 1 unit) and the prices we paid for our villas (TRIP.bases → paid).
// AED is pegged at 3.6725 to the dollar, so its rate must sit near the USD rate over the peg: this catches a rate typed
// upside down (open.er-api.com's THB page gives AED per baht, 0.109) or with the point in the wrong place
const usdThb = ((mx.midMarket || []).find((m) => m && m.currency === 'USD') || {}).thbPerUnit
const xr = rd('data/extra.json', {}).rates || []
for (const r of xr) {
  if (!(typeof r.thbPerUnit === 'number' && r.thbPerUnit > 0)) warn('extra.rates:' + r.currency, `thbPerUnit must be a number above 0 (baht for 1 ${r.currency})`)
  else if (r.currency === 'AED' && usdThb && Math.abs((r.thbPerUnit * 3.6725) / usdThb - 1) > 0.1) warn('extra.rates:AED', `${r.thbPerUnit} THB per AED is far from ${(usdThb / 3.6725).toFixed(2)} (the USD rate over the 3.6725 peg): upside down or a typo?`)
  // perUsd: units for 1 dollar, for a currency pegged to it (the paid price boxes show dollars from it)
  if (r.perUsd !== undefined && !(typeof r.perUsd === 'number' && r.perUsd > 0)) warn('extra.rates:' + r.currency, `perUsd must be a number above 0 (${r.currency} for 1 USD)`)
  else if (r.currency === 'AED' && r.perUsd !== undefined && r.perUsd !== 3.6725) warn('extra.rates:AED', `perUsd is ${r.perUsd}, but the dirham is pegged at 3.6725 per dollar`)
}
for (const b of TRIP.bases || []) {
  if (!b.paid) continue
  if (!(b.paid.total > 0) || !(b.guests > 0)) warn('trip.bases:' + b.id, 'paid needs a total above 0, and guests')
  if (b.paid.currency !== 'AMD' && !(mx.midMarket || []).some((m) => m && m.currency === b.paid.currency) && !xr.some((r) => r.currency === b.paid.currency)) warn('trip.bases:' + b.id, `paid in ${b.paid.currency}, but data/extra.json → rates has no ${b.paid.currency} rate`)
}

console.log(`checked: ${ev.length} events, ${pl.length} places, ${cl.length} clubs, ${ar.length} areas, ${ho.length} hotels, ${(mx.brands || []).length} brands`)
console.log(problems.length ? problems.join('\n') : 'no problems found')
process.exitCode = problems.length ? 1 : 0
