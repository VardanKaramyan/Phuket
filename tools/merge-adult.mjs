// Merges the 23 Oct 2026 research for Places → 18+ and Weed into data/*.json; curate.mjs calls it after the Bangkok merge.
// - research/result-adult-phuket.json, result-adult-away.json: adult nightlife on Phuket, in Bangkok, on Koh Phangan and Samui
// - research/result-cannabis-phuket.json, result-cannabis-away.json: cannabis shops in the same places, and the law
// The venues and shops go into data/places.json with tier 'adult' (the shops with category 'cannabis'), so votes, Saved,
// Share, the map and drive times work for them like for any place. The basics (law, safety, prices) go into data/adult.json.
// An item whose id is already in the guide is left as it is.
import fs from 'node:fs'
import path from 'node:path'
import { normArea } from './merge-islands-events.mjs'

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
// tags and runs of spaces out; "450 THB/g" → "450 THB a gram" (the build puts the dram amount after THB, which would split "THB/g")
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/\bTHB\s*\/\s*(g|gram)\b/g, 'THB a gram') : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
const uniq = (a) => Array.from(new Set(a))
const list = (a) => (a || []).filter(Boolean)
// web links only (the research comes from web pages: no javascript: or data: links)
const links = (...lists) => { const seen = new Set(); return lists.flat().filter((l) => l && /^https?:\/\//i.test(l.url) && !seen.has(l.url) && seen.add(l.url)) }
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined)
const score = (v) => (num(v) === undefined ? undefined : Math.max(1, Math.min(5, Math.round(Number(v)))))
const KINDS = ['bar-street', 'go-go', 'cabaret', 'show', 'gentlemens-club', 'massage', 'lgbtq', 'kratom', 'party-drugs-warning', 'activity', 'other', 'cannabis']
const DUR = ['1-2h', '2-3h', 'evening']
const DAYS = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/
// read and left out
const DROP = {}
// the 18+ basics: two researchers wrote the law and the bills; keep one of each, the law first
const BASICS_DROP = {
  'The law': 'the Bangkok list\'s law topic says the same and adds the under-18 rules',
  'Bills, lady drinks and photos in go-go bars': 'the same as Touts, bills and cards; its new facts are added there',
}
const BASICS_ADD = {
  'Touts, bills and cards': 'Never take photos inside a go-go bar: security reacts fast. Upstairs in Patpong, bills of 5,000-10,000 THB are reported.',
}
const BASICS_RENAME = { 'Closing times, ID and holy days': 'Bangkok: closing times, ID and holy days', 'Drugs, raids and urine tests in Bangkok': 'Bangkok: drugs, raids and urine tests' }
const BASICS_FIRST = /^The law/
// the weed lists of both researchers had these two; the Phuket list's 'Do not trust the stars' and 'How to spot fresh flower' stay
const WEED_BASICS_DROP = new Set(['How to read the 5.0 ratings', 'How to check the flower in the shop'])
// a weed topic on what a gram costs repeats the price guide, which the build shows first: kept only when there is none
// the user, 23 Oct 2026: no law, prescription or where-to-smoke topics for weed, only the shops and buying
const NO_LAW = /\b(law|legal|illegal|prescription|licen[cs]e|police|raid|fine|smok|enforce|arrest|airport|flight|ferr)/i

function place(raw, weed) {
  const it = clean(raw)
  let id = slug(it.id || it.name)
  const pre = weed ? 'weed-' : 'adult-'
  if (!id.startsWith(pre)) id = pre + id
  const kind = weed ? 'cannabis' : KINDS.includes(it.kind) ? it.kind : 'other'
  const out = {
    id, name: it.name, nameThai: it.nameThai, tier: 'adult', category: kind, area: normArea(it.area || it.island), island: it.island,
    lat: num(it.lat), lng: num(it.lng), coordSource: it.coordSource, coordConfidence: ['high', 'medium', 'low'].includes(it.coordConfidence) ? it.coordConfidence : 'medium',
    gmapsQuery: it.gmapsQuery || [it.name, it.island].filter(Boolean).join(', '), placeId: /^ChIJ/.test(it.placeId || '') ? it.placeId : undefined,
    rating: num(it.rating), reviews: num(it.reviews), ratingSource: it.ratingSource,
    durationLabel: DUR.includes(it.durationLabel) ? it.durationLabel : weed ? '1-2h' : 'evening',
    openText: it.openText, days: list(it.days).filter((x) => DAYS.test(x)), feeText: it.priceText,
    description: it.description, tips: list(it.tips).filter((t) => !weed || !/prescription/i.test(t)), links: links(list(it.links)), sources: uniq(list(it.sources)), verification: it.verification,
    imageCandidates: list(it.imageCandidates).filter((x) => x && /^https?:\/\//i.test(x.url)),
  }
  if (weed) Object.assign(out, {
    priceGram: it.priceGram && num(it.priceGram.min) !== undefined ? { min: num(it.priceGram.min), max: num(it.priceGram.max) ?? num(it.priceGram.min) } : undefined,
    quality: it.quality, usersSay: it.usersSay, lounge: it.lounge,
    valueScore: score(it.valueScore), qualityScore: score(it.qualityScore), pick: !!it.pick,
  })
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

export function mergeAdult(ROOT, log) {
  const P = (f) => path.join(ROOT, f)
  const rd = (f) => (fs.existsSync(P(f)) ? JSON.parse(fs.readFileSync(P(f), 'utf8')) : null)
  const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
  const files = [['research/result-adult-phuket.json', false], ['research/result-adult-away.json', false], ['research/result-cannabis-phuket.json', true], ['research/result-cannabis-away.json', true]]
  const got = files.map(([f, weed]) => [f, weed, rd(f)]).filter(([, , r]) => r)
  if (!got.length) { log.push('adult: no research/result-adult-*.json or result-cannabis-*.json, skipped'); return }

  const pl = rd('data/places.json')
  const ids = new Set(pl.items.map((p) => p.id))
  const basics = { adult: [], weed: [] }, priceGuide = {}
  let generatedOn = ''
  for (const [f, weed, r] of got) {
    if (r.generatedOn > generatedOn) generatedOn = r.generatedOn
    for (const raw of r.items || []) {
      const p = place(raw, weed)
      if (DROP[p.id]) { log.push(`adult: left out ${p.id} (${DROP[p.id]})`); continue }
      if (ids.has(p.id)) { log.push(`adult: ${p.id} is already in the guide, left as it is`); continue }
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) { log.push(`adult: ${p.id} has no coordinates, left out`); continue }
      pl.items.push(p); ids.add(p.id); log.push(`adult: new ${weed ? 'shop' : 'place'} ${p.id} [${path.basename(f, '.json').replace('result-', '')}]`)
    }
    basics[weed ? 'weed' : 'adult'].push(...clean(r.basics || []).filter((x) => !weed || !(NO_LAW.test(x.title) || WEED_BASICS_DROP.has(x.title) || (r.priceGuide && /what a gram costs/i.test(x.title)))).map((x) => ({ title: x.title, text: x.text, links: links(list(x.links)) })))
    // one sentence for the whole file (Phuket) or one per place (the others)
    const pg = clean(r.priceGuide)
    if (typeof pg === 'string' && pg) priceGuide.phuket = pg
    else if (pg && typeof pg === 'object') for (const [k, v] of Object.entries(pg)) if (v) priceGuide[normArea(k)] = v
  }
  basics.adult = basics.adult.filter((x) => !BASICS_DROP[x.title]).map((x) => ({ ...x, title: BASICS_RENAME[x.title] || x.title, text: BASICS_ADD[x.title] ? x.text + ' ' + BASICS_ADD[x.title] : x.text }))
  basics.adult.sort((a, b) => BASICS_FIRST.test(b.title) - BASICS_FIRST.test(a.title))
  wr('data/places.json', pl)
  wr('data/adult.json', { generatedOn, basics, priceGuide })
  log.push(`adult: ${basics.adult.length} 18+ basics, ${basics.weed.length} weed basics, price guides for ${Object.keys(priceGuide).join(', ') || 'nowhere'} → data/adult.json`)
}
