// Places → Food: the categories (the photo tiles under Food), their subcategories and the Good for row (27 Oct 2026,
// the user: "no food categories? maybe add subcategories for food?"). Worked out from each place's kind, tags, name
// and dishes; a place can be in several (a Southern Thai place known for its moo hong is under Thai and Pork).
// Used by tools/build.mjs; tools/share-test.mjs checks the rows.

// shrimp paste, dried shrimp and fish sauce are seasonings, not a prawn or fish dish
const SEASONING = /(liquid |stirred )?shrimp paste|(smoked )?dried (prawns?|shrimps?)|salted shrimp|shrimp chilli|fish sauce|fermented fish( curry| sauce)?|fish-innard( sauce)?|fish maw|fish balls?|krill/g
const low = (s) => String(s || '').toLowerCase().replace(SEASONING, ' ')
const has = (re, ...texts) => texts.some((t) => re.test(t))

// tile: the dish photo on the category's tile; all: the first chip of its subcategory row
// subs [key, label, test]: the test gets the place and its texts (t.all: name and dishes; t.sig: the first two dishes)
export const FOOD_CATS = [
  { key: 'pork', label: 'Pork', all: 'All pork', tile: 'moo-krob', in: (p) => p.foodKind === 'pork' || (p.foodTags || []).includes('pork'), subs: [
    ['crispy', 'Crispy & red pork', /moo krob|crispy pork|moo daeng|red (bbq |barbecue |roast )?pork|barbecue pork|kak moo/],
    ['leg', 'Pork leg & knuckle', /kha ?moo|kamoo|pork leg|kaki|knuckle|schweinshaxe|pig ankle/],
    ['braised', 'Moo hong & braised', /moo hong|braised pork|stewed pork|pork belly braised|kao yok|five-spice broth/],
    ['grilled', 'Grilled pork & satay', /moo ping|grilled pork|grilled soy pork|moo yang|pork neck|hao dong|pork skewers|sai ua|pork satay|satay.{0,30}pork|pork.{0,30}satay|soy pork/],
    ['bbq', 'Moo kata & Korean BBQ', /moo kata|mu kratha|samgyeopsal|korean bbq|moksal|grilled at the table/],
    ['ribs', 'Ribs & roasts', /(pork|spare|baby back|bbq|smoked|roasted|grilled|fried|braised|stewed|soft) (pork )?ribs|pork rib|pulled pork|suckling|babi guling|pork chop|pork cheeks|pork tenderloin|volcano ribs|pork spine|backbone/],
    ['fried', 'Fried & stir-fried pork', /fried pork|pork belly fried|moo tod|moo kua|minced pork|stir-fried.{0,25}pork|pork stir-fried|eiam tor|iem to|loba|deep-fried pork|pork armpit|streaky pork|kh?ua kling|fried pork neck|pork fried/],
    ['dimsum', 'Dim sum & buns', /dim sum|siu mai|pork buns|salapao/],
    ['soup', 'Pork noodles & soups', /kuay jap|kuay jab|guay jub|pork noodle|pork leg noodles|pork broth|pork bone|congee|\bjok\b|rice soup|khao tom|bak kut teh|offal soup|brain soup|leng s[ae]+p|boat noodles|noodles with (braised |minced |grilled )?pork|egg noodles/],
  ] },
  { key: 'seafood', label: 'Seafood', all: 'All seafood', tile: 'prawns', in: (p) => p.foodKind === 'seafood' || (p.foodTags || []).includes('seafood'), subs: [
    ['crab', 'Crab', /crab|\bpu ob\b|\bpoo\b/],
    ['prawns', 'Prawns & lobster', /prawn|shrimp|lobster|goong|mantis/],
    ['fish', 'Fish', /fish|sea bass|snapper|grouper|trevally|pomfret|barramundi|mackerel|catfish|tuna|sillago|catch of the day|daily catch|day's catch|khao tom pla|pla kapong/],
    ['shell', 'Squid & shellfish', /oyster|clam|mussel|scallop|shellfish|\bhoi\b|conch|squid|octopus|sea urchin|cuttlefish|shells/],
    ['pick', 'Pick your own', /choose|chosen|picked|from the tank|by weight|from the ice|ice display|in front of you|from the nets|live (crab|catch)|whiteboard|daily board|cooked to order/],
  ] },
  { key: 'thai', label: 'Thai', all: 'All Thai', tile: 'gaeng-som', in: (p) => ['thai', 'southern-thai', 'isaan'].includes(p.foodKind), subs: [
    ['south', 'Phuket & Southern', (p, t) => p.foodKind === 'southern-thai' || /southern|phuket[- ]style|gaeng som|kaeng som|sour (orange |fish |turmeric )?curry|moo hong|kh?ua kling|budu|sator|nam prik|tai pla|eiam tor|iem to|hokkien|o-tao|loba|khanom jeen/.test(t.all)],
    ['curry', 'Curries', /curry|massaman|panang|kaeng|gaeng|choo chee/],
    ['isaan', 'Isaan & som tam', (p, t) => p.foodKind === 'isaan' || /som ?tam|som ?tum|larb|gai yang|isaan|jaew|tam pa|papaya salad|tum thai/.test(t.all)],
    ['rice', 'Rice plates', /khao man gai|chicken rice|on rice|fried rice|kra ?pao|curry (over|on) rice|khao mok|biryani/],
    ['duck', 'Duck & goose', /duck|goose/],
  ] },
  { key: 'noodles', label: 'Noodles', all: 'All noodles', tile: 'mee-hokkien', in: (p, t) => p.foodKind === 'noodles' || (!['fine-dining', 'international', 'market'].includes(p.foodKind) && /hokkien|mee sapam|pad ?thai|phad ?thai|noodle soup|boat noodles|kuay jap|kuay jab|guay jub|khanom jeen|kanom jeen|khao ?soi|congee|\bjok\b|rice soup|khao tom/.test(t.sig)), subs: [
    ['hokkien', 'Phuket Hokkien noodles', /hokkien|mee sapam|mee hoon|mee hun|yellow noodles/],
    ['padthai', 'Pad thai', /pad ?thai|phad ?thai/],
    ['soup', 'Noodle soups', /noodle soup|boat noodles|beef noodle|kuay jap|kuay jab|guay jub|wonton|duck (and goose )?noodles|egg noodles|rice noodles|pork noodle|pork leg noodles|mee sua|thick noodle/],
    ['jeen', 'Khanom jeen', /khanom jeen|kanom jeen/],
    ['soi', 'Khao soi', /khao ?soi/],
    ['congee', 'Congee & rice soup', /congee|\bjok\b|rice soup|khao tom/],
  ] },
  { key: 'street', label: 'Street food & markets', all: 'All street food', tile: 'night-market', in: (p) => ['street-food', 'market'].includes(p.foodKind) || p.category === 'market', subs: [
    ['night', 'Night markets', (p, t) => (p.foodKind === 'market' || p.category === 'market') && /night|walking street|evening|jodd|chillva|naka|banzaan|lard yai/.test(t.name + ' ' + low(p.openText))],
    ['day', 'Day markets', (p, t) => (p.foodKind === 'market' || p.category === 'market') && !/night|walking street|evening|jodd|chillva|naka|banzaan|lard yai/.test(t.name + ' ' + low(p.openText))],
    ['stalls', 'Street stalls', (p) => p.foodKind === 'street-food'],
    ['dimsum', 'Dim sum', /dim sum/],
    ['roti', 'Roti', /roti/],
  ] },
  { key: 'grill', label: 'Grill & BBQ', all: 'All grills', tile: 'moo-kata', in: (p, t) => p.foodKind === 'grill' || /moo kata|mu kratha|samgyeopsal|korean bbq|steak/.test(t.sig), subs: [
    ['mookata', 'Moo kata', /moo kata|mu kratha/],
    ['korean', 'Korean BBQ', (p, t) => /korean|samgyeopsal|galbi|moksal/.test(t.all + ' ' + low(p.description))],
    ['steak', 'Steak', /steak|wagyu|tomahawk|picanha|chateaubriand|angus/],
    ['smoked', 'Smoked BBQ & ribs', /smoked|brisket|pulled pork|baby back|ribs/],
  ] },
  { key: 'sweet', label: 'Desserts', all: 'All desserts', tile: 'mango-sticky-rice', in: (p) => p.foodKind === 'dessert' || (p.foodTags || []).includes('dessert'), subs: [
    ['mango', 'Mango sticky rice', /mango sticky rice|sticky rice with (mango|thai custard)/],
    ['roti', 'Roti & pancakes', /roti|a-pong|crepe|pancake|khanom bueang|patongko|dough sticks/],
    ['thai', 'Thai sweets', /khanom|kanom|bua lo[iy]|lod chong|tub tim|o-aew|oh aew|thai desserts?|thai sweets?|sangkaya|custard|in coconut milk|luk chup|foi thong|thong yip|inthanin|tofu pudding|coconut pudding|bokkia|jelly|bi co moi|black sticky rice|salapao|coconut cups/],
    ['ice', 'Ice cream & shaved ice', /ice cream|bingsu|kakigori|shaved ice|gelato|sorbet/],
    ['cake', 'Cakes & chocolate', /cake|\btarts?\b|\bpies?\b|croissant|pastr|chocolate|brownie|eclair|honey toast|cr[eè]me br[uû]l[eé]e|tiramisu|cinnamon|brioche|croffle|strudel/],
  ] },
  { key: 'cafe', label: 'Cafes & bakeries', all: 'All cafes', tile: 'coffee', in: (p) => ['cafe', 'bakery'].includes(p.foodKind), subs: [
    ['coffee', 'Coffee', (p, t) => p.foodKind === 'cafe' || /coffee|kopi|espresso/.test(t.all)],
    ['bakery', 'Bakeries', (p, t) => p.foodKind === 'bakery' || /sourdough|croissant|bread|bakery|pastr|cinnamon roll|brioche/.test(t.all)],
    ['breakfast', 'Breakfast', (p) => (p.foodTags || []).includes('breakfast')],
    ['view', 'With a view', (p) => (p.foodTags || []).includes('view')],
  ] },
  { key: 'fine', label: 'Special dinners', all: 'All special dinners', tile: 'tasting-menu', in: (p) => p.foodKind === 'fine-dining' || ['1 star', '2 stars', '3 stars'].includes(p.michelin), subs: [
    ['stars', 'Michelin stars', (p) => ['1 star', '2 stars', '3 stars'].includes(p.michelin)],
    ['thai', 'Thai', (p, t) => !FINE_WORLD.test(t.name) && /\bthai\b(?! ingredients| produce| cacao| and local)|southern|isaan|royal|phuket|andaman|krabi|nakhon|pad thai|curr(y|ies)/.test(t.all + ' ' + low(p.description))],
    ['world', 'Western & other', (p, t) => FINE_WORLD.test(t.name) || !/\bthai\b(?! ingredients| produce| cacao| and local)|southern|isaan|royal|phuket|andaman|krabi|nakhon|pad thai|curr(y|ies)/.test(t.all + ' ' + low(p.description))],
  ] },
  { key: 'intl', label: 'International', all: 'All international', tile: 'pizza', in: (p) => p.foodKind === 'international', subs: [
    ['italian', 'Italian & pizza', /pizza|pasta|italian|tortell|linguine|tagliatelle|risotto|gelato|lasagn|carbonara|fettuccine/],
    ['europe', 'European', /french|german|georgian|swiss|bistro|schweinshaxe|sp[aä]tzle|khinkali|khachapuri|onion soup|pork chop|mediterranean|moussaka|kebab|mezze/],
    ['asian', 'Asian & Indian', /dim sum|cantonese|siu mai|korean|japanese|indian|biryani|nasi/],
    ['burgers', 'Burgers & late food', /burger|fries/],
  ] },
]
// tasting menus whose description names Thai produce but cook another cuisine
const FINE_WORLD = /pru \(|aulis|dao by|gaggan|s[uü]hring|l'ar[oô]me|le normandie|omemo|smokaccia|acqua|jampa/

// the Good for row: one tap filters by it; a second tap on the same chip turns it off
export const FOOD_GOOD = [
  ['pick', 'Top picks', (p) => !!p.pick],
  ['michelin', 'Michelin', (p) => !!p.michelin || (p.foodTags || []).includes('michelin')],
  ['budget', 'Cheap eats', (p) => (p.foodTags || []).includes('budget') || p.priceLevel === 1],
  ['group', 'Big groups', (p) => (p.foodTags || []).includes('group-friendly')],
  ['late', 'Late night', (p) => (p.foodTags || []).includes('late-night')],
  ['breakfast', 'Breakfast', (p) => (p.foodTags || []).includes('breakfast')],
  ['view', 'Views', (p) => (p.foodTags || []).some((t) => t === 'view' || t === 'beachfront')],
  ['local', 'Where locals eat', (p) => (p.foodTags || []).includes('local-favourite')],
  ['veg', 'Vegetarian', (p) => (p.foodTags || []).includes('vegetarian-friendly')],
  ['halal', 'Halal', (p) => (p.foodTags || []).includes('halal')],
]

const textsOf = (p) => {
  const dishes = (p.dishes || []).map(low)
  return { name: low(p.name), all: [low(p.name), ...dishes].join(' ; '), sig: dishes.slice(0, 2).join(' ; ') }
}
// { cats: ['pork', 'thai'], subs: { pork: ['crispy', 'leg'], thai: ['south'] }, good: ['pick', 'budget'] }
export function foodCats(p) {
  const t = textsOf(p), cats = [], subs = {}
  for (const c of FOOD_CATS) {
    if (!c.in(p, t)) continue
    cats.push(c.key)
    subs[c.key] = c.subs.filter(([, , test]) => (typeof test === 'function' ? test(p, t) : test.test(t.all))).map(([k]) => k)
  }
  return { cats, subs, good: FOOD_GOOD.filter(([, , test]) => test(p)).map(([k]) => k) }
}

// a stand-in photo for a place without its own: its signature dish (data/dishes.json → key, label, photo).
// The first dish that matches, then the name, then its kind.
export const DISH = [
  ['khinkali', /khinkali/], ['kebab', /kebab|mezze|hummus/], ['biryani', /biryani/], ['pizza', /pizza/], ['pasta', /pasta|tortell|linguine|tagliatelle|fettuccine|lasagn|carbonara/],
  ['mee-hokkien', /hokkien|mee sapam|mee hoon|mee hun/], ['moo-hong', /moo hong|braised pork belly|kao yok/], ['khao-kha-moo', /kha ?moo|kamoo|pork leg|kaki|knuckle/],
  ['kuay-jap', /kuay jap|kuay jab|guay jub/], ['moo-krob', /moo krob|crispy pork/], ['moo-daeng', /moo daeng|red (bbq |barbecue |roast )?pork|barbecue pork/],
  ['moo-kata', /moo kata|mu kratha/], ['korean-bbq', /samgyeopsal|korean|moksal/], ['satay', /satay/], ['moo-ping', /moo ping|grilled pork|moo yang|pork neck|pork skewers|hao dong/],
  ['bak-kut-teh', /bak kut teh|herbal pork rib/], ['ribs', /\bribs\b|spine|backbone/], ['jok', /congee|\bjok\b|rice soup|khao tom|porridge/], ['dim-sum', /dim sum|siu mai|har gow|dumplings/],
  ['pad-thai', /pad ?thai|phad ?thai/], ['khao-soi', /khao ?soi/], ['khanom-jeen', /khanom jeen|kanom jeen/], ['boat-noodles', /boat noodles/],
  ['beef-noodles', /beef noodle|beef soup|stewed beef/], ['crab-curry', /crab (meat )?(yellow )?curry|curry crab|fried curry crab/],
  ['noodle-soup', /noodle soup|noodles in|egg noodles|wonton|duck noodles|rice noodles with|duck and goose noodles/],
  ['khao-man-gai', /khao man gai|chicken rice/], ['duck', /duck|goose/], ['oyster-omelette', /o-tao|oyster omelette|hoi tod|or suan|mussel pancake/],
  ['gaeng-som', /gaeng som|kaeng som|sour (orange |fish |turmeric )?curry|sour fish|sour soup/], ['kua-kling', /kh?ua kling/], ['massaman', /massaman/],
  ['crab', /crab/], ['prawns', /prawn|shrimp|lobster|goong/], ['squid', /squid|octopus/], ['clams', /clam|oyster|mussel|scallop|shellfish/],
  ['fish', /fish|sea bass|snapper|grouper|trevally|mackerel|pomfret|catch/], ['curry', /curry|panang|kaeng|gaeng/],
  ['som-tam', /som ?tam|som ?tum|papaya salad|tum thai/], ['gai-yang', /gai yang|grilled chicken/], ['fried-chicken', /fried chicken|gai tod/],
  ['mango-sticky-rice', /mango sticky rice|sticky rice with mango/], ['roti', /roti/], ['thai-pancakes', /a-pong|khanom bueang|crepes?\b/], ['o-aew', /o-aew|oh aew/],
  ['shaved-ice', /bingsu|kakigori|shaved ice/], ['ice-cream', /ice cream|gelato|sorbet/], ['chocolate', /chocolate|cacao/],
  ['thai-sweets', /khanom|bua lo|lod chong|thai desserts?|custard|patongko|tub tim|jelly|bokkia|pudding|dough sticks/],
  ['coffee', /coffee|kopi|espresso/], ['bakery', /sourdough|bread|croissant|pastr|bakery|cake|\btarts?\b|\bpies?\b|brioche|sausage rolls/],
  ['steak', /steak|wagyu|picanha|tomahawk|chateaubriand/], ['burger', /burger/],
]
// the stand-in's caption (and the tile photos' names)
export const DISH_LABEL = {
  khinkali: 'Khinkali', kebab: 'Kebab', biryani: 'Biryani', pizza: 'Pizza', pasta: 'Pasta', 'mee-hokkien': 'Mee Hokkien', 'moo-hong': 'Moo hong', 'khao-kha-moo': 'Khao kha moo',
  'kuay-jap': 'Kuay jap', 'moo-krob': 'Moo krob', 'moo-daeng': 'Khao moo daeng', 'moo-kata': 'Moo kata', 'korean-bbq': 'Korean BBQ', satay: 'Pork satay', 'moo-ping': 'Grilled pork',
  'bak-kut-teh': 'Bak kut teh', ribs: 'Pork ribs', jok: 'Jok rice porridge', 'dim-sum': 'Dim sum', 'pad-thai': 'Pad thai', 'khao-soi': 'Khao soi', 'khanom-jeen': 'Khanom jeen',
  'boat-noodles': 'Boat noodles', 'beef-noodles': 'Beef noodle soup', 'crab-curry': 'Crab curry', 'noodle-soup': 'Noodle soup', 'khao-man-gai': 'Khao man gai', duck: 'Roast duck',
  'oyster-omelette': 'Oyster omelette', 'gaeng-som': 'Gaeng som', 'kua-kling': 'Khua kling', massaman: 'Massaman curry', crab: 'Crab', prawns: 'Prawns', squid: 'Squid',
  clams: 'Clams', fish: 'Fish', curry: 'Thai curry', 'som-tam': 'Som tam', 'gai-yang': 'Gai yang', 'fried-chicken': 'Fried chicken', 'mango-sticky-rice': 'Mango sticky rice',
  roti: 'Roti', 'thai-pancakes': 'Thai pancakes', 'o-aew': 'O-aew', 'shaved-ice': 'Shaved ice', 'ice-cream': 'Ice cream', chocolate: 'Chocolate', 'thai-sweets': 'Thai sweets',
  coffee: 'Coffee', bakery: 'Bakery', steak: 'Steak', burger: 'Burger', 'tasting-menu': 'Tasting menu', 'night-market': 'Night market', 'thai-food': 'Thai food',
}
const KIND_DISH = { 'fine-dining': 'tasting-menu', market: 'night-market', cafe: 'coffee', bakery: 'bakery' }
export function dishOf(p) {
  // a tasting menu is not one dish: its stand-in is a plated course; a market's is a market; a cafe's is coffee
  const kind = p.category === 'market' ? 'market' : p.foodKind
  if (KIND_DISH[kind]) return KIND_DISH[kind]
  if (kind === 'grill' && /korean/.test(low(p.description))) return 'korean-bbq'
  for (const d of [...(p.dishes || []).slice(0, 3), p.name].map(low)) {
    let best = null
    for (const [key, re] of DISH) { const m = d.match(re); if (m && (!best || m.index < best.at)) best = { key, at: m.index } }
    if (best) return best.key
  }
  return ''
}
