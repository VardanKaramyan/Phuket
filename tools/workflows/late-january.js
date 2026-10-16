export const meta = {
  name: 'phuket-guide-late-january',
  description: 'Research + adversarially verify Jan 19-26 events, Koh Phangan full-moon week, departure day and solo days',
  phases: [
    { title: 'Research', detail: '3 researchers: Phuket events 19-26 Jan, Koh Phangan full-moon week, departure + solo days' },
    { title: 'Verify', detail: 'one adversarial fact-checker per research output' },
  ],
}

const CONTEXT = `You are a meticulous travel researcher producing structured content for a personal, mobile-first, offline travel-guide website.

TRAVELER: in Phuket, Thailand from Fri 8 Jan to Tue 26 Jan 2027 (today is 16 Oct 2026). Three phases: a big group from 8 to 18 Jan; two people from 19 to 23 Jan; the traveler alone from 23 to 26 Jan. FLIGHT HOME: Tue 26 Jan 2027, 18:20 from Phuket airport (HKT). Last party night: Mon 25 Jan. Loves underground techno (Bassiani / Berlin style), good raves and festivals. Main base so far: Kamala (north end, near Café del Mar).
WRITING: English is not the traveler's first language. Short, simple, concrete sentences. No marketing fluff, no emojis, no exclamation marks. Max ~320 characters per description.
CALENDAR: Mon 2027-01-18, Tue 01-19, Wed 01-20, Thu 01-21, Fri 01-22 (FULL MOON PARTY night), Sat 01-23, Sun 01-24, Mon 01-25, Tue 01-26 (flight 18:20).

ACCURACY RULES
- Every place and event must be real. Check the official / ticketing source (RA, Dice, Ticketmelon, Megatix, Eventbrite, organizer site or Instagram). Prefer 2025-2026 sources. If a date is only a pattern (e.g. "every Friday in high season"), say so in status ("recurring" or "unconfirmed").
- Never invent facts, names, prices or dates. If unsure, say so or leave the optional field out.
- Coordinates within ~200 m of the real spot.

TOOLS: First load the web tools with ToolSearch query "select:WebSearch,WebFetch". You also have Bash (curl).
COORDINATES: Google Maps link/embed on the official site ("!3d..!4d..", "@lat,lng") or Wikipedia/Wikidata, or OpenStreetMap:
   Photon:    curl -s "https://photon.komoot.io/api/?q=URL_ENCODED_QUERY&lat=7.95&lon=98.33&limit=3"
   Nominatim: curl -s -A "phuket-trip-guide/1.0 (personal use)" "https://nominatim.openstreetmap.org/search?q=URL_ENCODED_QUERY&format=jsonv2&limit=3&countrycodes=th"; sleep 1.2   (max 1 request per second)
GOOGLE MAPS: gmapsQuery = what to type into Google Maps to land exactly on the place (official name + locality).
IMAGES: imageCandidates = 1-3 DIRECT image file URLs (official site og:image or Wikimedia Commons upload URLs, with license/credit). Never an HTML page.
AREA IDS (Phuket): patong, kamala, surin, bang-tao, layan, nai-thon, nai-yang, mai-khao, karon, kata, kata-noi, nai-harn, rawai, chalong, phuket-town, kathu, cape-panwa, ao-po, thalang, natai. Off-island: phang-nga, khao-lak, krabi, phi-phi, koh-yao, koh-lanta, koh-phangan, koh-samui, other.
IDS: unique, stable kebab-case ids.
ALREADY IN THE GUIDE (do not duplicate; you MAY return an updated copy of one of these with the SAME id if you find new facts for 19-26 Jan): ${(args && args.known || []).join(', ')}`

const LINK = { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] }
const IMG = { type: 'object', properties: { url: { type: 'string' }, source: { type: 'string' }, license: { type: 'string' }, credit: { type: 'string' } }, required: ['url'] }
const GEO = { lat: { type: 'number' }, lng: { type: 'number' }, coordSource: { type: 'string' }, coordConfidence: { type: 'string', enum: ['high', 'medium', 'low'] }, gmapsQuery: { type: 'string' } }
const COMMON = { description: { type: 'string' }, tips: { type: 'array', items: { type: 'string' } }, links: { type: 'array', items: LINK }, imageCandidates: { type: 'array', items: IMG }, sources: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' } }
const EVENT = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, kind: { type: 'string', enum: ['dated', 'recurring', 'venue'] }, name: { type: 'string' }, type: { type: 'string' },
  dates: { type: 'array', items: { type: 'string' } }, recurrence: { type: 'string' }, timeText: { type: 'string' },
  venue: { type: 'string' }, island: { type: 'string' }, area: { type: 'string' },
  genres: { type: 'array', items: { type: 'string' } }, undergroundScore: { type: 'integer', minimum: 1, maximum: 5 },
  status: { type: 'string', enum: ['confirmed', 'tickets-on-sale', 'listed', 'tba', 'unconfirmed', 'recurring'] },
  lineup: { type: 'array', items: { type: 'string' } }, priceText: { type: 'string' }, pick: { type: 'boolean' },
}, GEO, COMMON), required: ['id', 'kind', 'name', 'dates', 'lat', 'lng', 'gmapsQuery', 'description', 'status'] }
const HOTEL = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' }, area: { type: 'string' }, tier: { type: 'string', enum: ['luxury', 'boutique', 'mid-range', 'budget', 'hostel'] },
  priceText: { type: 'string' }, ratingText: { type: 'string' }, whyStay: { type: 'string' }, nearby: { type: 'string' },
  vibe: { type: 'array', items: { type: 'string' } }, beachfront: { type: 'boolean' }, website: { type: 'string' },
}, GEO, COMMON), required: ['id', 'name', 'area', 'tier', 'priceText', 'whyStay', 'lat', 'lng', 'gmapsQuery'] }
const PLACE = { type: 'object', properties: Object.assign({
  id: { type: 'string' }, name: { type: 'string' }, tier: { type: 'string', enum: ['must-see', 'hidden-gem', 'day-trip'] },
  category: { type: 'string', enum: ['beach', 'viewpoint', 'temple', 'culture', 'nature', 'waterfall', 'island', 'market', 'food', 'activity', 'wellness', 'nightlife'] },
  area: { type: 'string' }, durationLabel: { type: 'string', enum: ['1-2h', '2-3h', 'half-day', 'full-day', 'multi-day', 'evening'] },
  durationHours: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } },
  bestTime: { type: 'string' }, openText: { type: 'string' }, days: { type: 'array', items: { type: 'string', enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] } },
  feeText: { type: 'string' }, gettingThere: { type: 'string' },
}, GEO, COMMON), required: ['id', 'name', 'tier', 'category', 'area', 'lat', 'lng', 'gmapsQuery', 'durationLabel', 'description'] }
const FACT = { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, critical: { type: 'boolean' }, links: { type: 'array', items: LINK } }, required: ['title', 'text'] }

const S_EVENTS = { type: 'object', properties: { items: { type: 'array', items: EVENT }, notes: { type: 'string' } }, required: ['items'] }
const S_PHANGAN = { type: 'object', properties: { items: { type: 'array', items: EVENT }, logistics: { type: 'array', items: FACT }, notes: { type: 'string' } }, required: ['items', 'logistics'] }
const S_DEPART = { type: 'object', properties: { departure: { type: 'array', items: FACT }, hotels: { type: 'array', items: HOTEL }, places: { type: 'array', items: PLACE }, solo: { type: 'array', items: FACT }, notes: { type: 'string' } }, required: ['departure', 'hotels', 'solo'] }

const TASKS = [
  { key: 'events-phuket-late-jan', schema: S_EVENTS, prompt: `TASK: Find every worthwhile music event (festivals, parties, DJ shows, club nights) from Mon 18 to Mon 25 Jan 2027 in Phuket, Natai / Phang Nga, Khao Lak, Krabi, Phi Phi, Koh Lanta and Koh Samui (NOT Koh Phangan: another researcher covers it). Underground first.
Already known and dated in the guide: Circoloco Thailand weekend 3 (Sat 23 Jan, Baba Beach Club Natai), DnB Allstars Thailand (22-24 Jan, Azulea, Chalong), O Beach Ibiza at Barra Cuda (Wed 20 Jan). Re-check their details for those dates (times, prices, any lineup announced) and return updated copies with the same ids if anything changed.
Then search: Café del Mar Phuket shows 18-25 Jan (phuket.cafedelmar.com/events, Megatix, RA); Illuzion and Shelter guest nights in that week (illuzionphuket.com/events, RA club 160713); BOA; the Courage Bar crews (FAKE PALM, SUB, Enthusiast / Enthusiast Place) and any other underground collective in Phuket; beach clubs with good house / techno programming; Krabi / Lanta / Samui parties. For the weekly Phuket nights already in the guide (Shelter Fri/Sat, Enthusiast Place Tue open doors, Illuzion, BOA), say whether their pattern continues on 19-25 Jan.
For every item give the real dates in "dates" (only 2027-01-18 to 2027-01-25), status honest, undergroundScore honest, pick=true only for the best 2-4 fits for an underground-techno lover. Return 6-20 items.` },
  { key: 'phangan-full-moon-week', schema: S_PHANGAN, prompt: `TASK: Build the Koh Phangan party calendar for Mon 18 to Mon 25 Jan 2027, the full-moon week (Full Moon Party: Fri 22 Jan, Haad Rin), and the logistics for two people going from Phuket.
Events already in the guide (re-check and return updated copies with the SAME ids, with their dates for 18-25 Jan): Jungle Experience (Thu 21 Jan), Full Moon Party (Fri 22), Waterfall Festival (about Wed 20 and Sun 24), Lighthouse Party (Tue + Fri in high season: 19, 22), OXA Jungle Party (Fridays: 22), Chill Up (Mon + Thu: 18, 21, 25), Eden Garden (Saturdays: 23), Sabaii Friday Beach Party (22), Unclave / Groovy Tunes (about every second Friday: maybe 22), Retro Mountain (party nights vary). Find anything else in that week: other jungle / techno / psytrance parties, pre- and after-parties, special full-moon-week events (phangan.events, RA, Megatix, Ticketmelon, Telegram "Phangan Party Guide", Instagram).
LOGISTICS (array of facts, each a short title + 1-3 sentences + links): how to get from Phuket to Koh Phangan on Mon 18 or Tue 19 Jan (Bangkok Airways HKT-USM + Lomprayah / Seatran / Raja boats; joint bus + boat tickets; times and 2026 prices), how to get back to Phuket on Sat 23 Jan in time for Circoloco (doors about 15:00 at Baba Beach Club Natai, about 30 min from HKT airport): the earliest boats Phangan -> Samui and the Samui -> Phuket flight times; what full-moon week does to room prices and how early to book; where to stay for these parties (Ban Tai / Haad Rin / Thong Sala); getting around the island at night (taxis, songthaews, scooters and the risks); safety at the Full Moon Party (drinks, buckets, fire shows, police, belongings); what to bring (cash, closed shoes, glow). Be exact; use the operators' 2026 timetables.` },
  { key: 'departure-and-solo-days', schema: S_DEPART, prompt: `TASK: Plan the end of the trip.
(1) "departure" facts for Tue 26 Jan 2027, flight 18:20 from Phuket International Airport (HKT): when to be at the airport for an international flight (official HKT / airline guidance, peak-season immigration and security queues), when to leave from Kamala, Patong, Kata and Nai Yang (typical afternoon drive times), how to book the ride (Grab / Bolt / airport taxi; book ahead), hotel check-out times and luggage storage options (hotel storage, airport left-luggage service at HKT with location and price), the VAT Refund for Tourists rules in 2026 (minimum spend per store per day, forms, customs check before check-in at HKT, where to claim), anything about departure cards (none?), and the last-day options before the flight. Short title + 1-3 sentences + official links each.
(2) "places": 3-6 good things to do on the last day near the airport (within about 20 minutes of HKT): e.g. Nai Yang Beach, the plane-spotting spot at Mai Khao, the Soi Dog Foundation (check visiting hours and booking), Sirinat National Park, a good seafood lunch near Nai Yang. Same place fields as the guide (tier, category, area, durationLabel, durationHours, bestTime, openText/days, feeText, gettingThere, coordinates, gmapsQuery, imageCandidates). If an item is already in the guide (Mai Khao plane spotting, Soi Dog Foundation, Nai Yang Beach), return it only if you add new, last-day-specific facts, with the SAME id.
(3) "hotels": 3-5 hotels for the last nights near the airport (Nai Yang, Mai Khao, Nai Thon), from hostel to mid-range to a treat, with realistic late-January prices, rating text, whyStay (mention the drive time to HKT) and coordinates. The guide already has Snug Airportel (Nai Yang hostel): do not repeat it.
(4) "solo": 6-10 practical facts for being alone 23-26 Jan as a techno fan: how to meet people (social hostels, party crews, RA / Telegram groups, group tours), going to parties alone safely (drinks, rides home, phone and money), solo-friendly day trips (join-in boat tours), budget for a solo room, and keeping friends updated (share location). Short title + 1-3 sentences each.` },
]

function verifyPrompt(t, data) {
  return `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER. Another researcher produced the data below for the task "${t.key}". Assume every item may be wrong, outdated, invented or mislocated. Your job is to catch problems, not to agree.
For every event: confirm the date(s) on an official / ticketing source; if a date is only a weekly pattern or a guess, set status "recurring" or "unconfirmed" and say so in the text; remove events you cannot find at all (list them in removed). For every place / hotel: confirm it operates in 2026 and re-derive the coordinates independently (fix if more than 250 m off). For every fact: check it against official or recent sources; fix numbers; remove what you cannot support.
Keep the same ids and fields. Return the corrected data in the same shape, plus changes[] (one line per material change) and removed[] (what you dropped, with reason).

DATA (JSON):
${JSON.stringify(data, null, 1)}`
}
const withLog = (schema) => ({ type: 'object', properties: { data: schema, changes: { type: 'array', items: { type: 'string' } }, removed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, reason: { type: 'string' } }, required: ['reason'] } } }, required: ['data', 'changes'] })

const results = await pipeline(TASKS,
  (t) => agent(`${CONTEXT}\n\n${t.prompt}`, { label: 'research:' + t.key, phase: 'Research', schema: t.schema }),
  async (res, t) => {
    if (!res) return { key: t.key, data: null, changes: ['research failed'] }
    const v = await agent(verifyPrompt(t, res), { label: 'verify:' + t.key, phase: 'Verify', schema: withLog(t.schema) })
    log(`${t.key}: ${v ? 'verified' : 'verification FAILED (kept unverified)'}`)
    return v ? { key: t.key, data: v.data, changes: v.changes || [], removed: v.removed || [] } : { key: t.key, data: res, changes: [], removed: [], unverified: true }
  }
)
const out = {}
results.forEach((r, i) => { out[TASKS[i].key] = r })
return out
