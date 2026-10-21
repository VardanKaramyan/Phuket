// Merges the 21 Oct 2026 research into data/*.json; curate.mjs calls it after the islands merge.
// - research/result-bangkok-events.json: music nights in Bangkok during the trip → data/events.json
// - research/result-bangkok-places.json: places in and around Bangkok → data/places.json, and the Bangkok basics
//   (getting there and around, where to stay, safety) → data/bangkok.json
// - research/result-clubs.json: the clubs, party series and festivals for Places → Clubs & festivals → data/clubs.json,
//   and their nights that were not in the guide yet → data/events.json
// An item whose id is already in the guide is left as it is.
import fs from 'node:fs'
import path from 'node:path'
import { windowOf } from './trip.mjs'
import { normArea } from './merge-islands-events.mjs'

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
const uniq = (a) => Array.from(new Set(a))
// web links only (the research comes from web pages: no javascript: or data: links)
const links = (...lists) => { const seen = new Set(); return lists.flat().filter((l) => l && /^https?:\/\//i.test(l.url) && !seen.has(l.url) && seen.add(l.url)) }
const score = (v) => Math.max(0, Math.min(5, Math.round(Number(v) || 0)))
const list = (a) => (a || []).filter(Boolean)
// "HORN (queer techno club, Silom Soi 4)" → "HORN": the card's second line already says what and where it is
const short = (s) => String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || s
// the same score as their cards in Music (the research scored them 4: Courage's nights are mostly bass and garage,
// Unclave plays minimal house)
const CLUB_SCORE = { 'club-courage-phuket-town': 5, 'club-unclave-phangan': 5 }
// Bangkok, and Ayutthaya north of it (a day trip)
const bkkArea = (x) => (Number(x.lat) > 14.2 ? 'ayutthaya' : 'bangkok')
const TIERS = ['must-see', 'hidden-gem', 'day-trip']
const CATS = { temple: 'temple', market: 'market', shopping: 'market', food: 'food', nightlife: 'nightlife', viewpoint: 'viewpoint', culture: 'culture', activity: 'activity', nature: 'nature', wellness: 'wellness' }
const DUR = ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening']
// read and left out
const DROP = {
  'muuji-festival-2027': 'Japanese pop and indie in Khao Yai, 170 km from Bangkok: not this group\'s music',
  // clubs that have their own card in Clubs & festivals (and Mustache in Music): not a second time as a place
  'bkk-mustache-decho-road': 'in Music', 'bkk-subwerk': 'a club card', 'bkk-elsewhere-silom': 'a club card', 'bkk-bar-temp': 'a club card',
}

function event(raw, area) {
  const it = clean(raw)
  const e = {
    ...it, id: slug(it.id || it.name), name: short(it.name), kind: ['dated', 'recurring', 'venue'].includes(it.kind) ? it.kind : 'venue', area,
    dates: uniq(list(it.dates).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))).sort(), undergroundScore: score(it.undergroundScore), pick: !!it.pick,
    genres: list(it.genres), links: links(list(it.links)), sources: uniq(list(it.sources)), tips: list(it.tips),
  }
  // a club night with no listed dates is on during the trip, like the other venues
  e.window = e.dates.length ? windowOf(e.dates) : 'in'
  return e
}

export function mergeBangkok(ROOT, log) {
  const P = (f) => path.join(ROOT, f)
  const rd = (f) => (fs.existsSync(P(f)) ? JSON.parse(fs.readFileSync(P(f), 'utf8')) : null)
  const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
  const bev = rd('research/result-bangkok-events.json'), bpl = rd('research/result-bangkok-places.json'), cl = rd('research/result-clubs.json')
  if (!bev && !bpl && !cl) { log.push('bangkok: no research/result-bangkok-*.json or result-clubs.json, skipped'); return }

  // ---- events: Bangkok nights, and the club nights not in the guide yet ----
  const ev = rd('data/events.json')
  const have = new Set(ev.items.map((e) => e.id))
  const addEvent = (raw, area, from) => {
    const e = event(raw, area)
    if (DROP[e.id]) { log.push(`bangkok: left out ${e.id} (${DROP[e.id]})`); return }
    if (!e.id || have.has(e.id)) { log.push(`bangkok: ${from} event ${e.id} is already in the guide, left as it is`); return }
    ev.items.push(e); have.add(e.id); log.push(`bangkok: new event ${e.id} [${from}]`)
  }
  for (const x of bev?.items || []) addEvent({ ...x, island: 'Bangkok' }, 'bangkok', 'bangkok-events')
  for (const x of cl?.newEvents || []) addEvent(x, normArea(x.area || x.island), 'clubs')
  wr('data/events.json', ev)

  // ---- places in and around Bangkok, and the Bangkok basics ----
  if (bpl) {
    const pl = rd('data/places.json')
    const ids = new Set(pl.items.map((p) => p.id))
    for (const raw of bpl.items || []) {
      const it = clean(raw)
      let id = slug(it.id || it.name)
      if (!id.startsWith('bkk-')) id = 'bkk-' + id
      if (DROP[id]) { log.push(`bangkok: left out ${id} (${DROP[id]})`); continue }
      if (ids.has(id)) { log.push(`bangkok: place ${id} is already in the guide, left as it is`); continue }
      const food = it.tier === 'food' || it.category === 'food'
      pl.items.push({
        ...it, id, area: bkkArea(it), tier: TIERS.includes(it.tier) ? it.tier : 'hidden-gem', category: food ? 'food' : CATS[it.category] || 'activity',
        durationLabel: DUR.includes(it.durationLabel) ? it.durationLabel : 'half-day', days: list(it.days).filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x)),
        links: links(list(it.links)), sources: uniq(list(it.sources)), tips: list(it.tips),
      })
      ids.add(id); log.push(`bangkok: new place ${id}`)
    }
    wr('data/places.json', pl)
    const basics = clean(bpl.essentials || []).map((x) => ({ title: x.title, text: x.text, links: links(list(x.links)) }))
    wr('data/bangkok.json', { generatedOn: bpl.generatedOn, essentials: basics })
    log.push(`bangkok: ${basics.length} basics → data/bangkok.json`)
  }

  // ---- clubs, party series and festivals ----
  if (cl) {
    // a club's nights: the ones the research named, and the Bangkok nights held at it (by the venue's name)
    const named = (c) => { const k = slug(c.name).replace(/^club-/, ''); return k.length < 5 ? [] : ev.items.filter((e) => e.area === 'bangkok' && [e.venue, e.name].some((s) => slug(s).includes(k))).map((e) => e.id) }
    const items = clean(cl.clubs || []).map(({ newEventIds, ...c }) => {
      let id = slug(c.id || c.name)
      if (!id.startsWith('club-')) id = 'club-' + id
      const area = normArea(c.area || c.island)
      return {
        ...c, id, name: short(c.name), kind: ['club', 'party-series', 'festival'].includes(c.kind) ? c.kind : 'club', area, undergroundScore: CLUB_SCORE[id] ?? score(c.undergroundScore),
        events: uniq([...list(c.events), ...list(newEventIds)].map(slug).concat(area === 'bangkok' ? named(c) : [])).filter((x) => have.has(x)),
        links: links(list(c.links)), sources: uniq(list(c.sources)), tips: list(c.tips),
      }
    })
    wr('data/clubs.json', { generatedOn: cl.generatedOn, items })
    log.push(`bangkok: ${items.length} clubs and festivals → data/clubs.json`)
  }
}
