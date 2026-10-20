// Builds the offline map geometry for the guide:
//  - data/geo/land.geojson   : Phuket island + nearby land for context
//  - data/geo/areas.geojson  : tourist areas (subdistrict boundaries, split by labelled seeds where needed)
//  - data/geo/preview.png    : quick visual check
// Source data: OpenStreetMap via Nominatim (ODbL, © OpenStreetMap contributors).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as turf from '@turf/turf'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GEO = path.join(ROOT, 'data/geo')
const read = (p) => JSON.parse(fs.readFileSync(path.join(GEO, p), 'utf8'))
const toFeature = (n, props = {}) => turf.feature(n.geojson, props)

// ---------- base land ----------
const island = toFeature(read('nominatim-ko-phuket.json')[0], { name: 'Phuket' })

const TAMBON_FILES = fs.readdirSync(path.join(GEO, 'tambon')).filter((f) => f.endsWith('.json'))
const tambons = {}
for (const f of TAMBON_FILES) {
  const key = f.replace('.json', '').replace(/_/g, ' ')
  const clipped = turf.intersect(turf.featureCollection([toFeature(JSON.parse(fs.readFileSync(path.join(GEO, 'tambon', f), 'utf8'))), island]))
  if (clipped) tambons[key] = clipped
}

// Talat Yai (Old Town core) is missing from Nominatim: take what is left of the island near the Old Town.
if (!tambons['Talat Yai']) {
  let rest = island
  for (const t of Object.values(tambons)) rest = turf.difference(turf.featureCollection([rest, t])) || rest
  const oldTown = turf.point([98.388, 7.884])
  const pieces = turf.flatten(rest).features.filter((p) => turf.area(p) > 20000)
  const near = pieces.filter((p) => turf.booleanPointInPolygon(oldTown, p) || turf.distance(turf.centroid(p), oldTown) < 2.5)
  if (near.length) tambons['Talat Yai'] = near.reduce((a, b) => turf.union(turf.featureCollection([a, b])))
}

// ---------- tourist areas ----------
// Each subdistrict maps to one area, or is split between areas by labelled seed points (Voronoi, then union by label).
const WHOLE = {
  Patong: 'patong', Kamala: 'kamala', 'Mai Khao': 'mai-khao', Chalong: 'chalong', Kathu: 'kathu',
  'Talat Yai': 'phuket-town', 'Talat Nuea': 'phuket-town', Ratsada: 'phuket-town',
  'Thep Krasattri': 'thalang', 'Si Sunthon': 'thalang',
}
// Ko Kaeo (Boat Lagoon, residential) is deliberately left without a tourist area.
const UNASSIGNED = new Set(['Ko Kaeo'])
const SPLIT = {
  'Choeng Thale': [
    ['surin', 7.9748, 98.2810], ['surin', 7.9660, 98.2960],
    ['bang-tao', 8.0040, 98.2950], ['bang-tao', 7.9960, 98.3120], ['bang-tao', 8.0080, 98.3200],
    ['layan', 8.0330, 98.2930], ['layan', 8.0360, 98.3080],
  ],
  Sakhu: [
    ['nai-thon', 8.0560, 98.2790], ['nai-thon', 8.0620, 98.2950],
    ['nai-yang', 8.0880, 98.2980], ['nai-yang', 8.1050, 98.3150],
  ],
  // the south tip of Karon (Ao Sane, Black Rock, Laem Krating) is reached through Nai Harn: it goes with Nai Harn
  Karon: [
    ['karon', 7.8460, 98.2950], ['karon', 7.8560, 98.3060],
    ['kata', 7.8210, 98.3000], ['kata', 7.8260, 98.3110],
    ['kata-noi', 7.8060, 98.3020],
    ['nai-harn', 7.7780, 98.2950], ['nai-harn', 7.7830, 98.2975], ['nai-harn', 7.7765, 98.2895],
  ],
  // three areas since 20 Oct 2026 (the user's choice, from the 18 Oct research): Nai Harn (the beach, the lake, Soi
  // Naya and the road up to the Sai Yuan junction), Promthep (the cape hill road: Windmill, Ya Nui, Promthep) and
  // Rawai (the seafront from the foot of the Promthep hill to Laem Ka, Sai Yuan Road and Wiset Road to Chalong Circle)
  Rawai: [
    ['nai-harn', 7.7760, 98.3057], ['nai-harn', 7.7782, 98.3096], ['nai-harn', 7.7786, 98.3026], ['nai-harn', 7.7860, 98.3090],
    ['nai-harn', 7.7835, 98.3130], ['nai-harn', 7.7895, 98.3150], ['nai-harn', 7.7950, 98.3120],
    ['promthep', 7.7697, 98.3066], ['promthep', 7.7675, 98.3060], ['promthep', 7.7619, 98.3054], ['promthep', 7.7589, 98.3034], ['promthep', 7.7650, 98.3095],
    ['rawai', 7.7708, 98.3193], ['rawai', 7.7756, 98.3288], ['rawai', 7.7791, 98.3348], ['rawai', 7.7800, 98.3230], ['rawai', 7.7911, 98.3267],
    ['rawai', 7.7967, 98.3262], ['rawai', 7.8018, 98.3357], ['rawai', 7.8120, 98.3380],
  ],
  // Pa Khlok: the inland Khao Phra Thaeo forest (Bang Pae, Gibbon project, elephant sanctuary) belongs with Thalang;
  // the coast (Bang Rong pier, Ao Po, Cape Yamu) is the Ao Po area
  'Pa Khlok': [
    ['thalang', 8.0415, 98.3932], ['thalang', 8.0258, 98.4016], ['thalang', 8.0650, 98.3900],
    ['ao-po', 8.0685, 98.4417], ['ao-po', 8.0500, 98.4159], ['ao-po', 7.9930, 98.4130], ['ao-po', 8.0200, 98.4300],
  ],
  Wichit: [
    ['phuket-town', 7.8700, 98.3920], ['phuket-town', 7.8800, 98.3700],
    ['cape-panwa', 7.8050, 98.4050], ['cape-panwa', 7.8300, 98.4150],
  ],
}

const pieces = [] // [areaId, feature]
for (const [name, poly] of Object.entries(tambons)) {
  if (WHOLE[name]) { pieces.push([WHOLE[name], poly]); continue }
  if (UNASSIGNED.has(name)) continue
  const seeds = SPLIT[name]
  if (!seeds) { console.warn('unassigned subdistrict:', name); continue }
  const pts = turf.featureCollection(seeds.map(([id, lat, lng]) => turf.point([lng, lat], { id })))
  const cells = turf.voronoi(pts, { bbox: [98.0, 7.5, 98.8, 8.5] })
  cells.features.forEach((cell, i) => {
    if (!cell) return
    const part = turf.intersect(turf.featureCollection([cell, poly]))
    if (part) pieces.push([seeds[i][0], part])
  })
}

const byArea = {}
for (const [id, f] of pieces) byArea[id] = byArea[id] ? turf.union(turf.featureCollection([byArea[id], f])) : f
// Koh Sirey is its own island (bridge from Phuket Town) and belongs to Ratsada: add it to the Phuket Town area
if (fs.existsSync(path.join(GEO, 'extra/ko-sire.json')) && byArea['phuket-town']) {
  byArea['phuket-town'] = turf.union(turf.featureCollection([byArea['phuket-town'], toFeature(read('extra/ko-sire.json'))]))
}

// Phang Nga mainland north of Sarasin Bridge, from OSM coastline ways (land is on the left of a coastline way,
// so the west-facing Natai shore runs north to south with land to the east). The province polygon is not used
// because it includes the sea.
const coastWays = JSON.parse(fs.readFileSync(path.join(GEO, 'coast-natai-ways.json'), 'utf8'))
  .filter((w) => w.id !== '684290005') // that one is Phuket's own north tip
const key = (c) => c[0].toFixed(7) + ',' + c[1].toFixed(7)
const starts = new Map(coastWays.map((w) => [key(w.coords[0]), w]))
const ends = new Set(coastWays.map((w) => key(w.coords[w.coords.length - 1])))
let head = coastWays.find((w) => !ends.has(key(w.coords[0])))
const chain = []
for (let w = head; w; w = starts.get(key(w.coords[w.coords.length - 1]))) {
  chain.push(...(chain.length ? w.coords.slice(1) : w.coords))
  if (chain.length > 5000) break
}
const EAST = 98.42
const cut = chain.findIndex((c) => c[0] > EAST)
const mainlandCoast = cut > 0 ? chain.slice(0, cut) : chain
const top = mainlandCoast[0], bottom = mainlandCoast[mainlandCoast.length - 1]
const mainland = turf.polygon([[...mainlandCoast, [EAST, bottom[1]], [EAST, top[1]], top]], { name: 'Phang Nga mainland' })

const NATAI_BOX = turf.bboxPolygon([98.20, 8.232, 98.302, 8.338])
const natai = turf.intersect(turf.featureCollection([NATAI_BOX, mainland]))
if (natai) byArea['natai'] = natai

const outerOnly = (f) => {
  // keep outer rings only: rivers and lakes carved out as holes render as stray lines after simplification
  const polys = turf.flatten(f).features.map((p) => turf.polygon([p.geometry.coordinates[0]]))
  return polys.length === 1 ? polys[0] : turf.multiPolygon(polys.map((p) => p.geometry.coordinates))
}
const clean = (f) => {
  // drop slivers left by independent simplification of neighbouring boundaries
  const parts = turf.flatten(outerOnly(f)).features.filter((p) => turf.area(p) > 150000)
  if (!parts.length) return f
  const merged = parts.length === 1 ? parts[0] : turf.union(turf.featureCollection(parts))
  return turf.truncate(turf.simplify(outerOnly(merged), { tolerance: 0.00025, highQuality: true }), { precision: 5 })
}

const areas = turf.featureCollection(
  Object.entries(byArea).map(([id, f]) => {
    const g = clean(f)
    g.properties = { id, km2: Math.round(turf.area(g) / 1e5) / 10 }
    return g
  })
)

// ---------- context land ----------
const land = [turf.truncate(turf.simplify(island, { tolerance: 0.0002, highQuality: true }), { precision: 5 })]
land[0].properties = { name: 'Phuket' }
for (const f of fs.readdirSync(path.join(GEO, 'extra'))) {
  if (!f.startsWith('ko-')) continue
  const g = toFeature(read('extra/' + f), { name: f.replace('.json', '') })
  land.push(turf.truncate(turf.simplify(g, { tolerance: 0.0002, highQuality: true }), { precision: 5 }))
}
{
  const g = turf.truncate(turf.simplify(mainland, { tolerance: 0.0003, highQuality: true }), { precision: 5 })
  g.properties = { name: 'Phang Nga mainland' }
  land.push(g)
}
const landFC = turf.featureCollection(land)

// ---------- main roads for the offline basemap (OSM via Overpass) ----------
if (fs.existsSync(path.join(GEO, 'roads-raw.json'))) {
  const raw = read('roads-raw.json')
  const RANK = { motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary' }
  const lines = raw.elements.filter((e) => e.type === 'way' && e.geometry && e.geometry.length > 1).map((e) => {
    const k = RANK[e.tags.highway] || 'tertiary'
    const line = turf.lineString(e.geometry.map((g) => [g.lon, g.lat]), { k })
    return turf.truncate(turf.simplify(line, { tolerance: k === 'tertiary' ? 0.0003 : 0.0002, highQuality: false }), { precision: 5 })
  }).filter((l) => l.geometry.coordinates.length > 1 && (l.properties.k !== 'tertiary' || turf.length(l) > 0.25))
  fs.writeFileSync(path.join(GEO, 'roads.geojson'), JSON.stringify(turf.featureCollection(lines)))
  console.log('roads:', lines.length, 'lines,', Math.round(fs.statSync(path.join(GEO, 'roads.geojson')).size / 1024), 'KB')
}

fs.writeFileSync(path.join(GEO, 'areas.geojson'), JSON.stringify(areas))
fs.writeFileSync(path.join(GEO, 'land.geojson'), JSON.stringify(landFC))
console.log('areas:', areas.features.map((f) => `${f.properties.id} ${f.properties.km2}km²`).join(', '))
console.log('sizes: areas', fs.statSync(path.join(GEO, 'areas.geojson')).size, 'land', fs.statSync(path.join(GEO, 'land.geojson')).size)

// ---------- preview ----------
const [minX, minY, maxX, maxY] = [98.22, 7.72, 98.50, 8.36]
const k = Math.cos((7.95 * Math.PI) / 180)
const W = 900, H = Math.round((W * (maxY - minY)) / ((maxX - minX) * k))
const px = ([x, y]) => [((x - minX) / (maxX - minX)) * W, ((maxY - y) / (maxY - minY)) * H]
const ring = (r) => 'M' + r.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z'
const pathOf = (g) => (g.type === 'Polygon' ? g.coordinates.map(ring).join('') : g.coordinates.flatMap((p) => p.map(ring)).join(''))
const COLORS = ['#7cc6a4', '#f08aa0', '#8ec5ea', '#f3c868', '#b9a2e6', '#f4a77c', '#9fd3c7', '#e7a1c8', '#a8c66c', '#7fb2d9']
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#dcecef"/>`
for (const f of landFC.features) svg += `<path d="${pathOf(f.geometry)}" fill="#f4f1e8" stroke="#9aa" stroke-width="0.6"/>`
areas.features.forEach((f, i) => { svg += `<path d="${pathOf(f.geometry)}" fill="${COLORS[i % COLORS.length]}" fill-opacity="0.75" stroke="#234" stroke-width="0.8"/>` })
for (const f of areas.features) {
  const c = px(turf.pointOnFeature(f).geometry.coordinates)
  svg += `<text x="${c[0].toFixed(1)}" y="${c[1].toFixed(1)}" font-family="Helvetica" font-size="11" text-anchor="middle" fill="#012">${f.properties.id}</text>`
}
svg += '</svg>'
await sharp(Buffer.from(svg)).png().toFile(path.join(GEO, 'preview.png'))
console.log('preview written', W, 'x', H)
