// Tests the dram (AMD) amounts added next to baht prices: the rules in tools/amd.mjs on sample texts, then the
// built page: every whole-baht amount on it must have its dram amount next to it.
// Usage: node tools/amd-test.mjs [html build, default dist/index.html]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeAmd } from './amd.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const eq = (name, got, want) => {
  if (got === want) return
  failed++
  console.log(`  FAIL ${name}\n    got:  ${got}\n    want: ${want}`)
}

// ---- rules, at 10.8 AMD per baht ----
const amd = makeAmd(10.8)
const T = [
  ['single', 'Tickets 500 THB', 'Tickets 500 THB (≈5,400 AMD)'],
  ['range', 'Tickets 300-800 THB at parties', 'Tickets 300-800 THB (≈3,200-8,600 AMD) at parties'],
  ['en dash range', '1,000–1,500 THB', '1,000–1,500 THB (≈10,800–16,200 AMD)'],
  ['"to" range', 'ATMs charge 250 to 350 baht each', 'ATMs charge 250 to 350 baht (≈2,700 to 3,800 AMD) each'],
  ['slash list', 'Tickets 990 / 1,400 / 1,700 / 2,000 THB tiers', 'Tickets 990 / 1,400 / 1,700 / 2,000 THB (≈10,700 / 15,100 / 18,400 / 21,600 AMD) tiers'],
  ['tight slash list', 'say 400/200 THB, so', 'say 400/200 THB (≈4,300/2,200 AMD), so'],
  ['hyphen adjective', 'A 450-baht entry fee', 'A 450-baht (≈4,900 AMD) entry fee'],
  ['baht sign first', 'Tip ฿500 at most', 'Tip ฿500 (≈5,400 AMD) at most'],
  ['small amount', 'Toilet 20 THB', 'Toilet 20 THB (≈220 AMD)'],
  ['big amount', 'Tables from 25,000 THB', 'Tables from 25,000 THB (≈270,000 AMD)'],
  ['over 100k', '3-day GA 10,900 THB or £229', '3-day GA 10,900 THB (≈118,000 AMD) or £229'],
  ['over a million', 'The fine can be up to 100,000 THB', 'The fine can be up to 100,000 THB (≈1,080,000 AMD)'],
  ['million word', 'You need 1 million baht third-party insurance', 'You need 1 million baht (≈11 million AMD) third-party insurance'],
  ['capital Baht', 'about 500 Baht', 'about 500 Baht (≈5,400 AMD)'],
  ['two prices', 'Beer about 100-180 THB, cocktails 200-350 THB', 'Beer about 100-180 THB (≈1,100-1,900 AMD), cocktails 200-350 THB (≈2,200-3,800 AMD)'],
  ['after a time', '06:00 to 24:00, 150 baht per bag', '06:00 to 24:00, 150 baht (≈1,600 AMD) per bag'],
  ['ordinal before', '1st Release 2,500 THB', '1st Release 2,500 THB (≈27,000 AMD)'],
  ['rate with decimals', 'it paid 33.35 THB per USD 100 note', 'it paid 33.35 THB per USD 100 note'],
  ['decimal range', 'within about 0.1-0.2 THB of', 'within about 0.1-0.2 THB of'],
  ['no number', 'Always pay in THB. Tickets THB (Megatix)', 'Always pay in THB. Tickets THB (Megatix)'],
  ['url', 'finance.yahoo.com/quote/THB=X/', 'finance.yahoo.com/quote/THB=X/'],
  ['already done', 'Tickets 500 THB (≈5,400 AMD)', 'Tickets 500 THB (≈5,400 AMD)'],
  // inside brackets the dram amount follows a comma, so there are no brackets in brackets
  ['inside brackets', 'Smart Bus (100 baht) to the beaches', 'Smart Bus (100 baht, ≈1,100 AMD) to the beaches'],
  ['inside brackets, mid-sentence', '(06:00 to 24:00, 150 baht per bag)', '(06:00 to 24:00, 150 baht, ≈1,600 AMD per bag)'],
  ['after closed brackets', 'Fee (cash) 500 THB', 'Fee (cash) 500 THB (≈5,400 AMD)'],
  ['inside brackets, done', 'Smart Bus (100 baht, ≈1,100 AMD) to', 'Smart Bus (100 baht, ≈1,100 AMD) to'],
]
for (const [name, input, want] of T) eq(name, amd.text(input), want)

// HTML: only page text changes, never tags, attributes, scripts, styles, titles or select options
eq('html text and skips',
  amd.html('<p title="500 THB">Fee 500 THB</p><script>var a = "500 THB"</script><style>/* 500 THB */</style><option>500 THB</option><title>500 THB</title>'),
  '<p title="500 THB">Fee 500 THB <span class="amd">(≈5,400 AMD)</span></p><script>var a = "500 THB"</script><style>/* 500 THB */</style><option>500 THB</option><title>500 THB</title>')
eq('html entities', amd.html('<li>Ben &amp; Jerry&#39;s 120 THB</li>'), '<li>Ben &amp; Jerry&#39;s 120 THB <span class="amd">(≈1,300 AMD)</span></li>')
eq('html brackets across a link', amd.html('<p>(see <a href="#x">this</a> 500 THB)</p><p>200 THB</p>'),
  '<p>(see <a href="#x">this</a> 500 THB<span class="amd">, ≈5,400 AMD</span>)</p><p>200 THB <span class="amd">(≈2,200 AMD)</span></p>')
// a block marked data-noamd shows its own dram amount (the villa price box), so nothing inside it changes
eq('html data-noamd', amd.html('<div class="price" data-noamd><b>241,500 THB</b><div><span>3,020 THB</span></div></div><p>500 THB</p>'),
  '<div class="price" data-noamd><b>241,500 THB</b><div><span>3,020 THB</span></div></div><p>500 THB <span class="amd">(≈5,400 AMD)</span></p>')
eq('amount', amd.amount(241500), '≈2,610,000 AMD')
eq('html already done', amd.html('<p>500 THB <span class="amd">(≈5,400 AMD)</span></p>'), '<p>500 THB <span class="amd">(≈5,400 AMD)</span></p>')

// ---- the built page ----
const file = path.resolve(process.argv[2] || path.join(ROOT, 'dist/index.html'))
const h = fs.readFileSync(file, 'utf8')
// the page text (the artifact build has no <body> tag: then it starts at the top; styles and scripts are cut out below)
const body = h.slice(Math.max(0, h.indexOf('<body')), h.indexOf('<script type="application/json"'))
// the villa price boxes (data-noamd) write their own dram amounts: check those apart (the whole box, up to the
// end of its breakdown), then leave them out; "price-box paid" is what we paid for a booked villa (AED, then drams and baht)
const BOX = /<div class="price-box(?: paid)?" data-noamd>[\s\S]*?<\/dl><\/div>/g
const boxes = body.match(BOX) || []
const boxMissing = boxes.filter((x) => (x.match(/THB/g) || []).length !== (x.match(/AMD/g) || []).length)
if (!boxes.length || boxMissing.length) { failed++; console.log(`  FAIL villa price boxes: ${boxMissing.length} of ${boxes.length} without a dram amount for each baht amount`) }
const text = body.replace(BOX, ' ').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<option[\s\S]*?<\/option>/g, ' ').replace(/<[^>]+>/g, '')
const missed = []
// (a number right after a / is part of a web address, like pattayamail.com/news/2000-baht-helmet-fine)
for (const m of text.matchAll(/(?<![\d.,:/])\d[\d,]*(?:-|\s)(?:THB|baht|Baht)\b(?!\s\(≈|,\s≈)/g)) missed.push(text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 15).replace(/\s+/g, ' '))
const notes = (body.match(/class="amd"/g) || []).length
if (missed.length) { failed++; console.log(`  FAIL ${path.basename(file)}: ${missed.length} baht prices without a dram amount`); missed.slice(0, 10).forEach((s) => console.log('    | ' + s)) }
if (notes < 300) { failed++; console.log(`  FAIL ${path.basename(file)}: only ${notes} dram amounts`) }
const data = JSON.parse(h.match(/<script type="application\/json" id="guide-data">([\s\S]*?)<\/script>/)[1])
// popup lines with a price, and the villa popups' own price (price + priceAmd: a booked villa's price is in AED)
const pops = data.points.filter((p) => /\d (THB|baht)/.test(p.sub || '') || p.price)
const popMissed = pops.filter((p) => (p.price ? !/AMD/.test(p.price + ' ' + (p.priceAmd || '')) : !/AMD/.test(p.sub)))
if (!pops.length || popMissed.length) { failed++; console.log(`  FAIL map popups: ${popMissed.length} of ${pops.length} prices without a dram amount`) }
if (!(data.rates && data.rates.mid && data.rates.mid.AMD)) { failed++; console.log('  FAIL converter: no AMD rate') }

console.log(`${T.length + 6} rule checks; ${path.basename(file)}: ${notes} dram amounts, ${boxes.length} villa price boxes, ${pops.length} map popups with prices`)
console.log(failed ? `AMD TEST FAILED: ${failed}` : 'AMD TEST PASSED')
process.exitCode = failed ? 1 : 0
