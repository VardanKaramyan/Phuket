export const meta = {
  name: 'phuket-guide-islands-events',
  description: 'Deep research + adversarial verification: ports and ferries, islands, island events, island-hopping tours, Phuket music events, and places for an underground-techno lover (8-26 Jan 2027)',
  phases: [
    { title: 'Research', detail: '7 researchers: ports and ferries, islands, Gulf island events, Andaman island events and boat parties, island tours, Phuket music events, places for the traveler' },
    { title: 'Verify', detail: 'one adversarial fact-checker per research output' },
    { title: 'Critic', detail: 'completeness critic over everything, then a fact-check of its additions' },
  ],
}

const ROOT = (args && args.project) || '/Users/mac/Documents/Phuket'
const TODAY = (args && args.today) || '19 Oct 2026'

const CONTEXT = `You are a meticulous travel researcher producing structured content for a personal, mobile-first, offline travel-guide website (already built; your output is merged into it).

TRAVELER: in Phuket, Thailand from Fri 8 Jan to Tue 26 Jan 2027 (today is ${TODAY}). A group of 8 friends 8-18 Jan (villas in Patong / Kamala / Rawai area); two people 19-23 Jan, planned on Koh Phangan for the full-moon week (Bangkok Airways Phuket - Koh Samui + boat, back to Phuket Sat 23 Jan for Circoloco); then the traveler alone until the flight home Tue 26 Jan 2027, 18:20 from Phuket airport (HKT), last nights near the airport (Nai Yang). Loves underground techno (Bassiani / Berlin style), good raves and festivals; also wants the best sights, hidden gems, islands and boat days. Armenian (prices also shown in drams by the site; you just give baht).
WRITING: English is not the traveler's first language. Short, simple, concrete sentences. No marketing fluff, no emojis, no exclamation marks, no em-dash asides. Max ~320 characters per description; tips max ~180 characters each.
CALENDAR 2027: Fri 01-08, Sat 01-09, Sun 01-10, Mon 01-11, Tue 01-12, Wed 01-13, Thu 01-14, Fri 01-15, Sat 01-16, Sun 01-17, Mon 01-18, Tue 01-19, Wed 01-20, Thu 01-21, Fri 01-22 (FULL MOON PARTY), Sat 01-23, Sun 01-24, Mon 01-25 (last night out), Tue 01-26 (flight 18:20).

THE GUIDE AS IT IS NOW (read-only: NEVER write, move or delete anything in ${ROOT}): read the JSON files in ${ROOT}/data/ that matter for your task: events.json, places.json, essentials.json (Info sections), areas.json, extra.json. Re-check the existing items of your task and return UPDATED copies with the SAME id whenever a fact changed or new facts exist (new lineups, dates, prices, times, closures); do not return unchanged copies. New items need new unique kebab-case ids.

ACCURACY RULES
- Every place, pier, boat, tour, operator and event must be real and live for Jan 2027. Check the official or ticketing source (operator site, RA, Dice, Ticketmelon, Megatix, Eventpop, organizer Instagram / Facebook, official timetables, national park notices). Prefer 2025-2026 sources and say how recent a fact is.
- Never invent facts, names, prices, times or dates. If a date is only a pattern, say so (status "recurring" or "unconfirmed"). If unsure, leave the field out.
- Coordinates within ~150 m of the real spot (piers: the passenger terminal or boarding point).

TOOLS: load the web tools first with ToolSearch query "select:WebSearch,WebFetch". You also have Bash (curl) and Read.
COORDINATES: Google Maps link on the official site ("!3d..!4d..", "@lat,lng"), Wikipedia/Wikidata, or OpenStreetMap:
   Photon:    curl -s "https://photon.komoot.io/api/?q=URL_ENCODED_QUERY&lat=7.95&lon=98.33&limit=3"
   Nominatim: curl -s -A "phuket-trip-guide/1.0 (personal use)" "https://nominatim.openstreetmap.org/search?q=URL_ENCODED_QUERY&format=jsonv2&limit=3&countrycodes=th"; sleep 1.2   (max 1 request per second)
GOOGLE MAPS: gmapsQuery = what to type into Google Maps to land exactly on the place (official name + locality).
IMAGES: imageCandidates = 1-3 DIRECT image file URLs (official og:image or Wikimedia Commons upload URLs, with license/credit). Never an HTML page.
AREA IDS (Phuket): patong, kamala, surin, bang-tao, layan, nai-thon, nai-yang, mai-khao, karon, kata, kata-noi, nai-harn, rawai, chalong, phuket-town, kathu, cape-panwa, ao-po, thalang, natai. Off-island: phang-nga, khao-lak, krabi, phi-phi, koh-yao, koh-lanta, koh-lipe, trang, koh-phangan, koh-samui, koh-tao, surat-thani, other.`

const LINK = { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] }
const IMG = { type: 'object', properties: { url: { type: 'string' }, source: { type: 'string' }, license: { type: 'string' }, credit: { type: 'string' } }, required: ['url'] }
const GEO = { lat: { type: 'number' }, lng: { type: 'number' }, coordSource: { type: 'string' }, coordConfidence: { type: 'string', enum: ['high', 'medium', 'low'] }, gmapsQuery: { type: 'string' } }
const COMMON = { description: { type: 'string' }, tips: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: LINK }, imageCandidates: { type: 'array', items: IMG }, sources: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' } }
const EVENT = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, kind: { type: 'string', enum: ['dated', 'recurring', 'venue'] }, name: { type: 'string' }, type: { type: 'string' },
  dates: { type: 'array', items: { type: 'string' }, description: 'ISO dates 2027-01-08 .. 2027-01-25 (only the nights in the trip)' }, recurrence: { type: 'string' }, timeText: { type: 'string' },
  venue: { type: 'string' }, island: { type: 'string' }, area: { type: 'string' },
  genres: { type: 'array', items: { type: 'string' } }, undergroundScore: { type: 'integer', minimum: 1, maximum: 5 },
  status: { type: 'string', enum: ['confirmed', 'tickets-on-sale', 'listed', 'tba', 'unconfirmed', 'recurring'] },
  lineup: { type: 'array', items: { type: 'string' } }, priceText: { type: 'string' }, pick: { type: 'boolean' },
}, GEO, COMMON), required: ['id', 'kind', 'name', 'dates', 'lat', 'lng', 'gmapsQuery', 'description', 'status', 'verification'] }
const ROUTE = { type: 'object', properties: {
  to: { type: 'string', description: 'destination(s), e.g. "Koh Phi Phi (Tonsai Pier)"' }, operator: { type: 'string' },
  boat: { type: 'string', description: 'ferry, speedboat, catamaran, longtail, car ferry' }, times: { type: 'string', description: 'departure times for Jan 2027 high season, or "about every hour 08:00-17:00"' },
  duration: { type: 'string' }, priceText: { type: 'string' }, season: { type: 'string', description: 'e.g. "all year", "1 Nov - 30 Apr only"' }, bookingUrl: { type: 'string' },
}, required: ['to', 'operator'] }
const PLACE = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' },
  tier: { type: 'string', enum: ['must-see', 'hidden-gem', 'day-trip', 'pier', 'tour'] },
  category: { type: 'string', enum: ['beach', 'viewpoint', 'temple', 'culture', 'nature', 'waterfall', 'island', 'market', 'food', 'activity', 'wellness', 'nightlife', 'pier', 'tour'] },
  area: { type: 'string' }, durationLabel: { type: 'string', enum: ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening'] },
  durationHours: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
  bestTime: { type: 'string' }, openText: { type: 'string' }, days: { type: 'array', items: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] } },
  feeText: { type: 'string' }, gettingThere: { type: 'string' },
  routes: { type: 'array', items: ROUTE, description: 'PIERS ONLY: the boats that leave here' },
  facilities: { type: 'string', description: 'PIERS ONLY: parking, ticket counters, food, ATMs, luggage, toilets' },
  tourType: { type: 'string', description: 'TOURS ONLY: speedboat, big boat, catamaran, longtail, sea canoe, private charter, party boat, liveaboard' },
  departsFrom: { type: 'string', description: 'TOURS ONLY: the pier name (and its id if it is in your list)' },
  includes: { type: 'string', description: 'TOURS ONLY: pickup, lunch, snorkel gear, park fees or not' },
  privateCharter: { type: 'string', description: 'TOURS ONLY: what a private boat for 8 people costs, with source' },
  operators: { type: 'array', items: LINK, description: 'TOURS ONLY: reputable operators to book with' },
  dirLat: { type: 'number' }, dirLng: { type: 'number' }, dirLabel: { type: 'string', description: 'for tours: send Directions to the departure pier' },
}, GEO, COMMON), required: ['id', 'name', 'tier', 'category', 'area', 'lat', 'lng', 'gmapsQuery', 'durationLabel', 'description', 'verification'] }
const FACT = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, critical: { type: 'boolean' }, links: { type: 'array', items: LINK } }, required: ['title', 'text'] }
const CORRECTION = { type: 'object', properties: { where: { type: 'string', description: 'file + item id or Info section/title' }, claim: { type: 'string', description: 'the exact current text' }, verdict: { type: 'string', enum: ['wrong', 'outdated', 'unsupported'] }, correction: { type: 'string', description: 'the new text in the same simple style' }, source: { type: 'string' } }, required: ['where', 'claim', 'verdict', 'correction'] }
const REMOVED = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] }
const OUT = { type: 'object', properties: {
  events: { type: 'array', items: EVENT }, places: { type: 'array', items: PLACE }, facts: { type: 'array', items: FACT, description: 'practical facts for an Info section' },
  corrections: { type: 'array', items: CORRECTION, description: 'existing guide texts outside your returned items that are wrong or outdated' },
  removed: { type: 'array', items: REMOVED, description: 'existing guide items that should go (closed, cancelled, not real)' },
  notes: { type: 'string' },
}, required: ['notes'] }
const VERIFIED = { type: 'object', properties: Object.assign({}, OUT.properties, { changes: { type: 'array', items: { type: 'string' } } }), required: ['notes', 'changes'] }

const TASKS = [
  { key: 'ports-ferries', prompt: `TASK: PORTS, PIERS AND FERRIES. Return every pier / ferry terminal this traveler may use as 'places' with tier "pier" and category "pier": Phuket (Rassada Pier, Chalong Pier, Ao Po Grand Marina, Bang Rong Pier, Royal Phuket Marina, Rawai / Friendship Beach pier for longtails, Laem Hin and any other pier that tours or ferries use in 2026), the mainland and islands on the routes (Thap Lamu pier for the Similan Islands, Khao Lak; Krabi Klong Jilad / Ao Nang Nopparat Thara pier; Phi Phi Tonsai Pier; Koh Lanta Saladan pier; Koh Yao Noi Manoh pier and Koh Yao Yai piers; Koh Lipe arrival and Pak Bara if a Phuket - Lipe boat runs; Koh Samui Bangrak / Big Buddha pier, Nathon, Lipa Noi (Raja); Koh Phangan Thong Sala and Haad Rin piers; Donsak on the mainland). For each pier: routes[] (to, operator, boat type, Jan 2027 high-season times, duration, price, season, booking link), facilities, gettingThere (time and typical Grab / taxi price from Patong, Kamala and Rawai, or from the nearest town), feeText (pier fees, island entry fees paid on arrival), tips (arrive early, boarding pass swap, luggage, rough sea, cash). Also 'facts' for an Info section "Ferries and boats": how to book (operators, 12Go, Klook), e-ticket vs voucher, which boats run only in high season, seasickness and safety (life jackets, speedboat vs big ferry, weather cancellations), January sea conditions, national park and island fees in 2026/27, and a few typical multi-island routes (Phuket - Phi Phi - Krabi / Lanta; Phuket - Koh Yao; Phuket - Lipe; Khao Lak - Similan) with total times. Check every claim in Info → "Island hopping" (essentials.json, section id island-hopping) and in the piers named by the day-trip places, and put problems in 'corrections'.` },
  { key: 'islands', prompt: `TASK: ISLANDS IN GENERAL. Re-check every island day trip already in places.json (Phi Phi / Maya Bay, Phang Nga Bay / James Bond, Hong by Starlight, Similan, Koh Racha Yai, Coral Island, Khai Islands, Koh Yao Noi, Koh Hong Krabi, Railay) and return updated copies where facts changed for Jan 2027 (fees, closures, rules, boat times, crowds). Then add the islands still missing that fit this traveler, as 'places' with tier "day-trip" and category "island" (durationLabel full-day or multi-day): for example Koh Lanta, Bamboo Island, Koh Yao Yai, Koh Panyee, Koh Surin, Koh Lipe, Koh Ngai / Koh Mook (Trang), Koh Racha Noi, Koh Maiton, Koh Samui, Koh Tao, and others you find. For each: what it is like, what it is best for (party, snorkel, quiet beach, views), day trip or overnight, how to get there (pier, boat, time, price), fees, best time, crowds and tricks to avoid them, events or nightlife there (short), and pins on the island's main arrival point or main beach. Also 'facts' for an Info section "Islands around Phuket": which island for what, which need an overnight stay, park closures and rules (Maya Bay, Similan season, alcohol / drone rules), and how to combine islands in this trip (group days 8-18, the two of them 19-23, solo 24-26).` },
  { key: 'island-events-gulf', prompt: `TASK: EVENTS ON THE GULF ISLANDS, 8-25 Jan 2027: Koh Phangan (all dates, not only full-moon week), Koh Samui and Koh Tao. Re-check every Koh Phangan / Samui event already in events.json and return updated copies when facts changed (new dates, lineups, prices, status). Find all new parties, festivals, club nights, jungle raves, boat parties and beach parties for 8-25 Jan 2027, underground first (techno, minimal, deep, psytrance where relevant), with real dates or honest patterns (status). Sources: phangan.events, RA (Thailand), Megatix, Ticketmelon, Eventpop, Entrix, the organizers' Instagram / Facebook, Telegram 'Phangan Party Guide'. Also 'facts' for the Info section about party logistics on these islands (getting home at night, transport between parties, cash, safety), only if new or different from what essentials.json (section phangan-week) already says.` },
  { key: 'island-events-andaman', prompt: `TASK: EVENTS ON THE ANDAMAN ISLANDS AND COAST, 8-25 Jan 2027, plus BOAT PARTIES. Places: Koh Phi Phi, Koh Lanta, Krabi (Ao Nang, Railay, Tonsai), Koh Yao Noi / Yai, Khao Lak, Koh Lipe, Trang islands, and boat or yacht parties from Phuket, Krabi or Phi Phi (day or sunset party boats, techno / house boat parties, catamaran parties). Re-check the Andaman events already in events.json (e.g. Pangea Deep Sundays on Koh Lanta) and return updated copies when facts changed. Find new ones with real dates or honest patterns (status), underground first. Sources: RA, Megatix, Ticketmelon, Eventpop, organizers' sites and Instagram, Phi Phi / Lanta venue pages. Also 'facts' about nightlife and safety on these islands (closing times, getting back to the hotel, last boats), only if useful.` },
  { key: 'island-tours', prompt: `TASK: ISLAND-HOPPING TOURS. Return 'places' with tier "tour" and category "tour" for the best ways to see the islands on this trip: e.g. Phi Phi + Maya Bay + Bamboo early speedboat tour, Phang Nga Bay / James Bond by big boat or by sea canoe, Similan day trip from Khao Lak, Racha + Coral Island, Khai Islands half day, Krabi 4 / 7 islands by longtail from Ao Nang, Hong Islands, a private speedboat or catamaran charter for a group of 8 from Phuket, a sunset catamaran, and multi-island trips. For each: tourType, departsFrom (pier), durationLabel / durationHours, priceText (per person, Jan 2027, with source), privateCharter (price for a private boat for 8), includes (pickup from Patong / Kamala / Rawai, lunch, snorkel gear, national park fees or not), operators (2-4 reputable operators with links; check recent reviews and licences), tips (start time, crowds, seasickness, what to bring, red flags of cheap tours), pins at the main destination with dirLat/dirLng/dirLabel set to the departure pier. Use the same ids as the day-trip places only when you update those (do not duplicate a day-trip place as a tour; link to it by name instead). Also 'facts' for an Info section "Choosing a boat tour": speedboat vs big boat vs catamaran vs longtail vs private, what a fair price is, what is usually included, park fees, cancellation in bad weather, booking (direct, Klook, GetYourGuide, Viator), and red flags.` },
  { key: 'music-events-phuket', prompt: `TASK: MUSIC EVENTS IN PHUKET AND NEARBY MAINLAND (Phang Nga / Natai / Khao Lak), 8-25 Jan 2027, underground first. Re-check EVERY Phuket / Natai event and venue already in events.json (Circoloco, Café del Mar shows incl. Argy on 8 Jan (presale opens Tue 20 Oct 2026, 18:00 Thai time) and Marco Carola on 13 Jan, DnB Allstars, Shelter, Illuzion, BOA, Courage Bar crews (FAKE PALM, SUB, Enthusiast), Levitate, Summerset / EXPEREMINT, Armania, O Beach Barra Cuda, Spiritgust, Daft Funk live, Macan live, and the others) and return updated copies when anything changed: lineups announced since 16 Oct 2026, prices and ticket tiers, times, status, cancellations. Then find NEW events for 8-25 Jan 2027: club nights, guest DJs, techno / house parties, warehouse or jungle parties, beach club shows, festivals, open airs, boat parties, after-parties, and the crews behind them. Sources: RA (Phuket and Thailand), Dice, Megatix, Ticketmelon, Eventpop, venue and crew Instagram / Facebook, Time Out Phuket. pick=true only for the best 2-4 new fits for an underground-techno lover. Put any event that should leave the guide (cancelled, not real) in 'removed'.` },
  { key: 'places-preferences', prompt: `TASK: PLACES AND EXPERIENCES FOR THIS TRAVELER. He loves underground techno and good music; the group of 8 also wants fun days. Find what the guide is missing in the Phuket area (and Krabi / Phang Nga if worth it): bars and lounges with good DJs or sound systems, listening or vinyl bars, record shops, sunset bars with house / techno, beach clubs with good music on non-event days, late-night food for after parties, recovery spots (spas, ice baths, healthy cafes), unique group activities (Muay Thai class, sailing, jet-ski alternatives, ATV, cooking, diving try-dives), viewpoints and hidden beaches not yet in the guide. Return them as 'places' (tier must-see or hidden-gem, the right category). Then re-check the nightlife, food, wellness and activity places already in places.json for closures, new hours or prices, and return updated copies only where facts changed; put places that closed in 'removed'.` },
]

const verifyPrompt = (t, data) => `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER. Another researcher produced the data below for the task "${t.key}". Assume every item may be wrong, outdated, invented, closed, mislocated or seasonal-only. Your job is to catch problems, not to agree.
For EVERY item: re-check it against its own sources and at least one more (official site, ticketing page, operator timetable, Google Maps listing); re-derive the coordinates; check dates against the 2027 calendar; check prices and times are for the Jan 2027 high season (or say how old they are); for piers and boats check that each route really runs in January 2027; for tours check the operators are real and reputable. Fix what is wrong, drop what cannot be confirmed (list it in 'removed' with the reason), and re-check every 'corrections' entry (keep only the ones you confirm). You may add an important missing item if you fully verify it. In 'changes', list each change you made in one line. Keep the writing rules.

THE TASK WAS:
${t.prompt}

THE DATA TO CHECK:
${JSON.stringify(data, null, 1)}`

phase('Research')
const verified = await pipeline(
  TASKS,
  (t) => agent(`${CONTEXT}\n\n${t.prompt}`, { label: 'research:' + t.key, phase: 'Research', schema: OUT }),
  (res, t) => res ? agent(verifyPrompt(t, res), { label: 'verify:' + t.key, phase: 'Verify', schema: VERIFIED }).then((v) => v || { ...res, changes: ['VERIFY FAILED: unverified research output'] }) : null,
)
const lists = {}
TASKS.forEach((t, i) => { lists[t.key] = verified[i] })
log('verified: ' + TASKS.map((t, i) => { const v = verified[i] || {}; return `${t.key} ${(v.events || []).length}e/${(v.places || []).length}p/${(v.facts || []).length}f` }).join(', '))

phase('Critic')
const summary = TASKS.map((t) => {
  const v = lists[t.key] || {}
  return `== ${t.key}\n` + [
    ...(v.events || []).map((e) => `- EVENT ${e.id}: ${e.name} | ${(e.dates || []).join(', ') || e.recurrence || e.kind} | ${e.area}`),
    ...(v.places || []).map((p) => `- ${String(p.tier).toUpperCase()} ${p.id}: ${p.name} | ${p.area}`),
    ...(v.facts || []).map((f) => `- FACT ${f.title}`),
  ].join('\n')
}).join('\n\n')
const critic = await agent(`${CONTEXT}

ROLE: COMPLETENESS CRITIC. Seven researchers and seven fact-checkers produced the new and updated items below for this guide (the guide's current data is in ${ROOT}/data/). Find what is MISSING or WRONG for this traveler's real plan: getting from the group villas to the right pier on time, a boat day for 8 people, islands worth an overnight, island events on the exact nights, the Koh Phangan trip (19-23 Jan) and the way back, underground parties in Phuket on every weekend, solo days (24-26 Jan), duplicates across the lists (the same pier, island, tour or event twice), and items that do not work in January.
Return ONLY new items you fully researched and verified (same rules and schema), plus 'corrections' for problems you see (where = the item id or name). Return 0-10 new items; quality over count.

THE CURRENT NEW / UPDATED ITEMS:
${summary}`, { label: 'critic:completeness', phase: 'Critic', schema: OUT })

let extra = null
if (critic && ((critic.events || []).length || (critic.places || []).length || (critic.facts || []).length || (critic.corrections || []).length)) {
  extra = await agent(verifyPrompt({ key: 'critic-additions', prompt: 'Additions and corrections from a completeness critic for this guide (ports, islands, island events, tours, Phuket events, places).' }, critic), { label: 'verify:critic-additions', phase: 'Critic', schema: VERIFIED })
  if (!extra) extra = { ...critic, changes: ['VERIFY FAILED: unverified critic output'] }
}
return { lists, extra }
