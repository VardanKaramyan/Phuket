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
  'koh-kaew': [98.34, 7.92, 98.42, 7.99], 'phang-nga': [98.2, 8.0, 98.8, 8.8], 'khao-lak': [98.2, 8.5, 98.4, 8.8], natai: [98.22, 8.2, 98.33, 8.36],
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
    const d = turf.pointToLineDistance(pt, turf.polygonToLine(areaPoly[area]).type === 'FeatureCollection' ? turf.polygonToLine(areaPoly[area]).features[0] : turf.polygonToLine(areaPoly[area]), { units: 'kilometers' })
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
  if (p.tier !== 'day-trip') checkPoint(w, p)
  else if (!Number.isFinite(p.lat)) warn(w, 'missing coordinates')
  if (!p.description) warn(w, 'no description')
  if ((p.category === 'market') && !(p.days || []).length) warn(w, 'market without days')
}
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

console.log(`checked: ${ev.length} events, ${pl.length} places, ${ar.length} areas, ${ho.length} hotels, ${(mx.brands || []).length} brands`)
console.log(problems.length ? problems.join('\n') : 'no problems found')
process.exitCode = problems.length ? 1 : 0
