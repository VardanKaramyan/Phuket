// Turns picked photos (data/image-picks.json, written from the image workflow) into small card images:
// 640x360 WebP, cropped on the most interesting region, plus data/images.json for the build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, ...a)
const picks = JSON.parse(fs.readFileSync(P('data/image-picks.json'), 'utf8'))
fs.mkdirSync(P('assets/img'), { recursive: true })

const out = {}
let bytes = 0, failed = []
for (const pick of picks) {
  if (!pick || !pick.ok || !pick.file) continue
  const src = path.isAbsolute(pick.file) ? pick.file : P(pick.file)
  if (!fs.existsSync(src)) { failed.push(pick.key + ' (missing file)'); continue }
  // crops chosen by eye: keep the pools in the Renew photo, keep Unclave's logo out of frame
  const POSITION = { 'places:renew-sauna-ice-bath': 'south', 'events:unclave-phangan': 'north' }
  if (POSITION[pick.key]) pick.position = POSITION[pick.key]
  // a fixed 16:9 band (top edge in source pixels) where no gravity works: the Seaside portrait photo keeps
  // the fire dancer, the crowd and the top of the decks; the Sédo flyer keeps both DJs and the decks, not its old date
  const BAND = { 'events:seaside-pre-full-moon-haad-rin': 470, 'events:sedo-izikura-phuket-town': 250 }
  const name = pick.key.replace(':', '-').replace(/[^a-z0-9-]/gi, '-').toLowerCase() + '.webp'
  const dest = P('assets/img', name)
  try {
    const meta = await sharp(src, { failOn: 'none' }).metadata()
    let img = sharp(src, { failOn: 'none' }).rotate()
    if (BAND[pick.key] != null) img = sharp(await img.extract({ left: 0, top: BAND[pick.key], width: meta.width, height: Math.round(meta.width * 9 / 16) }).toBuffer())
    await img
      .resize(640, 360, { fit: 'cover', position: pick.position || sharp.strategy.attention, withoutEnlargement: false })
      .webp({ quality: 58, effort: 6, smartSubsample: true })
      .toFile(dest)
    bytes += fs.statSync(dest).size
    out[pick.key] = { file: 'assets/img/' + name, w: 640, h: 360, srcW: meta.width, srcH: meta.height, credit: pick.credit || '', license: pick.license || '', source: pick.page || pick.url || '' }
  } catch (e) {
    failed.push(pick.key + ' (' + e.message + ')')
  }
}
fs.writeFileSync(P('data/images.json'), JSON.stringify(out, null, 1))
console.log(`${Object.keys(out).length} images, ${Math.round(bytes / 1024)} KB total, avg ${Math.round(bytes / 1024 / Math.max(1, Object.keys(out).length))} KB`)
if (failed.length) console.log('failed:', failed.join('; '))

// contact sheet for a visual check
const keys = Object.keys(out)
const COLS = 6, TW = 240, TH = 135, LH = 18
const rows = Math.ceil(keys.length / COLS)
if (keys.length) {
  const tiles = await Promise.all(keys.map(async (k, i) => ({
    input: await sharp(P(out[k].file)).resize(TW, TH).toBuffer(),
    left: (i % COLS) * TW, top: Math.floor(i / COLS) * (TH + LH),
  })))
  const labels = keys.map((k, i) => `<text x="${(i % COLS) * TW + 4}" y="${Math.floor(i / COLS) * (TH + LH) + TH + 13}" font-family="Helvetica" font-size="11" fill="#000">${k.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 38)}</text>`).join('')
  const sheet = sharp({ create: { width: COLS * TW, height: rows * (TH + LH), channels: 3, background: '#ffffff' } })
    .composite([...tiles, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * TW}" height="${rows * (TH + LH)}">${labels}</svg>`), left: 0, top: 0 }])
  // split into pages of 8 rows so each sheet stays readable
  const full = await sheet.png().toBuffer()
  const perPage = 8 * (TH + LH)
  const pages = Math.ceil((rows * (TH + LH)) / perPage)
  for (let p = 0; p < pages; p++) {
    const h = Math.min(perPage, rows * (TH + LH) - p * perPage)
    await sharp(full).extract({ left: 0, top: p * perPage, width: COLS * TW, height: h }).png().toFile(P(`data/contact-${p + 1}.png`))
  }
  console.log(`contact sheets: ${pages}`)
}
