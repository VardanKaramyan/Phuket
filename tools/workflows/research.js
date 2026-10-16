export const meta = {
  name: 'phuket-guide-research-v2',
  description: 'Research and adversarially verify all content for the Phuket trip guide site',
  phases: [
    { title: 'Research', detail: 'parallel researchers: events x2, places x3, areas, hotels, exchanges, essentials' },
    { title: 'Verify', detail: 'adversarial fact, status and coordinate checks per chunk' },
    { title: 'Complete', detail: 'completeness critic for places, then verify the additions' },
  ],
}

// The ORIGINAL research run (trip 8-18 Jan, 15 Oct 2026); kept for reference. The 19-26 Jan research is late-january.js.
// args.root = the project folder on the machine that runs it (agents read files from there).
const PROJECT = (typeof args === 'object' && args && args.root) || '/Users/mac/Documents/Phuket'

const AREA_IDS = ['patong','kamala','surin','bang-tao','layan','nai-thon','nai-yang','mai-khao','karon','kata','kata-noi','nai-harn','rawai','chalong','phuket-town','kathu','cape-panwa','ao-po','thalang','natai']

const CONTEXT = `You are a meticulous travel researcher. You are producing structured content for a personal, mobile-first, offline travel-guide website.

TRAVELER: visiting Phuket, Thailand from Fri 8 Jan to Mon 18 Jan 2027. Today is 15 Oct 2026. Loves underground techno (Bassiani / Berlin style), good raves and festivals. Also wants the best sights, hidden gems, where to stay, money exchange and practical tips.
WRITING: English is not the traveler's first language. Write short, simple, concrete sentences. No marketing fluff, no emojis, no exclamation marks. Max ~320 characters per description.
TRIP CALENDAR: Fri 2027-01-08, Sat 01-09, Sun 01-10, Mon 01-11, Tue 01-12, Wed 01-13, Thu 01-14, Fri 01-15, Sat 01-16, Sun 01-17, Mon 01-18. (1 Jan 2027 is a Friday.)

ACCURACY RULES
- Every place must be real and operating in 2026 / Jan 2027. Check for "permanently closed", rebrands, renovations. Prefer 2025-2026 sources.
- Never invent facts, names, prices or dates. If you are unsure, say so or leave the optional field out.
- Coordinates must be within ~200 m of the real spot (beach = middle of the beach; viewpoint = the viewpoint itself; business = its entrance).

TOOLS: First load the web tools with ToolSearch query "select:WebSearch,WebFetch". You also have Bash (curl).

HOW TO GET COORDINATES
1. Best: coordinates inside an official Google Maps link or embed on the venue's own site (patterns like "!3d7.8961!4d98.2965", "@7.8961,98.2965", "ll=", "q=7.89,98.29"), or Wikipedia / Wikidata coordinates.
2. OpenStreetMap geocoders via curl:
   Photon:    curl -s "https://photon.komoot.io/api/?q=URL_ENCODED_QUERY&lat=7.95&lon=98.33&limit=3"
   Nominatim: curl -s -A "phuket-trip-guide/1.0 (personal use)" "https://nominatim.openstreetmap.org/search?q=URL_ENCODED_QUERY&format=jsonv2&limit=3&countrycodes=th"; sleep 1.2
   (Never send more than 1 Nominatim request per second. Prefer Photon for bulk lookups.)
Cross-check two sources when you can. Phuket island bounds: lat 7.74-8.21, lng 98.25-98.48. Set coordSource (e.g. "wikipedia+photon") and coordConfidence (high = two sources agree within 200 m; medium = one good source; low = estimate).

GOOGLE MAPS: gmapsQuery = the text to type into Google Maps to land exactly on this place: official name + locality, e.g. "Baba Beach Club Natai, Phang Nga" or "Promthep Cape, Rawai, Phuket".

IMAGES: imageCandidates = 1-3 DIRECT image file URLs (.jpg/.jpeg/.png/.webp, or upload.wikimedia.org URLs). Prefer Wikimedia Commons (put license and author into "license"/"credit"). Quick way:
   curl -s "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=URL_ENCODED_QUERY&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280"
   (use "thumburl" or "url"; license = extmetadata.LicenseShortName, author = extmetadata.Artist)
   Otherwise use the official site's og:image / hero photo. Never give an HTML page as an image URL. Do not download images.

AREA IDS for the "area" field (Phuket island + Natai): ${AREA_IDS.join(', ')}. ("natai" = Natai / Khao Pilai beaches in Phang Nga, ~30 min north of the airport.)
Off-island area values: phang-nga, khao-lak, krabi, phi-phi, koh-yao, koh-lanta, koh-phangan, koh-samui, other.
IDS: every item needs a unique, stable kebab-case id (e.g. "big-buddha", "circoloco-2027").`

// ---------- schemas ----------
const LINK = { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] }
const IMG = { type: 'object', properties: { url: { type: 'string' }, source: { type: 'string' }, license: { type: 'string' }, credit: { type: 'string' } }, required: ['url'] }
const GEO_PROPS = {
  lat: { type: 'number' }, lng: { type: 'number' },
  coordSource: { type: 'string' }, coordConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  gmapsQuery: { type: 'string' },
}
const COMMON_PROPS = {
  description: { type: 'string' },
  tips: { type: 'array', items: { type: 'string' } },
  links: { type: 'array', items: LINK },
  imageCandidates: { type: 'array', items: IMG },
  sources: { type: 'array', items: { type: 'string' } },
  verification: { type: 'string' },
}
const SCORE = { type: 'integer', minimum: 0, maximum: 5 }

const EVENT = { type: 'object', properties: Object.assign({
  id: { type: 'string' },
  kind: { type: 'string', enum: ['dated', 'recurring', 'venue'] },
  name: { type: 'string' },
  type: { type: 'string', description: 'festival | party | day party | club night | concert | weekly night | club | beach club | bar' },
  dates: { type: 'array', items: { type: 'string', description: 'YYYY-MM-DD' } },
  recurrence: { type: 'string' },
  timeText: { type: 'string' },
  window: { type: 'string', enum: ['in', 'before', 'after', 'n/a'] },
  venue: { type: 'string' },
  island: { type: 'string', description: 'Phuket | Phang Nga | Koh Phangan | Koh Samui | Krabi | Phi Phi | Koh Lanta | Other' },
  area: { type: 'string' },
  genres: { type: 'array', items: { type: 'string' } },
  undergroundScore: { type: 'integer', minimum: 1, maximum: 5 },
  status: { type: 'string', enum: ['confirmed', 'tickets-on-sale', 'listed', 'tba', 'unconfirmed', 'recurring'] },
  lineup: { type: 'array', items: { type: 'string' } },
  priceText: { type: 'string' },
  pick: { type: 'boolean' },
}, GEO_PROPS, COMMON_PROPS), required: ['id', 'kind', 'name', 'window', 'lat', 'lng', 'gmapsQuery', 'description'] }

const PLACE = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' }, nameThai: { type: 'string' },
  tier: { type: 'string', enum: ['must-see', 'hidden-gem', 'day-trip'] },
  category: { type: 'string', enum: ['beach', 'viewpoint', 'temple', 'culture', 'nature', 'waterfall', 'island', 'market', 'food', 'activity', 'wellness', 'nightlife'] },
  area: { type: 'string' },
  durationLabel: { type: 'string', enum: ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening'] },
  durationHours: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
  bestTime: { type: 'string' }, openText: { type: 'string' },
  days: { type: 'array', items: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] } },
  feeText: { type: 'string' }, gettingThere: { type: 'string' },
  goodFor: { type: 'array', items: { type: 'string' } },
}, GEO_PROPS, COMMON_PROPS), required: ['id', 'name', 'tier', 'category', 'area', 'lat', 'lng', 'gmapsQuery', 'durationLabel', 'description'] }

const AREA = { type: 'object', properties: Object.assign({
  id: { type: 'string', enum: AREA_IDS }, name: { type: 'string' }, tagline: { type: 'string' },
  bestFor: { type: 'array', items: { type: 'string' } }, notIdealFor: { type: 'array', items: { type: 'string' } },
  beach: { type: 'string' }, stayIf: { type: 'string' },
  scores: { type: 'object', properties: { nightlife: SCORE, beach: SCORE, food: SCORE, quiet: SCORE, family: SCORE, value: SCORE } },
  priceLevel: { type: 'integer', minimum: 1, maximum: 4 },
  airportDriveMin: { type: 'integer' }, patongDriveMin: { type: 'integer' },
  highlights: { type: 'array', items: { type: 'string' } },
}, GEO_PROPS, COMMON_PROPS), required: ['id', 'name', 'tagline', 'description', 'bestFor', 'scores', 'lat', 'lng', 'gmapsQuery'] }

const HOTEL = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' }, area: { type: 'string' },
  tier: { type: 'string', enum: ['luxury', 'boutique', 'mid-range', 'budget', 'hostel'] },
  priceText: { type: 'string' }, ratingText: { type: 'string' }, whyStay: { type: 'string' }, nearby: { type: 'string' },
  vibe: { type: 'array', items: { type: 'string' } }, beachfront: { type: 'boolean' }, adultsOnly: { type: 'boolean' },
  website: { type: 'string' },
}, GEO_PROPS, COMMON_PROPS), required: ['id', 'name', 'area', 'tier', 'priceText', 'whyStay', 'lat', 'lng', 'gmapsQuery'] }

const BRANCH = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' }, area: { type: 'string' }, address: { type: 'string' },
  hoursText: { type: 'string' }, notes: { type: 'string' },
}, GEO_PROPS), required: ['name', 'lat', 'lng', 'gmapsQuery'] }
const BRAND = { type: 'object', properties: {
  id: { type: 'string' }, name: { type: 'string' },
  kind: { type: 'string', enum: ['money-changer', 'bank', 'airport', 'other'] },
  rank: { type: 'integer' }, rating: { type: 'string', enum: ['best', 'great', 'ok', 'avoid'] },
  branding: { type: 'object', properties: { primaryColor: { type: 'string' }, secondaryColor: { type: 'string' }, logoText: { type: 'string' }, howToRecognize: { type: 'string' } } },
  summary: { type: 'string' }, pros: { type: 'array', items: { type: 'string' } }, cons: { type: 'array', items: { type: 'string' } },
  rateCheck: { type: 'object', properties: { url: { type: 'string' }, note: { type: 'string' } } },
  sampleRates: { type: 'array', items: { type: 'object', properties: { currency: { type: 'string' }, buyTHB: { type: 'number' }, date: { type: 'string' }, source: { type: 'string' } } } },
  branches: { type: 'array', items: BRANCH },
  website: { type: 'string' }, links: { type: 'array', items: LINK }, imageCandidates: { type: 'array', items: IMG },
  sources: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' },
}, required: ['id', 'name', 'rank', 'rating', 'summary'] }
const EXCHANGE = { type: 'object', properties: {
  verdict: { type: 'string' }, asOf: { type: 'string' },
  midMarket: { type: 'array', items: { type: 'object', properties: { currency: { type: 'string' }, thbPerUnit: { type: 'number' }, date: { type: 'string' }, source: { type: 'string' } } } },
  brands: { type: 'array', items: BRAND },
  atm: { type: 'object', properties: { feeText: { type: 'string' }, cheapest: { type: 'array', items: { type: 'string' } }, tips: { type: 'array', items: { type: 'string' } } } },
  cards: { type: 'array', items: { type: 'string' } },
  tips: { type: 'array', items: { type: 'string' } },
  avoid: { type: 'array', items: { type: 'string' } },
  sources: { type: 'array', items: { type: 'string' } },
}, required: ['verdict', 'brands', 'tips'] }

const ESSENTIALS = { type: 'object', properties: {
  asOf: { type: 'string' },
  sections: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, title: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, critical: { type: 'boolean' }, links: { type: 'array', items: LINK } }, required: ['title', 'text'] } },
  }, required: ['id', 'title', 'items'] } },
  emergencyNumbers: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, number: { type: 'string' }, note: { type: 'string' } }, required: ['label', 'number'] } },
  phrases: { type: 'array', items: { type: 'object', properties: { en: { type: 'string' }, thai: { type: 'string' }, say: { type: 'string' } }, required: ['en', 'thai', 'say'] } },
  sources: { type: 'array', items: { type: 'string' } },
}, required: ['sections', 'emergencyNumbers', 'phrases'] }

const REMOVED = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } }
const CHANGES = { type: 'array', items: { type: 'string' } }
function listSchema(item, extra) { return { type: 'object', properties: Object.assign({ items: { type: 'array', items: item }, notes: { type: 'string' } }, extra || {}), required: ['items'] } }
function verifyListSchema(item) { return { type: 'object', properties: { items: { type: 'array', items: item }, removed: REMOVED, changes: CHANGES }, required: ['items', 'removed', 'changes'] } }
function verifyObjSchema(obj) { return { type: 'object', properties: { data: obj, removed: REMOVED, changes: CHANGES }, required: ['data', 'changes'] } }

// ---------- helpers ----------
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
function norm(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim() }
function slug(s) { return norm(s).replace(/ /g, '-') }
function uniqueIds(items, taken) {
  const ids = taken || new Set()
  return items.map(it => {
    const base = slug(it.id || it.name) || 'item'
    let id = base, j = 2
    while (ids.has(id)) id = base + '-' + (j++)
    ids.add(id)
    return Object.assign({}, it, { id })
  })
}
function dedupe(items) {
  const seen = new Map()
  for (const it of items) { const k = norm(it.name); if (k && !seen.has(k)) seen.set(k, it) }
  return uniqueIds(Array.from(seen.values()))
}

// ---------- prompts ----------
const E1 = `TASK: Build the definitive list of DATED music events (festivals, parties, DJ shows) from 1 to 31 January 2027 that this traveler could reach from Phuket: Phuket, Natai / Phang Nga, Khao Lak, Krabi / Ao Nang / Railay, Phi Phi, Koh Lanta, Koh Samui, Koh Phangan. (Koh Phangan = ~1 h flight to Samui + 30 min boat. It is in scope because it has the most underground raves.)
START from the previous research: read ${PROJECT}/research/prior-events-research.md fully (summaries + raw tool results). It found, among others: Circoloco Thailand (Sat Jan 9, 16, 23 at Baba Beach Club Natai), Lost Jungle: Parvati Day & Night (Koh Phangan, Jan 9-12), Marco Carola at Cafe del Mar Phuket (Wed Jan 13), Francis Mercier at Cafe del Mar (Jan 6), Carl Cox at Cafe del Mar (Jan 3 or Jan 6 - conflicting), Halfmoon Festival (Koh Phangan, Jan 15-16), Jungle Experience (Koh Phangan, Jan 21), Full Moon Party (Haad Rin, Jan 22), DnB Allstars Thailand (Azulea, Chalong, Jan 22-24), Zamna Phuket (Yeden Gardens, Jan 23-24 vs Jan 29-30 - conflicting), Spiritgust (Jan 6-9), "Barra Cuda Phuket" (unknown; listed Jan 6/8/13), Daft Funk Live (Koh Phangan, Jan 12).
For EACH: re-verify the exact dates on the official / ticketing source (RA, Dice, Ticketmelon, Megatix, Eventbrite, organizer site / Instagram), resolve conflicts, find any lineup announced since, ticket link and price, times, venue and precise coordinates, and write a vivid but factual description.
Then SEARCH for more dated events in Jan 2027 that the previous research missed (RA listings for Thailand, Ticketmelon / Megatix / Dice January 2027, Time Out Phuket, phangan.events, Cafe del Mar / Catch / YONA / Illuzion / Baba Beach Club event pages). Underground first.
Fields: kind="dated". window = "in" if any date is 8-18 Jan 2027, "before" if only 1-7 Jan, "after" if only 19-31 Jan. undergroundScore honest (5 = Bassiani/Berlin level, 1 = commercial/tourist; e.g. Full Moon Party = 1). status from the enum. pick=true for the 4-6 best fits for an underground-techno lover inside the window. For multi-day events list every date in "dates".
Return 12-25 events.`

const E2 = `TASK: Build the list of CLUBS, VENUES and RECURRING party nights where this traveler can find good techno / house / underground parties during 8-18 Jan 2027, around Phuket and nearby islands (Koh Phangan included).
The previous research (read ${PROJECT}/research/prior-events-research.md) found: Shelter (techno back room inside Illuzion, Bangla Rd, Patong), Bermudos ("underground music spot", Rawai / Nai Harn; deep-tech and techno on Fridays), Niky's Speakeasy (techno bar, Bang Tao), Cafe del Mar Phuket (Kamala beach club with big-name DJs), OXA Jungle Party (Koh Phangan, Fridays, Ban Tai), Retro Mountain (Koh Phangan hard-techno venue: Rave Siam, Secret Rave), Chill Up (Koh Phangan; techno Mondays, melodic techno Thursdays).
For EACH: verify it still operates in late 2026 and what nights / genres it runs (RA club pages, Instagram / Facebook, Google reviews 2025-2026), opening hours, entry price, exact coordinates, links, image candidates.
Then SWEEP for more, real underground first: RA (ra.co) clubs and promoters in Phuket and Koh Phangan; local techno collectives / promoters that throw parties in Phuket (search Instagram / Facebook / Telegram mentions, Time Out Phuket, Phuket101, Reddit r/phuket); beach clubs with quality house / techno programming (check which of Catch Beach Club, YONA, Xana, Kudo and others still operate and what they play); Illuzion itself (Phuket's big club); Koh Phangan's other techno nights (Jungle Experience, Waterfall Party, etc.); Koh Samui and Krabi if worthwhile. Skip go-go bars, cabaret and pure commercial EDM / hip-hop clubs.
Fields: kind="recurring" for a regular party night, kind="venue" for a club / bar / beach club with programming on many nights. For recurring nights list the actual dates inside 8-18 Jan 2027 in "dates" (e.g. every Friday -> ["2027-01-08","2027-01-15"]) and set recurrence (e.g. "Every Friday, 22:00-04:00"). window="in" if it runs during the trip. status="recurring" for recurring nights/venues. Do NOT repeat the one-off dated events (Circoloco, Marco Carola, Halfmoon, etc.) - another researcher covers them.
Return 10-20 items.`

const P1 = `TASK: Research the MUST-SEE places on Phuket island: the classics a first-time visitor should not miss. About 20-24 items across beaches, viewpoints, temples, Old Town culture, markets and nature on Phuket island itself. (Day trips to other islands are covered by another researcher - skip them. Hidden gems too.)
Consider (verify each; don't include blindly): Big Buddha, Wat Chalong, Phuket Old Town (Thalang Rd, Soi Romanee), Sunday Walking Street market (Lard Yai), Promthep Cape, Karon Viewpoint, Kata Beach, Nai Harn Beach, Freedom Beach, Patong Beach and Bangla Road, Khao Rang viewpoint, Monkey Hill, Rawai Seafood Market, Phuket Weekend Market (Naka), Chillva Market, Sirinat National Park / Nai Yang, Khao Phra Thaeo (Ton Sai and Bang Pae waterfalls), Phuket Elephant Sanctuary, Chalong Bay Rum distillery, Black Rock Viewpoint, Windmill Viewpoint.
For each: tier="must-see", category, area id, coordinates, durationLabel + durationHours (realistic time on site, not counting the drive), bestTime (e.g. "Sunset - arrive by 17:30", "Before 9:00 to beat tour buses"), openText and days (markets: exactly which days), feeText (2026 prices for foreigners), gettingThere (from Patong / Kata by car or scooter, minutes), description, 2-4 practical tips, links, imageCandidates (Wikimedia preferred), sources.`

const P2 = `TASK: Research HIDDEN GEMS of Phuket island: lesser-known beaches, viewpoints, temples, local neighborhoods, nature walks and spots most tourists miss but that are really worth it in January 2027. About 18-24 items.
Ideas to check (verify each; include only if real and worth it): Banana Beach, Ao Sane, Laem Krating, Nui Beach, Ya Nui, Kata Noi, Laem Ka, Paradise Beach, Tri Trang, Ao Yon, Khao Khad viewpoint, Koh Sirey (sea-gypsy village and hilltop temple), Laem Phan Wa, Bang Rong mangroves and pier, Mai Khao beach plane-spotting, waterfall hikes, the Soi Dog Foundation, local food streets and markets, cafes with a view.
Check access in 2026: several "secret" beaches have been fenced off, made private or now charge entry - say so clearly, or drop them.
Do NOT duplicate the classics covered by another researcher: Big Buddha, Wat Chalong, Promthep Cape, Patong / Bangla Road, Old Town, Kata and Karon main beaches, Nai Harn, Freedom Beach, Black Rock Viewpoint, Windmill Viewpoint, Karon Viewpoint, Khao Rang, Monkey Hill, Sunday Walking Street, Chillva, Naka market, Rawai seafood market.
For each: tier="hidden-gem", category, area id, coordinates, durationLabel + durationHours, bestTime, openText/days, feeText, gettingThere, description, tips, links, imageCandidates, sources.`

const P3 = `TASK: Research (a) DAY TRIPS and ISLAND HOPPING from Phuket and (b) a few iconic FOOD experiences on Phuket island.
(a) About 10-14 trips, e.g.: Phang Nga Bay (James Bond Island, Koh Panyee, sea-canoe caves), Phi Phi Islands (Maya Bay rules for the 2026/27 season), Similan Islands (season opens mid-October; January is ideal), Koh Racha Yai, Coral Island (Koh Hey), Koh Khai, Koh Yao Noi, Koh Hong (Krabi), Railay / Krabi, Khao Sok (lake overnight), Samet Nangshe viewpoint (sunrise), Hong by Starlight evening sea-canoe trip, Koh Phangan as a 2-3 day side trip for raves (how to get there). For each: how to do it (group tour vs private longtail / speedboat; departure piers), typical 2026 price range, durationLabel (full-day, multi-day, ...), bestTime, tips (crowds, early starts, national-park fees, closures), coordinates of the destination (put the departure pier in gettingThere). tier="day-trip", category="island" / "nature" / "viewpoint" / "activity".
(b) About 6-8 food experiences on Phuket island, e.g. Old Town classics (Mee Ton Poe, One Chun, Raya, Lock Tien), Rawai seafood market "buy and they cook it", a famous local seafood restaurant, a Southern-Thai curry place, a great night-market food hall. category="food", tier="must-see" or "hidden-gem". Include price level in feeText (e.g. "Dishes 60-150 THB").`

const A1 = `TASK: Write the AREA GUIDE for Phuket: exactly one entry per area id (all 20): ${AREA_IDS.join(', ')}.
Scope of each: patong (Patong + Kalim), kamala, surin (Surin + Pansea), bang-tao (Bang Tao beach + Laguna + Cherngtalay / Boat Avenue), layan, nai-thon, nai-yang, mai-khao, karon, kata (Kata Yai), kata-noi, nai-harn, rawai (Rawai + Ya Nui + Promthep), chalong (Chalong + Soi Ta-iad fitness street + Chalong Pier), phuket-town (Old Town + Phuket City), kathu (inland between Patong and Phuket Town), cape-panwa, ao-po (north-east coast: Ao Po and Cape Yamu, marinas, boats to Koh Yao), thalang (inland north: heritage sites and rainforest park), natai (Natai and Khao Pilai beaches in Phang Nga, just north of Sarasin Bridge).
The traveler's priorities: underground techno and good parties (Circoloco at Baba Beach Club Natai on Sat Jan 9 and 16; Cafe del Mar in Kamala; Shelter / Illuzion in Patong; Bermudos in Rawai / Nai Harn; Niky's Speakeasy in Bang Tao), plus beaches and sights.
For each area: name, tagline (max 60 chars), description (max 380 chars: what it feels like, who is there), bestFor tags (choose from: nightlife, techno, beach-clubs, beach, swimming, snorkeling, families, couples, luxury, budget, quiet, nature, food, culture, local-life, shopping, long-stay, wellness, muay-thai, sunset, airport), notIdealFor tags, beach (1 sentence on the beach and sea in January), scores 0-5 (nightlife, beach, food, quiet, family, value), priceLevel 1-4, airportDriveMin (typical car minutes to HKT airport), patongDriveMin, highlights (3-5 short), lat/lng = center of the tourist area (main beach midpoint or town center), gmapsQuery, stayIf (one sentence starting "Stay here if"), imageCandidates (Wikimedia Commons preferred, a photo of the beach / town), sources.
Also fill "recommendation": which 2-3 areas suit THIS traveler best as a base (and a split-stay idea), and why.`

const H1 = `TASK: Curate about 18-24 standout hotels for this traveler for 8-18 Jan 2027 (peak season), spread across the areas that make sense for them, with a range of budgets. Cover:
- Natai (Circoloco): the Baba Beach Club Natai hotel itself, plus 1-2 nearby options;
- Kamala / Surin / Bang Tao (beach-club belt: Cafe del Mar, Catch, Niky's);
- Patong (Shelter / Illuzion; walkable nightlife): 2-3 options including a good-value one;
- Kata / Karon and Nai Harn / Rawai (Bermudos; relaxed beaches);
- Phuket Old Town (culture, food, cheap);
- 2-3 Koh Phangan stays near Ban Tai (OXA, Jungle Experience, Halfmoon) for a rave side-trip (area = "koh-phangan").
Tiers: luxury, boutique, mid-range, budget, hostel - at least 4 mid-range and 3 budget/hostel. Prefer places with excellent 2025-2026 reviews; put ratingText like "Google 4.6 (1,900 reviews)" if you find it. priceText = realistic January nightly range, e.g. "4,500-6,500 THB / night (~$130-190)". whyStay max 220 chars. nearby = what is walkable / how many minutes to the key spots. Verify each is open (not closed or renovating in Jan 2027). website = official site.`

const X1 = `TASK: Find the best currency exchange options in Phuket for this traveler (bringing cash, probably USD and/or EUR, plus bank cards), i.e. the money changers with the best rates (smallest spread), and say clearly which one is best.
Research:
1. Which money-changer brands in Phuket give the best rates in 2025-2026. Use traveler and expat sources (Reddit r/Thailand and r/phuket, AseanNow / ThaiVisa forum, Tripadvisor forum, Phuket news, Google reviews, blogs). Bangkok's famous low-spread changers are SuperRich (green "SuperRich Thailand" and orange "SuperRich 1965") and Vasu: check whether any of them really have Phuket branches. Find which Phuket-local changers are known for the best rates. Compare with bank booths (Kasikorn, SCB, Bangkok Bank, Krungsri, Krungthai) and airport counters.
2. Compare real published rates where possible (live rate pages, daily Facebook / LINE rate posts) for USD (100 notes) and EUR on the same day; fill sampleRates with date and source, and midMarket with the mid-market rate on that date.
3. For each brand worth listing (best ones, plus banks as "ok" and airport as "avoid" if true): branding so the traveler recognizes the shop (primaryColor / secondaryColor as hex, logoText, howToRecognize: what the sign / booth looks like), branches in Phuket with exact coordinates and hours (Patong, Kata / Karon, Kamala / Bang Tao, Rawai / Chalong, Phuket Town, Central Phuket / Jungceylon malls, airport), rateCheck link, pros / cons, imageCandidates (logo or shopfront).
4. ATM advice (2026 fee per withdrawal for foreign cards, cheapest ATMs, max per withdrawal), the DCC trap, Wise / Revolut cards, which notes to bring (large, new, clean USD 100 get better rates), passport requirement, opening hours, and an avoid list (hotels, airport arrivals hall, random booths).
Be honest: if no single brand wins everywhere, say "best in Patong is X, best in Phuket Town is Y". verdict = 2-3 sentences.`

const S1 = `TASK: Write the ESSENTIALS section: practical, current (as of Oct 2026) info for a trip on 8-18 Jan 2027. Verify each fact on official or recent (2025-2026) sources. Sections (id: title):
- entry: Entry and visa - Thailand Digital Arrival Card (TDAC: when and where to fill it; official URL only, warn about scam sites), visa-exemption length in 2026 (it may have changed from 60 days - check the current rule), any ETA plans, any tourist entry fee status, passport validity, onward ticket.
- getting-around: Grab and Bolt in Phuket (typical fares: airport -> Patong, Patong -> Kata, Patong -> Old Town), taxis and tuk-tuks (fixed-price culture, agree the price first), scooter rental (licence / IDP and insurance reality, police checkpoints, helmet), Phuket Smart Bus and airport bus, typical drive times.
- island-hopping: how to get to Koh Phangan from Phuket for raves (flight HKT -> USM + Lomprayah / Seatran boat; or bus + ferry via Surat Thani / Don Sak), time and price; Phi Phi / Krabi ferries (Rassada and Chalong piers); booking (12Go, official ferry sites).
- connectivity: SIM / eSIM (AIS, True; tourist packages and prices; airport booths; eSIM apps), Wi-Fi.
- safety-law: vaping / e-cigarettes illegal (penalties), cannabis rules in 2026, drug laws (very strict), drink spiking at parties, alcohol sale hours, smoking ban on beaches (fines), jet-ski scams, rip currents (January is calm on the west coast but watch flags), drones.
- health: hospitals (Bangkok Hospital Phuket, Vachira Phuket, Mission Hospital), pharmacies, sun and heat, mosquitoes, travel insurance, tap water.
- weather: January weather in Phuket (temperatures, rain, sea), sunrise and sunset times around 12 Jan 2027.
- etiquette: temple dress code, respect for the royal family, shoes off, tipping, haggling, the wai.
- power-apps: plugs and voltage, useful apps (Grab, Bolt, Google Translate with offline Thai, Google Maps offline area, LINE, 12Go, Klook / GetYourGuide, Wise).
Also: emergencyNumbers (Tourist Police 1155, police 191, ambulance 1669, etc. - verify each), phrases (12-16 essential Thai phrases: Thai script + easy phonetic "say" + English; note krap (male) / ka (female)).
Mark critical items (TDAC, vaping law, drugs) with critical=true. Each item: short title + 1-3 sentence text + links to official sources.`

const DOMAINS = [
  { key: 'events', title: 'Music events', schema: EVENT, chunk: 12,
    checks: 'exact dates and times on the official / ticketing source (RA, Dice, Ticketmelon, Megatix, organizer Instagram), the lineup announced so far, price, venue, window (in/before/after the 8-18 Jan trip), undergroundScore realism, and for recurring nights that they still run on those weekdays in late 2026',
    research: [{ key: 'events-dated', prompt: E1 }, { key: 'events-venues', prompt: E2 }] },
  { key: 'places', title: 'Places to go', schema: PLACE, chunk: 15, critic: true,
    checks: 'durationLabel and durationHours realism (time people actually spend there), bestTime, opening days and hours (markets run only on some days), 2026 entry fees for foreigners, access status (some beaches are fenced, private or charge entry), gettingThere',
    research: [{ key: 'places-must-see', prompt: P1 }, { key: 'places-hidden-gems', prompt: P2 }, { key: 'places-daytrips-food', prompt: P3 }] },
  { key: 'areas', title: 'Areas', schema: AREA, chunk: 10,
    checks: 'description accuracy, bestFor / notIdealFor tags, scores realism, drive minutes to the airport and to Patong, center coordinates (main beach midpoint or town center)',
    research: [{ key: 'areas', prompt: A1, extra: { recommendation: { type: 'string' } } }] },
  { key: 'hotels', title: 'Hotels', schema: HOTEL, chunk: 12,
    checks: 'that it is open in Jan 2027 (no closure or renovation), tier, realistic January price band, rating text, the "nearby" claims, website',
    research: [{ key: 'hotels', prompt: H1 }] },
  { key: 'exchanges', title: 'Currency exchange', object: EXCHANGE,
    checks: 'which brands really have Phuket branches; each branch address, coordinates and hours; the "best rate" claim (compare real published rates for the same day if you can); branding colors; 2026 ATM fees; DCC and other tips',
    research: [{ key: 'exchanges', prompt: X1 }] },
  { key: 'essentials', title: 'Essentials', object: ESSENTIALS,
    checks: 'every entry / legal rule against official sources as of Oct 2026 (TDAC, visa-exempt days, entry fee, vaping, cannabis, alcohol hours, beach smoking ban), phone numbers, fares, ferry and flight options and prices, weather numbers',
    research: [{ key: 'essentials', prompt: S1 }] },
]

const VERIFY_RULES = `For EACH item:
1. Status: confirm it exists and operates in 2026 / Jan 2027 (closure news, latest Google / Tripadvisor reviews, official site / Instagram). Remove items that are closed, fake, duplicated, or not worth it - list them in "removed" with the reason.
2. Coordinates: re-derive them independently (do not trust the given lat/lng) with the methods in the context. If the given point is more than 250 m off, correct it and update coordSource / coordConfidence.
3. Facts: check CHECKS. Correct anything wrong. Keep descriptions max ~320 characters, simple English.
4. gmapsQuery: make sure it finds this exact place in Google Maps (use the business name exactly as Google lists it, if you can find it).
5. Links: keep only official / ticket / RA / Instagram links that work.
6. Keep every field and the same id. Keep imageCandidates (add one only if there are none).
Write a short "verification" note per item: what you checked and the source (e.g. "Dates confirmed on RA + Dice; coords from venue Google Maps embed").`

function verifyListPrompt(d, items) {
  return `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER for the "${d.title}" section. Another researcher produced the ${items.length} items below. Assume every item may be wrong, outdated, closed, mislocated or exaggerated. Your job is to catch problems, not to agree.

${VERIFY_RULES.replace('CHECKS', d.checks)}

Return ALL surviving items (corrected, full fields), plus removed[] and changes[] (one line per material change).

ITEMS (JSON):
${JSON.stringify(items, null, 1)}`
}

function verifyObjPrompt(d, data) {
  return `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER for the "${d.title}" section. Another researcher produced the data below. Assume every claim may be wrong, outdated or exaggerated. Your job is to catch problems, not to agree.
Check: ${d.checks}. For every place / branch: confirm it exists and operates in 2026, and re-derive its coordinates independently (fix if more than 250 m off). Remove wrong or unverifiable claims, fix numbers, add anything important that is missing, keep the text short and simple. Put a short "verification" note on each brand if the schema allows it.

Return the corrected data (same schema, all fields), plus changes[] (one line per material change) and removed[] (things you dropped, with reason).

DATA (JSON):
${JSON.stringify(data, null, 1)}`
}

function criticPrompt(list) {
  return `ROLE: You are a COMPLETENESS CRITIC for the "Places to go" section of this Phuket trip guide (8-18 Jan 2027). Current list (name - tier - category - area):
${list}

What important places are MISSING? Think like (a) a first-timer who wants all the classics, (b) a local who knows the hidden gems, (c) someone with 11 days who wants great day trips, (d) a techno lover who wants sunset spots and chilled recovery days. Pick up to 10 genuinely worthwhile missing places (skip near-duplicates of existing ones and tourist traps). Research each one fully with the same fields and rigor (coordinates per the context rules, durations, fees, days, imageCandidates, sources). Return them as items (an empty array if nothing important is missing).`
}

// ---------- resume after an interrupted run ----------
// args.resume maps an agent label to { digest, files, draft } from its interrupted attempt. Labels not listed keep
// their original prompt, so finished agents come back from the cache unchanged.
const RESUME = (typeof args === 'object' && args && args.resume) || {}
function resumeNote(label) {
  const r = RESUME[label]
  if (!r) return ''
  return `

RESUME: Your previous attempt at this exact task was interrupted after a lot of work. Recover what you already found before you search again:
- Digest of the previous attempt (its notes, every tool call and the start of every result): ${r.digest}. It is long: read it in parts (Read with offset/limit) or grep it.
- Files written during that attempt are still on disk under ${r.files}.${r.draft ? `\n- A near-final draft of the output already exists: ${r.draft}. Check it against the task, fix gaps, and return it.` : ''}
Reuse those findings, fill the gaps with targeted checks only, and return the final result. Do not redo work that is already done.`
}

// ---------- precomputed research (finished before an interruption) ----------
// args.precomputed maps a research label to { file, count }: the saved result is not re-researched; the verifiers read it from the file.
const PRE = (typeof args === 'object' && args && args.precomputed) || {}

function verifyListFilePrompt(d, job) {
  const n = job.to - job.from + 1
  return `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER for the "${d.title}" section. Another researcher produced items that are saved in the JSON file ${job.file} (an object with an "items" array, plus "notes"). Read it, and verify ONLY the items at positions ${job.from} to ${job.to} (0-based, inclusive) of the "items" array: ${n} items. Assume every item may be wrong, outdated, closed, mislocated or exaggerated. Your job is to catch problems, not to agree.

${VERIFY_RULES.replace('CHECKS', d.checks)}

Return ALL surviving items from your range (corrected, full fields), plus removed[] and changes[] (one line per material change).`
}
function verifyObjFilePrompt(d, file) {
  return `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER for the "${d.title}" section. Another researcher produced the data saved in the JSON file ${file}. Read it fully. Assume every claim may be wrong, outdated or exaggerated. Your job is to catch problems, not to agree.
Check: ${d.checks}. For every place / branch: confirm it exists and operates in 2026, and re-derive its coordinates independently (fix if more than 250 m off). Remove wrong or unverifiable claims, fix numbers, add anything important that is missing, keep the text short and simple. Put a short "verification" note on each brand if the schema allows it.

Return the corrected data (same schema, all fields), plus changes[] (one line per material change) and removed[] (things you dropped, with reason).`
}

// ---------- pipeline ----------
const results = await pipeline(DOMAINS,
  async (d) => {
    const files = []
    const outs = await parallel(d.research.map(r => () => {
      const label = `research:${r.key}`
      if (PRE[label]) { files.push(PRE[label]); log(`${label}: using the saved result`); return Promise.resolve(null) }
      return agent(`${CONTEXT}\n\n${r.prompt}` + resumeNote(label), { label, phase: 'Research', schema: d.object ? d.object : listSchema(d.schema, r.extra) })
    }))
    if (d.object) {
      if (files.length) return { file: files[0].file }
      log(`${d.key}: research ${outs[0] ? 'done' : 'FAILED'}`)
      return { data: outs[0] }
    }
    const good = outs.filter(Boolean)
    const items = dedupe(good.flatMap(o => o.items || []))
    const res = { items, files }
    good.forEach(o => { if (o.recommendation) res.recommendation = o.recommendation; if (o.notes) res.notes = (res.notes || []).concat([o.notes]) })
    log(`${d.key}: ${items.length} new items researched (${good.length} researchers ok) + ${files.length} saved result(s)`)
    return res
  },
  async (res, d) => {
    if (d.object) {
      if (!res.data && !res.file) return { data: null, changes: ['research failed'], unverified: true }
      const prompt = res.file ? verifyObjFilePrompt(d, res.file) : verifyObjPrompt(d, res.data)
      const v = await agent(prompt + resumeNote(`verify:${d.key}`), { label: `verify:${d.key}`, phase: 'Verify', schema: verifyObjSchema(d.object) })
      log(`${d.key}: verification ${v ? 'done' : 'FAILED (kept unverified)'}`)
      return v ? { data: v.data, changes: v.changes || [], removed: v.removed || [] } : { data: res.data || null, file: res.file || null, changes: [], removed: [], unverified: true }
    }
    const jobs = chunk(res.items, d.chunk).map(c => ({ items: c }))
    for (const f of res.files || []) {
      const count = f.count || d.chunk
      const per = Math.ceil(count / Math.ceil(count / d.chunk))
      for (let s = 0; s < count; s += per) jobs.push({ file: f.file, from: s, to: Math.min(count, s + per) - 1 })
    }
    const vs = await parallel(jobs.map((j, i) => () =>
      agent(j.items ? verifyListPrompt(d, j.items) : verifyListFilePrompt(d, j), { label: `verify:${d.key}#${i + 1}`, phase: 'Verify', schema: verifyListSchema(d.schema) })))
    const items = [], removed = [], changes = [], unverifiedFiles = []
    vs.forEach((v, i) => {
      const j = jobs[i]
      if (!v) {
        if (j.items) j.items.forEach(it => items.push(Object.assign({}, it, { unverified: true })))
        else unverifiedFiles.push(j)
        return
      }
      const byId = new Map((j.items || []).map(it => [it.id, it]))
      v.items.forEach(it => items.push(Object.assign({}, byId.get(it.id) || {}, it)))
      removed.push(...(v.removed || [])); changes.push(...(v.changes || []))
    })
    log(`${d.key}: ${items.length} verified, ${removed.length} removed${unverifiedFiles.length ? `, ${unverifiedFiles.length} saved chunk(s) NOT verified` : ''}`)
    return Object.assign({}, res, { items: uniqueIds(items), removed, changes, unverifiedFiles })
  },
  async (res, d) => {
    if (!d.critic || !res || !res.items) return res
    const list = res.items.map(it => `${it.name} - ${it.tier} - ${it.category} - ${it.area}`).join('\n')
    const add = await agent(`${CONTEXT}\n\n${criticPrompt(list)}`, { label: `critic:${d.key}`, phase: 'Complete', schema: listSchema(d.schema) })
    const existing = new Set(res.items.map(it => norm(it.name)))
    const fresh = uniqueIds(((add && add.items) || []).filter(it => !existing.has(norm(it.name))), new Set(res.items.map(it => it.id)))
    if (!fresh.length) { log(`${d.key}: critic found nothing important missing`); return res }
    const v = await agent(verifyListPrompt(d, fresh), { label: `verify:${d.key}-additions`, phase: 'Complete', schema: verifyListSchema(d.schema) })
    const byId = new Map(fresh.map(it => [it.id, it]))
    const added = v
      ? v.items.map(it => Object.assign({}, byId.get(it.id) || {}, it, { addedByCritic: true }))
      : fresh.map(it => Object.assign({}, it, { unverified: true, addedByCritic: true }))
    log(`${d.key}: critic added ${added.length} places`)
    return Object.assign({}, res, {
      items: uniqueIds(res.items.concat(added)),
      removed: (res.removed || []).concat(v ? (v.removed || []) : []),
      changes: (res.changes || []).concat(v ? (v.changes || []) : []),
    })
  }
)

const out = {}
DOMAINS.forEach((d, i) => { out[d.key] = results[i] })
return out
