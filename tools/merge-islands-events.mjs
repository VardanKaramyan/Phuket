// Merges the 19 Oct 2026 research (research/result-islands-events.json, from tools/workflows/islands-events.js:
// ports and ferries, islands, Gulf and Andaman island events, island tours, Phuket music events, places for the
// traveler) into data/*.json. curate.mjs calls it after the villa list replaces the hotels and before place ids and
// area labels, so new items get both. The hook tables below hold the editorial decisions made after reading the result.
import fs from 'node:fs'
import path from 'node:path'
import { windowOf } from './trip.mjs'

const AREA_IDS = ['patong', 'kamala', 'surin', 'bang-tao', 'layan', 'nai-thon', 'nai-yang', 'mai-khao', 'karon', 'kata', 'kata-noi', 'nai-harn', 'promthep', 'rawai', 'chalong', 'phuket-town', 'kathu', 'cape-panwa', 'ao-po', 'thalang', 'natai']
const OFF = ['phang-nga', 'khao-lak', 'krabi', 'phi-phi', 'koh-yao', 'koh-lanta', 'koh-lipe', 'trang', 'koh-phangan', 'koh-samui', 'koh-tao', 'surat-thani', 'koh-kaew', 'other']
const AREA_FIX = {
  'ko-phangan': 'koh-phangan', 'ko-pha-ngan': 'koh-phangan', phangan: 'koh-phangan', 'ko-samui': 'koh-samui', samui: 'koh-samui', 'ko-tao': 'koh-tao', tao: 'koh-tao',
  'ko-lipe': 'koh-lipe', lipe: 'koh-lipe', 'ko-lanta': 'koh-lanta', lanta: 'koh-lanta', 'koh-phi-phi': 'phi-phi', 'phi-phi-islands': 'phi-phi',
  'ao-nang': 'krabi', railay: 'krabi', tonsai: 'krabi', 'koh-ngai': 'trang', 'koh-mook': 'trang', 'trang-islands': 'trang', donsak: 'surat-thani',
  'thap-lamu': 'khao-lak', similan: 'phang-nga', 'similan-islands': 'phang-nga', 'koh-yao-noi': 'koh-yao', 'koh-yao-yai': 'koh-yao',
  'old-town': 'phuket-town', 'phuket-old-town': 'phuket-town', bangtao: 'bang-tao', laguna: 'bang-tao', kalim: 'patong', 'khok-kloi': 'natai',
}
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
export const normArea = (a) => { const s = slug(a); return AREA_IDS.includes(s) || OFF.includes(s) ? s : AREA_FIX[s] || s || 'other' }
const uniq = (a) => Array.from(new Set(a))
const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length)
const links = (...lists) => { const seen = new Set(); return lists.flat().filter((l) => l && l.url && !seen.has(l.url) && seen.add(l.url)) }
const DUR = ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening']
const TIERS = ['must-see', 'hidden-gem', 'day-trip', 'pier', 'tour']
const CATS = ['beach', 'viewpoint', 'temple', 'culture', 'nature', 'waterfall', 'island', 'market', 'food', 'activity', 'wellness', 'nightlife', 'pier', 'tour']

// fields a re-checked copy of a known item replaces; dates, links and sources are merged instead
const EVENT_TAKE = ['timeText', 'priceText', 'status', 'recurrence', 'genres', 'description', 'tips', 'verification']
const PLACE_TAKE = ['description', 'bestTime', 'openText', 'days', 'feeText', 'gettingThere', 'tips', 'verification', 'routes', 'facilities', 'tourType', 'departsFrom', 'includes', 'privateCharter', 'operators', 'priceText']

// ---- editorial decisions after reading the result (see HANDOFF.md) ----
const SKIP = { // new item id: why it stays out
  'thailand-international-boat-show-2027': 'a yacht show, not a music night (the researcher marked it optional)',
  'pak-bara-pier': 'the mainland pier for Koh Lipe; from Phuket the direct speedboat goes straight to the island',
  'lipa-noi-raja-pier-samui': 'Raja car ferries from here only go to Donsak; the Koh Phangan week section covers the Raja Ferry',
  'pralarn-pier-maenam-samui': 'Lomprayah Maenam pier: on this trip the boats leave from Bangrak, next to the airport',
  // critic: the same Ao Nang longtail trip as the boat-tour card, which has the operators and prices; its two own tips moved there
  'krabi-4-islands': 'the same trip as the boat tour tour-krabi-4-islands-longtail',
}
const SKIP_IN = { // list key: { item id: why that list's copy is not used (another list has the better copy) }
  // critic: the Andaman copy says you can do both the boat and Circoloco (back at 20:00, Natai 65 min); this one says choose one
  'music-events-phuket': { 'sail-away-pukka-up-boat-party': 'the Andaman list has the checked copy with the Circoloco timing' },
}
const DROP = { // existing item id: why it leaves the guide ('removed' entries that were confirmed)
}
const tip = (it, t) => { it.tips = it.tips || []; if (!it.tips.includes(t)) it.tips.push(t) }
const AFTER = { // id: (item, before, fresh) => { ... } to keep facts the researchers did not have
  // critic: the two tips only the left-out island card had (verified by the islands fact-checker)
  'tour-krabi-4-islands-longtail': (p) => {
    tip(p, 'From Railay you can walk to Phra Nang Cave Beach early, before the tour boats come.')
    tip(p, 'From Phuket a few tours do it in one long day (about 9.5 h): van to Rassada Pier, ferry to Ao Nang, then a speedboat.')
  },
  // critic: the pin sat on Mae Haad Pier, which is now its own card; Koh Nang Yuan itself (Google viewpoint listing, OSM islet)
  'koh-tao-nang-yuan': (p) => {
    Object.assign(p, { lat: 10.11487, lng: 99.81393, gmapsQuery: 'Koh Nang Yuan Viewpoint, Ko Tao', coordConfidence: 'high', coordSource: "Google 'Koh Nang Yuan Viewpoint' (10.1148721, 99.8139339) and the OSM islet (relation 7155241, 10.11508, 99.81410), 19 Oct 2026; the old pin was Mae Haad Pier, now its own card" })
    tip(p, 'Google lists the Nang Yuan viewpoint as open 10:00-15:00.')
  },
  // critic: the pin was the Chong Lard Pier card's; Laem Haad Beach is the sandbar the card describes (Google listing)
  'koh-yao-yai': (p) => Object.assign(p, { lat: 8.0823, lng: 98.59864, gmapsQuery: 'Laem Haad Beach, Ko Yao Yai', coordConfidence: 'high', coordSource: "Google 'Laem Haad Beach', Ko Yao Yai (8.0823005, 98.5986407), 19 Oct 2026; the old pin was Chong Lard Pier, now its own card" }),
  'ang-thong-marine-park': (p) => tip(p, 'For tour prices and operators from Koh Phangan, see the Ang Thong boat tour card.'),
  // critic: the tour sat on the island card's pin; the Emerald Lake viewpoint the tour walks up to (Google, OSM lake Thale Nai)
  'tour-ang-thong-from-phangan': (p) => Object.assign(p, { lat: 9.65752, lng: 99.66624, gmapsQuery: 'Blue Lagoon (Emerald Lake) Viewpoint, Ko Mae Ko', coordConfidence: 'high', coordSource: "Google 'Blue Lagoon (Emerald Lake) Viewpoint', Ko Mae Ko (9.6575233, 99.666236), 160 m from the OSM lake Thale Nai (way 23977540), 19 Oct 2026" }),
  // the main sessions are on a Friday or Saturday night (its timeText); the recurrence text only names the Tuesday open decks
  'sedo-izikura-phuket-town': (e) => { e.tile = { word: 'Maybe', label: 'Fri Sat' } },
  // critic: 'Thong Sala Pier, Koh Phangan' opens Google's listing at the Songserm pier, 300 m away
  'thong-sala-pier': (p) => { p.gmapsQuery = 'Thongsala Pier (Raja, Lomprayah, Seatran, Night Boat), Koh Phangan' },
}
// Info sections built from the facts of one or more lists: { key (a list key or an array of them), id, title, after (section id),
// keep (titles of the old section's facts to keep), drop / only (titles of new facts to leave out / to take) }.
// With append: true the facts go into the existing section id, after the fact titled `at` (or at the end).
// add: facts taken from the reviewed 'corrections' (their corrected text), put after the list's own facts.
// first: titles that open the section, in this order (the rest keep the researchers' order).
const SECTIONS = [
  // the old Island hopping section: its Phi Phi, Krabi, pier and booking facts are now pier cards and these facts; the two
  // Koh Phangan facts stay as a pointer (the full plan is in the full-moon week section). The fees fact is in Islands.
  { key: 'ports-ferries', id: 'island-hopping', title: 'Ferries and boats', after: 'getting-around', drop: ['Park and island fees 2026/27'], keep: ['Koh Phangan: fastest (fly + boat)', 'Party trips: book early'],
    first: ['Which pier for which island', 'Last boats of the day', 'How to book boats', 'E-ticket or voucher'] },
  // the private-boat, weather and Lipe-boat facts repeat the boat-tour and ferry facts
  { key: 'islands', id: 'islands', title: 'Islands around Phuket', after: 'island-hopping', drop: ['A private boat for the group', 'Speedboats and the weather', 'Island hopping on one boat'] },
  // park fees are in Islands; the timing fact repeats Islands' crowd and group-plan facts
  { key: 'island-tours', id: 'boat-tours', title: 'Choosing a boat tour', after: 'islands', drop: ['National park fees', 'Timing your boat days'],
    add: [{ title: 'Which pier your tour leaves from', text: 'Day tours leave from several piers. Chalong Pier: Racha, Coral Island and some Phi Phi boats. Royal Phuket Marina and Boat Lagoon: many Phi Phi, Phang Nga and Krabi speedboats. Ao Po Pier (not Ao Po Grand Marina): Phang Nga Bay big boats and canoe trips. Visit Panwa: Love Andaman. Most tours include pickup; ask which pier.' }] },
  { key: ['island-events-andaman', 'island-events-gulf'], id: 'island-parties', title: 'Parties on the islands', after: 'phangan-week' },
  { key: 'places-preferences', id: 'safety-law', append: true, at: 'Vapes and e-cigarettes are illegal' },
]
const INFO_FIX = [ // [old text, new text] in any Info fact (the reviewed 'corrections')
  // ports-ferries: Raja's own site has no Samui - Phangan sailing any more
  ['Raja Ferry crosses from Donsak on the mainland to Thong Sala at 05:00, 08:00, 11:00, 14:00 and 18:00 (2 h 30 min), and from Lipa Noi on Samui in about 1 h 30 min.',
    "Raja Ferry crosses from Donsak on the mainland to Thong Sala at 05:00, 08:00, 11:00, 14:00 and 18:00 (2 h 30 min, 270 THB; back from Thong Sala at 05:00, 08:00, 11:00, 14:00 and 17:30). Raja's own site no longer lists a Lipa Noi (Samui) - Koh Phangan sailing; its Samui boats only go to Donsak."],
  // ports-ferries: the bus + boat tickets back from Koh Phangan for Sat 23 Jan 2027
  ['Other bus + ferry tickets to Phuket Bus Terminal 2 leave in the morning and take 10-12 hours; check 12Go for times.',
    "Samui Tour's boat + bus leaves Thong Sala at 11:30 and reaches Phuket airport at 18:30 (1,060 THB, on sale for 23 Jan 2027), about 30-45 minutes from Natai. Phantip's leaves at 08:30 and reaches Phuket Bus Terminal 2 at 18:00 (900 THB)."],
  ['reaches its Phuket Town office at 18:30', 'reaches its Phuket office at 18:30'],
  // ports-ferries: Echo Travel's late speedboats (listed on 12Go and Ferryscanner, own site offline)
  ['Later flights miss the last boats to Thong Sala; only the Haad Rin Queen speedboat at 18:30 still goes to Haad Rin.',
    'Later flights miss the last boats to Thong Sala. The Haad Rin Queen speedboat at 18:30 still goes to Haad Rin, and Echo Travel lists speedboats from Petcherat Marina to Baan Tai at 18:30 and 20:30 (its own site was offline in Oct 2026, so check before you rely on it).'],
  // island-events-gulf: the Lomprayah booking system on 19 Oct 2026
  ['From Thong Sala the first boat is the Lomprayah speedboat at 07:30 to Bangrak (arrives 08:00, 350 THB; 2026 timetable).',
    'From Thong Sala the first boat is the Lomprayah speedboat at 07:30 to Bangrak (arrives 08:00, 350 THB). On 19 Oct 2026 its booking system showed only a few seats left for Sat 23 Jan (2 pier tickets, 5 with the airport van), so book it now if you want it.'],
  // the kept Koh Phangan pointer: flight numbers as in the full-moon week section (Google Flights, 16 Oct 2026)
  ['(55 min, 6-7 flights a day, about 3,000-5,000 baht one way in late 2026)', '(55 min, up to 8 flights a day, from about 4,700 baht one way in Oct 2026)'],
  // ports-ferries and island-tours: islands without a park fee
  ['Also in cash: Phi Phi Don pier 20 THB and Koh Nang Yuan about 250 THB.', 'Also in cash: Phi Phi Don pier 20 THB and Koh Nang Yuan about 250 THB. Racha, Coral Island and Koh Yao have no park fee.'],
  // critic: Lanta is 1 h 30 by speedboat, not 5 h; the last boat from Koh Tao (Lomprayah booking system, Jan 2027)
  ['Plan 3 nights or more: Koh Lanta and Koh Lipe (5 h each way).', 'Plan 3 nights or more: Koh Lanta (about 1 h 30 min by speedboat) and Koh Lipe (about 5 h each way).'],
  ['Samui to Koh Phangan: Lomprayah 17:30 from Bangrak, Haad Rin Queen speedboat 18:30.', 'Samui to Koh Phangan: Lomprayah 17:30 from Bangrak, Haad Rin Queen speedboat 18:30. Koh Tao to Koh Phangan: the 16:30 Lomprayah ferry (at Thong Sala 18:10).'],
  // critic: Sédo Izikura's late sessions are posted on Instagram and phangan.events
  ['and the Instagram pages of Shelter, Courage Bar and SUB (FAKE PALM nights show up on RA and Megatix)', 'and the Instagram pages of Shelter, Courage Bar, SUB and Sédo Izikura (@sedoizikura; FAKE PALM nights show up on RA and Megatix, and phangan.events lists Phuket club nights)'],
]
const TEXT_FIX = [ // [file, item id (null: the whole file), old text, new text] in any text of that item (the reviewed 'corrections')
  // music-events-phuket: Circoloco plays three Saturdays; the Baba day pass in high season; the Argy sale
  ['areas.json', 'natai', 'hosts Circoloco on Sat 9 and Sat 16 Jan, 15:00-03:00.', 'hosts Circoloco on Sat 9, 16 and 23 Jan, 15:00-03:00.'],
  ['areas.json', 'natai', 'Circoloco at Baba Beach Club (Sat 9 and Sat 16 Jan, 15:00-03:00)', 'Circoloco at Baba Beach Club (Sat 9, 16 and 23 Jan, 15:00-03:00)'],
  ['areas.json', 'natai', 'Baba Beach Club day pass (minimum spend 1,500 THB, 11:00-22:00)', 'Baba Beach Club day pass (minimum spend 3,000 THB per adult in high season, 11:00-22:00)'],
  ['areas.json', 'kamala', '(presale sign-up opens 20 Oct, 18:00)', '(tickets on sale Tue 20 Oct, 18:00 Thai time)'],
  // island-events-gulf and ports-ferries: the Koh Phangan trip card
  ['places.json', 'koh-phangan-rave-trip', 'Lost Jungle Sat 9 12:00 - Tue 12 Jan 06:00 (phangan.events).', 'Lost Jungle Sat 9 Jan 18:00 to Mon 11 Jan about 17:00 (organiser ticket shop on Vibez, Oct 2026). phangan.events still shows Sat 12:00.'],
  ['places.json', 'koh-phangan-rave-trip', 'Budget: bus + boat via Don Sak, about 6-9 h (Lomprayah 07:00-12:45 or 09:30-16:30 in Oct 2026).', 'Budget: bus + boat via Donsak, about 7-9 h: Lomprayah from its Phuket office at 09:30 (or a 07:30 hotel pickup) to Thong Sala at 16:30, 1,400-1,800 THB, or Phantip from Bus Terminal 2 at 08:00, about 600-900 THB.'],
  ['places.json', 'koh-phangan-rave-trip', 'Bus + boat about 700-1,600 THB.', 'Bus + boat about 600-1,800 THB (Phantip about 600-900, Lomprayah 1,400-1,800).'],
  ['places.json', 'koh-phangan-rave-trip', 'Flight Phuket - Samui about 3,000 to 5,000 THB one way', 'Flight Phuket - Samui about 4,700-4,900 THB one way (Oct 2026)'],
  // ports-ferries: Thap Lamu is about 100 km from Patong
  ['places.json', 'similan-islands', 'Long day. Hotel pickup about 06:00-07:00 (early tours 03:00-04:30), then 1-1.5 h by van to Thap Lamu Pier (Khao Lak) and 60-90 min by speedboat. Back in Phuket in the evening.',
    'Long day. Hotel pickup in Phuket about 05:30-07:00 (early tours 03:00-04:30). Thap Lamu Pier is about 100 km from Patong: 1.5-2 h by van (about 70 min from the airport area). Check-in about 08:00, then 1 h 15 min - 1 h 30 min by speedboat. Back at the pier 16:30-17:30 and in Phuket in the evening.'],
  // ports-ferries and islands: Bang Rong Pier is about 17 km from the airport (OSRM)
  ['places.json', 'koh-yao-noi', 'about 22 km and 40 min from the airport', 'about 17 km and 20-40 min from the airport'],
  // island-tours: tour and private-boat prices for Phi Phi and Phang Nga Bay (operator pages, Oct 2026)
  ['places.json', 'phi-phi-maya-bay', 'sunrise tours 3,500-4,500 THB', 'early or sunrise tours about 3,700-5,310 THB (Simba 5,310 with max 18 guests, Phuket Sail Tours 4,400, Oct 2026)'],
  ['places.json', 'phi-phi-maya-bay', 'Private speedboat 15,000-25,000 THB per boat.', 'Private speedboat about 15,000-37,500 THB per boat; all-inclusive boats for up to 10 cost about 37,500 THB.'],
  ['places.json', 'phang-nga-bay-james-bond', 'Group tour 1,400-3,500 THB per person: longtail 1,400-1,600, big boat 1,500-1,800, speedboat 1,800-2,500, catamaran or premium 2,500-3,500.',
    'Group tour about 1,400-4,600 THB per person: longtail 1,400-1,800, big boat 1,500-2,800, speedboat 1,700-2,900, small-group or early tours 4,000-4,600 (Love Andaman, Simba, Oct 2026).'],
  ['places.json', 'hong-by-starlight', 'A private-charter version of the same trip is sold from 62,750 THB.', 'A private-charter version of the same trip is sold from 62,750 THB for 1-12 people.'],
  // islands: the Sirinat park alcohol ban (park chief, 3 May 2025)
  ['places.json', 'nai-yang-beach', 'Small seafood restaurants and bars sit under the trees, and the sea is calm in high season.', 'Small seafood restaurants and bars sit under the trees, and the sea is calm in high season. Drinking on the park beach is banned (fines from 5,000 baht, 2025).'],
  // island-events-gulf: Waterfall's Eventpop tiers; Entrix shows 21+ on every event
  ['events.json', 'waterfall-festival-phangan', 'Oct 2026: 1,100 THB early bird online, 1,300 online, 1,500 at the door (one beer included).', 'Oct 2026 (Eventpop, 25 Oct): early bird 1,100, 1,200 and 1,300 THB, general 1,400 online, 1,500 at the door (one beer included).'],
  ['events.json', 'bambu-sunday-session-haad-yuan', 'Online from 320 THB (Entrix). 21+.', 'Online from 320 THB (Entrix).'],
  // critic: the old Bang Rong card is the mangrove walk; the pier is now its own card
  ['places.json', 'bang-rong-mangroves', 'Bang Rong Pier and Mangrove Walk', 'Bang Rong mangrove walk and floating restaurant'],
  ['places.json', 'bang-rong-mangroves', 'Boats to Koh Yao Noi and Koh Yao Yai leave from this pier.', 'Boats to Koh Yao Noi and Koh Yao Yai leave from the pier here: see the Bang Rong Pier card for times.'],
  // critic: from Bangrak the Koh Tao boats are Boonsiri's, sold by Seatran (booking engine, 19 Jan 2027)
  ['places.json', 'seatran-bangrak-pier-samui', "Seatran's fast ferries go to Thong Sala on Koh Phangan and on to Koh Tao, and Boonsiri catamarans also leave from here.", "Seatran's fast ferries go to Thong Sala. Boonsiri catamarans, sold by Seatran, also leave here for Thong Sala and Koh Tao (to Koh Tao at 08:00 and 12:30, 700 THB)."],
  ['places.json', 'bangrak-big-buddha-piers-samui', '350 THB (500 with a Samui hotel pickup)', '350 THB, the 12:15 boat 250 THB (500 with a Samui hotel pickup)'],
  ['places.json', 'koh-tao-nang-yuan', 'Lomprayah, Boonsiri or Songserm from Thong Sala Pier (about 1 h) to Mae Haad Pier.', 'Lomprayah or Boonsiri from Thong Sala Pier (1-1.5 h), or the Songserm ferry from its own pier 300 m north-west (about 1 h 45 min), to Mae Haad Pier.'],
  // critic: the pink songthaews stopped in June 2025; the EV Green Line ends at Rassada (Phuket 101, Jul 2026; TAT, Jul 2025)
  ['places.json', 'rassada-pier', 'The cheapest ride is the pink songthaew from Ranong Road in Old Town, 10-15 THB, about 06:30-20:00.', 'The cheapest ride from Old Town is the air-conditioned EV bus Line 3 (Green Line) to Rassada Pier: 15-40 THB, about 05:45-18:30. The old pink songthaews stopped in June 2025.'],
]

export function mergeIslandsEvents(ROOT, log) {
  const file = path.join(ROOT, 'research/result-islands-events.json')
  if (!fs.existsSync(file)) { log.push('islands/events: no research/result-islands-events.json, skipped'); return }
  const src = JSON.parse(fs.readFileSync(file, 'utf8'))
  const R = src.result || src
  const P = (f) => path.join(ROOT, 'data', f)
  const rd = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'))
  const wr = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o, null, 1))
  const sets = [...Object.entries(R.lists || {}), ['critic-additions', R.extra]].filter(([, v]) => v)
  const added = []

  // ---- events ----
  const ev = rd('events.json')
  for (const id of Object.keys(DROP)) { const n = ev.items.length; ev.items = ev.items.filter((e) => e.id !== id); if (ev.items.length < n) log.push(`islands/events: dropped event ${id} (${DROP[id]})`) }
  const byEv = new Map(ev.items.map((e) => [e.id, e]))
  for (const [key, v] of sets) for (const raw of v.events || []) {
    const it = clean(raw)
    it.id = slug(it.id || it.name)
    if (SKIP[it.id] || DROP[it.id]) { log.push(`islands/events: left out ${it.id} (${SKIP[it.id] || DROP[it.id]})`); continue }
    if ((SKIP_IN[key] || {})[it.id]) { log.push(`islands/events: ${key} copy of ${it.id} not used (${SKIP_IN[key][it.id]})`); continue }
    it.dates = uniq((it.dates || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))).sort()
    const old = byEv.get(it.id)
    if (!old) {
      const e = { ...it, area: normArea(it.area || it.island), kind: ['dated', 'recurring', 'venue'].includes(it.kind) ? it.kind : 'venue', links: links(it.links) }
      // a weekly night or a venue with no listed dates is open during the trip, like the other venues
      e.window = e.dates.length ? windowOf(e.dates) : 'in'
      if (AFTER[e.id]) AFTER[e.id](e, null, it)
      ev.items.push(e); byEv.set(e.id, e); added.push(['events', e])
      log.push(`islands/events: new event ${e.id} [${key}]`)
      continue
    }
    const before = JSON.parse(JSON.stringify(old))
    for (const k of EVENT_TAKE) if (filled(it[k])) old[k] = it[k]
    if (filled(it.lineup)) old.lineup = it.lineup
    old.dates = uniq([...(old.dates || []), ...it.dates]).sort()
    old.links = links(old.links, it.links)
    old.sources = uniq([...(old.sources || []), ...(it.sources || [])])
    if (old.dates.length) old.window = windowOf(old.dates)
    if (AFTER[old.id]) AFTER[old.id](old, before, it)
    log.push(`islands/events: updated event ${old.id} [${key}]`)
  }
  wr('events.json', ev)

  // ---- places, piers and boat tours ----
  const pl = rd('places.json')
  for (const id of Object.keys(DROP)) { const n = pl.items.length; pl.items = pl.items.filter((p) => p.id !== id); if (pl.items.length < n) log.push(`islands/events: dropped place ${id} (${DROP[id]})`) }
  const byPl = new Map(pl.items.map((p) => [p.id, p]))
  for (const [key, v] of sets) for (const raw of v.places || []) {
    const it = clean(raw)
    it.id = slug(it.id || it.name)
    if (SKIP[it.id] || DROP[it.id]) { log.push(`islands/events: left out ${it.id} (${SKIP[it.id] || DROP[it.id]})`); continue }
    if ((SKIP_IN[key] || {})[it.id]) { log.push(`islands/events: ${key} copy of ${it.id} not used (${SKIP_IN[key][it.id]})`); continue }
    const old = byPl.get(it.id)
    if (!old) {
      const p = {
        ...it, area: normArea(it.area), tier: TIERS.includes(it.tier) ? it.tier : 'day-trip', category: CATS.includes(it.category) ? it.category : 'activity',
        durationLabel: DUR.includes(it.durationLabel) ? it.durationLabel : 'half-day', days: (it.days || []).filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x)),
        links: links(it.links), operators: links(it.operators || []),
      }
      if (AFTER[p.id]) AFTER[p.id](p, null, it)
      pl.items.push(p); byPl.set(p.id, p); added.push(['places', p])
      log.push(`islands/events: new ${p.tier} ${p.id} [${key}]`)
      continue
    }
    const before = JSON.parse(JSON.stringify(old))
    for (const k of PLACE_TAKE) if (filled(it[k])) old[k] = it[k]
    if (Array.isArray(old.days)) old.days = old.days.filter((x) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(x))
    old.links = links(old.links, it.links)
    old.sources = uniq([...(old.sources || []), ...(it.sources || [])])
    if (AFTER[old.id]) AFTER[old.id](old, before, it)
    log.push(`islands/events: updated place ${old.id} [${key}]`)
  }
  wr('places.json', pl)

  // ---- Info sections and reviewed corrections ----
  const es = rd('essentials.json')
  for (const s of SECTIONS) {
    const lists = [].concat(s.key).map((k) => (k === 'critic-additions' ? R.extra : (R.lists || {})[k])).filter(Boolean)
    const items = clean([...lists.flatMap((v) => v.facts || []).filter((f) => f && !(s.drop || []).includes(f.title) && (!s.only || s.only.includes(f.title))), ...(s.add || [])]).filter((f) => f && f.title && f.text).map((f) => ({ ...f, links: links(f.links || []) }))
    if (s.append) {
      const sec = (es.sections || []).find((x) => x.id === s.id)
      if (!sec) { log.push(`islands/events: NO Info section ${s.id} to add to`); continue }
      const fresh = items.filter((f) => !sec.items.some((o) => o.title === f.title))
      const at = s.at ? sec.items.findIndex((o) => o.title === s.at) : -1
      sec.items.splice(at >= 0 ? at + 1 : sec.items.length, 0, ...fresh)
      log.push(`islands/events: Info section ${s.id} +${fresh.length} facts`)
      continue
    }
    const keep = s.keep ? (es.sections.find((x) => x.id === s.id)?.items || []).filter((f) => s.keep.includes(f.title)) : []
    if (s.first) items.sort((a, b) => { const r = (f) => { const i = s.first.indexOf(f.title); return i < 0 ? s.first.length : i }; return r(a) - r(b) })
    if (!items.length && !keep.length) continue
    es.sections = (es.sections || []).filter((x) => x.id !== s.id)
    const at = s.after ? es.sections.findIndex((x) => x.id === s.after) : -1
    es.sections.splice(at >= 0 ? at + 1 : es.sections.length, 0, { id: s.id, title: s.title, items: [...items, ...keep] })
    log.push(`islands/events: Info section ${s.id} (${items.length} new facts${keep.length ? ', ' + keep.length + ' kept' : ''})`)
  }
  for (const [from, to] of INFO_FIX) {
    let n = 0
    for (const sec of es.sections || []) for (const it of sec.items || []) if (String(it.text).includes(from)) { it.text = String(it.text).replace(from, to); n++ }
    log.push(n ? `islands/events fix: Info "${from.slice(0, 50)}"` : `islands/events fix: NO MATCH in Info for "${from.slice(0, 50)}"`)
  }
  wr('essentials.json', es)

  // ---- reviewed corrections in the other files ----
  const deep = (o, from, to) => { let n = 0; const walk = (x) => { if (Array.isArray(x)) x.forEach((v, i) => { if (typeof v === 'string') { if (v.includes(from)) { x[i] = v.replace(from, to); n++ } } else walk(v) }); else if (x && typeof x === 'object') for (const k of Object.keys(x)) { const v = x[k]; if (typeof v === 'string') { if (v.includes(from)) { x[k] = v.replace(from, to); n++ } } else walk(v) } }; walk(o); return n }
  for (const f of uniq(TEXT_FIX.map(([file]) => file))) {
    const d = rd(f)
    for (const [, id, from, to] of TEXT_FIX.filter(([file]) => file === f)) {
      const target = id ? (d.items || []).find((x) => x.id === id) : d
      const n = target ? deep(target, from, to) : 0
      log.push(n ? `islands/events fix: ${f} ${id || ''} "${from.slice(0, 50)}"` : `islands/events fix: NO MATCH in ${f} ${id || ''} for "${from.slice(0, 50)}"`)
    }
    wr(f, d)
  }

  // ---- verification log ----
  const lg = rd('research-log.json')
  lg.changes['islands-events'] = Object.fromEntries(sets.map(([k, v]) => [k, v.changes || []]))
  lg.removed['islands-events'] = Object.fromEntries(sets.map(([k, v]) => [k, v.removed || []]))
  lg.correctionsIslandsEvents = sets.flatMap(([k, v]) => (v.corrections || []).map((c) => ({ from: k, ...c })))
  wr('research-log.json', lg)

  // ---- photo search list for the new items ----
  const picks = fs.existsSync(P('image-picks.json')) ? JSON.parse(fs.readFileSync(P('image-picks.json'), 'utf8')) : []
  const have = new Set(picks.filter((p) => p && p.ok).map((p) => p.key))
  const site = (it) => (it.website && /^https?:/.test(it.website) ? it.website : ((it.links || []).find((l) => /^https?:/.test(l.url)) || {}).url)
  const kindOf = { events: () => 'music event / venue', places: (p) => `${p.tier} / ${p.category}` }
  const want = added.filter(([k, it]) => !have.has(`${k}:${it.id}`)).map(([k, it]) => ({
    key: `${k}:${it.id}`, kind: kindOf[k](it), name: it.name, where: [it.venue, it.area, it.island].filter(Boolean).join(', '),
    gmapsQuery: it.gmapsQuery, website: site(it), candidates: it.imageCandidates || [],
  }))
  if (want.length) {
    fs.writeFileSync(path.join(ROOT, 'research/photo-items-wave9.json'), JSON.stringify(want, null, 1))
    log.push(`islands/events: ${want.length} new items need a photo (research/photo-items-wave9.json)`)
  } else log.push('islands/events: every new item has a photo')
}
