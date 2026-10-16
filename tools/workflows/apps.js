export const meta = {
  name: 'phuket-guide-apps',
  description: 'Research + adversarially verify the apps and services to install for the Phuket / Koh Phangan trip (rides, travel, money, phone, chat, safety, food, party tickets, bookings)',
  phases: [
    { title: 'Research', detail: '3 researchers: rides and travel; money, phone, chat, maps and safety; food, party tickets and bookings' },
    { title: 'Verify', detail: 'one adversarial fact-checker per research output (store links, availability, claims)' },
    { title: 'Critic', detail: 'completeness critic over all three lists, then a fact-check of what it adds' },
  ],
}

const CONTEXT = `You are a meticulous travel researcher producing structured content for a personal, mobile-first, offline travel-guide website.

TRAVELER: in Phuket, Thailand from Fri 8 Jan to Tue 26 Jan 2027 (today is 16 Oct 2026). A big group from 8 to 18 Jan (base: Kamala, north end, near Café del Mar); two people from 19 to 23 Jan, mostly on Koh Phangan (Ban Tai) for the full-moon week, reached by a Bangkok Airways flight Phuket - Koh Samui and a Lomprayah / Seatran boat, back to Phuket on Sat 23 Jan; then the traveler alone until the flight home on Tue 26 Jan 2027, 18:20 from Phuket airport (HKT). Last nights near the airport (Nai Yang). Loves underground techno and raves. Goes to: Circoloco at Baba Beach Club Natai (tickets on Dice and Ticketmelon), Café del Mar shows (Megatix), DnB Allstars (Megatix / official site), OXA Jungle Party and Jungle Experience (Megatix), Waterfall Festival (Eventpop), Hollystone (Megatix), Bambu (Entrix), Lost Jungle (Vibez shop), small parties found on Resident Advisor, Instagram and the Telegram channel 'Phangan Party Guide'. Uses Grab / Bolt for rides, money changers and ATMs for cash. Probably a foreign (non-Thai) phone number and a non-Thai App Store / Google Play account.
WRITING: English is not the traveler's first language. Short, simple, concrete sentences. No marketing fluff, no emojis, no exclamation marks, no em-dash asides. 'what' max ~220 characters; each tip max ~170 characters; 'setup' max ~200 characters.

ACCURACY RULES
- Every app and service must be real, live and usable by a foreign tourist in Thailand in late 2026 / early 2027. Check the official site and the store listings. Prefer 2025-2026 sources. If a service shut down or left Thailand, say so (and leave it out of items, list it in 'removed' or notes).
- Never invent facts, prices, features or button names. If unsure, leave it out or say it is not confirmed.
- STORE LINKS: give the exact App Store URL (https://apps.apple.com/app/id<digits> or with a country path) and Google Play URL (https://play.google.com/store/apps/details?id=<package>) ONLY after you checked them, e.g.
    curl -sL -m 30 -A "Mozilla/5.0 (Macintosh)" "https://apps.apple.com/us/app/id<digits>" | grep -o '<title>[^<]*' | head -1
    curl -sL -m 30 -A "Mozilla/5.0" "https://play.google.com/store/apps/details?id=<package>&hl=en" | grep -o '<title>[^<]*' | head -1
  The title must name the right app and publisher. Also check whether the iOS app is listed outside Thailand (try the us and gb storefronts, e.g. apps.apple.com/gb/app/id<digits>); if it is Thai-store-only, say so in a tip (a foreign Apple ID cannot download it).
- 'where' must be exact for this trip: Phuket, Koh Phangan, Koh Samui (and say clearly if something does NOT work on Koh Phangan or at Phuket airport).

TOOLS: First load the web tools with ToolSearch query "select:WebSearch,WebFetch". You also have Bash (curl).
IDS: unique kebab-case ids, e.g. 'grab', 'bolt', 'line'.
PRIORITY: 'must' = install and set up at home before the flight; 'useful' = worth having; 'optional' = only for some plans.
CATEGORY: rides (Getting around), travel (Ferries, flights and airport), maps (Maps and language), phone (Phone and internet), chat (Chat and contacts), money (Money and payments), safety (Safety and health), food (Food and delivery), events (Parties and tickets), bookings (Hotels, tours and tickets for activities).`

const LINK = { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label', 'url'] }
const APP = { type: 'object', properties: {
  id: { type: 'string' }, name: { type: 'string', description: 'name as in the stores' },
  category: { type: 'string', enum: ['rides', 'travel', 'maps', 'phone', 'chat', 'money', 'safety', 'food', 'events', 'bookings'] },
  priority: { type: 'string', enum: ['must', 'useful', 'optional'] },
  what: { type: 'string', description: 'what you use it for on this trip' },
  setup: { type: 'string', description: 'what to do at home before the flight (account, SMS code to your home number, card, offline download). Empty if nothing.' },
  where: { type: 'string', description: 'where it works on this trip' },
  cost: { type: 'string', description: 'free / fees / plan prices, only if known' },
  tips: { type: 'array', items: { type: 'string' } },
  appStore: { type: 'string', description: 'checked App Store URL, or empty' },
  googlePlay: { type: 'string', description: 'checked Google Play URL, or empty' },
  website: { type: 'string', description: 'official site (for web-only services this is the main link)' },
  links: { type: 'array', items: LINK, description: 'extra official help pages, e.g. how to download offline maps' },
  sources: { type: 'array', items: { type: 'string' } },
  verification: { type: 'string', description: 'what you checked and when' },
}, required: ['id', 'name', 'category', 'priority', 'what', 'where', 'verification'] }
const CORRECTION = { type: 'object', properties: { claim: { type: 'string' }, verdict: { type: 'string', enum: ['correct', 'wrong', 'outdated', 'unsupported'] }, correction: { type: 'string', description: 'the corrected sentence(s) in the same simple style, or empty if correct' }, source: { type: 'string' } }, required: ['claim', 'verdict'] }
const REMOVED = { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] }
const S_APPS = { type: 'object', properties: { items: { type: 'array', items: APP }, corrections: { type: 'array', items: CORRECTION }, removed: { type: 'array', items: REMOVED }, notes: { type: 'string' } }, required: ['items', 'corrections'] }
const S_VERIFIED = { type: 'object', properties: { items: { type: 'array', items: APP }, corrections: { type: 'array', items: CORRECTION }, removed: { type: 'array', items: REMOVED }, changes: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['items', 'corrections', 'changes'] }

const TASKS = [
  { key: 'rides-travel', prompt: `TASK: the apps and services for GETTING AROUND and TRAVEL on this trip (categories rides, travel, and maps only where it is about navigation).
Cover at least: Grab (GrabCar and its options, GrabBike if legal and available in Phuket, Advance Booking, Share My Ride, payment by card or cash, the SMS code to a foreign number at sign-up), Bolt, inDrive (does it really work in Phuket in 2026?), any other ride app that works in Phuket (check: Maxim, LINE MAN rides, airasia ride / MOVE, local taxi apps), and what works on Koh Samui and on Koh Phangan (Grab? Bolt? or only songthaew / local taxis and LINE / WhatsApp drivers). At Phuket airport: where app cars pick up in 2026, any rules or fees, and the official airport taxi / limousine counters. Phuket Smart Bus (live tracking app or site, payment). Ferries: Lomprayah, Seatran Discovery, Haad Rin Queen (online booking, e-tickets, apps). 12Go (app and site). Bangkok Airways (app: check-in, boarding pass) for the Phuket - Samui flights. The official Airports of Thailand app (flight board for HKT). FlightRadar24 (the guide uses it for plane spotting at Mai Khao). Offline navigation backup (Google Maps offline areas; Organic Maps or Maps.me).
ALSO CHECK these claims that are in the guide now, and return one 'corrections' entry for each:
1. "Both apps [Grab and Bolt] work in Phuket and show the price first. Typical car fares: airport to Patong 600-950 baht, Patong to Kata 250-500, Patong to Old Town 400-550. Bolt is often a bit cheaper, so compare. Prices go up at busy times and in heavy rain."
2. "Grab pickup is near Exit 8 (international) or Exit 1 (domestic)."
3. "Install Grab and Bolt before you arrive and add a payment card. Compare both for each ride. inDrive also works in Phuket and lets you offer your own price."
4. "Airport limousine taxis have fixed prices on a board, about 800 baht to Patong; metered taxis add a 100-baht airport fee."
5. "12Go: Book ferries, buses, vans and domestic flights, with e-tickets on your phone. Check the pier and pickup time carefully."
6. "Phuket Smart Bus: pay by contactless card, Thai QR or cash." and "live tracking" on phuketsmartbus.com.
Return 8-16 items.` },
  { key: 'money-phone-safety', prompt: `TASK: the apps and services for MONEY, PHONE AND INTERNET, CHAT, MAPS AND LANGUAGE, and SAFETY AND HEALTH on this trip.
Cover at least: Wise and Revolut (card exchange rates, weekend or other fees, ATM limits; Thai ATMs charge foreign cards 250-350 baht per withdrawal anyway); paying by phone in Thailand with a foreign card (Apple Pay / Google Pay at contactless terminals: does it work in 2026?); Thai QR (PromptPay) payments for tourists in 2026: which apps a foreigner can really use (check TrueMoney Wallet for foreigners, Alipay+ partner wallets, the TAGTHAi app from TAT, any bank 'tourist QR' product) and their limits; a currency converter (XE or similar; the guide has its own converter too); exchange-rate apps or pages of the money changers in the guide (SuperRich, Mamy Exchange, Lion) if they exist. Phone: eSIM apps (Airalo, Holafly, Saily or others: real 2026 Thailand prices are optional) versus the official AIS and True tourist eSIMs, and the AIS / True apps for top-ups. Chat: LINE (sign-up needs an SMS code; how to add a shop by LINE ID or QR; LINE Official Accounts), WhatsApp, Telegram (the party channel). Maps and language: Google Maps (offline areas, saving places, sharing location), Google Translate (offline Thai, camera, conversation). Safety and health: the Thailand Tourist Police app (exact store name, publisher, features, languages), emergency numbers (1155 tourist police, 1669 ambulance, 191 police), any official app for travel advice, a weather / sea app good for boat days and rain (Windy or the Thai Meteorological Department app), hospital apps only if useful (Bangkok Hospital Phuket, Vachira Phuket).
ALSO CHECK these claims that are in the guide now, and return one 'corrections' entry for each:
1. "Thailand Tourist Police app: Official app with an SOS function that connects you to the Tourist Police (1155) and uses GPS to find you. It works without a Thai SIM. Live chat in English, Chinese, Japanese, Korean and Russian."
2. "LINE is the main chat app in Thailand. Many hotels, drivers, tour shops and clubs answer on LINE faster than by email or phone."
3. "A Wise or similar card gives a good exchange rate. In 2026 Thai bank ATMs charge foreign cards 250 baht (Visa) or 350 baht (Mastercard) per withdrawal, so take out larger amounts. Always choose to pay in baht (THB), not in your home currency."
4. "Or buy an AIS or True eSIM online before the trip, or use an eSIM app such as Airalo. Check that your phone supports eSIM. Keep your home SIM on for bank SMS codes."
5. "Google Translate: download Thai for offline use. The camera mode reads menus and signs, and conversation mode helps with drivers."
Return 10-18 items.` },
  { key: 'food-events-bookings', prompt: `TASK: the apps and services for FOOD AND DELIVERY, PARTIES AND TICKETS, and BOOKINGS (hotels, tours, activities) on this trip.
Cover at least: food delivery in Phuket in 2026 (GrabFood, LINE MAN, foodpanda: is foodpanda still in Thailand?, Robinhood: still running?, ShopeeFood?), and on Koh Phangan / Samui; restaurant finding (Wongnai, Google Maps; the Michelin Guide app only if useful). Party tickets, one item per platform the traveler needs: DICE (does the ticket live only in the app? transfer rules?), Megatix, Ticketmelon, Eventpop, Entrix, Resident Advisor (RA app: tickets, event alerts, following venues and artists), and how each one delivers tickets (app, e-mail QR, ID check). Telegram for the 'Phangan Party Guide' channel and Instagram for crews (only as short items or tips). Bookings: Agoda and Booking.com (which one is stronger for Thai hotels, pay-at-hotel), Hostelworld (its chats and 'Linkups' for solo days), Klook and GetYourGuide (tours, airport transfers, SIM pickup), 12Go only if not obviously travel (another researcher covers ferries). Laundry, massage or other everyday services only if there is a real app tourists use in Phuket.
ALSO CHECK these claims that are in the guide now, and return one 'corrections' entry for each:
1. "Klook and GetYourGuide: book tours, boat trips and tickets with reviews and clear prices. Check what is included (hotel pickup, park fees, lunch) and the cancellation rules."
2. "Hostelworld: book a bed through Hostelworld, and the app opens chats with people in your hostel and in Phuket 7 days before check-in. 'Linkups' are meet-ups that hostels and travellers post, from dinners to nights out."
3. "Circoloco tickets: Dice says 18+, but Ticketmelon says 20+. Bring your passport." (ticket and ID rules at the door)
Return 10-18 items.` },
]

const verifyPrompt = (t, data) => `${CONTEXT}

ROLE: You are an ADVERSARIAL FACT-CHECKER. Another researcher produced the data below for the task "${t.key}". Assume every item may be wrong, outdated, shut down, not available in Thailand, not available to a foreign phone number or store account, or has a broken / wrong store link. Your job is to catch problems, not to agree.
For EVERY item: (1) re-check that the service is live in Thailand in Oct 2026 and works where 'where' says (especially Koh Phangan and Phuket airport); (2) fetch the App Store and Google Play URLs yourself and confirm the title and publisher (fix or empty them if wrong); (3) re-check each fact in 'what', 'setup', 'cost' and every tip against a source, and delete or fix anything you cannot confirm; (4) check the priority makes sense for this traveler (must = needed before the flight). Re-check every 'corrections' entry too.
Keep good items (fixed), drop bad ones (list them in 'removed' with the reason), and you may add an important missing item if you fully verify it. In 'changes', list each change you made in one line. Keep the writing rules.

THE TASK WAS:
${t.prompt}

THE DATA TO CHECK:
${JSON.stringify(data, null, 1)}`

phase('Research')
const verified = await pipeline(
  TASKS,
  (t) => agent(`${CONTEXT}\n\n${t.prompt}`, { label: 'research:' + t.key, phase: 'Research', schema: S_APPS }),
  (res, t) => res ? agent(verifyPrompt(t, res), { label: 'verify:' + t.key, phase: 'Verify', schema: S_VERIFIED }).then((v) => v || { ...res, changes: ['VERIFY FAILED: unverified research output'] }) : null,
)
const lists = {}
TASKS.forEach((t, i) => { lists[t.key] = verified[i] })
log(`verified lists: ${TASKS.map((t, i) => `${t.key} ${(verified[i] && verified[i].items || []).length} items`).join(', ')}`)

// the critic needs every list at once
phase('Critic')
const summary = TASKS.map((t) => `== ${t.key}\n` + ((lists[t.key] && lists[t.key].items) || []).map((x) => `- ${x.name} [${x.category}, ${x.priority}] ${x.what} | where: ${x.where}`).join('\n')).join('\n\n')
const critic = await agent(`${CONTEXT}

ROLE: COMPLETENESS CRITIC. Three researchers and three fact-checkers built the list below of apps and services to install for this trip. Find what is MISSING or WRONG for this traveler's real days: arrival at HKT (TDAC is a web form, not an app: check there is no official app and that fake apps exist), the group days in Kamala, boat days, the Koh Phangan week (taxis there, ferries, ATMs, cash), the solo days (meeting people, safety), parties (tickets, ID), money, phone, health, the last day and the flight home (left luggage, VAT refund, lounges, airline check-in). Also look for duplicates, wrong priorities (too many 'must' items is bad: keep 'must' to what really needs setting up at home), and items that do not work for a foreign tourist.
Return ONLY new items you fully researched and verified (same rules: real, live, checked store links), plus 'corrections' for problems you see in the existing list (claim = the item name + what is wrong, correction = the fix). Return 0-8 new items; quality over count.

THE CURRENT LIST:
${summary}`, { label: 'critic:completeness', phase: 'Critic', schema: S_APPS })

let extra = null
if (critic && ((critic.items || []).length || (critic.corrections || []).length)) {
  extra = await agent(verifyPrompt({ key: 'critic-additions', prompt: 'Additions and corrections from a completeness critic for the apps list of this trip.' }, critic), { label: 'verify:critic-additions', phase: 'Critic', schema: S_VERIFIED })
  if (!extra) extra = { ...critic, changes: ['VERIFY FAILED: unverified critic output'] }
}
return { lists, extra }
