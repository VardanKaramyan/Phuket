// Editorial pass after import: merge duplicates that two researchers both covered, drop items that only repeat
// another card, and report near-duplicates for a manual look. Edits data/*.json in place.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as turf from '@turf/turf'
import { mergeLateJan } from './merge-late-jan.mjs'
import { mergeIslandsEvents } from './merge-islands-events.mjs'
import { inTrip } from './trip.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, 'data', ...a)
const rd = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'))
const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
const log = []
// curate edits data/*.json in place (it appends tips), so it must run once per fresh import: use `npm run data`
{
  const lg = rd('research-log.json')
  if (lg.curated) {
    console.error('data/ is already curated, or an earlier curate run stopped halfway. Run `npm run data` (a fresh import, then curate, then the apps import) instead of curate.mjs alone.')
    process.exit(1)
  }
  // marked before the first write, so a run that crashes halfway cannot be repeated on half-curated data
  lg.curated = 'started'; wr('research-log.json', lg)
}

// ---- events ----
const ev = rd('events.json')
const DROP_EVENTS = {
  // the weekly OXA night is covered by the recurring card (same party, same Fridays)
  'oxa-jungle-party-jan-2027': 'same party as the weekly OXA Jungle Party card',
  // Barra Cuda's only programme is the O Beach Ibiza pool party, which has its own dated card
  'barra-cuda-beach-club': 'same venue and party as the O Beach Ibiza at Barra Cuda card',
}
const keep = []
for (const e of ev.items) {
  if (DROP_EVENTS[e.id]) {
    log.push(`events: dropped ${e.id} (${DROP_EVENTS[e.id]})`)
    continue
  }
  keep.push(e)
}
// the recurring OXA card inherits the dated card's verified dates inside the trip if it lost them
const oxa = keep.find((e) => e.id === 'oxa-jungle-party')
const oxaDated = ev.items.find((e) => e.id === 'oxa-jungle-party-jan-2027')
if (oxa && oxaDated && !(oxa.dates || []).length) oxa.dates = (oxaDated.dates || []).filter(inTrip)
// items far from Phuket labelled only "Other": name the place from the venue text instead
for (const e of keep) {
  if (String(e.island || '').toLowerCase() === 'other' && e.venue) {
    const place = String(e.venue).replace(/\(.*?\)/g, '').split(',').pop().trim()
    if (place) { e.island = place; log.push(`events: ${e.id} place label -> ${place}`) }
  }
}
ev.items = keep
wr('events.json', ev)

// ---- places: same place listed by two researchers ----
const pl = rd('places.json')
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\b(beach|the|phuket)\b/g, '').trim()
const dist = (a, b) => {
  const R = 6371, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const tierRank = { 'must-see': 0, 'hidden-gem': 1, 'day-trip': 2 }
const out = []
for (const p of pl.items) {
  const twin = out.find((q) => norm(q.name) === norm(p.name))
  if (!twin) {
    const near = out.find((q) => q.category === p.category && dist(q, p) < 0.12)
    if (near) log.push(`places: CHECK "${p.name}" is ${Math.round(dist(near, p) * 1000)} m from "${near.name}" (same category), kept both`)
    out.push(p); continue
  }
  // keep the richer card; prefer the must-see tier
  const better = (tierRank[p.tier] ?? 9) < (tierRank[twin.tier] ?? 9) || (JSON.stringify(p).length > JSON.stringify(twin).length * 1.3)
  log.push(`places: merged duplicate "${p.name}" (${p.id}) with "${twin.name}" (${twin.id}), kept ${better ? p.id : twin.id}`)
  if (better) out[out.indexOf(twin)] = p
}
pl.items = out
wr('places.json', pl)

// ---- hotels: same hotel twice ----
const ho = rd('hotels.json')
const seen = new Map()
ho.items = ho.items.filter((h) => { const k = norm(h.name); if (seen.has(k)) { log.push(`hotels: dropped duplicate ${h.id}`); return false } seen.set(k, 1); return true })
wr('hotels.json', ho)

// ---- fixes from the QA review (each one was checked by a reviewer; see research/qa-result.json) ----
{
  const evd = rd('events.json'), byId = (arr, id) => arr.find((x) => x.id === id)
  const e = (id, fn) => { const x = byId(evd.items, id); if (x) { fn(x); log.push(`events: fixed ${id}`) } else log.push(`events: MISSING ${id} (fix skipped)`) }
  e('cafe-del-mar-pyramid-2027-01-08', (x) => {
    x.name = 'Argy at Café del Mar (Pyramid Stage)'; x.lineup = ['Argy']; x.status = 'listed'
    x.priceText = 'On sale Tue 20 Oct 2026, 18:00 Thai time, on Megatix: Limited Presale 900 THB (entry by 16:00), 1st Release 1,700 THB (entry by 18:00), Anytime Entry 2,500 THB with 1 drink. Clubroom after-party from 23:00: 800 THB.'
    x.timeText = 'Fri 8 Jan, 14:00 to 22:30 on the Pyramid Stage; Clubroom after-party from 23:00'
    x.description = 'Argy plays the Pyramid Stage at Café del Mar on your arrival day: melodic house and techno on the beach at Kamala, from the afternoon to 22:30, then an after-party in the Clubroom.'
    x.tips = (x.tips || []).filter((t) => !/secret/i.test(t)).concat(['Each ticket has an entry time. Late entry can be refused or cost 500 THB, so plan your airport transfer.'])
    x.links = [{ label: 'Event page', url: 'https://phuket.cafedelmar.com/events/argy-jan2027' }, { label: 'Tickets (Café del Mar on Megatix)', url: 'https://megatix.in.th/cafedelmarphuket' }, { label: 'Presale sign-up', url: 'https://laylo.com/cdm/argy-jan8' }]
  })
  e('shelter-phuket', (x) => { x.dates = ['2027-01-08', '2027-01-09', '2027-01-15', '2027-01-16', '2027-01-22', '2027-01-23']; x.recurrence = 'Most Fridays and Saturdays, usually 23:30 to 04:00. Check the line-up first: some weekends have no Shelter night.' })
  e('marco-carola-cafe-del-mar-2027', (x) => {
    x.priceText = 'Megatix, 15 Oct 2026: Early Bird 1,900 and 1st Release 2,500 THB are sold out. Final Release 3,000 THB (entry by 18:00), Anytime Entry 5,000 THB with 1 drink. The Clubroom after-party from 23:00 is a separate 1,200 THB ticket (sold out).'
    x.tips = (x.tips || []).concat(['Ticket tiers sell out fast: buy early.'])
  })
  e('cafe-del-mar-phuket', (x) => { // its shows on 8 and 13 Jan have their own cards
    x.dates = []
    x.priceText = 'Day entry and Club Room nights vary. Big shows have their own tickets: see the Argy (8 Jan) and Marco Carola (13 Jan) cards.'
  })
  e('waterfall-festival-phangan', (x) => {
    x.name = 'Waterfall Festival'; x.status = 'unconfirmed'; x.dates = ['2027-01-13', '2027-01-20', '2027-01-24']
    x.recurrence = '2 days before and 2 days after each Full Moon Party (about 20 and 24 Jan), plus special nights. In Jan 2026 it also ran some extra nights, so 13 Jan is possible but not announced.'
  })
  e('halfmoon-festival-jan-2027', (x) => { x.extraMaps = [{ label: 'Day 1: Harmony Beach Club', q: 'Harmony Beach Club, Ban Tai, Koh Phangan' }] })
  wr('events.json', evd)

  const pld = rd('places.json')
  const p = (id, fn) => { const x = byId(pld.items, id); if (x) { fn(x); log.push(`places: fixed ${id}`) } else log.push(`places: MISSING ${id} (fix skipped)`) }
  const PIERS = {
    chalong: [7.820855, 98.344423, 'Directions to Chalong Pier'], rassada: [7.872544, 98.414305, 'Directions to Rassada Pier'],
    aopor: [8.060937, 98.432937, 'Directions to Ao Po Pier'], thaplamu: [8.57013, 98.223243, 'Directions to Thap Lamu Pier'],
    bangrong: [8.049466, 98.415914, 'Directions to Bang Rong Pier'],
  }
  const pier = (id, k) => p(id, (x) => { const [la, ln, lab] = PIERS[k]; Object.assign(x, { dirLat: la, dirLng: ln, dirLabel: lab }) })
  pier('koh-racha-yai', 'chalong'); pier('coral-island-koh-hey', 'chalong'); pier('phi-phi-maya-bay', 'rassada'); pier('railay-krabi', 'rassada')
  pier('hong-by-starlight', 'aopor'); pier('phang-nga-bay-james-bond', 'aopor'); pier('similan-islands', 'thaplamu'); pier('koh-yao-noi', 'bangrong')
  p('khai-islands', (x) => { x.noDirections = true }); p('koh-hong-krabi', (x) => { x.noDirections = true })
  p('kruvit-raft', (x) => Object.assign(x, { dirLat: 7.934983, dirLng: 98.407818, dirLabel: 'Directions to Laem Hin Pier' }))
  p('samet-nangshe-viewpoint', (x) => Object.assign(x, { dirLat: 8.235093, dirLng: 98.445248, dirLabel: 'Directions to the car park' }))
  p('phuket-elephant-sanctuary', (x) => {
    Object.assign(x, { dirLat: 8.026009, dirLng: 98.401535, dirLabel: 'Directions to the office' })
    x.tips = (x.tips || []).concat(["Google's pin for the sanctuary is about 650 m from the meeting office. Use 'Directions to the office'."])
  })
  p('karon-temple-market', (x) => { x.gmapsQuery = 'Karon Temple Market, Karon, Phuket'; x.placeIdLocked = true })
  p('koh-phangan-rave-trip', (x) => {
    // the group stays in Phuket (the Patong villa 8-14 Jan, the Rawai villa 14-18 Jan, booked 19 Oct 2026), so the
    // window is the two of you in full-moon week (19-23 Jan)
    x.name = 'Koh Phangan rave trip (2-5 days)'
    x.bestTime = 'For the two of you: Tue 19 to Sat 23 Jan, the full-moon week, then fly back for the last Circoloco on Sat 23. The group stays in Phuket (the Patong villa 8 to 14 Jan, the Rawai villa 14 to 18 Jan). See Info, Koh Phangan full-moon week.'
    x.description = "Thailand's party island, in the Gulf. Most jungle raves are inland near Ban Tai. While the group is in Phuket: OXA (Fri 8 and 15 Jan), Lost Jungle psytrance (Sat 9 to Mon 11) and Halfmoon (Fri 15 - Sat 16). In full-moon week: OXA (Tue 19), Waterfall (Wed 20), Jungle Experience (Thu 21) and the Full Moon Party (Fri 22 Jan)."
    x.gettingThere = String(x.gettingThere || '').replace('Bangkok Airways Phuket - Koh Samui (about 1 h, several flights a day), then', 'Bangkok Airways Phuket - Koh Samui (about 1 h, 8 flights a day; take one at 14:15 or earlier to catch the boats), then')
    x.tips = (x.tips || []).concat(['Full-moon week (20-24 Jan): rooms cost 2-3 times more and many ask for a 3-5 night minimum. Book in October or November. Ban Tai is the best base.'])
    x.feeText = String(x.feeText || '').replace(/from about 2,200 THB one way/g, 'about 3,000 to 5,000 THB one way')
  })
  p('nai-yang-beach', (x) => { x.tips = (x.tips || []).map((t) => /plane/i.test(t) ? 'Plane spotting: the south end of Mai Khao Beach, best from late morning to about 14:00 (see its card).' : t) })
  // photo agent found Thai news (ThaiPBS, Ch7, about late 2025) of a landslide that closed the golden-rock replica
  p('koh-sirey', (x) => { x.tips = (x.tips || []).concat(['Thai news reported that a landslide damaged the golden-rock shrine at Wat Koh Sirey (late 2025). Ask locally whether it has reopened.']) })
  p('lock-tien', (x) => { x.gmapsQuery = 'ลกเที้ยน original, 59/14 Bangkok Rd, Phuket'; x.placeIdLocked = true })
  // restore plane spotting: removed by mistake as a duplicate of a must-see card that never existed
  if (!byId(pld.items, 'mai-khao-plane-spotting')) {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/raw/research_places-hidden-gems.json'), 'utf8')).items.find((x) => x.id === 'mai-khao-plane-spotting')
    if (raw) {
      const x = Object.assign({}, raw, { tier: 'must-see', area: 'mai-khao', lat: 8.11179, lng: 98.30185, coordSource: 'osm+commons geotags', coordConfidence: 'high' })
      x.bestTime = 'Late afternoon. In January most planes land over the sea, passing low over this beach.'
      x.tips = (x.tips || []).filter((t) => !/december to june/i.test(t)).concat(['Watching is free. A motorbike taxi from the car park costs about 20 THB (2026).'])
      x.verification = 'Restored after QA: coordinates from OSM plus two Commons geotags (about 160 m west of the runway 09 threshold).'
      pld.items.push(x); log.push('places: restored mai-khao-plane-spotting')
    }
  }
  wr('places.json', pld)

  const ard = rd('areas.json')
  const a = (id, fn) => { const x = byId(ard.items, id); if (x) { fn(x); log.push(`areas: fixed ${id}`) } }
  a('cape-panwa', (x) => { x.gmapsQuery = 'Cape Panwa, Wichit, Phuket'; x.placeIdLocked = true })
  a('thalang', (x) => { x.gmapsQuery = 'Thalang District, Phuket'; x.placeIdLocked = true })
  // Niky's Speakeasy could not be confirmed for 2026: take it out of the area texts
  const dropNikys = (t) => typeof t === 'string' ? t.replace(/,?\s*(and\s+)?Niky'?s( Speakeasy)?( \([^)]*\))?/g, '').replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim() : t
  for (const x of ard.items) {
    for (const k of ['tagline', 'description', 'stayIf', 'beach']) if (typeof x[k] === 'string' && /Niky/.test(x[k])) { x[k] = dropNikys(x[k]); log.push(`areas: removed Niky's from ${x.id}.${k}`) }
    if (Array.isArray(x.highlights)) { const before = x.highlights.length; x.highlights = x.highlights.filter((h) => !/Niky/.test(h)); if (x.highlights.length !== before) log.push(`areas: removed Niky's highlight from ${x.id}`) }
    if (Array.isArray(x.links)) x.links = x.links.filter((l) => !/niky/i.test((l.label || '') + (l.url || '')))
    if (Array.isArray(x.tips)) x.tips = x.tips.filter((t) => !/Niky/.test(t))
  }
  if (/Niky/.test(ard.recommendation || '')) ard.recommendation = ''
  a('natai', (x) => { x.stayIf = 'Stay here if you find a room: on the Circoloco Saturdays (9, 16 and 23 Jan) rooms are sold out or very expensive. The group sleeps in its booked villas (Patong to 14 Jan, Rawai to 18 Jan) and books a driver: about 1 hour from Patong, 1 hour 10 from Rawai.' })
  // the two Bang Tao sentences that the removal above leaves broken
  a('bang-tao', (x) => {
    x.tagline = 'Long beach, top restaurants and beach clubs'
    x.description = String(x.description).replace(/Catch and Xana beach clubs have DJs[^.]*\./, 'Catch and Xana are the big beach clubs.')
  })
  wr('areas.json', ard)

  const hod = rd('hotels.json')
  const baba = byId(hod.items, 'baba-beach-club-natai')
  if (baba) {
    baba.noRoomsOnTrip = 'No rooms 8–27 Jan'
    baba.whyStay = 'The Circoloco venue itself: a music hotel on Natai Beach with a Funktion-One sound system. No rooms are on sale for 8 to 27 Jan 2027, so for this trip it is your party venue. Book a driver from the villa: about 1 hour from Patong (9 Jan), 1 hour 10 from Rawai (16 Jan).'
    log.push('hotels: flagged Baba Beach Club (no rooms on the trip dates)')
  }
  const nh = byId(hod.items, 'natai-house')
  if (nh) nh.whyStay = 'Small owner-run resort 2 to 3 minutes from Natai Beach and 3 minutes by car from Baba Beach Club. Good value on Fridays and Sundays; Sat 9 and Sat 16 Jan showed no rooms online (Oct 2026).'
  const al = byId(hod.items, 'aleenta-phuket-phang-nga')
  if (al && !/45,000/.test(al.priceText || '')) al.tips = (al.tips || []).concat(['On the Circoloco Saturdays it costs about 45,000 to 52,000 THB per night.'])
  wr('hotels.json', hod)

  const mxd = rd('exchanges.json')
  const br = (id, i, fn) => { const b = byId(mxd.brands || [], id); const x = b && (b.branches || [])[i]; if (x) { fn(x); log.push(`money: fixed ${id}#${i}`) } }
  // sign colours as seen on the shop photos (the research only had website colours)
  const brand = (id, fn) => { const b = byId(mxd.brands || [], id); if (b) { b.branding = b.branding || {}; fn(b.branding); log.push(`money: branding ${id}`) } }
  brand('mamy-exchange', (x) => Object.assign(x, { primaryColor: '#178C43', secondaryColor: '#FFFFFF', howToRecognize: "A green 'Mamy Exchange' sign with white letters over a roadside shop on Thepkrasattri Rd (route 402) in Koh Kaew." }))
  brand('lion-currency-exchange', (x) => Object.assign(x, { primaryColor: '#1C2566', secondaryColor: '#FFFFFF', accentColor: '#E2DC2A', logoText: 'LION Currency Exchange', howToRecognize: "A white marble counter in a navy frame with a yellow lion-head logo, blue 'LION' letters and a white lit 'CURRENCY EXCHANGE' sign above. Ground floor of Jungceylon, Botanica zone (Big C side)." }))
  brand('value-plus', (x) => Object.assign(x, { primaryColor: '#1B2A5A', secondaryColor: '#FFFFFF', accentColor: '#E31B23', howToRecognize: "A navy sign with white 'Value+ Plus' letters and red trim, over a red 'CURRENCY EXCHANGE' counter." }))
  { const sr = byId(mxd.brands || [], 'superrich-1965-phuket'); if (sr) sr.cons = (sr.cons || []).concat(['The sign in the photo says open daily; the official branch page (Sep 2026) says closed on Sundays.']) }
  br('value-plus', 1, (x) => { x.gmapsQuery = '7.892790,98.299473'; x.placeIdLocked = true })
  br('value-plus', 3, (x) => { x.gmapsQuery = 'Value Plus Currency Exchange (Central Porto De), Cherngtalay, Phuket'; x.placeIdLocked = true })
  br('money-shop', 1, (x) => { x.gmapsQuery = 'Exchange, 100 Karon Rd, Karon, Phuket'; x.placeId = 'ChIJw0EoZAAlUDARmp-Rwqi4JLw'; x.placeIdLocked = true })
  br('money-shop', 6, (x) => { x.gmapsQuery = 'Money Shop Exchange Central, Wichit, Phuket'; x.placeId = 'ChIJFz-fz-IxUDARphiV2OFNfAU'; x.placeIdLocked = true })
  wr('exchanges.json', mxd)

  const esd = rd('essentials.json')
  for (const sec of esd.sections || []) for (const it of sec.items || []) {
    if (/rainy season is usually November to March/i.test(it.text || '')) {
      it.text = it.text.replace(/\s*[^.]*rainy season is usually November to March[^.]*\./i, " Koh Phangan's rainy season is roughly October to December. January still gets some showers (about 130 mm on 8 to 9 days, against about 30 mm in Phuket), so rain and choppy seas are more likely there.")
      log.push('essentials: fixed the Koh Phangan rainy season')
    }
  }
  wr('essentials.json', esd)
}

// ---- the trip is 8 to 26 Jan (group 8-18, two people 19-23, solo 24-26, flight 26 Jan 18:20): fix texts written for 8-18 ----
{
  const swap = (file, listKey, id, field, from, to) => {
    const d = rd(file)
    const list = listKey ? d[listKey] : d
    const it = (list || []).find((x) => x.id === id || x.title === id)
    if (!it) { log.push(`trip length: MISSING ${file} ${id}`); return }
    const set = (obj, key) => { if (typeof obj[key] === 'string' && obj[key].includes(from)) { obj[key] = obj[key].replace(from, to); return true } return false }
    let ok = false
    if (Array.isArray(it[field])) it[field].forEach((_, i) => { if (set(it[field], i)) ok = true })
    else ok = set(it, field)
    if (ok) { wr(file, d); log.push(`trip length: ${id}.${field}`) } else log.push(`trip length: no match in ${id}.${field}`)
  }
  swap('events.json', 'items', 'unclave-phangan', 'tips', 'and next on about Fri 22 Jan (after your trip)', 'and next on about Fri 22 Jan (in your Koh Phangan days)')
  swap('events.json', 'items', 'waterfall-festival-phangan', 'tips', 'so the Full Moon dates fall after your trip', 'so the full-moon nights are about Wed 20 and Sun 24 Jan')
  swap('events.json', 'items', 'dnb-allstars-thailand-2027', 'description', ' It starts four days after your trip ends.', ' It falls in your last week (Fri 22 to Sun 24 Jan).')
  swap('events.json', 'items', 'full-moon-party-2027-01', 'description', ' Four days after your trip ends.', ' It falls in your days for two (Fri 22 Jan).')
  swap('events.json', 'items', 'zamna-phuket-2027', 'description', 'after your trip.', 'after you fly home on 26 Jan.')
  swap('places.json', 'items', 'nai-yang-beach', 'tips', 'Good last stop on departure day (Mon 18 Jan)', 'Good last stop on departure day (Tue 26 Jan)')
  swap('places.json', 'items', 'mai-khao-plane-spotting', 'tips', 'Good last stop on Mon 18 Jan', 'Good last stop on Tue 26 Jan, before your 18:20 flight')
  swap('places.json', 'items', 'soi-dog-foundation', 'tips', 'In the trip window it is open Fri 8, Mon 11 to Fri 15, and Mon 18 January.', 'In your dates it is open on weekdays: Fri 8, Mon 11 to Fri 15, Mon 18 to Fri 22, and Mon 25 and Tue 26 January.')
  swap('places.json', 'items', 'samet-nangshe-viewpoint', 'bestTime', 'Sunrise on 8-18 Jan 2027 is about 06:45', 'Sunrise in January is about 06:45')
  swap('places.json', 'items', 'sunday-walking-street', 'openText', 'On your trip: Sun 10 Jan and Sun 17 Jan 2027.', 'On your trip: Sun 10, 17 and 24 Jan 2027.')
  swap('places.json', 'items', 'naka-weekend-market', 'openText', 'On your trip: Sat 9, Sun 10, Sat 16 and Sun 17 Jan 2027.', 'On your trip: Sat 9, Sun 10, Sat 16, Sun 17, Sat 23 and Sun 24 Jan 2027.')
  swap('places.json', 'items', 'chillva-market', 'openText', 'Closed Sunday (10 and 17 Jan on your trip). Tuesday adds a second-hand clothes market (Tue 12 Jan).', 'Closed Sunday (10, 17 and 24 Jan on your trip). Tuesday adds a second-hand clothes market (Tue 12 and Tue 19 Jan).')
  swap('places.json', 'items', 'karon-temple-market', 'tips', 'In the trip window it runs on Fri 8, Tue 12 and Fri 15 January.', 'In your dates it runs on Fri 8, Tue 12, Fri 15, Tue 19 and Fri 22 January.')
  // Kapook's Thai calendar lists the January 2027 holy days as 1, 7, 15, 22 and 30 Jan
  swap('places.json', 'items', 'go-benz', 'openText', '(in your dates: Fri 15 Jan)', '(in your dates: Fri 15 and Fri 22 Jan)')
  swap('places.json', 'items', 'hong-by-starlight', 'bestTime', 'New moon is Fri 8 Jan 2027, so book early in your trip.', 'New moon is Fri 8 Jan 2027, so book early in your trip and skip the full-moon days around Fri 22 Jan.')
  swap('areas.json', 'items', 'thalang', 'tips', '(Tue 12 Jan is in your dates)', '(Tue 12 and Tue 19 Jan are in your dates)')
  {
    // the Koh Phangan hotel prices were checked for 8-16 Jan; the two of you go back in full-moon week
    const d = rd('hotels.json')
    for (const id of ['milky-bay-resort', 'slumber-party-phangan']) {
      const h = d.items.find((x) => x.id === id)
      if (!h) { log.push(`trip length: MISSING hotel ${id}`); continue }
      h.tips = (h.tips || []).map((t) => t.replace('Tickets for Fri 8 and Fri 15 Jan 2027 are on sale on Megatix (500 THB).', 'Tickets for Fri 8, Fri 15 and Tue 19 Jan 2027 (moved for full-moon week) are on sale on Megatix (from 500 THB).'))
        .concat(['The price above was checked for 8-16 Jan. For full-moon week (19-23 Jan), check again early: rooms on the island cost more then and sell out.'])
      log.push(`trip length: ${id} full-moon week tip`)
    }
    wr('hotels.json', d)
  }
  {
    // 'Sundays in high season': Sun 24 Jan counts too
    const d = rd('events.json')
    const pg = d.items.find((x) => x.id === 'pangea-beach-bar-lanta')
    if (pg) { pg.dates = Array.from(new Set([...(pg.dates || []), '2027-01-24'])).sort(); wr('events.json', d); log.push('trip length: pangea-beach-bar-lanta adds Sun 24 Jan') }
  }
  {
    const d = rd('exchanges.json')
    d.tips = (d.tips || []).map((t) => t.replace('No Thai bank holiday falls on your dates (8-18 Jan 2027)', 'No Thai bank holiday falls on your dates (8-26 Jan 2027)').replace('(10 and 17 Jan)', '(10, 17 and 24 Jan)'))
    wr('exchanges.json', d); log.push('trip length: exchanges tips')
  }
  {
    const d = rd('essentials.json')
    for (const sec of d.sections || []) for (const it of sec.items || []) {
      it.text = String(it.text)
        .replace('Your 8-18 Jan trip fits.', 'Your 8-26 Jan trip (19 days) fits.')
        .replace('For 8-18 Jan (11 days) the 15-day plan fits.', 'For 8-26 Jan (19 days) take a 30-day plan (True: 1,199 baht) or a 15-day plan plus a top-up.')
        // the 16 Oct fact-check found no source for this (TAT's page does not say it)
        .replace(' It works without a Thai SIM.', '')
        // computed with the same sun formula as the day agenda
        .replace('During your trip, sunrise is 06:42-06:45 and sunset 18:23-18:28 (on 12 Jan: 06:43 and 18:25).', 'During your trip, sunrise is 06:42-06:46 and sunset 18:23-18:31 (on 19 Jan: 06:45 and 18:28).')
    }
    wr('essentials.json', d); log.push('trip length: essentials')
  }
}

// ---- the late-January research (19-26 Jan): new events, the Koh Phangan week, flight day, solo days ----
mergeLateJan(ROOT, log)

// ---- corrections from the apps research (import-apps.mjs prints them) ----
// Info texts and event tips are only final after mergeLateJan (it adds Info sections and replaces the tips of
// re-checked events), so fixes to them go here and not in the trip-length block above.
{
  const INFO_FIX = [ // [old text, new text]: replaced in every Info fact that contains it
    // 12Go FAQ: the phone PDF is enough only for trips with the e-ticket sign
    ['Book ferries, buses, vans and domestic flights, with e-tickets on your phone.', "Book ferries, buses, vans and domestic flights in one app. If the trip has an 'e-ticket' sign, the PDF on your phone is enough. If not, print the voucher and swap it for a ticket at the counter."],
    // no source says they answer faster
    ['Many hotels, drivers, tour shops and clubs answer on LINE faster than by email or phone.', 'Many hotels, drivers, tour shops and clubs have a LINE account and answer messages there.'],
    // RA's 'Phuket' area has no listings (RA GraphQL, 16 Oct 2026); Phuket clubs sit under Thailand 'All'
    ['Check Resident Advisor (Phuket page) and the Instagram pages', "Check Resident Advisor with the location set to Thailand (its Phuket page stays empty; Shelter has a club page there), and the Instagram pages"],
  ]
  const TIP_FIX = [ // [event id, old text, new text]: replaced in that event's tips
  ]
  const LINK_FIX = [ // [old url, new url, or '' to drop the link]: in every Info fact and event card
    ['https://ra.co/events/th/phuket', 'https://ra.co/clubs/160713'],
  ]
  if (INFO_FIX.length) {
    const d = rd('essentials.json')
    for (const [from, to] of INFO_FIX) {
      let n = 0
      for (const sec of d.sections || []) for (const it of sec.items || []) if (String(it.text).includes(from)) { it.text = String(it.text).replace(from, to); n++ }
      log.push(n ? `apps fix: Info "${from.slice(0, 50)}"` : `apps fix: NO MATCH in Info for "${from.slice(0, 50)}"`)
    }
    wr('essentials.json', d)
  }
  if (TIP_FIX.length) {
    const d = rd('events.json')
    for (const [id, from, to] of TIP_FIX) {
      const e = d.items.find((x) => x.id === id)
      const hit = e && (e.tips || []).some((t) => t.includes(from))
      if (hit) e.tips = e.tips.map((t) => t.replace(from, to))
      log.push(hit ? `apps fix: ${id} tip "${from.slice(0, 40)}"` : `apps fix: NO MATCH in ${id} tips for "${from.slice(0, 40)}"`)
    }
    wr('events.json', d)
  }
  if (LINK_FIX.length) {
    for (const f of ['essentials.json', 'events.json']) {
      const d = rd(f)
      const items = f === 'events.json' ? d.items : (d.sections || []).flatMap((s) => s.items || [])
      const LABEL = { 'https://ra.co/clubs/160713': 'Shelter Phuket on Resident Advisor' }
      for (const it of items) it.links = (it.links || []).flatMap((l) => { const m = LINK_FIX.find(([o]) => o === l.url); return !m ? [l] : m[1] ? [{ ...l, url: m[1], label: LABEL[m[1]] || l.label }] : [] })
      wr(f, d)
    }
    for (const [o, n] of LINK_FIX) log.push(`apps fix: link ${o} -> ${n || '(dropped)'}`)
  }
}

// ---- hotels: the group's villa shortlist replaces the researched hotels ----
// User, 16 Oct 2026: Airbnb and Booking.com links from the group chat, for 8 guests on 8-18 Jan. The stays are
// hand-written in data/stays.json (price, photos, copy); edit them there, not here.
{
  const st = rd('stays.json')
  const d = rd('hotels.json')
  log.push(`hotels: replaced ${d.items.length} researched hotels with ${st.items.length} stays from data/stays.json`)
  d.items = st.items
  wr('hotels.json', d)
}

// ---- the 19 Oct 2026 research: ports and ferries, islands, island events, boat tours, Phuket events, places ----
mergeIslandsEvents(ROOT, log)
// the group no longer goes to Koh Phangan on 10-13 Jan (villas booked in Phuket, 19 Oct 2026)
{
  const d = rd('places.json')
  for (const x of d.items) if (typeof x.description === 'string' && x.description.includes(', or 10-13 Jan if the group goes')) { x.description = x.description.replace(', or 10-13 Jan if the group goes', ''); log.push('places: ' + x.id + ' no group Phangan window') }
  wr('places.json', d)
}

// ---- Google place ids (recorded by the maps reviewer): links open the exact listing ----
{
  const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'research/google-place-ids.json'), 'utf8'))
  const key = (k, id) => k + ':' + id
  const top = new Map(g.map((x) => [key(x.kind, x.id), x]))
  let n = 0
  const apply = (kind, it, id = it.id) => {
    if (it.placeIdLocked || it.coordConfidence === 'low') return
    const r = top.get(key(kind, id)); const t = r && (r.top || [])[0]
    if (!t || !t.pid || r.q !== it.gmapsQuery || (kind !== 'area' && t.dist > 700)) return
    it.placeId = t.pid; n++
  }
  for (const [f, kind] of [['events.json', 'event'], ['places.json', 'place'], ['areas.json', 'area'], ['hotels.json', 'hotel']]) {
    const d = rd(f); d.items.forEach((it) => apply(kind, it)); wr(f, d)
  }
  const mxd = rd('exchanges.json')
  ;(mxd.brands || []).forEach((b) => (b.branches || []).forEach((x, i) => apply('money', x, b.id + '#' + i)))
  wr('exchanges.json', mxd)
  log.push(`place ids: ${n} links now open the exact Google listing`)
}

// ---- area labels follow the map: if a pin sits clearly inside another area's outline, relabel it ----
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/geo/areas.geojson'), 'utf8'))
const ids = new Set(geo.features.map((f) => f.properties.id))
// the stays' Airbnb pins are approximate: two Laguna villas sit just inland of the Bang Tao outline
const KEEP_AREA = new Set(['big-buddha', 'black-rock-viewpoint', 'money-shop/Money Shop Exchange Karon', 'modern-4br-villa-laguna', 'luxpride-2-wallaya-v7'])
const relabel = (kind, it) => {
  if (!ids.has(it.area) || !Number.isFinite(it.lat)) return
  const pt = turf.point([it.lng, it.lat])
  const own = geo.features.find((f) => f.properties.id === it.area)
  if (turf.booleanPointInPolygon(pt, own)) return
  const inside = geo.features.find((f) => turf.booleanPointInPolygon(pt, f))
  if (!inside) return
  const ownLine = turf.polygonToLine(own)
  const d = turf.pointToLineDistance(pt, ownLine.type === 'FeatureCollection' ? ownLine.features[0] : ownLine, { units: 'kilometers' })
  if (d < 0.3 || KEEP_AREA.has(it.id)) return
  log.push(`${kind}: ${it.id} area ${it.area} -> ${inside.properties.id} (pin is ${d.toFixed(1)} km inside it)`)
  it.area = inside.properties.id
}
for (const [f, kind] of [['events.json', 'events'], ['places.json', 'places'], ['hotels.json', 'hotels']]) {
  const d = rd(f); d.items.forEach((it) => relabel(kind, it)); wr(f, d)
}
{
  const mx = rd('exchanges.json')
  ;(mx.brands || []).forEach((b) => (b.branches || []).forEach((x) => relabel('money', Object.assign(x, { id: b.id + '/' + x.name }))))
  ;(mx.brands || []).forEach((b) => (b.branches || []).forEach((x) => { delete x.id }))
  wr('exchanges.json', mx)
}

{
  const lg = rd('research-log.json'); lg.curated = true; wr('research-log.json', lg)
}
console.log(log.length ? log.join('\n') : 'nothing to curate')
console.log(`now: ${rd('events.json').items.length} events, ${rd('places.json').items.length} places, ${rd('hotels.json').items.length} hotels`)
