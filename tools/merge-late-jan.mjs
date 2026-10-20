// Merges the late-January research (research/result-late-jan.json: Phuket events 18-25 Jan, the Koh Phangan
// full-moon week, flight day, solo days, places and hotels near the airport) into data/*.json.
// curate.mjs calls it after its own fixes and before place ids and area labels, so new items get both.
import fs from 'node:fs'
import path from 'node:path'
import { TRIP, inTrip, windowOf, dayLabel, phaseLabel } from './trip.mjs'

// same normalization as import.mjs
const AREA_IDS = ['patong', 'kamala', 'surin', 'bang-tao', 'layan', 'nai-thon', 'nai-yang', 'mai-khao', 'karon', 'kata', 'kata-noi', 'nai-harn', 'promthep', 'rawai', 'chalong', 'phuket-town', 'kathu', 'cape-panwa', 'ao-po', 'thalang', 'natai']
const OFF = ['phang-nga', 'khao-lak', 'krabi', 'phi-phi', 'koh-yao', 'koh-lanta', 'koh-phangan', 'koh-samui', 'koh-kaew', 'other']
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
function normArea(a) {
  const s = slug(a)
  if (AREA_IDS.includes(s) || OFF.includes(s)) return s
  const map = { 'ko-phangan': 'koh-phangan', 'ko-pha-ngan': 'koh-phangan', phangan: 'koh-phangan', 'ko-samui': 'koh-samui', samui: 'koh-samui', 'old-town': 'phuket-town', bangtao: 'bang-tao', laguna: 'bang-tao', 'khok-kloi': 'natai' }
  return map[s] || s || 'other'
}
const DUR = ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening']
const TIERS = ['luxury', 'boutique', 'mid-range', 'budget', 'hostel']
const uniq = (a) => Array.from(new Set(a))
const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length)

const KP_TIP = 'Koh Phangan is far from Phuket. The fastest way is a flight to Koh Samui, then a boat. Plan at least 2 nights.'
const SKIP = {
  'obeach-club-seen-samui-2027': 'commercial Sunday pool party on Koh Samui; on 10, 17 and 24 Jan the plan has you elsewhere',
  // the 15 Oct fact-check removed it for the same reason, and nothing has been announced since
  'black-box-samui': 'small Samui bar with irregular nights and nothing announced for 2026/27',
}
// the fact-checker could not confirm this account anywhere
const DEAD_LINKS = ['https://www.instagram.com/fake_palm/']
const links = (...lists) => { const seen = new Set(); return lists.flat().filter((l) => l && l.url && !DEAD_LINKS.includes(l.url) && !seen.has(l.url) && seen.add(l.url)) }

// fields a re-checked copy of a known event replaces; dates, links and sources are merged instead
const TAKE = ['timeText', 'priceText', 'status', 'recurrence', 'genres', 'description', 'tips', 'coordConfidence', 'coordSource', 'verification']
// after the generic merge: keep facts the researchers did not have (they only saw the ids of known items)
const AFTER = {
  'cafe-del-mar-phuket': (x, before, it) => {
    x.dates = [] // the big shows have their own cards
    x.status = before.status
    x.priceText = `${it.priceText} Big shows have their own tickets: see the Argy (8 Jan) and Marco Carola (13 Jan) cards.`
    x.description = 'Ibiza beach club at the north end of Kamala Beach, close to your base. Big DJs play afternoon-to-night shows on the outdoor Pyramid Stage: Argy on Fri 8 Jan and Marco Carola on Wed 13 Jan. Nothing is announced yet for 18-25 Jan. The Club Room has DJ nights Wed-Sat from 22:00. Stylish and expensive, not underground.'
    x.tips = [...(it.tips || []), ...(before.tips || []).filter((t) => /big shows/i.test(t))]
  },
  'o-beach-ibiza-barra-cuda-2027': (x) => {
    x.timeText = '12:00 to midnight on Fri 1, Wed 6, Fri 8, Wed 13, Fri 15, Wed 20 and Wed 27 Jan (27 Jan is after your flight). After-party tickets (entry from 9 PM) are not on sale yet.'
  },
}

// new items: the researchers listed only 18-25 Jan, so add the earlier dates their notes give
const NEW_FIX = {
  'wet-pool-party-haad-rin': (x) => { x.agendaNote = 'every afternoon of full-moon week'; x.tile = { word: 'Daily', label: '20–24' } },
  'levitate-sunset-connections': (x) => {
    x.dates = ['2027-01-08', '2027-01-15', '2027-01-22']
    x.timeText = 'Every Friday 16:00-23:45: Fri 8, 15 and 22 Jan'
  },
}

export function mergeLateJan(ROOT, log) {
  const file = path.join(ROOT, 'research/result-late-jan.json')
  if (!fs.existsSync(file)) { log.push('late jan: no research/result-late-jan.json, skipped'); return }
  const R = JSON.parse(fs.readFileSync(file, 'utf8'))
  const P = (f) => path.join(ROOT, 'data', f)
  const rd = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'))
  const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
  const data = (k) => (R[k] && R[k].data) || {}
  const added = []

  // ---- events ----
  const ev = rd('events.json')
  const byId = new Map(ev.items.map((e) => [e.id, e]))
  const fresh = clean([...(data('events-phuket-late-jan').items || []), ...(data('phangan-full-moon-week').items || [])])
  for (const it of fresh) {
    it.id = slug(it.id || it.name)
    if (SKIP[it.id]) { log.push(`late jan: left out ${it.id} (${SKIP[it.id]})`); continue }
    it.dates = uniq((it.dates || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))).sort()
    const old = byId.get(it.id)
    if (!old) {
      const e = { ...it, area: normArea(it.area || it.island), kind: ['dated', 'recurring', 'venue'].includes(it.kind) ? it.kind : 'venue', links: links(it.links) }
      if (NEW_FIX[e.id]) NEW_FIX[e.id](e)
      if (e.dates.length) e.window = windowOf(e.dates)
      ev.items.push(e); byId.set(e.id, e); added.push(['events', e])
      log.push(`late jan: new event ${e.id} (${e.dates.map((d) => Number(d.slice(8))).join(', ') || e.kind})`)
      continue
    }
    const before = JSON.parse(JSON.stringify(old))
    for (const k of TAKE) if (filled(it[k])) old[k] = it[k]
    if (filled(it.lineup)) old.lineup = it.lineup
    old.dates = uniq([...(old.dates || []), ...it.dates]).sort()
    old.links = links(old.links, it.links)
    old.sources = uniq([...(old.sources || []), ...(it.sources || [])])
    if ((before.tips || []).includes(KP_TIP) && !old.tips.includes(KP_TIP)) old.tips.push(KP_TIP)
    if (AFTER[old.id]) AFTER[old.id](old, before, it)
    if (old.dates.length) old.window = old.dates.some(inTrip) ? 'in' : old.window
    log.push(`late jan: updated event ${old.id}`)
  }
  wr('events.json', ev)

  // ---- places for the last day ----
  const pl = rd('places.json')
  for (const it of clean(data('departure-and-solo-days').places || [])) {
    it.id = slug(it.id || it.name)
    const old = pl.items.find((p) => p.id === it.id)
    if (old) {
      for (const k of ['bestTime', 'gettingThere', 'openText', 'feeText', 'tips']) if (filled(it[k])) old[k] = it[k]
      old.links = links(old.links, it.links)
      log.push(`late jan: updated place ${old.id}`)
      continue
    }
    const p = { ...it, area: normArea(it.area), durationLabel: DUR.includes(it.durationLabel) ? it.durationLabel : 'half-day', days: (it.days || []).filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x)), links: links(it.links) }
    pl.items.push(p); added.push(['places', p])
    log.push(`late jan: new place ${p.id}`)
  }
  wr('places.json', pl)

  // ---- hotels for the last nights, near the airport ----
  const ho = rd('hotels.json')
  for (const it of clean(data('departure-and-solo-days').hotels || [])) {
    it.id = slug(it.id || it.name)
    if (ho.items.some((h) => h.id === it.id)) continue
    const h = { ...it, area: normArea(it.area), tier: TIERS.includes(it.tier) ? it.tier : 'mid-range', lastNights: true, links: links(it.links) }
    ho.items.push(h); added.push(['hotels', h])
    log.push(`late jan: new hotel ${h.id}`)
  }
  wr('hotels.json', ho)

  // ---- Info sections: the Koh Phangan week, solo days and the flight home ----
  const es = rd('essentials.json')
  const sec = (id, title, items, after) => {
    if (!filled(items)) return
    es.sections = (es.sections || []).filter((s) => s.id !== id)
    const at = after ? es.sections.findIndex((s) => s.id === after) : -1
    es.sections.splice(at >= 0 ? at + 1 : es.sections.length, 0, { id, title, items })
    log.push(`late jan: Info section ${id} (${items.length} facts)`)
  }
  const fix = (items) => items.map((f) => ({
    ...f,
    text: String(f.text || '').replace('the Instagram pages of Shelter, Courage Bar, FAKE PALM and SUB', 'the Instagram pages of Shelter, Courage Bar and SUB (FAKE PALM nights show up on RA and Megatix)'),
    links: links(f.links || []),
  }))
  const phase = (id) => TRIP.phases.find((p) => p.id === id)
  sec('phangan-week', `Koh Phangan full-moon week (${phaseLabel(phase('duo'))})`, fix(clean(data('phangan-full-moon-week').logistics || [])), 'island-hopping')
  sec('solo', `Your solo days (${phaseLabel(phase('solo'))})`, fix(clean(data('departure-and-solo-days').solo || [])), 'safety-law')
  sec('departure', `Flight home: ${dayLabel(TRIP.flight.day)}, ${TRIP.flight.time}`, fix(clean(data('departure-and-solo-days').departure || [])))
  wr('essentials.json', es)

  // ---- verification log ----
  const lg = rd('research-log.json')
  for (const [k, v] of Object.entries(R)) { lg.changes['late-jan:' + k] = (v && v.changes) || []; lg.removed['late-jan:' + k] = (v && v.removed) || [] }
  wr('research-log.json', lg)

  // ---- photo search list for the new items (photos workflow) ----
  const picks = fs.existsSync(P('image-picks.json')) ? JSON.parse(fs.readFileSync(P('image-picks.json'), 'utf8')) : []
  const have = new Set(picks.filter((p) => p && p.ok).map((p) => p.key))
  const site = (it) => (it.website && /^https?:/.test(it.website) ? it.website : ((it.links || []).find((l) => /^https?:/.test(l.url)) || {}).url)
  const kindOf = { events: (e) => 'music event / venue', places: (p) => `${p.tier} / ${p.category}`, hotels: (h) => `hotel (${h.tier})` }
  const want = added.filter(([k, it]) => !have.has(`${k}:${it.id}`)).map(([k, it]) => ({
    key: `${k}:${it.id}`, kind: kindOf[k](it), name: it.name, where: [it.venue, it.area, it.island].filter(Boolean).join(', '),
    gmapsQuery: it.gmapsQuery, website: site(it), candidates: it.imageCandidates || [],
  }))
  // written only when something still needs a photo, so the wave-7 search list is kept once photos exist
  if (want.length) {
    fs.writeFileSync(path.join(ROOT, 'research/photo-items-wave7.json'), JSON.stringify(want, null, 1))
    log.push(`late jan: ${want.length} new items need a photo (research/photo-items-wave7.json)`)
  } else log.push('late jan: every new item has a photo')
}
