// Imports the apps research (research/result-apps.json, from the phuket-guide-apps workflow) into data/apps.json:
// merges the three fact-checked lists and the critic's checked additions, removes duplicates, keeps the log.
// The 'corrections' (claims already in the guide) are printed for a manual fix in tools/curate.mjs.
// Usage: node tools/import-apps.mjs research/result-apps.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, ...a)
if (!process.argv[2] || !fs.existsSync(process.argv[2])) {
  console.log(`import-apps: ${process.argv[2] || '(no file given)'} not found, data/apps.json left as it is`)
  process.exit(0)
}
const src = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const R = src.result || src
const strip = (s) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : s)
const clean = (o) => (Array.isArray(o) ? o.map(clean) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)])) : strip(o))
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const CATS = ['rides', 'travel', 'maps', 'phone', 'chat', 'money', 'safety', 'food', 'events', 'bookings']
const PRI = ['must', 'useful', 'optional']
const okStore = { appStore: /^https:\/\/apps\.apple\.com\/([a-z]{2}\/)?app\/([^/]+\/)?id\d+/, googlePlay: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/ }

const sets = [...Object.entries(R.lists || {}).map(([k, v]) => [k, v]), ['critic-additions', R.extra]].filter(([, v]) => v)
const byId = new Map()
const log = { changes: {}, removed: {}, corrections: [] }
for (const [key, v] of sets) {
  log.changes[key] = v.changes || []
  log.removed[key] = v.removed || []
  for (const c of v.corrections || []) log.corrections.push({ from: key, ...clean(c) })
  for (const raw of v.items || []) {
    const it = clean(raw)
    it.id = slug(it.id || it.name)
    if (!CATS.includes(it.category)) it.category = 'travel'
    if (!PRI.includes(it.priority)) it.priority = 'useful'
    for (const k of ['appStore', 'googlePlay']) {
      if (it[k] && !okStore[k].test(it[k])) { console.log(`  ${it.id}: dropped odd ${k} link ${it[k]}`); it[k] = '' }
      if (it[k]) it[k] = it[k].replace(/[?&]hl=[a-z-]+$/i, '').replace(/&gl=[a-z]+/i, '')
    }
    const old = byId.get(it.id)
    if (!old) { byId.set(it.id, it); continue }
    // the same app from two researchers: keep the higher priority, the longer texts, and every tip and link
    const merged = { ...old }
    if (PRI.indexOf(it.priority) < PRI.indexOf(old.priority)) merged.priority = it.priority
    for (const k of ['what', 'setup', 'where', 'cost', 'appStore', 'googlePlay', 'website', 'verification']) if ((it[k] || '').length > (old[k] || '').length) merged[k] = it[k]
    merged.tips = Array.from(new Set([...(old.tips || []), ...(it.tips || [])]))
    const seen = new Set(); merged.links = [...(old.links || []), ...(it.links || [])].filter((l) => l && l.url && !seen.has(l.url) && seen.add(l.url))
    merged.sources = Array.from(new Set([...(old.sources || []), ...(it.sources || [])]))
    byId.set(it.id, merged)
    console.log(`  merged duplicate ${it.id} (${key})`)
  }
}
// editorial fixes after the merge (for example from the completeness critic): change an app, or drop it
// from the completeness critic's fact-checked corrections (16 Oct 2026)
const tip = (a, t) => { a.tips = [...(a.tips || []), t] }
const ATM = 'Thai ATMs still charge their own fee for each withdrawal with a foreign card: 250 baht (Visa) or 350 baht (Mastercard) at the big banks in 2026. The card does not pay it back, so take out bigger amounts less often, and choose baht if the screen offers your home currency.'
const APP_FIX = { // id: (app) => { ... }
  // one Telegram item, with the party channel
  telegram: (a) => {
    const g = byId.get('telegram-party-guide')
    a.category = 'events'
    if (g) { a.tips = Array.from(new Set([...(a.tips || []), ...(g.tips || [])])); const seen = new Set(); a.links = [...(a.links || []), ...(g.links || [])].filter((l) => l && l.url && !seen.has(l.url) && seen.add(l.url)) }
  },
  grab: (a) => tip(a, 'The same app orders food (GrabFood) in Phuket. Grab does not work on Koh Phangan: for food there, use Delivery KPG.'),
  // 1155 works without the app, and the app has low ratings (from only 6 ratings each, Oct 2026)
  'tourist-police': (a) => { a.priority = 'useful'; tip(a, 'You can call 1155 without the app. The app has low store ratings, so keep 1155 as a normal phone call.') },
  'bangkok-airways': (a) => { a.priority = 'useful'; tip(a, 'The Boutique Lounge is free for all Bangkok Airways passengers, also in economy. At Phuket it is in the domestic terminal, 2nd floor, near Gate 4, open 05:30-21:30 (Nov 2025).') },
  wise: (a) => tip(a, ATM),
  revolut: (a) => tip(a, ATM),
  'ais-tourist-sim': (a) => tip(a, 'Since 16 May 2026 a Thai SIM card for a foreigner is registered in person with the passport, at a shop or the airport counter (max 3 SIMs per person per provider, NBTC rule). Bring your passport.'),
  'true-tourist-sim': (a) => tip(a, 'Since 16 May 2026 a Thai SIM card for a foreigner is registered in person with the passport, at a shop or the airport counter (max 3 SIMs per person per provider, NBTC rule). Bring your passport.'),
  truemoney: (a) => { a.setup = 'Sign-up needs a Thai mobile number for the SMS code, then a passport scan and a live selfie. Approval can take 1 to 3 business days, and some travellers fail the check. Do not count on it for this trip.' },
}
const DROP = new Set([ // ids to leave out
  'grabfood', // the same app as Grab (tip added there)
  'telegram-party-guide', // merged into telegram
])
for (const [id, fn] of Object.entries(APP_FIX)) { const a = byId.get(id); if (a) fn(a); else console.log(`  APP_FIX: no app ${id}`) }
for (const id of DROP) if (!byId.delete(id)) console.log(`  DROP: no app ${id}`)
const items = Array.from(byId.values())
// lists rebuilt from a journal or with a dead fact-checker carry 'VERIFY MISSING' / 'VERIFY FAILED' in their changes
const unverified = sets.filter(([, v]) => (v.changes || []).some((c) => /^VERIFY (MISSING|FAILED)/.test(c))).map(([k]) => k)
fs.writeFileSync(P('data/apps.json'), JSON.stringify({
  asOf: '16 Oct 2026',
  intro: 'What to install for this trip and what each app is for. Set up the must-haves at home: most of them send an SMS code to your phone number when you sign up.',
  unverified,
  items,
}, null, 1))
const rl = JSON.parse(fs.readFileSync(P('data/research-log.json'), 'utf8'))
rl.changes.apps = log.changes; rl.removed.apps = log.removed; rl.appsCorrections = log.corrections
fs.writeFileSync(P('data/research-log.json'), JSON.stringify(rl, null, 1))

const count = (k) => Object.fromEntries((k === 'category' ? CATS : PRI).map((c) => [c, items.filter((i) => i[k] === c).length]).filter(([, n]) => n))
console.log(`${items.length} apps · by priority ${JSON.stringify(count('priority'))} · by category ${JSON.stringify(count('category'))}`)
console.log(`no store link: ${items.filter((i) => !i.appStore && !i.googlePlay).map((i) => i.id).join(', ') || '-'}`)
if (unverified.length) console.log(`\nWARNING: NOT FACT-CHECKED: ${unverified.join(', ')}. The Apps page says so. Do not publish it or apply these corrections before a fact-check (resume or re-run tools/workflows/apps.js).`)
console.log(`\ncorrections to apply in curate.mjs (${log.corrections.length}):`)
for (const c of log.corrections) console.log(`- [${c.from}] ${c.verdict.toUpperCase()}: ${c.claim}\n    -> ${c.correction || '(no change)'}${c.source ? `\n    source: ${c.source}` : ''}`)
