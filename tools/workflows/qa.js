export const meta = {
  name: 'phuket-guide-qa',
  description: 'Independent reviews of the built Phuket guide: phone UX, content accuracy, map links, code/offline, requirements',
  phases: [
    { title: 'Review', detail: '5 reviewers with different lenses' },
  ],
}

const P = args.project
const SHOTS = args.shots
const BRIEF = `PROJECT: ${P} — a phone-first, offline travel guide website for Phuket (trip 8-26 Jan 2027; traveler loves underground techno).
Source: ${P}/src (styles.css, app.js, sw.js), build script ${P}/tools/build.mjs, data ${P}/data/*.json, built outputs ${P}/dist/index.html (static offline web app with service worker), ${P}/dist/phuket-guide-offline.html (single file), ${P}/artifact/index.html (claude.ai artifact version: no service worker, map tiles blocked by CSP, Leaflet from cdnjs).
Screenshots of every view at 390x844 (light and dark): ${SHOTS} (files light-<view>.png, dark-<view>.png; views: home, events, places, areas, stay, money, info). Note: in full-page screenshots the fixed bottom tab bar appears part-way down the image; that is a screenshot artifact, not a bug.
THE USER ASKED FOR: a simple mobile-optimized site they can use easily and offline; sections: music events (from earlier research), places to go (must-go + hidden gems, with locations and how long each takes), favorite hotels, currency exchange (best exchanges with lowest rates: locations, branding, which one is best), areas (breakdown + short description of each area and what it is best for, drawn on a real map, with a Google Maps option). Every item: image, map location with a button that opens Google Maps directly, short description.
Report only real, specific problems with evidence (file + line, or screenshot + what you see). No style nitpicks without user impact. Severity: high = wrong info / broken feature / unusable on phone; medium = confusing or degraded; low = polish.`

const ISSUES = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['high', 'medium', 'low'] }, where: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
}, required: ['severity', 'where', 'problem', 'fix'] } }, summary: { type: 'string' } }, required: ['issues', 'summary'] }

const LENSES = [
  { key: 'phone-ux', prompt: `LENS: phone UX and visual quality. Look at EVERY screenshot (use Read on each PNG). Check: text clipped or overflowing, overlapping elements, unreadable contrast (both themes), cramped or misaligned cards, tap targets under ~40px, confusing labels, broken or ugly photos (wrong subject, stretched, watermarks), empty placeholders, anything that looks unfinished. Also open ${P}/dist/index.html and skim the markup for anything that would look wrong on a phone.` },
  { key: 'accuracy', prompt: `LENS: content accuracy, adversarial. From ${P}/data, pick 16 items across events (at least 5, include the top picks), places (5), hotels (3) and money changers (3 branches). For each, independently verify with web search (load WebSearch/WebFetch via ToolSearch "select:WebSearch,WebFetch"): it exists and operates for Jan 2027, dates/hours/fees are right, and the coordinates point at the right spot (check via OpenStreetMap: curl -s "https://photon.komoot.io/api/?q=QUERY&lat=7.95&lon=98.33&limit=3"). Report every factual error you find with the correct value and a source URL.` },
  { key: 'maps-links', prompt: `LENS: Google Maps links and map data. Every card has a "Google Maps" button built as https://www.google.com/maps/search/?api=1&query=<gmapsQuery> and a "Directions" button to lat,lng. Read all gmapsQuery values in ${P}/data/*.json (events, places, areas, hotels, exchanges branches). Flag queries that are ambiguous (could land on a different place with the same name elsewhere in Thailand, e.g. a generic beach or chain name without "Phuket"/area), misspelled, or that do not match the item. Also flag items whose lat/lng look inconsistent with their area or name (you can run: node ${P}/tools/check.mjs). Propose the exact corrected query for each.` },
  { key: 'code-offline', prompt: `LENS: code correctness, offline behavior and accessibility. Review ${P}/src/app.js, ${P}/src/sw.js, ${P}/src/styles.css and the generated ${P}/dist/index.html. Look for: JS errors and edge cases (missing data, localStorage blocked, offline, hash routing, map init when hidden), service-worker bugs (stale updates, precache misses, iOS Safari quirks, cache growth), artifact-build limits (no service worker, CSP blocks tiles/fetch), accessibility (labels, focus, contrast, reduced motion), and performance (page weight, image sizes). You can run the built site: node ${P}/tools/offline-test.mjs, and screenshots with node ${P}/tools/shoot.mjs <html> <outdir> light.` },
  { key: 'requirements', prompt: `LENS: does the site deliver everything the user asked for? Go requirement by requirement (see THE USER ASKED FOR) and check the built site and data: is each section present, populated, and useful for this traveler on 8-26 Jan 2027? Does EVERY item have an image, a location with a Google Maps button, and a short description? Places: must-see AND hidden gems with time-to-explore? Exchanges: locations, branding, a clear "best"? Areas: description, best-for, drawn on a real map, Google Maps option? Music: built from the earlier research (${P}/research/prior-events-research.md) with nothing important dropped? List every gap.` },
]

phase('Review')
const reviews = await parallel(LENSES.map((l) => () => agent(`${BRIEF}\n\n${l.prompt}`, { label: 'review:' + l.key, phase: 'Review', schema: ISSUES })))
const out = {}
LENSES.forEach((l, i) => { out[l.key] = reviews[i] })
return out
