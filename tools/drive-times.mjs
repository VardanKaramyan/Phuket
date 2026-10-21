// Driving times from the group's booked villas (TRIP.bases in tools/trip.mjs) to every place, event, area, money
// branch and villa on Phuket and the mainland nearby, written to data/drive-times.json for the cards and day tips.
// Source: the OSRM demo server (router.project-osrm.org) on OpenStreetMap roads, so the times are without traffic.
// Islands (Phi Phi, Koh Phangan, …) and far places (Krabi, Surat Thani) are left out: no drive to them.
// Run it again when a villa pin or the bases change: node tools/drive-times.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRIP } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'))
const NO_ROAD = new Set(['phi-phi', 'koh-yao', 'koh-lanta', 'koh-lipe', 'koh-phangan', 'koh-samui', 'koh-tao', 'krabi', 'surat-thani', 'trang', 'bangkok', 'ayutthaya', 'other'])
const ok = (it) => Number.isFinite(+it.lat) && Number.isFinite(+it.lng) && !NO_ROAD.has(it.area) && it.coordConfidence !== 'low'
const stays = rd('stays.json').items
const points = [] // [key, lat, lng]
for (const p of rd('places.json').items) if (ok(p)) points.push(['pl:' + p.id, +p.lat, +p.lng])
for (const e of rd('events.json').items) if (ok(e)) points.push(['ev:' + e.id, +e.lat, +e.lng])
if (fs.existsSync(path.join(ROOT, 'data/clubs.json'))) for (const c of rd('clubs.json').items) if (ok(c)) points.push(['cl:' + c.id, +c.lat, +c.lng])
for (const a of rd('areas.json').items) if (ok(a)) points.push(['ar:' + a.id, +a.lat, +a.lng])
for (const h of rd('hotels.json').items) if (ok(h)) points.push(['ht:' + h.id, +h.lat, +h.lng])
for (const b of rd('exchanges.json').brands || []) (b.branches || []).forEach((x, i) => { if (Number.isFinite(+x.lat)) points.push([`mx:${b.id}#${i}`, +x.lat, +x.lng]) })
points.push(['airport', 8.1132, 98.3169])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function table(from, dests) {
  const coords = [from, ...dests].map(([, la, ln]) => `${ln.toFixed(5)},${la.toFixed(5)}`).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`
  for (let t = 0; t < 4; t++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'phuket-trip-guide (one-off drive times)' } })
    if (r.ok) { const j = await r.json(); if (j.code === 'Ok') return j }
    await sleep(2000 * (t + 1))
  }
  throw new Error('OSRM failed for ' + from[0])
}
const out = { generatedOn: new Date().toISOString().slice(0, 10), source: 'OSRM demo server (router.project-osrm.org), OpenStreetMap roads; no traffic', bases: {}, items: {} }
for (const base of TRIP.bases) {
  const h = stays.find((x) => x.id === base.id)
  if (!h) throw new Error('tools/trip.mjs: base ' + base.id + ' is not in data/stays.json')
  out.bases[base.key] = { id: base.id, lat: h.lat, lng: h.lng }
  for (let i = 0; i < points.length; i += 90) {
    const chunk = points.slice(i, i + 90)
    const j = await table([base.key, h.lat, h.lng], chunk)
    chunk.forEach(([key], k) => {
      const s = j.durations[0][k + 1], m = j.distances[0][k + 1]
      if (s == null) return
      ;(out.items[key] = out.items[key] || {})[base.key] = { min: Math.round(s / 60), km: Math.round(m / 100) / 10 }
    })
    await sleep(1100) // be gentle with the free demo server
  }
}
fs.writeFileSync(path.join(ROOT, 'data/drive-times.json'), JSON.stringify(out, null, 1))
console.log(`drive times: ${Object.keys(out.items).length} points from ${Object.keys(out.bases).join(' and ')}`)
