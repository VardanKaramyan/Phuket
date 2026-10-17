// Armenian dram (AMD) amounts next to baht prices, for a reader who thinks in drams.
//   text('300-800 THB')  -> '300-800 THB (≈3,200-8,600 AMD)'
//   html('<p>300-800 THB</p>') -> '<p>300-800 THB <span class="amd">(≈3,200-8,600 AMD)</span></p>' (page text only)
//   inside brackets it follows a comma instead: 'Smart Bus (100 baht)' -> 'Smart Bus (100 baht, ≈1,100 AMD)'
// It takes whole numbers, ranges (300-800, 250 to 350), lists (990 / 1,400 THB), "450-baht" and "฿500".
// Decimal amounts are left alone: in this guide they are all exchange rates (33.35 THB per USD).
// An element with a data-noamd attribute shows its own dram amount (amount()), so html() leaves its inside alone.
const NUM = String.raw`\d{1,3}(?:,\d{3})+|\d+`
const AMT = String.raw`(?:${NUM})(?:\s?(?:-|–|/)\s?(?:${NUM})|\sto\s(?:${NUM}))*(?:\smillion)?`
const DONE = String.raw`(?!\s?\(≈|,\s?≈|\s?<span class="amd">)`
const AFTER = new RegExp(String.raw`(?<![\d.,:/])(${AMT})(\s?|-)(THB|[Bb]aht)\b${DONE}`, 'g')
const BEFORE = new RegExp(String.raw`฿\s?(${AMT})(?![\d.,])${DONE}`, 'g')
const SKIP = new Set(['script', 'style', 'option', 'title', 'textarea'])
// brackets opened before these tags still count after them (a link in the middle of a sentence); other tags end the text
const INLINE = new Set(['a', 'b', 'i', 'em', 'strong', 'small', 'span', 'abbr', 'code', 'mark', 'sub', 'sup', 'u', 's'])
const depthOf = (s) => (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length

export function makeAmd(amdPerThb) {
  // 2-3 significant figures: the rate moves more than that
  const round = (v) => {
    const step = v < 1000 ? 10 : v < 100000 ? 100 : v < 1e6 ? 1000 : 10000
    return (Math.round(v / step) * step).toLocaleString('en-US')
  }
  const sig2 = (v) => Number(v.toPrecision(2)).toLocaleString('en-US')
  // the same amount text with every number in drams
  const drams = (amount) => {
    const million = /\smillion$/.test(amount)
    const nums = amount.replace(/\smillion$/, '')
    const out = nums.replace(new RegExp(NUM, 'g'), (n) => {
      const v = Number(n.replace(/,/g, '')) * amdPerThb
      return million ? sig2(v) : round(v)
    })
    return '≈' + out + (million ? ' million' : '') + ' AMD'
  }
  // depth: brackets already open before this text; nested: the price sits inside brackets
  const add = (s, wrap, depth = 0) => {
    const inside = (str, at) => depth + depthOf(str.slice(0, at)) > 0
    return s
      .replace(AFTER, (m, amount, sep, cur, at, str) => amount + sep + cur + wrap(drams(amount), inside(str, at)))
      .replace(BEFORE, (m, amount, at, str) => m + wrap(drams(amount), inside(str, at)))
  }
  return {
    rate: amdPerThb,
    amount: (thb) => drams(Number(thb).toLocaleString('en-US')),
    text: (s) => add(String(s), (x, nested) => (nested ? ', ' + x : ' (' + x + ')')),
    // page text between tags; tags, attributes and the inside of SKIP elements stay as they are
    // (dram amounts already there are taken out first, so running it twice changes nothing)
    html: (s) => {
      let skip = null, open = 0, depth = 0 // skip: the element being left alone, open: how deep inside it
      const wrap = (x, nested) => (nested ? '<span class="amd">, ' + x + '</span>' : ' <span class="amd">(' + x + ')</span>')
      return String(s).replace(/ ?<span class="amd">[^<]*<\/span>/g, '').split(/(<[^>]*>)/).map((part, i) => {
        if (i % 2) {
          const m = part.match(/^<(\/?)([a-zA-Z][\w-]*)/)
          if (m) {
            const name = m[2].toLowerCase()
            if (!m[1] && !skip && (SKIP.has(name) || /\sdata-noamd[\s=>]/.test(part))) { skip = name; open = 1 }
            else if (!m[1] && name === skip) open++
            else if (m[1] && name === skip && --open === 0) skip = null
            if (!INLINE.has(name)) depth = 0
          }
          return part
        }
        if (skip) return part
        const out = add(part, wrap, depth)
        depth = Math.max(0, depth + depthOf(part))
        return out
      }).join('')
    },
  }
}
