// Merges the 27 Oct 2026 food research for Places → Food into data/*.json; curate.mjs calls it after the 18+ merge.
// - research/result-food-<region>.json (phuket-west, phuket-south, phuket-town, andaman, gulf, bangkok-old, bangkok-new):
//   restaurants, street food, markets, desserts and cafes that people praise, each checked on Google Maps
// A new place goes into data/places.json with tier 'food' (it shows only under Food); a place already in the guide (the
// same id) keeps its tier, description and photo and gets the food fields (what to order, what people say, the score…).
// The basics (Phuket, Bangkok) go into data/food.json.
import fs from 'node:fs'
import path from 'node:path'
import { normArea } from './merge-islands-events.mjs'

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
// tags and runs of spaces out; "180 THB/plate" → "180 THB a plate" (the build puts the dram amount after THB)
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/\bTHB\s*\/\s*([a-z]+)\b/g, 'THB a $1') : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
const uniq = (a) => Array.from(new Set(a))
const list = (a) => (Array.isArray(a) ? a : []).filter(Boolean)
const links = (...lists) => { const seen = new Set(); return lists.flat().filter((l) => l && /^https?:\/\//i.test(l.url) && !seen.has(l.url) && seen.add(l.url)) }
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined)
export const FOOD_KINDS = ['thai', 'southern-thai', 'noodles', 'seafood', 'pork', 'grill', 'isaan', 'street-food', 'market', 'dessert', 'cafe', 'bakery', 'fine-dining', 'international']
export const FOOD_TAGS = ['pork', 'dessert', 'seafood', 'late-night', 'breakfast', 'michelin', 'view', 'beachfront', 'budget', 'group-friendly', 'vegetarian-friendly', 'halal', 'local-favourite', 'booking-needed']
const DAYS = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/
export const FOOD_FILES = ['phuket-west', 'phuket-south', 'phuket-town', 'andaman', 'gulf', 'bangkok-old', 'bangkok-new']
// read and left out: id → why
const DROP = {}
// the same place from two researchers (or a near copy): the second id → the one kept
const SAME = {}
// read again on Google Maps after the research (27 Oct 2026): fields to set
const FIX = { 'food-koh-panyee': { rating: 4.4, ratingSource: 'Google Maps (Ko Panyi village), 27 Oct 2026' } }
// fields a fresh copy gives a place already in the guide (its own description, tips and photo stay)
const FOOD_FIELDS = ['foodKind', 'foodTags', 'district', 'rating', 'reviews', 'ratingSource', 'reviewsSource', 'otherRatings', 'michelin', 'michelinNote', 'priceLevel', 'dishes', 'praise', 'watchOut', 'foodScore', 'pick']
const FRESH = ['openText', 'days', 'feeText', 'bestTime']

// the Michelin Guide Thailand 2026, in one of five words; "Not in the 2026 guide (…)" or a restaurant's own claim is not
// a listing: it goes on the card as a note
export function michelinOf(m) {
  if (!m || /^not in\b|\bsays\b|did not find|not (on|in) the/i.test(m)) return undefined
  if (/three michelin stars/i.test(m)) return '3 stars'
  if (/two michelin stars/i.test(m)) return '2 stars'
  if (/one michelin star/i.test(m)) return '1 star'
  if (/^(michelin\s+)?bib gourmand/i.test(m)) return 'Bib Gourmand'
  if (/selected|selection|listed/i.test(m)) return 'Selected'
  return undefined
}
function item(raw) {
  const it = clean(raw)
  let id = slug(it.id || it.name)
  const kind = FOOD_KINDS.includes(it.kind) ? it.kind : 'thai'
  const michelin = michelinOf(it.michelin)
  const tags = uniq(list(it.tags).filter((t) => FOOD_TAGS.includes(t) && (t !== 'michelin' || michelin)).concat(michelin ? ['michelin'] : []))
  const out = {
    id, name: it.name, nameThai: it.nameThai, tier: 'food', category: 'food', foodKind: kind, foodTags: tags,
    area: normArea(it.area || it.island), district: it.district, island: it.island,
    lat: num(it.lat), lng: num(it.lng), coordSource: it.coordSource, coordConfidence: ['high', 'medium', 'low'].includes(it.coordConfidence) ? it.coordConfidence : 'medium',
    gmapsQuery: it.gmapsQuery || [it.name, it.district, it.island].filter(Boolean).join(', '), placeId: /^ChIJ/.test(it.placeId || '') ? it.placeId : undefined,
    rating: num(it.rating), reviews: num(it.reviews), ratingSource: it.ratingSource, reviewsSource: num(it.reviews) ? it.reviewsSource : undefined,
    otherRatings: list(it.otherRatings).filter((r) => r && r.site && num(r.rating)).map((r) => ({ site: r.site, rating: num(r.rating), reviews: num(r.reviews), note: r.note, url: /^https?:\/\//.test(r.url || '') ? r.url : undefined })),
    michelin, michelinNote: !michelin && it.michelin ? it.michelin : undefined, priceLevel: num(it.priceLevel) ? Math.max(1, Math.min(4, Math.round(num(it.priceLevel)))) : undefined,
    feeText: it.priceText, dishes: list(it.dishes), praise: it.praise, watchOut: it.watchOut,
    description: it.description, openText: it.openText, days: list(it.days).filter((x) => DAYS.test(x)), bestTime: it.bestTime,
    durationLabel: '1-2h', foodScore: num(it.score) ? Math.max(1, Math.min(5, Math.round(num(it.score)))) : 3, pick: !!it.pick,
    tips: list(it.tips), links: links(list(it.links)), sources: uniq(list(it.sources)), verification: it.verification,
    imageCandidates: list(it.imageCandidates).filter((x) => x && /^https?:\/\//i.test(x.url)),
  }
  if (out.days.length === 7) out.days = []
  return Object.fromEntries(Object.entries(out).filter(([k, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length && k !== 'days')))
}
// metres between two pins
const far = (a, b) => { const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), y = b.lat - a.lat; return Math.sqrt(x * x + y * y) * 111320 }
const words = (s) => new Set(slug(s).split('-').filter((w) => w.length > 2 && !['restaurant', 'the', 'and', 'cafe', 'phuket', 'bangkok', 'shop', 'branch'].includes(w)))
// the first word that names the place (not "The", "Restaurant" or the town): Bokkia and Ann on the same street differ
const lead = (s) => [...words(s)][0] || ''
const sameName = (a, b) => !!lead(a) && lead(a) === lead(b)
// Google's own id for a listing, from a Maps link the researcher kept (…!1s0x305…:0x8f2…)
const cidOf = (u) => (String(u || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/) || [])[1] || ''

export function mergeFood(ROOT, log) {
  const P = (f) => path.join(ROOT, f)
  const rd = (f) => (fs.existsSync(P(f)) ? JSON.parse(fs.readFileSync(P(f), 'utf8')) : null)
  const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
  const got = FOOD_FILES.map((k) => [k, rd(`research/result-food-${k}.json`)]).filter(([, r]) => r)
  if (!got.length) { log.push('food: no research/result-food-*.json, skipped'); return }
  const pl = rd('data/places.json')
  const byId = new Map(pl.items.map((p) => [p.id, p]))
  const basics = {}, kept = []
  let generatedOn = '', added = 0, updated = 0
  for (const [k, r] of got) {
    if (r.generatedOn > generatedOn) generatedOn = r.generatedOn
    for (const raw of list(r.items)) {
      const f = Object.assign(item(raw), FIX[slug(raw.id || raw.name)] || {}), cid = cidOf(raw.mapsUrl) || list(raw.sources).map(cidOf).find(Boolean) || ''
      // the listing's number, for a Google Maps link that opens that exact place (maps?cid=…)
      if (cid && !f.placeId) f.gcid = BigInt(cid.split(':')[1]).toString()
      if (!f.id || !f.name) continue
      if (SAME[f.id]) { log.push(`food: ${f.id} is the same place as ${SAME[f.id]}, left out`); continue }
      if (DROP[f.id]) { log.push(`food: left out ${f.id} (${DROP[f.id]})`); continue }
      let old = byId.get(f.id)
      // the same id from two researchers: one place twice (the first copy kept), or two places of one name (Wanlamun in
      // Phuket Town and in Bangkok): the second gets its area in the id
      if (old && old.tier === 'food' && Number.isFinite(f.lat) && far(old, f) > 500) { f.id += '-' + f.area; old = byId.get(f.id) }
      if (old && old.tier === 'food') { log.push(`food: ${f.id} came twice, the first copy kept [${k}]`); continue }
      if (old) {
        // a place already in the guide: the food fields, merged links and sources; a food place also takes the fresh
        // hours and prices (a market keeps its own days and card, and shows under Food too)
        for (const x of FOOD_FIELDS) if (f[x] !== undefined) old[x] = f[x]
        if (old.category === 'food') for (const x of FRESH) if (f[x] !== undefined && !(Array.isArray(f[x]) && !f[x].length && x !== 'days')) old[x] = f[x]
        if (!old.placeId && f.placeId) old.placeId = f.placeId
        if (!old.placeId && f.gcid) old.gcid = f.gcid
        old.links = links(list(old.links), list(f.links)); old.sources = uniq(list(old.sources).concat(list(f.sources)))
        if (f.verification && old.category === 'food') old.verification = f.verification
        if (!list(old.tips).length && list(f.tips).length) old.tips = f.tips
        updated++; log.push(`food: ${f.id} already in the guide, food fields added [${k}]`)
        continue
      }
      if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) { log.push(`food: ${f.id} has no coordinates, left out`); continue }
      // the same place under another id: the same Google listing, or a close pin with a shared name word
      const twin = kept.find((x) => (f.placeId && x.placeId === f.placeId) || (cid && x.cid === cid) || (far(x, f) < 120 && sameName(x.name, f.name)))
      if (twin) { log.push(`food: ${f.id} looks like ${twin.id} (${(f.placeId && twin.placeId === f.placeId) || (cid && twin.cid === cid) ? 'same Google listing' : 'same name, ' + Math.round(far(twin, f)) + ' m'}), left out [${k}]`); continue }
      pl.items.push(f); byId.set(f.id, f); kept.push(Object.assign({ cid }, { id: f.id, name: f.name, lat: f.lat, lng: f.lng, placeId: f.placeId })); added++
    }
    for (const x of list(r.existingChecked)) if (x && x.verdict && x.verdict !== 'kept') log.push(`food: the researcher says ${x.id} is ${x.verdict}: ${x.note || ''} [${k}]`)
    const b = clean(list(r.basics)).filter((x) => x && x.title && x.text).map((x) => ({ title: x.title, text: x.text, links: links(list(x.links)) }))
    if (b.length) basics[k.startsWith('bangkok') ? 'bangkok' : 'phuket'] = (basics[k.startsWith('bangkok') ? 'bangkok' : 'phuket'] || []).concat(b)
  }
  wr('data/places.json', pl)
  wr('data/food.json', { generatedOn, basics })
  log.push(`food: ${added} new places, ${updated} already in the guide; basics for ${Object.keys(basics).join(', ') || 'nowhere'} → data/food.json`)
}
