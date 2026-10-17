// Downloads the offline satellite layer: EOxCloudless (Sentinel-2) tiles for the trip areas, saved as WebP in
// assets/sat/{z}/{x}/{y}.webp with assets/sat/coverage.json (the tile ranges per zoom, read by the build and the app).
// Licence: CC BY-NC-SA 4.0 (non-commercial, credit EOX, share alike); the credit line is in coverage.json.
// The imagery is 10 m per pixel, so zoom 14 is its full detail. Files already on disk are skipped.
// Usage: node tools/sat-tiles.mjs (npm run sat)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets/sat')
const YEAR = 2025
const URL_T = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${YEAR}_3857/default/g/{z}/{y}/{x}.jpg`
// [south, west, north, east], first zoom, last zoom
const AREAS = [
  ['trip region (Similan to Koh Phangan)', [7.5, 97.55, 9.9, 100.2], 8, 10],
  ['Andaman day trips (Phang Nga Bay, Krabi, Phi Phi)', [7.55, 98.2, 8.35, 98.9], 11, 12],
  ['Phuket and the bay islands', [7.58, 98.22, 8.32, 98.66], 13, 13],
  ['Phuket island', [7.74, 98.25, 8.21, 98.46], 14, 14],
  ['Koh Phangan and Koh Samui', [9.4, 99.9, 9.85, 100.15], 11, 12],
  ['Koh Phangan', [9.66, 99.94, 9.81, 100.08], 13, 14],
]

const tileXY = (lat, lng, z) => {
  const n = 2 ** z
  return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)]
}
const ranges = {} // z -> [[x0, x1, y0, y1], ...]
const tiles = new Map()
for (const [, [s, w, n, e], z0, z1] of AREAS) {
  for (let z = z0; z <= z1; z++) {
    const [x0, y1] = tileXY(s, w, z), [x1, y0] = tileXY(n, e, z)
    ;(ranges[z] ||= []).push([x0, x1, y0, y1])
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.set(`${z}/${x}/${y}`, [z, x, y])
  }
}

let fetched = 0, kept = 0, failed = 0
const queue = [...tiles.values()]
async function worker() {
  while (queue.length) {
    const [z, x, y] = queue.shift()
    const f = path.join(OUT, String(z), String(x), y + '.webp')
    if (fs.existsSync(f)) { kept++; continue }
    const url = URL_T.replace('{z}', z).replace('{x}', x).replace('{y}', y)
    let ok = false
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'phuket-trip-guide (personal, non-commercial; offline map)' } })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const jpg = Buffer.from(await res.arrayBuffer())
        fs.mkdirSync(path.dirname(f), { recursive: true })
        await sharp(jpg).webp({ quality: 72 }).toFile(f)
        ok = true; fetched++
      } catch (e) {
        if (attempt === 3) { failed++; console.log('  failed', z, x, y, e.message) } else await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
    await new Promise((r) => setTimeout(r, 120)) // gentle on the free tile server
  }
}
await Promise.all(Array.from({ length: 4 }, worker))

let bytes = 0
for (const t of tiles.keys()) { const f = path.join(OUT, t + '.webp'); if (fs.existsSync(f)) bytes += fs.statSync(f).size }
const coverage = {
  source: `EOxCloudless ${YEAR} (Sentinel-2 cloudless), ${URL_T}`,
  attribution: `Offline imagery: <a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data ${YEAR}), <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>`,
  minZoom: Math.min(...Object.keys(ranges).map(Number)), maxZoom: Math.max(...Object.keys(ranges).map(Number)),
  areas: AREAS.map(([name, box, z0, z1]) => ({ name, box, zooms: [z0, z1] })),
  ranges, tiles: tiles.size, bytes,
}
fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(coverage, null, 1) + '\n')
console.log(`satellite tiles: ${tiles.size} (${fetched} downloaded, ${kept} already saved, ${failed} failed) · ${(bytes / 1048576).toFixed(1)} MB`)
process.exitCode = failed ? 1 : 0
