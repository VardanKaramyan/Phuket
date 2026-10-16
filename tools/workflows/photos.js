export const meta = {
  name: 'phuket-guide-images',
  description: 'Find, download and visually verify one good photo per guide item (events, places, areas, hotels)',
  phases: [
    { title: 'Photos', detail: 'one agent per batch: try candidates, search Wikimedia / official sites, look at each photo' },
    { title: 'Retry', detail: 'second pass for items still without a usable photo' },
  ],
}

const OUT = args.outDir
const FILE = args.itemsFile

const RULES = `You are picking ONE good photo for each item of a personal, mobile travel guide for Phuket (Jan 2027). Photos show as 16:9 cards about 360 px wide on a phone.

TOOLS: Bash (curl, file, and sips on macOS or python3 / identify elsewhere), Read (Read on an image file shows it to you), and web tools (load them with ToolSearch query "select:WebSearch,WebFetch" if you need them).

FOR EACH ITEM:
1. Try its candidate URLs first, in order. Download with:
   curl -sL -m 40 -A "phuket-trip-guide/1.0 (personal travel guide)" -o "${OUT}/KEY.ext" "URL"
   (KEY = the item key with ":" replaced by "-", e.g. places-big-buddha.jpg). For Wikimedia, download the 1280px thumbnail, not the full original: use the API (iiurlwidth=1280 -> "thumburl"), or build it as https://upload.wikimedia.org/wikipedia/commons/thumb/<a>/<ab>/<File>/1280px-<File>.
2. Check it is a real image of reasonable size: file "${OUT}/KEY.ext" and its pixel size (macOS: sips -g pixelWidth -g pixelHeight; Linux: identify from ImageMagick, or node with the project's sharp: node -e "require('sharp')(process.argv[1]).metadata().then(m=>console.log(m.width,m.height))" FILE). Need width >= 640 px (prefer >= 1000). Delete files that are HTML, tiny, or broken.
3. LOOK at it with Read. Accept only if it clearly shows THIS place (or, for events, the venue / party / an official event visual), is sharp, mostly landscape (portrait is OK only if the subject survives a 16:9 crop), and has no big watermark, collage, map, logo-only or text-heavy graphic. For events, an official flyer is acceptable only if no good venue or party photo exists.
4. If no candidate passes, search for better ones:
   - Wikimedia Commons: curl -s "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=10&gsrsearch=URL_ENCODED&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280" (try the name, name + Phuket, the Thai name, the beach / area name)
   - the official website: find og:image (curl the homepage, grep -i 'og:image') or a gallery photo
   - for events: the venue's photos, RA event / club page images (og:image), the organizer site
   Never use stock-photo sites (Shutterstock, Getty, Alamy, Dreamstime, iStock, Adobe Stock, 123rf) or images with their watermarks. Never use Google Maps / Tripadvisor user photos.
5. Record credit and license: for Wikimedia, author (plain text, no HTML) + license short name (e.g. "CC BY-SA 4.0"); for official sites, credit "© <official name>" and license "official site". page = the page where the image is described (Commons file page or the site page).
Keep only the final chosen file for each item at "${OUT}/KEY.<ext>" (delete rejected downloads). If nothing acceptable exists after a real search, set ok=false with a short note on what you tried.`

const SCHEMA = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: {
  key: { type: 'string' }, ok: { type: 'boolean' }, file: { type: 'string', description: 'absolute path of the chosen file' },
  url: { type: 'string', description: 'direct URL the file came from' }, page: { type: 'string' },
  credit: { type: 'string' }, license: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' },
  note: { type: 'string', description: 'what the photo shows, or why none was found' },
}, required: ['key', 'ok'] } } }, required: ['results'] }

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const describe = (keys) => `Your items are in the JSON file ${FILE} (an array of objects with key, kind, name, where, gmapsQuery, website, candidates). Handle exactly these ${keys.length} keys:\n${keys.join('\n')}`

const batches = args.batches
const allKeys = batches.flat()
log(`${allKeys.length} items in ${batches.length} batches`)
phase('Photos')
const first = await parallel(batches.map((b, i) => () =>
  agent(`${RULES}\n\n${describe(b)}\n\nReturn one result per key.`, { label: `photos#${i + 1}`, phase: 'Photos', schema: SCHEMA })))

const results = new Map()
first.forEach((r) => { if (!r) return; for (const x of r.results || []) results.set(x.key, x) })
const missing = allKeys.filter((k) => !results.get(k) || !results.get(k).ok)
log(`first pass: ${allKeys.length - missing.length} ok, ${missing.length} without a photo`)

if (missing.length) {
  phase('Retry')
  const retry = await parallel(chunk(missing, 10).map((b, i) => () =>
    agent(`${RULES}\n\nA first pass found no acceptable photo for these items. Search harder: other spellings, the Thai name, the beach / bay / village it is in, nearby viewpoints, the official site's gallery, the venue's Facebook cover image (og:image of the public page), Wikipedia articles' lead images, and Openverse (https://api.openverse.org/v1/images/?q=URL_ENCODED&license_type=all-cc). A good photo of the immediate surroundings (e.g. the beach in front of a hotel) is acceptable if you say so in the note.\n\n${describe(b)}\n\nReturn one result per key.`, { label: `retry#${i + 1}`, phase: 'Retry', schema: SCHEMA })))
  retry.forEach((r) => { if (!r) return; for (const x of r.results || []) if (x.ok || !results.has(x.key)) results.set(x.key, x) })
}

const all = allKeys.map((k) => results.get(k) || { key: k, ok: false, note: 'no result' })
log(`done: ${all.filter((x) => x.ok).length}/${all.length} items have a photo`)
return { results: all }
