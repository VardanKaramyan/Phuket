// Builds the guide from data/*.json into three outputs:
//   dist/                         static offline web app (index.html + img/ + sat/ + sw.js + manifest + icons + KML)
//   dist/phuket-guide-offline.html single self-contained file (images and satellite tiles inlined) to keep on the phone
//   artifact/index.html            claude.ai artifact version (no document skeleton, Leaflet from cdnjs, no service worker)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import * as turf from '@turf/turf'
import sharp from 'sharp'
import { TRIP, TRIP_DAYS, TRIP_LABEL, inTrip, phaseOf, phaseRange, phaseLabel, baseOf, leavingOn } from './trip.mjs'
import { makeAmd } from './amd.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const P = (...a) => path.join(ROOT, ...a)
const DATA_DIR = process.env.GUIDE_DATA || ''
const readJSON = (p, d = null) => {
  const alt = DATA_DIR && p.startsWith('data/') && !p.startsWith('data/geo/') ? path.join(DATA_DIR, p.slice(5)) : P(p)
  return fs.existsSync(alt) ? JSON.parse(fs.readFileSync(alt, 'utf8')) : d
}

// ---------- data ----------
const events = readJSON('data/events.json', { items: [] }).items || []
const places = readJSON('data/places.json', { items: [] }).items || []
// Places → Clubs & festivals, and the Bangkok basics (the 21 Oct 2026 research, tools/merge-bangkok.mjs)
const clubs = readJSON('data/clubs.json', { items: [] }).items || []
const bangkok = readJSON('data/bangkok.json', {}) || {}
// Places → 18+ and Weed: the law-free basics and the price guides (the 23 Oct 2026 research, tools/merge-adult.mjs);
// the venues and shops themselves are places with tier 'adult'
const adult = readJSON('data/adult.json', {}) || {}
const areasDoc = readJSON('data/areas.json', { items: [] })
const areas = areasDoc.items || []
const hotels = readJSON('data/hotels.json', { items: [] }).items || []
const money = readJSON('data/exchanges.json', {}) || {}
const info = readJSON('data/essentials.json', {}) || {}
const images = readJSON('data/images.json', {}) || {}
const areaGeo = readJSON('data/geo/areas.geojson')
const land = readJSON('data/geo/land.geojson')
const roads = readJSON('data/geo/roads.geojson')
const extra = readJSON('data/extra.json', {}) || {} // hand-written copy: intros, tips
// dram (AMD) amounts next to every baht price, and AMD first in the converter (data/extra.json → amdRate)
const amdRate = extra.amdRate && extra.amdRate.perThb > 0 ? extra.amdRate : null
const amd = amdRate ? makeAmd(amdRate.perThb) : { text: (s) => s, html: (s) => s, amount: () => '' }
// then USD and EUR (data/exchanges.json), then the hand-kept ones (data/extra.json → rates: AED, the villas were paid in it)
const midRates = () => (amdRate ? [{ currency: 'AMD', thbPerUnit: 1 / amdRate.perThb, date: amdRate.date }] : [])
  .concat((money.midMarket || []).filter((m) => m && m.thbPerUnit && m.currency !== 'AMD'))
  .concat((extra.rates || []).filter((m) => m && m.thbPerUnit > 0 && m.currency !== 'AMD' && !(money.midMarket || []).some((x) => x && x.currency === m.currency)))
const appsDoc = readJSON('data/apps.json', { items: [] }) || { items: [] } // apps and services to install
const apps = appsDoc.items || []

// the trip dates, phases and flight: tools/trip.mjs
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dowOf = (iso) => DOW[new Date(iso + 'T12:00:00Z').getUTCDay()]
const dayLabel = (iso) => `${dowOf(iso)} ${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const has = (v) => v != null && String(v).trim() !== ''
const gmaps = (q, pid) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + (pid ? '&query_place_id=' + encodeURIComponent(pid) : '')
const gdir = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${(+lat).toFixed(6)},${(+lng).toFixed(6)}`
const isUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u)
const textOf = (...parts) => esc(parts.flat().filter(Boolean).join(' ').toLowerCase())
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

const AREA_NAMES = Object.fromEntries(areas.map((a) => [a.id, a.name]))
const OFF_ISLAND = { 'koh-kaew': 'Koh Kaew', 'phang-nga': 'Phang Nga', 'khao-lak': 'Khao Lak', krabi: 'Krabi', 'phi-phi': 'Phi Phi', 'koh-yao': 'Koh Yao', 'koh-lanta': 'Koh Lanta', 'koh-lipe': 'Koh Lipe', trang: 'Trang islands', 'koh-phangan': 'Koh Phangan', 'koh-samui': 'Koh Samui', 'koh-tao': 'Koh Tao', 'surat-thani': 'Surat Thani', bangkok: 'Bangkok', ayutthaya: 'Ayutthaya', other: '' }
// Bangkok and its day trip: their own tab in Music and in Places
const BKK = ['bangkok', 'ayutthaya']
const areaName = (id) => (id === 'other' ? '' : AREA_NAMES[id] || OFF_ISLAND[id] || (id ? cap(String(id).replace(/-/g, ' ')) : ''))

const AREA_COLORS = {
  patong: '#D9435F', kamala: '#8C6FD1', surin: '#D45D79', 'bang-tao': '#3D7FD1', layan: '#9A7BD8', 'nai-thon': '#E39A4F',
  'nai-yang': '#E0719A', 'mai-khao': '#3FA37A', karon: '#F0963A', kata: '#2FB59A', 'kata-noi': '#7E6BD6', 'nai-harn': '#F2A541',
  rawai: '#E07BB0', promthep: '#58A7C9', chalong: '#3B9FD1', 'phuket-town': '#E8A33D', kathu: '#6FA83D', 'cape-panwa': '#9BBF45', 'ao-po': '#5C8FD6',
  thalang: '#9AA79A', natai: '#2E9C8F',
}

const ICON = {
  trip: '<path d="M3 8.5a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a1.5 1.5 0 0 0 0 3v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a1.5 1.5 0 0 0 0-3z"/><path d="M14 7v1.5M14 11v2M14 15.5V17"/>',
  events: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
  places: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  areas: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  stay: '<path d="M3 18.5v-11M3 14h18v4.5M21 14v-2.5A3.5 3.5 0 0 0 17.5 8H11v6"/><circle cx="7" cy="11" r="1.6"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.01"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 16.9l-5.2 2.75 1-5.8-4.2-4.1 5.8-.85z"/>',
  pin: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  camera: '<path d="M4 8.2h3.2l1.6-2.4h6.4l1.6 2.4H20V19H4z"/><circle cx="12" cy="13.3" r="3.3"/>',
  route: '<path d="M5 19.5c0-5.5 3.8-7 7-7h7.5M16 9l3.5 3.5L16 16"/>',
  ext: '<path d="M14 4h6v6M20 4l-8.5 8.5M18.5 14v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5H10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  hide: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.2 9.5 6a15 15 0 0 1-2.6 3.3M6.5 7.6C4.6 8.9 3.2 10.7 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ticket: '<path d="M3 8.5a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a1.5 1.5 0 0 0 0 3v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a1.5 1.5 0 0 0 0-3z"/>',
  swap: '<path d="M7 7.5h13l-3.5-3.5M17 16.5H4l3.5 3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  phone: '<path d="M5.5 3.5h3.5l1.8 4.6-2.3 1.4a11 11 0 0 0 6 6l1.4-2.3 4.6 1.8v3.5a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 5.7a2 2 0 0 1 2-2.2z"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  expand: '<path d="M14 4h6v6M20 4l-6.5 6.5M10 20H4v-6M4 20l6.5-6.5"/>',
  shrink: '<path d="M19.5 4.5L14 10M14 5.5V10h4.5M4.5 19.5L10 14M10 18.5V14H5.5"/>',
  like: '<path d="M7.5 10.5v9h-3v-9zM7.5 10.5l3.6-6.8c1.4 0 2.4 1.1 2.1 2.5l-.7 3.3h5.2a2 2 0 0 1 2 2.3l-1.1 6.3a2 2 0 0 1-2 1.7H7.5"/>',
  skip: '<path d="M7.5 13.5v-9h-3v9zM7.5 13.5l3.6 6.8c1.4 0 2.4-1.1 2.1-2.5l-.7-3.3h5.2a2 2 0 0 0 2-2.3l-1.1-6.3a2 2 0 0 0-2-1.7H7.5"/>',
  back: '<path d="M10 6l-6 6 6 6M4.5 12H20"/>',
  next: '<path d="M14 6l6 6-6 6M19.5 12H4"/>',
  up: '<path d="M12 19.5V5M6 11l6-6 6 6"/>',
  share: '<path d="M12 3.5v11.5M7.5 8L12 3.5 16.5 8M5 12.5v6a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
  wallet: '<path d="M17.5 7.5V5.8a1.3 1.3 0 0 0-1.6-1.3L5 7.5"/><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M20.5 11.5h-4a2 2 0 0 0 0 4h4"/><path d="M16.6 13.5h.01"/>',
  note: '<path d="M5.5 3.5h9l4 4v12a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4M8 12h8M8 15.5h5"/>',
  down: '<path d="M12 4.5V19M6 13l6 6 6-6"/>',
  // Spending: the expense categories, Mark paid, Close and the folded Paid by row
  food: '<path d="M6.5 3v6a2 2 0 0 0 4 0V3M8.5 3v18M17.5 21V3c-2 1.4-3 3.6-3 6.5V13h3"/>',
  drinks: '<path d="M5 4h14l-7 8.5zM12 12.5V20M8 20h8M7.4 7h9.2"/>',
  groceries: '<path d="M3 4h2.2l2.3 10.3a1.6 1.6 0 0 0 1.6 1.2h7.7a1.6 1.6 0 0 0 1.5-1.1L20.5 8H6.1"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  transport: '<path d="M5 17H3.8a.8.8 0 0 1-.8-.8v-3.4l1.9-5A2 2 0 0 1 6.8 6.5h10.4a2 2 0 0 1 1.9 1.3l1.9 5v3.4a.8.8 0 0 1-.8.8H19M3 12.8h18M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  shopping: '<path d="M5 8h14l-1 12.5H6zM9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  other: '<path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5zM9 8.5h6M9 12h6M9 15.5h3.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
}
const icon = (n, extraAttr = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extraAttr}>${ICON[n] || ''}</svg>`

// ---------- images ----------
function imgTag(key, alt, mode, placeholder = '') {
  const im = (extra.dropImages || []).includes(key) ? null : images[key]
  const standIn = (extra.imageNotes || {})[key]
  if (!im || !fs.existsSync(P(im.file))) return `<div class="media"><span class="ph" aria-hidden="true">${esc(placeholder)}</span>`
  const src = mode === 'inline' ? 'data:image/webp;base64,' + fs.readFileSync(P(im.file)).toString('base64') : 'img/' + path.basename(im.file)
  const credit = has(im.credit) ? `<span class="credit">${esc(String(im.credit).replace(/<[^>]+>/g, '').slice(0, 80))}${has(im.license) ? ' · ' + esc(im.license) : ''}</span>` : ''
  return `<div class="media"><img src="${src}" alt="${esc(alt)}" width="${im.w || 640}" height="${im.h || 360}" loading="lazy" decoding="async">${credit}${standIn ? `<span class="standin">${esc(standIn)}</span>` : ''}`
}

// a villa's photos to swipe through: the photo saved with the guide first (it shows offline), then the listing's own
// photos straight from Airbnb or Booking.com (data/hotels.json → gallery, from tools/stay-gallery.mjs). They carry
// data-src, and src/app.js loads each one when you get near it; without JavaScript, and in the artifact, only the first shows
function villaMedia(h, mode) {
  const html = imgTag('hotels:' + h.id, h.name, mode, 'H')
  const g = (h.gallery || []).filter((x) => x && isUrl(x.url))
  if (!g.length || !/<img /.test(html)) return html
  const sized = (u) => (/muscache\.com/.test(u) ? u.split('?')[0] + '?im_w=720' : u)
  const n = g.length + 1
  const slides = g.map((x, i) => `<img data-src="${esc(sized(x.url))}" alt="${esc(x.alt || h.name + ', photo ' + (i + 2))}" width="720" height="480" decoding="async">`).join('')
  return html.replace(/<img [^>]*>/, (first) => `<div class="slides" data-gallery tabindex="0" role="region" aria-label="${esc(`Photos of ${h.name}: ${n}, swipe for more`)}">${first}${slides}</div>` +
    `<span class="gal-count js-only" aria-hidden="true">1 / ${n}</span>` +
    `<button class="gal-btn prev js-only" type="button" aria-label="Previous photo">${icon('back')}</button>` +
    `<button class="gal-btn next js-only" type="button" aria-label="Next photo">${icon('next')}</button>`)
}

// ---------- shared bits ----------
// item.dirLat/dirLng/dirLabel send Directions somewhere other than the pin (e.g. the pier for an island);
// noDirections hides it (tours from different piers); a low-confidence pin gets neither Directions nor a map dot
const lowConf = (it) => it.coordConfidence === 'low'
const dirOf = (it) => (it.noDirections || lowConf(it) ? null : Number.isFinite(it.dirLat) ? { lat: it.dirLat, lng: it.dirLng, label: it.dirLabel || 'Directions' } : Number.isFinite(it.lat) ? { lat: it.lat, lng: it.lng, label: 'Directions' } : null)
// Like / Skip for the group: src/app.js loads the votes from /api/votes (website only) and shows the bar once they load
const voteBar = (key, name) => `<div class="votes js-only" data-vote-item="${esc(key)}" data-vote-name="${esc(name)}" hidden><div class="vote-btns"><button class="btn vote" type="button" data-vote-btn="like" aria-pressed="false">${icon('like')}Like <b>0</b></button><button class="btn vote" type="button" data-vote-btn="skip" aria-pressed="false">${icon('skip')}Skip <b>0</b></button></div><p class="voters"></p></div>`
function actionRow({ item, q, mapKey, fav, extraBtns = '' }) {
  const parts = []
  const query = q || item.gmapsQuery
  if (has(query)) parts.push(`<a class="btn primary" href="${gmaps(query, item.placeId)}" target="_blank" rel="noopener">${icon('pin')}Google Maps</a>`)
  const d = dirOf(item)
  if (d) parts.push(`<a class="btn" href="${gdir(d.lat, d.lng)}" target="_blank" rel="noopener" data-dir="${+d.lat},${+d.lng}" data-dir-name="${esc(item.name || '')}">${icon('route')}${esc(d.label)}</a>`)
  ;(item.extraMaps || []).forEach((x) => parts.push(`<a class="btn" href="${gmaps(x.q, x.placeId)}" target="_blank" rel="noopener">${icon('pin')}${esc(x.label)}</a>`))
  if (mapKey && !lowConf(item)) parts.push(`<button class="btn js-only" type="button" data-on-map="${esc(mapKey)}">${icon('areas')}On map</button>`)
  parts.push(extraBtns)
  if (fav) parts.push(`<button class="btn square js-only" type="button" data-share-card aria-label="${esc('Share ' + (item.name || ''))}">${icon('share')}</button>`)
  if (fav) parts.push(`<button class="btn square fav js-only" type="button" data-fav="${esc(fav)}" aria-pressed="false" aria-label="${esc('Save ' + (item.name || ''))}">${icon('star')}</button>`)
  return `<div class="actions">${parts.join('')}</div>`
}
function linksHtml(links = []) {
  const ok = (links || []).filter((l) => l && isUrl(l.url))
  if (!ok.length) return ''
  return `<div class="links">${ok.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || 'Link')} ↗</a>`).join('')}</div>`
}
// the collapsed part of a card: extra fact rows, tips and links
function moreBlock(title, tips = [], links = [], rows = []) {
  const t = (tips || []).filter(has)
  const l = linksHtml(links)
  const f = facts(rows)
  if (!t.length && !l && !f) return ''
  return `<details class="more"><summary>${esc(title)}</summary>${f}${t.length ? `<ul>${t.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${l}</details>`
}
function facts(rows) {
  const r = rows.filter(([, v]) => has(v))
  if (!r.length) return ''
  return `<dl class="facts">${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
}

// ---------- events ----------
const STATUS = { confirmed: ['Confirmed', 'good'], 'tickets-on-sale': ['Tickets on sale', 'good'], listed: ['Listed', 'soft'], tba: ['Details TBA', 'warn'], unconfirmed: ['Unconfirmed', 'warn'], recurring: ['Regular night', 'soft'] }
const whereOf = (e) => {
  const isl = String(e.island || '').toLowerCase()
  if (isl.includes('bangkok') || BKK.includes(e.area)) return 'bangkok'
  if (isl.includes('phangan') || e.area === 'koh-phangan') return 'koh-phangan'
  if (isl.includes('phuket') || isl.includes('phang nga') || AREA_NAMES[e.area] || e.area === 'natai') return 'phuket'
  return 'other'
}
const eventSort = (a, b) => {
  const da = (a.dates || []).filter(inTrip)[0] || (a.dates || [])[0] || '9999', db = (b.dates || []).filter(inTrip)[0] || (b.dates || [])[0] || '9999'
  const wa = a.window === 'in' ? 0 : a.window === 'before' ? 1 : 2, wb = b.window === 'in' ? 0 : b.window === 'before' ? 1 : 2
  return wa - wb || da.localeCompare(db) || (b.undergroundScore || 0) - (a.undergroundScore || 0)
}
const datedEvents = events.filter((e) => e.kind === 'dated').sort(eventSort)
const regularEvents = events.filter((e) => e.kind !== 'dated').sort((a, b) => (b.undergroundScore || 0) - (a.undergroundScore || 0) || whereOf(a).localeCompare(whereOf(b)))
// list order: the most underground first (5 → 1), then the top picks, then by the first night in the trip; the nights
// outside your dates last
const firstInTrip = (e) => (e.dates || []).filter(inTrip).sort()[0] || '9999'
const eventsSorted = events.slice().sort((a, b) => (a.window !== 'in') - (b.window !== 'in') || (b.undergroundScore || 0) - (a.undergroundScore || 0) || !!b.pick - !!a.pick || firstInTrip(a).localeCompare(firstInTrip(b)) || eventSort(a, b))

function eventCard(e, mode) {
  const dates = (e.dates || []).filter(Boolean).sort()
  const first = dates.find(inTrip) || dates[0]
  const recurring = e.kind !== 'dated'
  const rt = recurring ? recurrenceTile(e) : null
  const tile = recurring
    ? `<div class="datetile every"><span class="dow">${rt.word}</span><span class="day">${esc(rt.label)}</span><span class="mon">${e.window === 'in' ? 'In dates' : '&nbsp;'}</span></div>`
    : first ? `<div class="datetile"><span class="dow">${dowOf(first).toUpperCase()}</span><span class="day">${first.slice(8, 10)}</span><span class="mon">${MON[Number(first.slice(5, 7)) - 1].toUpperCase()}</span></div>`
      : `<div class="datetile"><span class="dow">Date</span><span class="day">?</span><span class="mon">TBA</span></div>`
  const dateChips = dates.length > 1 || (recurring && dates.length) ? `<div class="dates">${dates.map((d) => `<span class="${inTrip(d) ? 'in' : ''}">${dowOf(d)} ${Number(d.slice(8, 10))}</span>`).join('')}</div>` : ''
  const st = STATUS[e.status] || null
  const score = Math.max(1, Math.min(5, e.undergroundScore || 1))
  const f = [e.window === 'in' ? 'in' : 'out', e.pick ? 'pick' : '', recurring ? 'recurring' : 'dated'].filter(Boolean).join(' ')
  const where = whereOf(e)
  // a club or a nightly party with no listed dates: any day you are there; the plan has the Gulf islands only with the
  // group (10-13 Jan) or the two of you (19-23 Jan), never on the solo days
  const phases = dates.length ? Array.from(new Set(dates.filter(inTrip).map(phaseOf))).join(' ') : (['koh-phangan', 'koh-samui', 'koh-tao'].includes(e.area) ? 'group duo' : 'group duo solo')
  const sub = [e.venue, areaName(e.area) || e.island].filter(has)
  const lineup = (e.lineup || []).filter(has)
  const tags = (e.genres || []).filter(has)
  const windowNote = e.window === 'before' ? 'Before your dates' : e.window === 'after' ? 'After your dates' : ''
  return `<article class="card flyer" id="ev-${esc(e.id)}" data-fav-card="ev:${esc(e.id)}" data-name="${esc(e.name)}" data-kind="Music" data-f="${f}" data-where="${where}" data-phase="${phases}" data-text="${textOf(e.name, e.venue, e.island, e.genres, e.lineup, areaName(e.area))}">
${imgTag('events:' + e.id, e.name + (e.venue ? ' at ' + e.venue : ''), mode, '♪')}<div class="tag-top">${e.pick ? '<span class="pill hot">Top pick</span>' : ''}${st ? `<span class="pill">${st[0]}</span>` : ''}${windowNote ? `<span class="pill">${windowNote}</span>` : ''}</div></div>
<div class="body">
<div class="flyer-head">${tile}<div><h2 class="card-title">${esc(e.name)}</h2><p class="subtitle">${esc(sub.join(' · '))}</p></div></div>
${dateChips}
<div class="meter-row"><span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= score ? 'on' : ''}"></i>`).join('')}</span>Underground ${score}/5</div>
<p class="desc">${esc(e.description)}</p>
${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
${facts([['When', recurring ? e.recurrence || e.timeText : e.timeText], ['Where', lowConf(e) ? 'Exact place not public yet. Check the organiser before you go.' : ''], ['Tickets', e.priceText], ['By car', lowConf(e) ? '' : driveText('ev:' + e.id)]])}
${moreBlock('Line-up, tips & links', e.tips, e.links, [['Lineup', lineup.length ? lineup.join(', ') : ''], ['Type', e.type]])}
${voteBar('ev:' + e.id, e.name)}
${actionRow({ item: e, mapKey: 'event:' + e.id, fav: 'ev:' + e.id })}
</div></article>`
}
const DAY_RX = { Mon: 'mon(day)?', Tue: 'tue(s|sday)?', Wed: 'wed(nesday)?', Thu: 'thu(r|rs|rsday)?', Fri: 'fri(day)?', Sat: 'sat(urday)?', Sun: 'sun(day)?' }
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// the big tile on weekly cards: weekdays from the dates inside the trip, else whole day words from the text
// ("sunset" is not Sunday, "closed Wednesdays" is not a party night); "Often" when the text says it is not every week
function recurrenceTile(e) {
  if (e.tile) return e.tile
  const r = String(e.recurrence || '')
  let days = Array.from(new Set((e.dates || []).filter(inTrip).map(dowOf))).sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b))
  if (!days.length) {
    const cleaned = r.replace(/closed\s+(on\s+)?\w+/gi, ' ').replace(/sun(set|rise)/gi, ' ')
    days = WEEK.filter((d) => new RegExp('\\b' + DAY_RX[d] + 's?\\b', 'i').test(cleaned))
  }
  const nightly = /nightly|daily|every night|every day|open daily/i.test(r)
  const loose = /most|often|usually|irregular|about every|every second|varies|changes|some /i.test(r)
  const word = e.status === 'unconfirmed' ? 'Maybe' : nightly ? 'Every' : loose ? 'Often' : e.kind === 'venue' ? 'Open' : 'Every'
  const label = nightly ? 'Night' : days.length && days.length <= 3 ? days.join(' ') : e.kind === 'venue' ? 'Club' : 'Week'
  return { word, label }
}

// ---------- places ----------
const DUR = { '1-2h': ['1–2 h', 'short'], '2-3h': ['2–3 h', 'short'], 'half-day': ['Half day', 'half'], 'full-day': ['Full day', 'full'], 'multi-day': ['2+ days', 'full'], evening: ['Evening', 'evening'] }
const TIER = { 'must-see': ['Must-see', 'must'], 'hidden-gem': ['Hidden gem', 'gem'], 'day-trip': ['Day trip', 'trip'], tour: ['Boat tour', 'trip'], pier: ['Pier', 'soft'] }
const tierOrder = { 'must-see': 0, 'hidden-gem': 1, 'day-trip': 2, tour: 3, pier: 4 }
// the boats that leave a pier, one line each
const routesHtml = (routes = []) => {
  const r = (routes || []).filter((x) => x && has(x.to))
  if (!r.length) return ''
  return `<ul class="routes">${r.map((x) => `<li><b>${esc(x.to)}</b><span>${esc([x.operator, x.boat].filter(has).join(' · '))}</span>${has(x.times) ? `<span>${icon('clock')}${esc(x.times)}</span>` : ''}${has(x.duration) || has(x.priceText) ? `<span>${esc([x.duration, x.priceText].filter(has).join(' · '))}</span>` : ''}${has(x.season) ? `<span class="season">${esc(x.season)}</span>` : ''}${isUrl(x.bookingUrl) ? `<a href="${esc(x.bookingUrl)}" target="_blank" rel="noopener">Book or timetable</a>` : ''}</li>`).join('')}</ul>`
}
// tours name their piers in free text (departsFrom): link the ones that have a pier card, both ways
const pierShort = (p) => String(p.name || '').replace(/\s*\(.*$/, '').trim()
const piers = places.filter((p) => p.tier === 'pier' && pierShort(p).length > 4)
const piersOf = (t) => piers.filter((p) => String(t.departsFrom || '').toLowerCase().includes(pierShort(p).toLowerCase()))
const toursFrom = (p) => places.filter((t) => t.tier === 'tour' && piersOf(t).includes(p))
const cardLinks = (label, items, name = (x) => x.name) => (items.length ? `<p class="card-links">${esc(label)} ${items.map((x) => `<a href="#pl-${esc(x.id)}">${esc(name(x))}</a>`).join(', ')}</p>` : '')
// a pier card: where its boats go, then the boats folded away (a big pier has 7 or more), fees, tours from there
// each place once: 'Ao Nang (Nopparat Thara Pier) and Railay East' and 'Railay and Ao Nang' give Ao Nang, Railay East
const routeDests = (r) => {
  const out = [], seen = new Set()
  for (const x of r) for (const part of String(x.to || '').replace(/\s*\([^)]*\)/g, '').split(/,| via |:/)[0].split(/ and /)) {
    const name = part.trim(), key = name.toLowerCase().replace(/^koh? /, '').replace(/ (east|west|town|pier)$/, '')
    // a fragment like 'islands', or a line about boats arriving here, is not a place the boats go to
    if (!/^[A-Z]/.test(name) || /^(Arriving|From) /.test(name)) continue
    if (!seen.has(key)) { seen.add(key); out.push(name) }
  }
  return out
}
function pierBody(p) {
  const r = (p.routes || []).filter((x) => x && has(x.to))
  const boats = r.length > 2 ? `<details class="more"><summary>Boats: times and prices (${r.length})</summary>${routesHtml(r)}</details>` : r.length ? `<h3 class="mini-title">Boats from here</h3>${routesHtml(r)}` : ''
  return facts([['Boats to', routeDests(r).join(', ')], ['Fees', p.feeText], ['Best time', p.bestTime], ['By car', driveText('pl:' + p.id, p)]]) + boats + cardLinks('Boat tours from here:', toursFrom(p))
}
const placeIndex = new Map(places.map((p, i) => [p.id, i]))
// Places → 18+ and Weed: adult nightlife and the cannabis shops (category 'cannabis'), on Phuket, the Gulf islands and in
// Bangkok. They show only under their own tabs (data-only), where a Where row replaces the length row
const ADULT_KIND = { 'bar-street': 'Bar street', 'go-go': 'Go-go bar', cabaret: 'Cabaret show', show: 'Adult show', 'gentlemens-club': 'Gentlemen’s club', massage: 'Massage', lgbtq: 'LGBTQ+', kratom: 'Kratom bar', 'party-drugs-warning': 'Warning', activity: '18+ activity', other: '18+', cannabis: 'Weed shop' }
const adultWhere = (p) => (BKK.includes(p.area) ? 'bangkok' : ['koh-phangan', 'koh-samui', 'koh-tao'].includes(p.area) ? 'islands' : 'phuket')
const WHERE_NAME = { phuket: 'Phuket', islands: 'Koh Phangan & Samui', bangkok: 'Bangkok' }
// the Google rating weighted by its count: 4.9 from 12 reviews ranks below 4.7 from 900
const bayes = (p) => ((p.rating || 0) * (p.reviews || 0) + 4.3 * 50) / ((p.reviews || 0) + 50)
const adultItems = places.filter((p) => p.tier === 'adult')
const adultRank = (p) => Object.keys(WHERE_NAME).indexOf(adultWhere(p)) * 2 + (p.category === 'cannabis' ? 1 : 0)
// the areas in the researchers' order (Patong, near the first villa, first; then Kata and Karon, the Rawai side, …)
const adultArea = new Map()
adultItems.forEach((p) => { if (!adultArea.has(p.area)) adultArea.set(p.area, adultArea.size) })
// the weed shops, best first in each place (the user, 23 Oct 2026: "sorted weed places from best to worst"): quality plus
// value for the price (each out of 5, from what buyers say), half a point for a researcher's top pick, then the rating
const weedScore = (p) => (p.qualityScore || 0) + (p.valueScore || 0) + (p.pick ? 0.5 : 0)
const WEED_PLACES = { phuket: 'on Phuket', 'koh-phangan': 'on Koh Phangan', 'koh-samui': 'on Koh Samui', 'koh-tao': 'on Koh Tao', bangkok: 'in Bangkok' }
const weedPlace = (p) => (BKK.includes(p.area) ? 'bangkok' : WEED_PLACES[p.area] ? p.area : 'phuket')
const weedOrder = (p) => Object.keys(WEED_PLACES).indexOf(weedPlace(p))
// by place, the nightlife before the shops; the nightlife by area and kind, the shops best first
const adultSorted = adultItems.slice().sort((a, b) => adultRank(a) - adultRank(b) || (a.category === 'cannabis'
  ? weedOrder(a) - weedOrder(b) || weedScore(b) - weedScore(a) || bayes(b) - bayes(a)
  : adultArea.get(a.area) - adultArea.get(b.area) || Object.keys(ADULT_KIND).indexOf(a.category) - Object.keys(ADULT_KIND).indexOf(b.category) || bayes(b) - bayes(a)))
// "No. 3 of 25 on Phuket" on each shop
const weedRank = new Map()
for (const k of Object.keys(WEED_PLACES)) {
  const shops = adultSorted.filter((p) => p.category === 'cannabis' && weedPlace(p) === k)
  shops.forEach((p, i) => weedRank.set(p.id, `No. ${i + 1} of ${shops.length} ${WEED_PLACES[k]}`))
}
const daysText = (p) => ((p.days || []).length === 6 ? 'Closed ' + WEEK.find((d) => !p.days.includes(d)) : (p.days || []).length && p.days.length < 7 ? 'Only ' + p.days.join(', ') : '')
function adultCard(p, mode) {
  const weed = p.category === 'cannabis'
  const kind = ADULT_KIND[p.category] || '18+'
  const stars = p.rating ? `<span>${icon('star')}<b>${esc(trimNum(p.rating))}</b> ${p.reviews ? `${esc(p.reviews.toLocaleString('en-US'))} Google reviews` : 'on Google'}</span>` : ''
  const scores = weed ? [p.qualityScore ? `Quality ${p.qualityScore}/5` : '', p.valueScore ? `Value ${p.valueScore}/5` : ''].filter(has).join(' · ') : ''
  const open = [p.openText, daysText(p)].filter(has).join(' · ')
  return `<article class="card" id="pl-${esc(p.id)}" data-fav-card="pl:${esc(p.id)}" data-name="${esc(p.name)}" data-kind="${weed ? 'Weed shop' : '18+'}" data-tier="${weed ? 'adult weed' : 'adult'}" data-only="tier" data-where="${adultWhere(p)}" data-dur="evening" data-text="${textOf(p.name, kind, areaName(p.area), p.island)}">
${imgTag('places:' + p.id, p.name, mode, weed ? '✿' : '18+')}<div class="tag-top"><span class="pill adult">${esc(kind)}</span>${p.pick ? '<span class="pill must">Top pick</span>' : ''}</div></div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(p.name)}</h2><p class="subtitle">${esc([areaName(p.area) || p.island, kind].filter(has).join(' · '))}</p></div></div>
${stars || scores ? `<p class="rating">${weed && weedRank.has(p.id) ? `<span class="rank">${esc(weedRank.get(p.id))}</span>` : ''}${stars}${scores ? `<span>${esc(scores)}</span>` : ''}</p>` : ''}
<p class="desc">${esc(p.description)}</p>
${facts(weed ? [['Price', p.feeText], ['Quality', p.quality], ['Buyers say', p.usersSay], ['Open', open], ['By car', driveText('pl:' + p.id, p)]] : [['Price', p.feeText], ['Open', open], ['By car', driveText('pl:' + p.id, p)]])}
${moreBlock('Tips & links', p.tips, p.links, weed ? [['Lounge', p.lounge]] : [])}
${voteBar('pl:' + p.id, p.name)}
${actionRow({ item: p, mapKey: 'place:' + p.id, fav: 'pl:' + p.id })}
</div></article>`
}
// piers come last, after food: in All they are a reference list, not places to visit
const placesSorted = places.slice().sort((a, b) => BKK.includes(a.area) - BKK.includes(b.area) || (a.tier === 'pier') - (b.tier === 'pier') || (a.category === 'food') - (b.category === 'food') || (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3) || placeIndex.get(a.id) - placeIndex.get(b.id))
const trimNum = (x) => String(Math.round(x * 10) / 10)
// one duration per card: the researched on-site hours when they exist, minutes for short stops
function durText(p) {
  const [label] = DUR[p.durationLabel] || [p.durationLabel || '']
  const h = p.durationHours || {}
  if (!['1-2h', '2-3h'].includes(p.durationLabel) || h.min == null) return label
  const lo = h.min, hi = h.max != null ? h.max : h.min
  if (hi < 1) return lo === hi ? `${Math.round(lo * 60)} min` : `${Math.round(lo * 60)}–${Math.round(hi * 60)} min`
  if (lo < 1) return `${Math.round(lo * 60)} min–${trimNum(hi)} h`
  return lo === hi ? `${trimNum(lo)} h` : `${trimNum(lo)}–${trimNum(hi)} h`
}
function placeCard(p, mode) {
  let [, durKey] = DUR[p.durationLabel] || [p.durationLabel || '', 'short']
  const hmax = p.durationHours && p.durationHours.max
  if (durKey === 'short' && hmax > 3) durKey = 'half'
  // a pier is not a visit of some length: it shows only under Any length
  if (p.tier === 'pier') durKey = ''
  const durLabel = durText(p)
  const [tierLabel, tierCls] = TIER[p.tier] || ['Place', 'soft']
  // Bangkok's places sit under their own tab only
  const tierKeys = BKK.includes(p.area) ? 'bangkok' : [p.tier, p.category === 'food' ? 'food' : ''].filter(Boolean).join(' ')
  const days = daysText(p)
  const sub = [areaName(p.area), cap(p.category)].filter(has).join(' · ')
  return `<article class="card" id="pl-${esc(p.id)}" data-fav-card="pl:${esc(p.id)}" data-name="${esc(p.name)}" data-kind="Place" data-tier="${esc(tierKeys)}" data-dur="${durKey}" data-text="${textOf(p.name, p.nameThai, p.category, areaName(p.area), p.goodFor, p.tier)}">
${imgTag('places:' + p.id, p.name, mode, '◆')}<div class="tag-top"><span class="pill ${p.category === 'food' ? 'food' : tierCls}">${p.category === 'food' ? 'Food' : tierLabel}</span></div>${p.tier === 'pier' ? '' : `<div class="tag-bottom"><span class="pill">${icon('clock')}${esc(durLabel)}</span></div>`}</div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(p.name)}</h2><p class="subtitle">${esc(sub)}${has(p.nameThai) ? ` · <span lang="th">${esc(p.nameThai)}</span>` : ''}</p></div></div>
<p class="desc">${esc(p.description)}</p>
${p.tier === 'pier' ? pierBody(p)
    : p.tier === 'tour' ? facts([['Time', durLabel], ['Price', p.priceText || p.feeText], ['Private boat', p.privateCharter], ['Includes', p.includes], ['Leaves from', p.departsFrom], ['Best time', p.bestTime]]) + cardLinks(piersOf(p).length > 1 ? 'The piers:' : 'The pier:', piersOf(p), pierShort)
    : facts([['Time', durLabel + (['1-2h', '2-3h'].includes(p.durationLabel) ? ' on site' : '')], ['Best time', p.bestTime], ['Cost', p.feeText], ['By car', driveText('pl:' + p.id, p)]])}
${moreBlock(p.tier === 'tour' ? 'Operators, getting there & tips' : 'Opening, getting there & tips', p.tips, [...(p.tier === 'tour' ? p.operators || [] : []), ...(p.links || [])], [['Open', [p.openText, days].filter(has).join(' · ')], ['Getting there', p.gettingThere], ['Facilities', p.facilities]])}
${voteBar('pl:' + p.id, p.name)}
${actionRow({ item: p, mapKey: 'place:' + p.id, fav: 'pl:' + p.id })}
</div></article>`
}

// ---------- areas ----------
const areaOrder = Object.keys(AREA_COLORS)
const areasSorted = areas.slice().sort((a, b) => areaOrder.indexOf(a.id) - areaOrder.indexOf(b.id))
const BEST_TAGS = ['nightlife', 'techno', 'beach-clubs', 'beach', 'quiet', 'couples', 'families', 'food', 'culture', 'budget', 'luxury', 'local-life']
function areaCard(a, mode) {
  const s = a.scores || {}
  const price = '฿'.repeat(Math.max(1, Math.min(4, a.priceLevel || 2)))
  const bars = [['Nightlife', s.nightlife], ['Beach', s.beach], ['Food', s.food], ['Quiet', s.quiet], ['Family', s.family], ['Value', s.value]]
    .map(([k, v]) => `<div class="score"><span>${k}</span><span class="bar" role="img" aria-label="${k} ${v ?? 0} of 5"><i style="--v:${v ?? 0}"></i></span></div>`).join('')
  const best = (a.bestFor || []).filter(has)
  return `<article class="card" id="ar-${esc(a.id)}" data-name="${esc(a.name)}" data-kind="Area" data-best="${esc(best.join(' '))}" style="--c:${AREA_COLORS[a.id] || '#999'}" data-text="${textOf(a.name, a.tagline, best)}">
${imgTag('areas:' + a.id, a.name, mode, (a.name || '').slice(0, 3).toUpperCase())}</div>
<div class="body">
<div class="area-head"><span class="swatch" aria-hidden="true"></span><h2 class="card-title">${esc(a.name)}</h2></div>
<p class="subtitle">${esc(a.tagline)}</p>
${best.length ? `<div class="tags">${best.map((t) => `<span class="tag">${esc(t.replace(/-/g, ' '))}</span>`).join('')}</div>` : ''}
<p class="desc">${esc(a.description)}</p>
${has(a.stayIf) ? `<p class="stayif">${esc(a.stayIf)}</p>` : ''}
${facts([['Prices', price], ['Airport', a.airportDriveMin ? `≈ ${a.airportDriveMin} min drive` : ''], ['By car', driveText('ar:' + a.id)]])}
<details class="more"><summary>Scores, sea & highlights</summary><div class="scores">${bars}</div>${facts([['To Patong', a.id === 'patong' ? '' : a.patongDriveMin ? `≈ ${a.patongDriveMin} min drive` : ''], ['Sea in Jan', a.beach], ['Not ideal for', (a.notIdealFor || []).join(', ').replace(/-/g, ' ')]])}${(a.highlights || []).filter(has).length ? `<ul>${a.highlights.filter(has).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${linksHtml(a.links)}</details>
<div class="actions"><button class="btn primary js-only" type="button" data-area-map="${esc(a.id)}">${icon('areas')}Show on map</button><a class="btn" href="${gmaps(a.gmapsQuery || a.name + ', Phuket')}" target="_blank" rel="noopener">${icon('pin')}Google Maps</a></div>
</div></article>`
}

// ---------- hotels ----------
const HTIER = { luxury: 'Luxury', boutique: 'Boutique', 'mid-range': 'Mid-range', budget: 'Budget', hostel: 'Hostel' }
const zoneOf = (h) => {
  if (h.lastNights || ['nai-yang', 'mai-khao'].includes(h.area)) return 'airport'
  if (h.area === 'natai' || h.area === 'phang-nga') return 'natai'
  if (['kamala', 'surin', 'bang-tao', 'layan', 'nai-thon', 'nai-yang', 'mai-khao'].includes(h.area)) return 'west'
  if (h.area === 'patong') return 'patong'
  if (['karon', 'kata', 'kata-noi', 'nai-harn', 'promthep', 'rawai', 'chalong'].includes(h.area)) return 'south'
  if (h.area === 'phuket-town') return 'town'
  if (h.area === 'koh-phangan') return 'phangan'
  return 'other'
}
const ZONES = [['west', 'Kamala & beach-club coast'], ['natai', 'Natai'], ['patong', 'Patong'], ['south', 'Kata · Rawai'], ['town', 'Old Town'], ['phangan', 'Koh Phangan'], ['airport', 'Near the airport']]
const hotelOrder = { luxury: 0, boutique: 1, 'mid-range': 2, budget: 3, hostel: 4 }
const STAY_GUESTS = 8
// the trip total, read from the start of priceText ("241,500 THB for 10 nights (8-18 Jan, 8 guests), ..."), so the big
// number on the card and the price notes can never disagree; a villa with no rooms on the dates has none
// ---------- our villas: the two the group booked (TRIP.bases), and driving times from them ----------
// data/drive-times.json comes from tools/drive-times.mjs (OSRM on OpenStreetMap roads, no traffic)
const DRIVE = (readJSON('data/drive-times.json', { items: {} }) || { items: {} }).items || {}
const BASES = TRIP.bases.map((b) => {
  const h = hotels.find((x) => x.id === b.id)
  if (!h) throw new Error(`tools/trip.mjs: the booked villa ${b.id} is not in data/hotels.json`)
  const nights = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86400000)
  return { ...b, h, nights, paid: b.paid ? paidOf(b.paid.total, b.paid.currency, nights, b.guests || STAY_GUESTS, b.id) : null }
})
const baseOfVilla = (id) => BASES.find((b) => b.id === id)
// what we paid for both villas together (when every booked villa has its price, in one currency)
const PAID_ALL = BASES.length > 1 && BASES.every((b) => b.paid && b.paid.currency === BASES[0].paid.currency && b.paid.guests === BASES[0].paid.guests)
  ? paidOf(BASES.reduce((s, b) => s + Math.round(b.paid.total * 100), 0) / 100, BASES[0].paid.currency, BASES.reduce((s, b) => s + b.nights, 0), BASES[0].paid.guests, 'both villas') : null
const baseRange = (b) => `${Number(b.from.slice(8))}–${Number(b.to.slice(8))} Jan`
const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`)
// "3 min from the Patong villa · 22 min from the Rawai villa": only for places you drive to (not islands or boat tours)
function driveText(key, it) {
  const d = DRIVE[key]
  if (!d || (it && (it.category === 'island' || ['tour', 'day-trip'].includes(it.tier)))) return ''
  const parts = BASES.filter((b) => d[b.key]).map((b) => `${mins(d[b.key].min)} from the ${b.short}`)
  return parts.length ? parts.join(' · ') + ' (no traffic)' : ''
}
function priceOf(h) {
  if (h.noRoomsOnTrip) return null
  const m = String(h.priceText || '').match(/^([\d,]+) THB for (\d+) nights/)
  if (!m) throw new Error(`data/hotels.json: ${h.id}: priceText must start with "<total> THB for <nights> nights", not "${String(h.priceText).slice(0, 60)}"`)
  const total = Number(m[1].replace(/,/g, '')), nights = Number(m[2])
  const r10 = (n) => Math.round(n / 10) * 10
  // per person per day (a night's share), per person for the whole stay, and the villa per day
  return { total, nights, perPerson: r10(total / nights / STAY_GUESTS), perPersonStay: r10(total / STAY_GUESTS), perNight: r10(total / nights) }
}
const thb = (n) => n.toLocaleString('en-US') + ' THB'
// ---------- the price we paid for a booked villa (TRIP.bases → paid) ----------
// the exact amount in the currency it was paid in (two decimals: 22,282.88 AED), shared out per person and per day; the
// drams next to it are estimates at the mid-market rate (data/extra.json → rates), and the dollars come from the
// currency's fixed rate to the dollar when it has one (`perUsd`: AED is pegged at 3.6725)
function paidOf(total, currency, nights, guests, what) {
  const rates = midRates(), rate = rates.find((m) => m.currency === currency), usd = rates.find((m) => m.currency === 'USD')
  if (!(total > 0) || !(nights > 0) || !(guests > 0)) throw new Error(`tools/trip.mjs: ${what}: paid needs a total above 0, nights and guests`)
  if (!rate) throw new Error(`tools/trip.mjs: ${what} was paid in ${currency}, but there is no ${currency} rate: add it to data/extra.json → rates`)
  // in cents (fils), so the shares round once
  const c = Math.round(total * 100), share = (n) => Math.round(c / n) / 100
  // units of the paid currency per dollar: the peg, or else across the baht rates (0: no dollar rate)
  const pegged = rate.perUsd > 0, perUsd = currency === 'USD' ? 1 : pegged ? rate.perUsd : usd ? usd.thbPerUnit / rate.thbPerUnit : 0
  return { total: c / 100, currency, nights, guests, thbPerUnit: rate.thbPerUnit, rateDate: rate.date, perUsd, pegged, perPersonStay: share(guests), perPerson: share(nights * guests), perNight: share(nights) }
}
const cash = (n, cur) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur
// the other amounts for an amount paid: drams (amd.amount takes whole baht), then whole dollars written like usd() below
// ("≈$758"; the user, 21 Oct 2026: "for the aed ones - remove thb and replace it with usd"); baht to 3 significant
// figures instead when we paid in dollars or there is no dollar rate (perUsd 0)
const paidAmd = (p, n) => amd.amount(Math.round(n * p.thbPerUnit))
const paidUsd = (p) => p.currency !== 'USD' && p.perUsd > 0
const paidAlt = (p, n) => [amdRate ? paidAmd(p, n) : '', paidUsd(p) ? '≈$' + Math.round(n / p.perUsd).toLocaleString('en-US') : '≈' + Number((n * p.thbPerUnit).toPrecision(3)).toLocaleString('en-US') + ' THB'].filter(Boolean)
// one line for the popups, the share previews and the KML: "22,282.88 AED for 6 nights, 2,785.36 AED per person (≈275,000 AMD)"
const paidLine = (p) => `${cash(p.total, p.currency)} for ${plural(p.nights, 'night')}, ${cash(p.perPersonStay, p.currency)} per person${amdRate ? ' (' + paidAmd(p, p.perPersonStay) + ')' : ''}`
// the paid price box: the total in the currency we paid, big; then per person for the stay, per person per day and the
// villa per day, each with its drams and dollars on lines of their own (data-noamd: those are written out here, not
// added by tools/amd.mjs)
function paidBox(p, label, rows = ['stay', 'pp', 'night']) {
  const alt = (n) => paidAlt(p, n).map((x) => `<span>${esc(x)}</span>`).join('')
  const ROW = { stay: [`Per person, ${p.nights} days`, p.perPersonStay], pp: ['Per person per day', p.perPerson], night: ['Whole villa per day', p.perNight] }
  // lines break between the parts, never inside "8 guests", "14–18 Jan" or "≈2,200,000 AMD"
  return `<div class="price-box paid" data-noamd><div class="price-head"><div><span class="price-label">${esc(label).replace(/(\d) /g, '$1&nbsp;')}</span><b class="price-total">${cash(p.total, p.currency)}</b><span class="price-alt">${paidAlt(p, p.total).map((x) => esc(x).replace(/ /g, '&nbsp;')).join(' · ')}</span></div></div>` +
    `<dl class="price-split">${rows.map((k) => `<dt>${esc(ROW[k][0])}</dt><dd><b>${cash(ROW[k][1], p.currency)}</b>${alt(ROW[k][1])}</dd>`).join('')}</dl></div>`
}
// beds for the group (bedrooms / beds / baths from the listing): a bed each is ideal; 4 beds or fewer for 8 is not
// ("if it's 4 beds it's not ideal", the user, 17 Oct 2026)
function bedFit(h) {
  if (!(h.beds > 0)) return null
  if (h.beds >= STAY_GUESTS) return { key: 'good', text: 'A bed each' }
  if (h.beds <= STAY_GUESTS / 2) return { key: 'bad', text: `Not ideal: ${Math.ceil(STAY_GUESTS / h.beds)} to a bed` }
  return { key: 'warn', text: 'Some share a bed' }
}
const BED_CHIPS = [['good', 'A bed each'], ['warn', 'Some share'], ['bad', '2 to a bed']]
// Show on map: a small map of the villa inside the card (src/app.js draws it when the accordion opens), the big map,
// and Google Maps; without JavaScript only the Google Maps link shows
function villaMap(h) {
  if (lowConf(h) || !Number.isFinite(+h.lat)) return ''
  const approx = /approximate/i.test(h.coordSource || '') ? '<p class="note">The pin is approximate: Airbnb sends the address after booking.</p>' : ''
  return `<details class="more mapacc" data-mini-map data-lat="${+h.lat}" data-lng="${+h.lng}"><summary>${icon('areas')}Show on map</summary>` +
    `<div class="mini-map js-only" role="img" aria-label="${esc('Map of where ' + h.name + ' is')}"></div><p class="map-credit js-only"></p>${approx}` +
    `<div class="actions"><button class="btn primary js-only" type="button" data-on-map="hotel:${esc(h.id)}">${icon('areas')}Open the big map</button>` +
    `<a class="btn" href="${gmaps(h.gmapsQuery || h.name, h.placeId)}" target="_blank" rel="noopener">${icon('pin')}Google Maps</a></div></details>`
}
function bedRow(h) {
  const fit = bedFit(h)
  if (!fit) return ''
  const parts = [h.bedrooms > 0 ? plural(h.bedrooms, 'bedroom') : '', plural(h.beds, 'bed'), h.baths > 0 ? plural(h.baths, 'bath') : ''].filter(Boolean)
  return `<div class="beds-row"><span class="pill ${fit.key}">${esc(fit.text)}</span><span>${esc(parts.join(' · '))}</span></div>`
}
// US dollars from the mid-market rate in data/exchanges.json (an estimate, like the drams)
const usdPerThb = (() => { const u = (money.midMarket || []).find((m) => m && m.currency === 'USD' && m.thbPerUnit > 0); return u ? 1 / u.thbPerUnit : 0 })()
function usd(thbAmount) {
  if (!usdPerThb) return ''
  const v = thbAmount * usdPerThb
  const step = v < 100 ? 1 : v < 1000 ? 5 : 10
  return '≈$' + (Math.round(v / step) * step).toLocaleString('en-US')
}
// the villa price: drams first and big (an estimate, from the rate in data/extra.json), then US dollars, then the exact
// price the listing showed in baht (the one to compare with Airbnb / Booking.com)
function priceBox(h) {
  // our booked villas: what we paid for our nights, not the listing's 8-18 Jan price
  const bv = baseOfVilla(h.id)
  if (bv && bv.paid) return paidBox(bv.paid, `Paid · ${baseRange(bv)} · ${plural(bv.nights, 'night')} · ${bv.paid.guests} guests`)
  const pr = priceOf(h)
  if (!pr) return `<div class="price-box none"><div><b class="price-total">${esc(h.noRoomsOnTrip)}</b><span class="price-pp">No price for the trip dates</span></div></div>`
  const site = h.websiteLabel || 'Listing'
  const alt = (n, label) => [usd(n), (label ? label + ' ' : '') + thb(n)].filter(Boolean).join(' · ')
  // data-noamd: the dram amounts here are written out, not added by tools/amd.mjs
  const row = (label, n) => `<dt>${esc(label)}</dt><dd>${amdRate ? `<b>${amd.amount(n)}</b><span>${esc(alt(n))}</span>` : `<b>${thb(n)}</b>`}</dd>`
  const main = amdRate ? `<b class="price-total">${amd.amount(pr.total)}</b><span class="price-alt">${esc(alt(pr.total, site + ' price'))}</span>` : `<b class="price-total">${thb(pr.total)}</b>`
  return `<div class="price-box" data-noamd><div class="price-head"><div><span class="price-label">${pr.nights} nights · all fees${amdRate ? ' · estimate' : ''}</span>${main}</div></div>` +
    `<dl class="price-split">${row('Per person per day', pr.perPerson)}${row(`Per person, ${pr.nights} days`, pr.perPersonStay)}${row('Whole villa per day', pr.perNight)}</dl></div>`
}
// listFirst (data/stays.json): the villas the user put at the top, in that order; then by area, rooms on sale, price
const hotelsSorted = hotels.slice().sort((a, b) => (a.listFirst ?? 99) - (b.listFirst ?? 99) || ZONES.findIndex((z) => z[0] === zoneOf(a)) - ZONES.findIndex((z) => z[0] === zoneOf(b)) || (a.noRoomsOnTrip ? 1 : 0) - (b.noRoomsOnTrip ? 1 : 0) || (hotelOrder[a.tier] ?? 9) - (hotelOrder[b.tier] ?? 9))
// shared notes: a list and an Add note form; the vote server keeps them (website only: src/app.js fills the list and
// shows the block once the server answers). item: 'ht:<id>' for a villa, 'all' for the whole trip
// the notes show as they are; only the box to write a new one is folded away under Add a note
function notesInner(item) {
  const fid = 'note-' + item.replace(/[^a-z0-9]+/gi, '-')
  return `<ul class="notes-list" aria-live="polite"></ul><details class="more note-add"><summary>Add a note</summary><form class="note-form" autocomplete="off"><label class="sr-only" for="${fid}">Add a note</label>` +
    `<textarea id="${fid}" name="text" rows="2" maxlength="500" required placeholder="Add a note for the group"></textarea><button class="btn" type="submit">${icon('plus')}Add note</button></form></details>`
}
const villaNotes = (h) => `<div class="notes js-only" data-notes="ht:${esc(h.id)}" hidden><p class="notes-label">${icon('note')}Notes <span class="notes-n"></span></p>${notesInner('ht:' + h.id)}</div>`
// Move up / down: the villa order for everyone, kept by the vote server (website only: src/app.js shows them)
const moveBtns = (h) => `<button class="btn square js-only" type="button" data-move-stay="up" hidden aria-label="${esc('Move ' + h.name + ' up')}">${icon('up')}</button>` +
  `<button class="btn square js-only" type="button" data-move-stay="down" hidden aria-label="${esc('Move ' + h.name + ' down')}">${icon('down')}</button>` +
  `<button class="btn js-only" type="button" data-unpin-stay hidden aria-label="${esc('Reset the position of ' + h.name)}">${icon('swap')}Reset position</button>`
function hotelCard(h, mode) {
  const tierKey = h.tier === 'hostel' ? 'budget hostel' : h.tier
  const extraBtns = isUrl(h.website) ? `<a class="btn" href="${esc(h.website)}" target="_blank" rel="noopener">${icon('globe')}${esc(h.websiteLabel || 'Website')}</a>` : ''
  // 'Hide' takes the villa off the list and the map on this phone; the Hidden villas list brings it back
  const hideBtn = `<button class="btn js-only" type="button" data-hide-stay="${esc(h.id)}" aria-label="${esc('Hide ' + h.name)}">${icon('hide')}Hide</button>`
  const vibe = (h.vibe || []).filter(has)
  return `<article class="card" id="ht-${esc(h.id)}" data-stay="${esc(h.id)}" data-fav-card="ht:${esc(h.id)}" data-name="${esc(h.name)}" data-kind="Hotel" data-tier="${esc(tierKey)}" data-zone="${zoneOf(h)}" data-beds="${bedFit(h)?.key || ''}" data-text="${textOf(h.name, areaName(h.area), h.tier, vibe)}">
${villaMedia(h, mode)}<div class="tag-top">${baseOfVilla(h.id) ? `<span class="pill booked">Booked · ${baseRange(baseOfVilla(h.id))}</span>` : ''}<span class="pill ${h.tier === 'luxury' ? 'must' : 'soft'}">${esc(HTIER[h.tier] || h.tier)}</span>${h.noRoomsOnTrip ? `<span class="pill bad">${esc(h.noRoomsOnTrip)}</span>` : ''}${h.adultsOnly ? '<span class="pill soft">Adults only</span>' : ''}${h.beachfront ? '<span class="pill soft">Beachfront</span>' : ''}</div></div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(h.name)}</h2><p class="subtitle">${esc(areaName(h.area))}${has(h.ratingText) ? ' · ' + esc(h.ratingText) : ''}</p></div></div>
${bedRow(h)}
${priceBox(h)}
${villaMap(h)}
<p class="desc">${esc(h.whyStay)}</p>
${vibe.length ? `<div class="tags">${vibe.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
${baseOfVilla(h.id)?.paid ? '' : facts([['January', h.priceText]])}
${moreBlock('Nearby & more', [h.description !== h.whyStay ? h.description : '', ...(h.tips || [])].filter(has), h.links, [['Nearby', h.nearby]])}
${villaNotes(h)}
${voteBar('ht:' + h.id, h.name)}
<div class="actions">${lowConf(h) ? '' : `<button class="btn primary js-only" type="button" data-open-map aria-label="${esc('Map of ' + h.name)}">${icon('areas')}Map</button>`}${extraBtns}${hideBtn}<button class="btn square js-only" type="button" data-share-stay data-listing="${esc(isUrl(h.website) ? h.website : '')}" aria-label="${esc('Share ' + h.name)}">${icon('share')}</button>${moveBtns(h)}<button class="btn square fav js-only" type="button" data-fav="ht:${esc(h.id)}" aria-pressed="false" aria-label="${esc('Save ' + h.name)}">${icon('star')}</button></div>
</div></article>`
}

// ---------- money ----------
const brands = (money.brands || []).slice().sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
const RATING = { best: ['Best rates', 'good'], great: ['Very good', 'good'], ok: ['OK', 'warn'], avoid: ['Avoid', 'bad'] }
const inkFor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return '#ffffff'
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#10232a' : '#ffffff'
}
const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim() : d)
const lum = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
function signColors(branding) {
  const bg = hex(branding && branding.primaryColor, '#0a7480')
  const second = hex(branding && branding.secondaryColor, '')
  const fg = second && contrast(bg, second) >= 4 ? second : contrast(bg, '#ffffff') >= contrast(bg, '#10232a') ? '#ffffff' : '#10232a'
  const stripe = hex(branding && branding.accentColor, '') || (second && second !== fg ? second : 'transparent')
  return `--brand:${bg};--brand-ink:${fg};--brand-2:${stripe}`
}
function brandCard(b, mode) {
  const [rl, rc] = RATING[b.rating] || ['', 'soft']
  const br = b.branding || {}
  const sign = has(br.primaryColor) ? `<span class="sign" style="${signColors(br)}" aria-hidden="true">${esc(br.logoText || b.name)}</span>` : `<span class="sign plain" aria-hidden="true">${esc(br.logoText || b.name)}</span>`
  const branches = (b.branches || []).filter((x) => x && x.lat != null)
  const groups = {}
  ;(b.sampleRates || []).filter((r) => r && r.buyTHB).forEach((r) => {
    const src = String(r.source || '').split(/[(,;:]/)[0].replace(/https?:\/\/(www\.)?/, '').trim()
    const k = src && (b.sampleRates || []).some((x) => x.source && x.source !== r.source) ? src : ''
    ;(groups[k] = groups[k] || []).push(`${r.currency} ${r.buyTHB}`)
  })
  const dates = Array.from(new Set((b.sampleRates || []).map((r) => r && r.date).filter(Boolean)))
  const sample = Object.keys(groups).length ? Object.entries(groups).map(([k, v]) => (k ? k + ': ' : '') + v.join(', ')).join(' · ') + (dates.length === 1 ? ` (${dates[0]})` : '') : ''
  const branchHtml = branches.length ? `<ul class="branches">${branches.map((x) => `<li><b>${esc(x.name)}</b><span>${esc([areaName(x.area), x.hoursText].filter(has).join(' · '))}${has(x.notes) ? ' · ' + esc(x.notes) : ''}</span><a class="btn" href="${gmaps(x.gmapsQuery || x.name, x.placeId)}" target="_blank" rel="noopener">${icon('pin')}Map</a></li>`).join('')}</ul>` : ''
  const finder = !branches.length && b.kind === 'bank' ? `<a class="btn primary" href="${gmaps('bank currency exchange')}" target="_blank" rel="noopener">${icon('pin')}Find one near you</a>` : ''
  const pc = (b.pros || []).length || (b.cons || []).length ? `<div class="proscons">${(b.pros || []).length ? `<div><h4>Good</h4><ul>${b.pros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${(b.cons || []).length ? `<div><h4>Watch out</h4><ul>${b.cons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''
  const rateLink = b.rateCheck && isUrl(b.rateCheck.url) ? `<a class="btn primary" href="${esc(b.rateCheck.url)}" target="_blank" rel="noopener">${icon('ext')}Today’s rates</a>` : ''
  const web = isUrl(b.website) && (!b.rateCheck || b.website !== b.rateCheck.url) ? `<a class="btn" href="${esc(b.website)}" target="_blank" rel="noopener">${icon('globe')}Website</a>` : ''
  return `<article class="card" id="mx-${esc(b.id)}" data-name="${esc(b.name)}" data-kind="Money">
${images['money:' + b.id] && !(extra.dropImages || []).includes('money:' + b.id) ? imgTag('money:' + b.id, b.name, mode, '฿') + '</div>' : ''}
<div class="body">
<div class="brand-row">${sign}<div><h2 class="card-title">${esc(b.name)}</h2>${rl ? `<span class="pill ${rc}">${rl}</span>` : ''}</div></div>
${has(br.howToRecognize) ? `<p class="note">Look for: ${esc(br.howToRecognize)}</p>` : ''}
<p class="desc">${esc(b.summary)}</p>
${branchHtml}
${pc || sample || has(b.rateCheck && b.rateCheck.note) || (b.links || []).length ? `<details class="more"><summary>Rates, good & watch out</summary>${sample ? `<p class="ratesample">Sample buy rates: ${esc(sample)}</p>` : ''}${pc}${has(b.rateCheck && b.rateCheck.note) ? `<p class="note">${esc(b.rateCheck.note)}</p>` : ''}${linksHtml(b.links)}</details>` : ''}
<div class="actions">${finder}${rateLink}${web}${branches.length ? `<button class="btn js-only" type="button" data-on-map="money:${esc(b.id)}-0">${icon('areas')}On map</button>` : ''}</div>
</div></article>`
}

// ---------- calendar (home) ----------
function sunTimes(iso, lat = 7.89, lng = 98.3, tz = 7) {
  const rad = Math.PI / 180
  const J = Date.parse(iso + 'T12:00:00Z') / 86400000 + 2440587.5
  const n = Math.round(J - 2451545.0 + 0.0008)
  const Js = n - lng / 360
  const M = (357.5291 + 0.98560028 * Js) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lam = (M + C + 180 + 102.9372) % 360
  const Jt = 2451545.0 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad)
  const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad))
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec))) / rad
  const t = (Jd) => new Date((Jd - 2440587.5) * 86400000 + tz * 3600000).toISOString().slice(11, 16)
  return { rise: t(Jt - w / 360), set: t(Jt + w / 360) }
}
// the agenda's market dots: markets, and food places open only on a few days (a restaurant closed on Wednesdays is not one)
const markets = places.filter((p) => (p.days || []).length && (p.category === 'market' ? p.days.length < 7 : p.category === 'food' && p.days.length <= 3))
// the plan has the two of you on Koh Phangan on these nights, so its parties come first in the agenda
const PLAN_PHANGAN = new Set(['2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22'])
function dayAgenda(iso) {
  // flight day: you are at the airport by 15:20, so evening parties and markets do not apply
  if (iso === TRIP.flight.day) return { evs: [], mk: [] }
  const here = PLAN_PHANGAN.has(iso) ? 'koh-phangan' : 'phuket'
  const near = (e) => (whereOf(e) === here ? 0 : 1)
  // nights on islands outside the plan (Phi Phi pool parties, Lanta bars) only make the agenda when they suit the traveler;
  // nights in one of our Phuket villas leave out Koh Phangan; Bangkok is not in the plan (it has its own tab)
  const inVilla = !!baseOf(iso)
  const evs = events.filter((e) => (e.dates || []).includes(iso) && whereOf(e) !== 'bangkok' && !(inVilla && whereOf(e) === 'koh-phangan') && (whereOf(e) !== 'other' || e.pick || (e.undergroundScore || 0) >= 3)).sort((a, b) => near(a) - near(b) || (b.pick ? 1 : 0) - (a.pick ? 1 : 0) || (b.undergroundScore || 0) - (a.undergroundScore || 0))
  const mk = markets.filter((p) => p.days.includes(dowOf(iso)))
  return { evs, mk }
}
const shortHours = (t) => { const m = String(t || '').match(/\b\d{1,2}[:.]\d{2}\s*[-–]\s*\d{1,2}[:.]\d{2}\b/); return m ? m[0].replace(/\s+/g, '') : '' }
const OFFLINE_TEXT = {
  standalone: 'Open this guide once with internet to save it for offline use.',
  single: 'This file works offline as it is. Keep it on your phone or laptop.',
  artifact: 'This copy needs internet. For the trip, keep the offline file of this guide (phuket-guide-offline.html) on your phone: it works with no internet.',
}
let buildName = 'standalone'
function homeView(mode) {
  const dayCell = (iso) => {
    const { evs, mk } = dayAgenda(iso)
    const dots = evs.slice(0, 2).map(() => '<i></i>').join('') + (mk.length ? '<i class="sun"></i>' : '')
    const fly = iso === TRIP.flight.day ? ' fly' : ''
    return `<a class="day-btn${fly}" href="#day-${iso}" data-day="${iso}" aria-pressed="false"><span class="dw">${dowOf(iso).toUpperCase()}</span><span class="dn">${Number(iso.slice(8, 10))}</span><span class="dots">${fly ? '<i class="plane"></i>' : dots}</span></a>`
  }
  const dayRows = TRIP.phases.map((ph) => {
    const days = TRIP_DAYS.filter((d) => phaseOf(d) === ph.id)
    const range = phaseLabel(ph)
    return `<div class="phase-row"><span class="phase-label">${esc(ph.label)} · ${range}${ph.id === 'solo' ? ` · flight ${TRIP.flight.time}` : ''}</span><div class="days" role="group" aria-label="${esc(ph.label)} days">${days.map(dayCell).join('')}</div></div>`
  }).join('')
  const agenda = TRIP_DAYS.map((iso) => {
    const { evs, mk } = dayAgenda(iso)
    const st = sunTimes(iso)
    const items = [
      ...evs.map((e) => `<li><div><a href="#ev-${esc(e.id)}">${esc(e.name)}</a> <span>· ${esc([areaName(e.area) || e.island, e.status === 'unconfirmed' ? 'not confirmed' : e.agendaNote || (e.kind === 'dated' ? '' : e.kind === 'venue' ? 'most weekends, check the line-up' : 'weekly'), e.pick ? 'top pick' : ''].filter(has).join(' · '))}</span></div></li>`),
      ...mk.map((p) => `<li class="mk"><div><a href="#pl-${esc(p.id)}">${esc(p.name)}</a> <span>· ${esc([areaName(p.area), shortHours(p.openText)].filter(has).join(' · '))}</span></div></li>`),
    ]
    ;[].concat((extra.dayTips || {})[iso] || []).forEach((tip) => items.push(`<li class="tip"><div><span>${esc(tip)}</span></div></li>`))
    const b = baseOf(iso), lv = leavingOn(iso)
    const where = lv && b ? `Move: out of the ${lv.short} by ${lv.checkOut}, into the ${b.short} from ${b.checkIn}` : b && iso === b.from ? `Check in at the ${b.short} from ${b.checkIn}` : b ? `Night at the ${b.short}` : lv ? `Check out of the ${lv.short} by ${lv.checkOut}` : ''
    return `<article class="agenda-day" id="day-${iso}" data-day="${iso}"><h3>${dayLabel(iso)} <small>Sunrise ${st.rise} · Sunset ${st.set}</small></h3>${where ? `<p class="day-base"><a href="#our-villas">${icon('stay')}${esc(where)}</a></p>` : ''}${items.length ? `<ul>${items.join('')}</ul>` : '<p class="quiet">No parties listed yet. A good day for a beach, a viewpoint or a day trip.</p>'}</article>`
  }).join('')
  // a hand-picked list (extra.beforeYouFly); without one, the first 'must know' facts of the pre-trip sections
  const tripSections = new Set(['phangan-week', 'solo', 'departure'])
  // a link to #apps only makes sense once the Apps view exists (data/apps.json)
  const beforeFly = (extra.beforeYouFly || []).length ? extra.beforeYouFly.filter((c) => c.href !== '#apps' || apps.length)
    : (info.sections || []).filter((s) => !tripSections.has(s.id)).flatMap((s) => (s.items || []).filter((i) => i.critical).map((i) => ({ text: i.title, href: '#info-' + s.id }))).slice(0, 5)
  const bestBrand = brands[0]
  const tiles = [
    ['events', 'events', 'Music & raves', plural(datedEvents.filter((e) => e.window === 'in').length, 'dated event') + ' in your dates'],
    ['places', 'places', 'Places to go', [plural(places.filter((p) => !['day-trip', 'tour', 'pier', 'adult'].includes(p.tier)).length, 'spot'), plural(places.filter((p) => p.tier === 'day-trip').length, 'day trip'), ...(places.some((p) => p.tier === 'tour') ? [plural(places.filter((p) => p.tier === 'tour').length, 'boat tour')] : [])].join(' · ')],
    ['areas', 'areas', 'Areas & map', plural(areas.length, 'area') + ', drawn on the map'],
    ['stay', 'stay', 'Where to stay', plural(hotels.length, 'villa') + ' + your own'],
    ...(buildName === 'standalone' ? [['spend', 'wallet', 'Spending', 'Who paid what, and who owes whom']] : []),
    ['money', 'money', 'Money', bestBrand ? `Best rates: ${bestBrand.name}` : 'Exchange & ATMs'],
    ['info', 'info', 'Essentials', 'Entry, transport, boats, safety, phrases'],
    ...(apps.length ? [['apps', 'apps', 'Apps to install', `${plural(apps.filter((a) => a.priority === 'must').length, 'app')} to set up before you fly, ${apps.length} in all`, 'wide']] : []),
  ].map(([href, ic, t, s, cls]) => `<a class="tile${cls ? ' ' + cls : ''}" href="#${href}">${icon(ic)}<b>${esc(t)}</b><span>${esc(s)}</span></a>`).join('')
  return `<section class="view" id="home" aria-labelledby="home-title">
<h1 class="sr-only" id="home-title">Phuket trip guide, ${TRIP_LABEL.words}</h1>
<div class="pass">
<div class="pass-top"><div class="pass-code"><small>Trip to</small>HKT</div><div class="pass-side"><b>Phuket</b><span class="thai" lang="th">ภูเก็ต</span><span><span class="nw">${TRIP_LABEL.long} ·</span> <span class="nw">${TRIP_LABEL.days}</span></span><span class="pass-flight"><span class="nw">Flight home</span> <span class="nw">${dayLabel(TRIP.flight.day)}, ${TRIP.flight.time}</span></span></div></div>
<div class="pass-count js-only" id="countdown" role="timer" hidden>
<div class="pc-head"><span class="pc-label" id="cd-label">Trip starts in</span><span class="pc-when" id="cd-when"></span></div>
<div class="pc-board" aria-hidden="true">${[['d', 'Days'], ['h', 'Hours'], ['m', 'Min'], ['s', 'Sec']].map(([k, l], i) => `${i ? '<span class="pc-sep">:</span>' : ''}<div class="pc-unit pc-${k}"><div class="pc-digits" data-cd="${k}"></div><small>${l}</small></div>`).join('')}</div>
</div>
<div class="pass-cut" aria-hidden="true"></div>
<div class="pass-bottom">${dayRows}
<div class="pass-legend"><span><i></i>Music</span><span><i class="sun"></i>Market</span><span><i class="plane"></i>Flight home</span></div></div>
</div>
${BASES.length ? `<div class="bases-strip" aria-label="Our villas">${BASES.map((b) => `<a href="#our-villas"><span>${icon('stay')}${esc(b.short)}</span><b>${esc(dayLabel(b.from).replace(/ Jan$/, ''))} → ${esc(dayLabel(b.to))}</b></a>`).join('')}</div>` : ''}
<div class="block-title"><h2>Day by day</h2><button class="chip js-only" type="button" id="agenda-all" aria-pressed="false">Show all days</button></div>
<div class="agenda" id="agenda">${agenda}</div>
<div class="tiles">${tiles}</div>
${beforeFly.length ? `<div class="callout alert"><h3>Before you fly</h3><ul>${beforeFly.map((c) => `<li>${c.href ? `<a href="${esc(c.href)}">${esc(c.text)}</a>` : esc(c.text)}</li>`).join('')}</ul><p><a href="#info">Read the essentials</a></p></div>` : ''}
<div class="stack js-only"><div class="block-title"><h2>Saved</h2><small id="saved-count"></small></div><div class="agenda-day"><ul id="saved-list"></ul></div></div>
<div class="callout" id="offline-box"><h3>Offline use</h3><p class="offline-state" id="offline-state">${OFFLINE_TEXT[buildName] || ''}</p><p id="offline-fill-row" hidden><button class="btn primary" type="button" id="offline-fill">Download the missing ones</button></p>
<div id="install-tip" hidden><p id="install-ios">iPhone: tap Share, then “Add to Home Screen”. Open it once with internet. After that it works offline.</p><p id="install-android">Android: tap ⋮, then “Add to Home screen” or “Install app”.</p></div>
<p class="note">For offline turn-by-turn directions, also download Phuket in the Google Maps app: profile picture → Offline maps → Select your own map.</p></div>
<footer class="footer-note">${buildName === 'standalone' ? '<p class="js-only" id="signed-in" hidden>Signed in as <b></b>. <button class="link-btn" type="button" id="sign-out">Not you?</button></p><p class="js-only" data-admin-only hidden>Admin: <a href="#admin">Activity &amp; logins</a>. Only you see this.</p>' : ''}<p>Researched on ${esc(extra.researchedOn || '15 Oct 2026')}. Lineups, prices and opening hours change: check the official link before you go.</p><p>Map data © OpenStreetMap contributors (ODbL). Photos: Wikimedia Commons contributors and the venues’ own sites, credited on each photo.</p></footer>
</section>`
}

// ---------- share pages: link previews in WhatsApp, Telegram, iMessage… ----------
// A shared link like https://phuket-six.vercel.app/s/ht-<id> is a small page whose Open Graph tags (the photo, the
// name, the price or the date) messengers read for the preview; opened, it goes straight to that card in the guide
// (/#ht-<id>). vercel.json maps /s/<name> to dist/s/<name>.html. The preview photos are JPEGs in dist/og/ (WhatsApp:
// under 600 KB, at least 300 px wide; JPEG is the format every messenger takes).
const SITE = String(extra.siteUrl || 'https://phuket-six.vercel.app').replace(/\/$/, '')
const OG_W = 800, OG_H = 420
const SITE_TITLE = 'Phuket trip guide'
const SITE_DESC = `Music, places, villas and money for the group trip to Phuket, ${TRIP_LABEL.long}. Works offline.`
const short = (t, n = 190) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length <= n ? t : t.slice(0, t.lastIndexOf(' ', n - 1)).replace(/[,.;:·\s]+$/, '') + '…' }
const firstSentence = (t) => (String(t || '').match(/^.*?[.!?](\s|$)/) || [String(t || '')])[0].trim()
const ogTags = ({ title, desc, url, img }) => [
  ['og:type', 'website'], ['og:site_name', `${SITE_TITLE} · ${TRIP_LABEL.long}`], ['og:title', title], ['og:description', desc], ['og:url', url],
  ...(img ? [['og:image', SITE + '/og/' + img], ['og:image:type', 'image/jpeg'], ['og:image:width', OG_W], ['og:image:height', OG_H], ['og:image:alt', title]] : []),
].map(([k, v]) => `<meta property="${k}" content="${esc(String(v))}">`).join('\n') + `\n<meta name="twitter:card" content="summary_large_image">`
const siteMeta = () => ogTags({ title: SITE_TITLE + ' · ' + TRIP_LABEL.long, desc: SITE_DESC, url: SITE + '/', img: 'site.jpg' })
// every card someone can share, with its preview text and photo
function shareItems() {
  const raw = Object.fromEntries((readJSON('data/image-picks.json', []) || []).filter((x) => x.ok && x.file).map((x) => [x.key, x.file]))
  const photo = (key) => (images[key] && !(extra.dropImages || []).includes(key) ? (raw[key] && fs.existsSync(P(raw[key])) ? raw[key] : images[key].file) : null)
  const out = []
  for (const h of hotels) {
    const pr = priceOf(h)
    const bv = baseOfVilla(h.id)
    const price = bv && bv.paid ? `Booked ${baseRange(bv)} · paid ${paidLine(bv.paid)}`
      : pr ? `${amdRate ? amd.amount(pr.total) + ' (' + thb(pr.total) + ')' : thb(pr.total)} for ${pr.nights} nights, 8 guests, 8–18 Jan` : h.noRoomsOnTrip || ''
    const rooms = [h.bedrooms > 0 ? plural(+h.bedrooms, 'bedroom') : '', h.beds > 0 ? plural(+h.beds, 'bed') : ''].filter(Boolean).join(', ')
    out.push({ slug: 'ht-' + h.id, hash: 'ht-' + h.id, title: h.name, desc: short([price, rooms, areaName(h.area), h.ratingText].filter(has).join(' · ')), key: 'hotels:' + h.id })
  }
  for (const e of events) {
    const dates = (e.dates || []).filter(inTrip).sort()
    const when = e.kind === 'dated' && dates.length ? dates.slice(0, 3).map(dayLabel).join(', ') + (dates.length > 3 ? '…' : '') : firstSentence(e.recurrence || e.timeText || '').replace(/\.$/, '')
    out.push({ slug: 'ev-' + e.id, hash: 'ev-' + e.id, title: e.name, desc: short([when, areaName(e.area), firstSentence(e.description)].filter(has).join(' · ')), key: 'events:' + e.id })
  }
  for (const pl of places) out.push({ slug: 'pl-' + pl.id, hash: 'pl-' + pl.id, title: pl.name, desc: short([areaName(pl.area), firstSentence(pl.description)].filter(has).join(' · ')), key: 'places:' + pl.id })
  // the lists you can share from their filter chips
  out.push({ slug: 'stay-liked', hash: 'stay/liked', title: 'Villas the group liked', desc: 'The villas with likes, most likes first, in the Phuket trip guide.' })
  out.push({ slug: 'stay-saved', hash: 'stay/saved', title: 'Villas the group saved', desc: 'The saved villas, with their prices for 8 guests, 8–18 Jan.' })
  out.push({ slug: 'events-saved', hash: 'events/saved', title: 'Saved music and parties', desc: 'The events the group saved in the Phuket trip guide.' })
  out.push({ slug: 'places-saved', hash: 'places/saved', title: 'Saved places', desc: 'The places the group saved in the Phuket trip guide.' })
  return out.map((x) => ({ ...x, src: x.key ? photo(x.key) : null }))
}
const sharePage = ({ slug, hash, title, desc, img }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${SITE_TITLE}</title>
<meta name="description" content="${esc(desc)}">
${ogTags({ title, desc, url: SITE + '/s/' + slug, img })}
<meta name="robots" content="noindex">
<link rel="icon" href="/icon-192.png">
<script>location.replace('/#${hash}')</script>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#0b1416;color:#e9f1ef;font:16px/1.5 system-ui,sans-serif}main{max-width:440px;display:grid;gap:12px}img{width:100%;border-radius:12px}h1{margin:0;font-size:22px}p{margin:0;color:#b6c5c2}a{justify-self:start;padding:12px 16px;border-radius:10px;background:#39c0cb;color:#032328;font-weight:600;text-decoration:none}</style>
</head><body><main>${img ? `<img src="/og/${img}" alt="">` : ''}<h1>${esc(title)}</h1><p>${esc(desc)}</p><a href="/#${hash}">Open in the Phuket guide</a></main></body></html>
`
async function ogJpeg(src, out) {
  // made again only when the photo is newer than the preview
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(P(src)).mtimeMs) return
  await sharp(P(src)).rotate().resize(OG_W, OG_H, { fit: 'cover', position: 'attention' }).jpeg({ quality: 74, mozjpeg: true }).toFile(out)
}
async function sharePages() {
  const items = shareItems()
  fs.rmSync(P('dist/s'), { recursive: true, force: true }); fs.mkdirSync(P('dist/s'), { recursive: true })
  fs.mkdirSync(P('dist/og'), { recursive: true })
  const keep = new Set(['site.jpg'])
  // the guide's own preview: a sunset photo with its name on it
  const siteSrc = ['places:promthep-cape', 'places:big-buddha'].map((k) => items.find((x) => x.key === k)?.src || (images[k] && images[k].file)).find((f) => f && fs.existsSync(P(f)))
  if (siteSrc && !fs.existsSync(P('dist/og/site.jpg'))) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="40" y="${OG_H - 92}" font-family="Avenir Next, Helvetica Neue, Arial" font-weight="800" font-size="72" fill="#fff">Phuket</text><text x="42" y="${OG_H - 44}" font-family="Avenir Next, Helvetica Neue, Arial" font-weight="600" font-size="30" fill="#fff" fill-opacity="0.9">Trip guide · ${esc(TRIP_LABEL.long)}</text></svg>`
    await sharp(P(siteSrc)).resize(OG_W, OG_H, { fit: 'cover', position: 'attention' }).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 78, mozjpeg: true }).toFile(P('dist/og/site.jpg'))
  }
  for (const it of items) {
    let img = 'site.jpg'
    if (it.src) { img = it.slug + '.jpg'; keep.add(img); await ogJpeg(it.src, P('dist/og', img)) }
    fs.writeFileSync(P('dist/s', it.slug + '.html'), sharePage({ ...it, img }))
  }
  for (const f of fs.readdirSync(P('dist/og'))) if (!keep.has(f)) fs.rmSync(P('dist/og', f))
  return items.length
}

// ---------- views ----------
// Notes (website only): the group's notes for the whole trip, and every villa's notes in one list (src/app.js fills it)
function notesView() {
  if (buildName !== 'standalone') return ''
  return `<section class="view" id="notes" aria-labelledby="notes-title">
<div class="view-head"><span class="eyebrow">Shared with the group</span><h1 class="view-title" id="notes-title">Notes</h1><p class="lede">Notes for the whole trip, and every note on the villas. Anyone can add one, everyone sees them.</p></div>
<div class="stack js-only notes notes-all" id="group-notes" data-notes="all" hidden><div class="block-title"><h2>${icon('note')}Group notes</h2></div>${notesInner('all')}</div>
<div class="stack js-only" id="villa-notes-box"><div class="block-title"><h2>${icon('stay')}On the villas</h2><small id="villa-notes-n"></small></div><div id="villa-notes"><p class="note">Add a note on a villa from its card on the Stay tab.</p></div></div>
</section>`
}
// Spending (website only): what the group pays, the balances and who pays whom, kept by the vote server; src/app.js
// fills it. The people are TRIP.people (tools/trip.mjs); the categories and currencies are the ones api/votes.js takes
const SPEND_CATS = [['food', 'Food'], ['drinks', 'Drinks'], ['groceries', 'Groceries'], ['transport', 'Transport'], ['activities', 'Activities'], ['stay', 'Stay'], ['shopping', 'Shopping'], ['other', 'Other']]
const SPEND_ICON = { activities: 'ticket', pay: 'swap' } // drawn with another icon
const SPEND_CURS = ['THB', 'AMD', 'AED', 'USD']
// the names under the codes: AMD and AED sit side by side and are easy to mix up (21 Oct 2026, two villas were saved
// in drams instead of dirhams)
const CUR_NAME = { THB: 'baht', AMD: 'dram', AED: 'dirham', USD: 'dollar' }
// a person: a coloured round with the initial (two words: both initials), in the same colour everywhere (src/app.js too)
const initials = (p) => { const w = p.split(' '); return w.length > 1 ? w[0][0] + w[1][0] : p[0] }
const avatar = (p) => `<span class="av p${TRIP.people.indexOf(p)}" aria-hidden="true">${esc(initials(p))}</span>`
function spendView() {
  if (buildName !== 'standalone') return ''
  const people = (attr) => `<div class="people">${TRIP.people.map((p) => `<button class="person" type="button" ${attr}="${esc(p)}" aria-pressed="false">${avatar(p)}<span>${esc(p)}</span></button>`).join('')}</div>`
  const seg = (id, attr, items, label) => `<div class="seg" id="${id}" role="group" aria-label="${esc(label)}">${items.map(([v, t], i) => `<button type="button" ${attr}="${v}" aria-pressed="${i === 0}">${esc(t)}</button>`).join('')}</div>`
  return `<section class="view spend" id="spend" aria-labelledby="spend-title">
<div class="view-head spend-head"><h1 class="view-title" id="spend-title">Spending</h1><label class="cur-pick js-only" hidden><span class="sr-only">Show amounts in</span><select id="spend-cur">${SPEND_CURS.map((c) => `<option value="${c}">${c} · ${CUR_NAME[c]}</option>`).join('')}</select></label></div>
<p class="note" id="spend-off">Open the guide’s website to share expenses with the group.</p>
<div class="todo-card js-only" id="spend-todo" hidden></div>
<div class="me-card js-only" id="spend-me" hidden></div>
<div class="js-only spend-body" id="spend-body" hidden>
${seg('spend-seg', 'data-pane', [['list', 'Expenses'], ['balances', 'Balances'], ['stats', 'Stats']], 'Show')}
<div class="spend-pane" data-pane-box="list"><div class="chips" role="toolbar" aria-label="Filter expenses"><button class="chip" type="button" data-spend-filter="all" aria-pressed="true">All <span class="n"></span></button><button class="chip" type="button" data-spend-filter="mine" aria-pressed="false">Mine <span class="n"></span></button><button class="chip" type="button" data-spend-filter="person" aria-pressed="false" hidden><span class="t"></span> <span class="n"></span></button></div><div class="spend-list" id="spend-list"></div><button class="link-btn" type="button" id="spend-copy" hidden>Share as text</button></div>
<div class="spend-pane" data-pane-box="balances" hidden><div class="spend-empty" id="spend-bal-empty" hidden>${icon('other')}<p>No expenses yet</p></div><ul class="bal-chart" id="spend-bal"></ul><div class="block-title" id="spend-settle-h"><h2>Settle up</h2><button class="link-btn" type="button" id="spend-next" hidden></button></div><ul class="settle" id="spend-settle"></ul><div class="block-title" id="spend-paid-h" hidden><h2>Paid back</h2></div><div class="day-rows" id="spend-paid" hidden></div></div>
<div class="spend-pane" data-pane-box="stats" hidden id="spend-stats"></div>
</div>
<button class="fab js-only" type="button" id="spend-add" hidden>${icon('plus')}<span>Add expense</span></button>
<template id="spend-icons">${[...SPEND_CATS.map(([k]) => k), 'pay', 'check', 'next', 'plus', 'camera', 'pin'].map((k) => `<span data-i="${k}">${icon(SPEND_ICON[k] || k)}</span>`).join('')}</template>
</section>
<dialog class="sheet js-only" id="spend-sheet" aria-labelledby="sheet-title"><form id="spend-form" novalidate autocomplete="off" data-noamd>
<div class="sheet-head"><h2 id="sheet-title">New expense</h2><button class="icon-btn" type="button" data-sheet-close aria-label="Close">${icon('close')}</button></div>
${seg('sp-kind', 'data-kind', [['spend', 'Expense'], ['pay', 'Payment']], 'Expense or payment')}
<div class="amount-box"><input id="sp-amount" name="amount" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="0" aria-label="Amount"><div class="seg seg-cur" id="sp-curs" role="group" aria-label="Currency">${SPEND_CURS.map((c, i) => `<button type="button" data-cur="${c}" aria-pressed="${i === 0}" aria-label="${CUR_NAME[c]}s (${c})"><b>${c}</b><small>${CUR_NAME[c]}</small></button>`).join('')}</div>
<p class="conv"><span id="sp-conv"></span><button class="link-btn" type="button" id="sp-rate-btn" hidden></button></p>
<label class="rate-box" id="sp-rate-box" hidden><span id="sp-rate-l">THB for 1 AED</span><input id="sp-rate" inputmode="decimal" autocomplete="off"></label><p class="rate-warn" id="sp-rate-warn" hidden></p></div>
<div class="what-row" data-only="spend"><button class="x-ic cat-tile" type="button" id="sp-cat" aria-expanded="false" aria-controls="sp-cats"></button><input id="sp-what" name="what" maxlength="80" enterkeyhint="done" placeholder="What was it?" aria-label="What was it"></div>
<div class="cat-grid" id="sp-cats" role="group" aria-label="Category" hidden>${SPEND_CATS.map(([k, t]) => `<button type="button" class="cat-chip c-${k}" data-cat="${k}" aria-pressed="false">${icon(SPEND_ICON[k] || k)}<span>${t}</span></button>`).join('')}</div>
<div class="quick" id="sp-quick" hidden></div>
<div class="field"><button class="pick-row" type="button" id="sp-paid-row" aria-expanded="false" aria-controls="sp-paid-box"><span class="field-label" id="sp-paid-l">Paid by</span><span class="pick-val" id="sp-paid-val"></span>${icon('chev')}</button><div id="sp-paid-box" role="group" aria-labelledby="sp-paid-l" hidden>${people('data-paid')}</div></div>
<div class="field" data-only="pay"><span class="field-label" id="sp-to-l">To</span><div role="group" aria-labelledby="sp-to-l">${people('data-to')}</div></div>
<div class="field" data-only="spend"><div class="field-row"><span class="field-label" id="sp-split-l">Split</span>${seg('sp-mode', 'data-mode', [['equal', 'Equally'], ['shares', 'Shares'], ['amounts', 'Amounts']], 'How to split')}</div><div id="sp-split" role="group" aria-labelledby="sp-split-l"></div><p class="split-sum" id="sp-sum" aria-live="polite"></p></div>
<div class="field"><span class="field-label">Day</span><div class="day-pick"><button type="button" class="chip" data-day="0" aria-pressed="false">Today</button><button type="button" class="chip" data-day="-1" aria-pressed="false">Yesterday</button><input type="date" id="sp-date" name="date" required min="2026-06-01" max="2027-02-28" aria-label="Day"></div></div>
<div class="field receipt-field"><span class="field-label" id="sp-photo-l">Receipt</span>
<div class="receipt-row"><label class="btn small receipt-add" id="sp-photo-btn">${icon('camera')}<span>Add photo</span><input type="file" id="sp-photo" accept="image/*" aria-labelledby="sp-photo-l"></label>
<div class="receipt-prev" id="sp-photo-prev" hidden><button class="receipt-thumb" type="button" id="sp-photo-open" aria-label="Open the receipt photo"><img id="sp-photo-img" alt=""></button><div class="receipt-info"><small id="sp-photo-size"></small><button class="link-btn" type="button" id="sp-photo-del">Remove photo</button></div></div></div>
<p class="receipt-loc" id="sp-loc" hidden>${icon('pin')}<span id="sp-loc-text"></span><span class="receipt-acts"><a id="sp-loc-map" target="_blank" rel="noopener">Map</a><button class="link-btn" type="button" id="sp-loc-del">Remove place</button></span></p>
<p class="receipt-noloc" id="sp-noloc" hidden><span id="sp-noloc-text">No location in the photo.</span> <button class="link-btn" type="button" id="sp-loc-here">Use where I am now</button></p>
</div>
<p class="sheet-meta" id="sp-meta" hidden></p>
<div class="sheet-foot"><p class="sheet-err" id="sp-err" role="alert"></p><button class="btn quiet-danger" type="button" id="sp-delete" hidden>Delete</button><button class="btn primary" type="submit" id="sp-save">Save</button></div>
</form></dialog>
<dialog class="receipt-view js-only" id="receipt-view" aria-labelledby="rv-title"><div class="rv-head"><h2 id="rv-title">Receipt</h2><button class="icon-btn" type="button" data-rv-close aria-label="Close">${icon('close')}</button></div>
<div class="rv-body"><p class="note" id="rv-wait">Loading the photo…</p><img id="rv-img" alt="Receipt photo" hidden><p class="rv-place" id="rv-place" hidden>${icon('pin')}<span id="rv-place-text"></span> <a id="rv-map" target="_blank" rel="noopener">Open in Google Maps</a></p><p class="note" id="rv-note" hidden></p></div></dialog>`
}
// Admin (website only, Vardan K): the activity log, filled in by src/app.js from the vote server (?audit=1): who did what,
// when, from which IP, place and device, with filters, people and devices
function adminView() {
  if (buildName !== 'standalone') return ''
  return `<section class="view admin" id="admin" aria-labelledby="admin-title">
<div class="view-head"><span class="eyebrow">Admin · ${esc(TRIP.admin || '')} only</span><h1 class="view-title" id="admin-title">Activity log</h1><p class="lede">Every sign-in, tap, view, vote, note and expense, with who, when, where and on which phone.</p></div>
<div id="admin-body"><p class="note">Open the guide's website to see the log.</p></div>
</section>`
}
// Stats: filled in by src/app.js from the vote server (website only)
function statsView() {
  return `<section class="view" id="stats" aria-labelledby="stats-title">
<div class="view-head"><span class="eyebrow">Website only</span><h1 class="view-title" id="stats-title">Visits and activity</h1><p class="lede">Who opened the guide and what they did: visits, tabs, villas looked at, maps, photos, shares, likes and notes.</p></div>
<div id="stats-body"><p class="note">Open the guide's website to see the stats.</p></div>
</section>`
}
// links: values that have their own address (#<list>/<value>, e.g. #stay/liked), so a filtered list can be shared
// attrs: e.g. data-when="tier:adult weed" shows the row only while the tier row is on one of those (src/app.js)
function chipRow(listId, group, items, label, links = [], after = '', attrs = '') {
  return `<div class="chips" role="toolbar" aria-label="${esc(label)}"${attrs}>${items.map(([v, t], i) => `<button class="chip" type="button" data-group="${group}" data-value="${v}"${links.includes(v) ? ' data-link' : ''} aria-pressed="${i === 0}">${esc(t)} <span class="n"></span></button>`).join('')}${after}</div>`
}
const shareListBtn = `<button class="chip share-list js-only" type="button" data-share-list hidden>${icon('share')}Share</button>`
function eventsView(mode) {
  const intro = extra.eventsIntro || 'Phuket’s scene is mostly beach clubs. For darker, Berlin-style raves, Koh Phangan is the place: a short flight to Samui and a 30-minute boat.'
  return `<section class="view" id="events" aria-labelledby="events-title">
<div class="view-head"><span class="eyebrow">${TRIP_LABEL.long} · underground first</span><h1 class="view-title" id="events-title">Music & raves</h1><p class="lede">${esc(intro)}</p></div>
${extra.eventsCallout ? `<div class="callout"><h3>${esc(extra.eventsCallout.title)}</h3>${(extra.eventsCallout.groups || [{ items: extra.eventsCallout.items }]).map((g) => `${g.title ? `<h4 class="callout-sub">${esc(g.title)}</h4>` : ''}<ul>${g.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</div>` : ''}
<div class="toolbar" data-toolbar="events">
${chipRow('events', 'f', [['all', 'All'], ['in', 'In my dates'], ['pick', 'Top picks'], ['recurring', 'Weekly & clubs'], ['dated', 'One-off events'], ['saved', 'Saved']], 'Filter events', ['saved'], shareListBtn)}
${chipRow('events', 'phase', [['all', 'All my days'], ...TRIP.phases.map((p) => [p.id, `${p.label} · ${phaseRange(p)}`])], 'Filter by part of the trip')}
${chipRow('events', 'where', [['all', 'Everywhere'], ['phuket', 'Phuket & Natai'], ['koh-phangan', 'Koh Phangan'], ...(events.some((e) => whereOf(e) === 'bangkok') ? [['bangkok', 'Bangkok']] : []), ['other', 'Other islands']], 'Filter by place')}
<input class="search" type="search" id="events-search" placeholder="Search events, venues, genres" aria-label="Search events">
</div>
<div class="list" data-list="events">${eventsSorted.map((e) => eventCard(e, mode)).join('\n')}</div>
<p class="empty" data-empty="events" hidden>No events match these filters.</p>
${extra.eventsFooter ? `<div class="callout sun"><h3>${esc(extra.eventsFooter.title)}</h3><ul>${extra.eventsFooter.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
</section>`
}
// a club, a party series or a festival (Places → Clubs & festivals): the music, the door, the nights, how underground it
// is, and its nights during the trip (each opens its card in Music)
const CLUB_KIND = { club: 'Club', 'party-series': 'Party series', festival: 'Festival' }
const nightsOf = (e) => { const d = (e.dates || []).filter(inTrip).sort(); return d.length ? d.map((x) => dowOf(x) + ' ' + Number(x.slice(8, 10))).join(', ') + ' Jan' : e.recurrence || e.timeText || '' }
function clubCard(c, mode) {
  const score = Math.max(1, Math.min(5, c.undergroundScore || 1))
  const evs = (c.events || []).map((id) => events.find((e) => e.id === id)).filter(Boolean)
  // no photo of its own: the photo of one of its nights
  const img = ['clubs:' + c.id, ...evs.map((e) => 'events:' + e.id)].find((k) => images[k]) || 'clubs:' + c.id
  const kind = CLUB_KIND[c.kind] || 'Club'
  const drive = driveText('cl:' + c.id) || evs.map((e) => driveText('ev:' + e.id)).find(Boolean) || ''
  return `<article class="card" id="cl-${esc(c.id)}" data-name="${esc(c.name)}" data-kind="Club" data-tier="${BKK.includes(c.area) ? 'club bangkok' : 'club'}" data-dur="evening" data-text="${textOf(c.name, c.music, c.island, areaName(c.area), evs.map((e) => e.name))}">
${imgTag(img, c.name, mode, '♪')}<div class="tag-top"><span class="pill hot">${kind}</span></div></div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(c.name)}</h2><p class="subtitle">${esc([areaName(c.area) || c.island, kind].filter(has).join(' · '))}</p></div></div>
<div class="meter-row"><span class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= score ? 'on' : ''}"></i>`).join('')}</span>Underground ${score}/5</div>
<p class="desc">${esc(c.description)}</p>
${facts([['Music', c.music], ['Nights', c.openText], ['Door', c.door], ['Sound', c.sound], ['Size', c.size], ['By car', drive]])}
${evs.length ? `<div class="club-evs"><h3>During the trip</h3><ul>${evs.map((e) => `<li><a href="#ev-${esc(e.id)}">${esc(e.name)}</a> <span>· ${esc(nightsOf(e))}</span></li>`).join('')}</ul></div>` : ''}
${moreBlock('Getting there, tips & links', c.tips, c.links, [['Getting there', c.gettingThere]])}
${actionRow({ item: c })}
</div></article>`
}
// a card of topics that fold open, first under its tab
function basicsCard(id, title, topics, attrs) {
  if (!topics.length) return ''
  return `<article class="card basics" id="${id}" data-name="${esc(title)}" data-kind="Place" ${attrs} data-dur="" data-text="${textOf(title, topics.map((x) => x.title + ' ' + x.text))}">
<div class="body"><h2 class="card-title">${esc(title)}</h2>
<p class="desc">Tap a topic to open it.</p>
${topics.map((x) => `<details class="more"><summary>${esc(x.title)}</summary><p class="desc">${esc(x.text)}</p>${linksHtml(x.links)}</details>`).join('\n')}
</div></article>`
}
// Places → Bangkok, first card: getting there and around, where to stay, safety
const bangkokBasics = () => basicsCard('bkk-basics', 'Bangkok basics', bangkok.essentials || [], 'data-tier="bangkok"')
// Places → 18+ and Weed, first cards: the 18+ basics (under 18+), then the weed basics with what a gram costs in each place
const adultBasics = () => basicsCard('adult-basics', '18+ basics', (adult.basics || {}).adult || [], 'data-tier="adult" data-only="tier" data-where="phuket islands bangkok"')
function weedBasics() {
  const pg = adult.priceGuide || {}
  const where = { phuket: 'on Phuket', 'koh-phangan': 'on Koh Phangan', 'koh-samui': 'on Koh Samui', bangkok: 'in Bangkok' }
  const prices = Object.keys(where).filter((k) => has(pg[k])).map((k) => ({ title: `What a gram costs ${where[k]}`, text: pg[k] }))
  const ranked = { title: 'How the shops are ranked', text: 'Best first in each place: Phuket, Koh Phangan, Koh Samui, Bangkok. The rank adds the Quality and Value scores (each out of 5, from what buyers say on Reddit and in reviews: good weed, and a good price for it), and half a point for a Top pick, the best shops in their area. Equal scores go by the Google rating and how many reviews it has. Almost every shop shows 4.8 to 5.0 on Google, so the stars alone say little.' }
  return basicsCard('weed-basics', 'Weed basics', [...prices, ranked, ...((adult.basics || {}).weed || [])], 'data-tier="adult weed" data-only="tier" data-where="phuket islands bangkok"')
}
// the Places list: Phuket's places, the Bangkok basics (first under Bangkok), the clubs and festivals (most underground
// first), Bangkok's places, then 18+ and Weed
const clubWhere = (c) => (BKK.includes(c.area) ? 2 : ['koh-phangan', 'koh-samui', 'koh-tao'].includes(c.area) ? 1 : 0)
const clubsSorted = clubs.slice().sort((a, b) => (b.undergroundScore || 0) - (a.undergroundScore || 0) || clubWhere(a) - clubWhere(b) || a.name.localeCompare(b.name))
function placesList(mode) {
  const rest = placesSorted.filter((p) => p.tier !== 'adult')
  const home = rest.filter((p) => !BKK.includes(p.area)), bkk = rest.filter((p) => BKK.includes(p.area))
  return [...home.map((p) => placeCard(p, mode)), bangkokBasics(), ...clubsSorted.map((c) => clubCard(c, mode)), ...bkk.map((p) => placeCard(p, mode)),
    adultBasics(), weedBasics(), ...adultSorted.map((p) => adultCard(p, mode))].filter(Boolean).join('\n')
}
function placesView(mode) {
  return `<section class="view" id="places" aria-labelledby="places-title">
<div class="view-head"><span class="eyebrow">Must-see · hidden gems · day trips</span><h1 class="view-title" id="places-title">Places to go</h1><p class="lede">${esc(extra.placesIntro || 'Each place shows how long it takes, the best time to go and what it costs. In January the west-coast sea is calm and clear.')}</p></div>
<div class="toolbar" data-toolbar="places">
${chipRow('places', 'tier', [['all', 'All'], ...(clubs.length ? [['club', 'Clubs & festivals']] : []), ...([...places, ...clubs].some((x) => BKK.includes(x.area) && x.tier !== 'adult') ? [['bangkok', 'Bangkok']] : []), ...(adultItems.length ? [['adult', '18+']] : []), ...(adultItems.some((p) => p.category === 'cannabis') ? [['weed', 'Weed']] : []), ['must-see', 'Must-see'], ['hidden-gem', 'Hidden gems'], ['day-trip', 'Day trips'], ...(places.some((x) => x.tier === 'tour') ? [['tour', 'Boat tours']] : []), ...(places.some((x) => x.tier === 'pier') ? [['pier', 'Piers & ferries']] : []), ['food', 'Food'], ['saved', 'Saved']], 'Filter places', ['saved'], shareListBtn)}
${chipRow('places', 'dur', [['all', 'Any length'], ['short', 'Up to 3 hours'], ['half', 'Half day'], ['full', 'Full day +'], ['evening', 'Evening']], 'Filter by time needed', [], '', adultItems.length ? ' data-when="tier:!adult weed"' : '')}
${adultItems.length ? chipRow('places', 'where', [['all', 'Everywhere'], ...Object.keys(WHERE_NAME).filter((k) => adultItems.some((p) => adultWhere(p) === k)).map((k) => [k, WHERE_NAME[k]])], 'Filter by place', [], '', ' data-when="tier:adult weed" hidden') : ''}
<input class="search" type="search" id="places-search" placeholder="Search beaches, temples, markets…" aria-label="Search places">
</div>
<div class="list" data-list="places">${placesList(mode)}</div>
<p class="empty" data-empty="places" hidden>No places match these filters.</p>
</section>`
}
function staticMapSvg() {
  if (!areaGeo || !land) return ''
  const [minX, minY, maxX, maxY] = [98.24, 7.74, 98.48, 8.35]
  const k = Math.cos((8 * Math.PI) / 180)
  const W = 400, H = Math.round((W * (maxY - minY)) / ((maxX - minX) * k))
  const px = ([x, y]) => [((x - minX) / (maxX - minX)) * W, ((maxY - y) / (maxY - minY)) * H]
  const ring = (r) => 'M' + r.map((c) => px(c).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z'
  const pathOf = (g) => (g.type === 'Polygon' ? g.coordinates.map(ring).join('') : g.coordinates.flatMap((p) => p.map(ring)).join(''))
  const inView = (f) => { const b = turf.bbox(f); return b[2] > minX && b[0] < maxX && b[3] > minY && b[1] < maxY }
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of Phuket with the areas outlined"><rect width="${W}" height="${H}" fill="var(--map-sea)"/>`
  for (const f of land.features.filter(inView)) s += `<path d="${pathOf(f.geometry)}" fill="var(--map-land)" stroke="var(--map-line)" stroke-width="0.6"/>`
  for (const f of areaGeo.features) s += `<path d="${pathOf(f.geometry)}" fill="${AREA_COLORS[f.properties.id] || '#999'}" fill-opacity="0.5" stroke="${AREA_COLORS[f.properties.id] || '#999'}" stroke-width="0.8"/>`
  for (const a of areasSorted) {
    const lp = labelPoint(a); if (!lp) continue
    const [x, y] = px([lp[1], lp[0]])
    s += `<text class="lbl" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${esc(shortName(a))}</text>`
  }
  return s + '</svg>'
}
const shortName = (a) => String(a.name || a.id).replace(/ ?\(.*\)/, '').replace(/ Beach$/, '').replace(/ & .*/, '').replace(/^Phuket Town.*/, 'Phuket Town')
function labelPoint(a) {
  const f = areaGeo && areaGeo.features.find((x) => x.properties.id === a.id)
  if (!f) return a.lat != null ? [a.lat, a.lng] : null
  const c = turf.centerOfMass(f)
  const pt = turf.booleanPointInPolygon(c, f) ? c : turf.pointOnFeature(f)
  return [pt.geometry.coordinates[1], pt.geometry.coordinates[0]]
}
function areasView(mode, opts) {
  const tagCounts = {}
  areas.forEach((a) => (a.bestFor || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1 }))
  const tags = BEST_TAGS.filter((t) => tagCounts[t])
  const kmlNote = opts.kml ? `<p class="note">Want these areas inside Google Maps? <a href="phuket-areas.kml" download>Download the KML file</a>, then on a computer open Google My Maps → Create a new map → Import. The map then shows in the Google Maps app under Saved → Maps.</p>` : ''
  return `<section class="view" id="areas" aria-labelledby="areas-title">
<div class="view-head"><span class="eyebrow">Where to base yourself</span><h1 class="view-title" id="areas-title">Areas of Phuket</h1><p class="lede">${esc(extra.areasIntro || 'Tap an area on the map to read about it. Pins show events, places, hotels and money changers.')}</p></div>
<div class="mapbox">
<div id="map" aria-label="Map of Phuket areas"></div>
<div class="basebar" role="group" aria-label="Map style" hidden><button type="button" data-base="streets" aria-pressed="false">Streets</button><button type="button" data-base="satellite" aria-pressed="false">Satellite</button><button type="button" data-base="simple" aria-pressed="false">Offline</button></div>
<div class="maptools"><button class="icon-btn" type="button" id="map-full" aria-label="Full screen" aria-pressed="false">${icon('expand', 'class="i-enter"')}${icon('shrink', 'class="i-exit"')}</button><button class="icon-btn" type="button" id="map-zoom-in" aria-label="Zoom in">${icon('plus')}</button><button class="icon-btn" type="button" id="map-zoom-out" aria-label="Zoom out">${icon('minus')}</button><button class="icon-btn" type="button" id="map-fit" aria-label="Show all of Phuket">${icon('fit')}</button><button class="icon-btn" type="button" id="map-locate" aria-label="Show my location">${icon('locate')}</button></div>
<div class="layerbar" role="group" aria-label="Show on map">
<button class="chip" type="button" data-layer="areas" aria-pressed="true"><i class="swatch-outline"></i>Areas</button>
<button class="chip" type="button" data-layer="event" aria-pressed="true"><i style="background:var(--pulse)"></i>Music</button>
<button class="chip" type="button" data-layer="place gem" aria-pressed="true"><i style="background:var(--sea)"></i><i style="background:var(--leaf)"></i>Places</button>
<button class="chip" type="button" data-layer="hotel" aria-pressed="true"><i style="background:var(--violet)"></i>Villas</button>
${adultItems.some((p) => p.category === 'cannabis') ? '<button class="chip" type="button" data-layer="weed" aria-pressed="true"><i style="background:var(--weed)"></i>Weed</button>\n' : ''}<button class="chip" type="button" data-layer="money" aria-pressed="false"><i style="background:var(--sun)"></i>Money</button>${adultItems.some((p) => p.category !== 'cannabis') ? '\n<button class="chip" type="button" data-layer="adult" aria-pressed="false"><i style="background:var(--orchid)"></i>18+</button>' : ''}
</div>
</div>
<p class="map-credit js-only" id="map-credit"></p>
<div class="staticmap">${staticMapSvg()}</div>
${(extra.areasRecommendation || []).length || has(areasDoc.recommendation) ? `<div class="reco"><span class="eyebrow">For you</span><h3>Best bases for this trip</h3>${(extra.areasRecommendation || [areasDoc.recommendation]).map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
${kmlNote}
<div class="toolbar" data-toolbar="areas">
${chipRow('areas', 'best', [['all', 'All areas'], ...tags.map((t) => [t, cap(t.replace(/-/g, ' '))])], 'Filter areas by what they are best for')}
</div>
<div class="list" data-list="areas">${areasSorted.map((a) => areaCard(a, mode)).join('\n')}</div>
<p class="empty" data-empty="areas" hidden>No areas match.</p>
</section>`
}
// Our villas, at the top of the Stay tab: the dates, check-in and checkout, and the way there
function ourVillas(mode) {
  if (!BASES.length) return ''
  const card = (b) => {
    const h = b.h, im = images['hotels:' + h.id]
    const src = im && fs.existsSync(P(im.file)) ? (mode === 'inline' ? 'data:image/webp;base64,' + fs.readFileSync(P(im.file)).toString('base64') : 'img/' + path.basename(im.file)) : ''
    const ll = `${+h.lat},${+h.lng}`
    // the price we paid (TRIP.bases → paid) goes under the photo and the dates, across the whole card
    return `<article class="base-card" id="base-${b.key}">${src ? `<a class="base-thumb" href="#ht-${esc(h.id)}" tabindex="-1" aria-hidden="true"><img src="${src}" alt="" loading="lazy"></a>` : ''}<div class="base-body">
<span class="eyebrow">${esc(b.short)} · ${plural(b.nights, 'night')}</span><h3><a href="#ht-${esc(h.id)}">${esc(h.name)}</a></h3>
<p class="base-dates"><b>${esc(dayLabel(b.from))}</b> check-in from ${b.checkIn} → <b>${esc(dayLabel(b.to))}</b> checkout by ${b.checkOut}</p>
<p class="note">${esc(areaName(h.area))}${DRIVE['airport'] && DRIVE['airport'][b.key] ? ` · the airport ${mins(DRIVE['airport'][b.key].min)} by car (no traffic)` : ''}</p></div>
${b.paid ? paidBox(b.paid, `Paid · ${plural(b.nights, 'night')} · ${b.paid.guests} guests`) : ''}
<div class="actions"><a class="btn primary" href="#ht-${esc(h.id)}">See the villa</a><a class="btn" href="${gmaps(ll)}" target="_blank" rel="noopener">${icon('pin')}Map</a><a class="btn" href="${gdir(h.lat, h.lng)}" target="_blank" rel="noopener" data-dir="${ll}" data-dir-name="${esc('the ' + b.short)}" data-dir-skip="${b.key}">${icon('route')}Directions</a></div></article>`
  }
  // both villas together: the whole stay and each person's share of it
  const total = PAID_ALL ? `<div class="base-total" id="our-villas-total">${paidBox(PAID_ALL, `Both villas · ${plural(PAID_ALL.nights, 'night')} · ${PAID_ALL.guests} guests`, ['stay', 'pp'])}</div>` : ''
  const p = BASES.find((b) => b.paid)?.paid
  const sig = (x) => Number(x.toPrecision(3))
  const rateNote = !p ? '' : `We paid in ${p.currency}. ` +
    (!paidUsd(p) ? `The baht are estimates: 1 ${p.currency} ≈ ${p.thbPerUnit} THB. ` : p.pegged ? `The dollars use the fixed rate, 1 USD = ${p.perUsd} ${p.currency}. ` : `The dollars are estimates: 1 USD ≈ ${sig(p.perUsd)} ${p.currency}. `) +
    (amdRate ? `The drams are estimates: 1 ${p.currency} ≈ ${sig(p.thbPerUnit * amdRate.perThb).toLocaleString('en-US')} AMD (${p.rateDate}). ` : '')
  return `<div class="stack" id="our-villas"><h2 class="block-title">Our villas <small>booked</small></h2>${BASES.map(card).join('')}${total}<p class="note">${esc(rateNote)}The pins are Airbnb's approximate ones until the hosts send the exact addresses, so directions may end a few hundred metres off. Directions anywhere in the guide can start from either villa.</p></div>`
}
function stayView(mode) {
  const zonesUsed = ZONES.filter(([z]) => hotels.some((h) => zoneOf(h) === z))
  // only the price chips that match a card (the villa list has no boutique hotels)
  const tiersUsed = [['luxury', 'Luxury'], ['boutique', 'Boutique'], ['mid-range', 'Mid-range'], ['budget', 'Budget']].filter(([t]) => hotels.some((h) => (h.tier === 'hostel' ? 'budget' : h.tier) === t))
  return `<section class="view" id="stay" aria-labelledby="stay-title">
<div class="view-head"><span class="eyebrow">8 guests · 8–18 Jan</span><h1 class="view-title" id="stay-title">Where to stay</h1><p class="lede">${esc(extra.stayIntro || 'Add your own bookings, and browse hotels picked for this trip, from Circoloco’s beach to Old Town.')}</p></div>
${ourVillas(mode)}
<div class="stack"><h2 class="block-title">My hotels</h2>
<div class="mine" id="my-hotels"><p class="note">Turn on JavaScript to save your own hotels here.</p></div>
<p class="js-only"><button class="btn" type="button" id="my-hotel-open" aria-expanded="false" aria-controls="my-hotel-form">${icon('plus')}Add hotel</button></p>
<form class="myform js-only" id="my-hotel-form" autocomplete="off" hidden>
<label for="mh-name">Hotel name<input id="mh-name" name="name" required placeholder="e.g. Baba Beach Club Natai"></label>
<label for="mh-link">Google Maps link (optional)<input id="mh-link" name="link" type="url" inputmode="url" placeholder="https://maps.app.goo.gl/…"></label>
<div class="row2"><label for="mh-dates">Dates<input id="mh-dates" name="dates" placeholder="8–11 Jan"></label><label for="mh-notes">Notes<input id="mh-notes" name="notes" placeholder="Booking no., check-in time"></label></div>
<div class="actions"><button class="btn primary" type="submit">${icon('plus')}Save hotel</button><button class="btn" type="button" id="my-hotel-cancel">Cancel</button></div>
</form></div>
<details class="acc picks-acc js-only" id="group-picks-box" hidden><summary><span>Group picks <small id="group-picks-n"></small></span></summary><div class="acc-body">
<p class="note">Villas the group liked, most likes first. Tap Like or Skip on a card to vote, and the arrows to move a villa up or down the list for everyone.</p>
<ol class="picks" id="group-picks"></ol></div></details>
<h2 class="block-title">Villas for the group <small>${hotels.length} places</small></h2>
<p class="js-only pins-note" id="pins-note" hidden><span>Some villas were moved by hand and keep their place.</span> <button class="btn" type="button" id="unpin-all">Reset all positions</button></p>
<div class="toolbar" data-toolbar="stay">
${chipRow('stay', 'pick', [['all', 'All'], ...(buildName === 'standalone' ? [['liked', 'Liked']] : []), ['saved', 'Saved']], 'Show the liked or saved villas', ['liked', 'saved'], shareListBtn)}
${chipRow('stay', 'tier', [['all', 'All'], ...tiersUsed], 'Filter villas by price')}
${chipRow('stay', 'zone', [['all', 'Everywhere'], ...zonesUsed], 'Filter hotels by area')}
${chipRow('stay', 'beds', [['all', 'Any beds'], ...BED_CHIPS.filter(([k]) => hotels.some((h) => bedFit(h)?.key === k))], 'Filter villas by beds')}
</div>
<div class="list" data-list="stay">${hotelsSorted.map((h) => hotelCard(h, mode)).join('\n')}</div>
<p class="empty" data-empty="stay" hidden>No villas match these filters.</p>
<div class="stack js-only" id="hidden-stays" hidden><h2 class="block-title">Hidden villas <small id="hidden-stays-n"></small></h2>
<p class="note">${buildName === 'standalone' ? 'Hidden for the whole group. Tap Show again to bring a villa back on the list and the map for everyone.' : 'Hidden on this phone only. Tap Show again to put a villa back on the list and the map.'}</p>
<div class="mine" id="hidden-stays-list"></div></div>
</section>`
}
function moneyView(mode) {
  const best = brands[0]
  const mid = midRates()
  const curOpts = mid.map((m) => `<option value="${esc(m.currency)}">${esc(m.currency)}</option>`).join('')
  const listBlock = (title, arr, cls = '') => (arr || []).filter(has).length ? `<div class="callout ${cls}"><h3>${esc(title)}</h3><ul>${arr.filter(has).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''
  const atm = money.atm || {}
  return `<section class="view" id="money" aria-labelledby="money-title">
<div class="view-head"><span class="eyebrow"><a href="#info">Essentials</a> · Baht ฿ · exchange · ATMs</span><h1 class="view-title" id="money-title">Money</h1><p class="lede">${esc(extra.moneyIntro || 'Cash is king at markets, taxis and small bars. Change cash at a money changer, not at the airport or your hotel.')}</p></div>
${best ? `<div class="verdict"><span class="eyebrow">Best place to change money</span><div class="brand-row"><span class="sign${has(best.branding && best.branding.primaryColor) ? '' : ' plain'}" style="${has(best.branding && best.branding.primaryColor) ? signColors(best.branding) : ''}" aria-hidden="true">${esc(best.branding?.logoText || best.name)}</span><h3>${esc(best.name)}</h3></div><p>${esc(money.verdict)}</p><p><a href="#mx-${esc(best.id)}">Branches and details</a></p></div>` : ''}
${mid.length ? `<div class="converter js-only" id="converter"><span class="eyebrow">Quick converter</span>
<label class="note" for="conv-amount" id="conv-from-label">You give</label>
<div class="conv-row"><input id="conv-amount" type="number" inputmode="decimal" value="${mid[0].currency === 'AMD' ? 10000 : 100}" min="0" step="any"><select id="conv-cur" aria-label="Currency">${curOpts}</select></div>
<div class="conv-row"><div class="conv-out num" id="conv-out" aria-live="polite">—</div><button class="icon-btn" type="button" id="conv-dir" aria-label="Switch direction">${icon('swap')}</button></div>
<p class="note" id="conv-note"></p></div>` : ''}
${amdRate ? `<p class="note">Dram amounts in this guide use ${amdRate.perThb} AMD per baht (mid-market, ${esc(amdRate.date)}).</p>` : ''}
<div class="list">${brands.map((b) => brandCard(b, mode)).join('\n')}</div>
${atm.feeText || (atm.tips || []).length ? `<div class="callout"><h3>ATMs</h3>${has(atm.feeText) ? `<p>${esc(atm.feeText)}</p>` : ''}${(atm.cheapest || []).length ? `<p><b>Cheapest:</b> ${esc(atm.cheapest.join('; '))}</p>` : ''}${(atm.tips || []).length ? `<ul>${atm.tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : ''}
${listBlock('Cards', money.cards)}
${listBlock('Tips', money.tips, 'sun')}
${listBlock('Avoid', money.avoid, 'alert')}
${(money.sources || []).length ? `<details class="more"><summary>Sources</summary><p class="sources">${money.sources.filter(isUrl).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>`).join(' · ')}</p></details>` : ''}
</section>`
}
function infoView() {
  const nums = (info.emergencyNumbers || []).map((n) => `<a href="tel:${esc(String(n.number).replace(/[^0-9+]/g, ''))}"><b class="${String(n.number).length > 6 ? 'long' : ''}">${esc(n.number)}</b><span>${esc(n.label)}${has(n.note) ? ' · ' + esc(n.note) : ''}</span></a>`).join('')
  const secs = (info.sections || []).map((s, i) => `<details class="acc"${i === 0 ? ' open' : ''} id="info-${esc(s.id)}"><summary>${esc(s.title)}</summary><div class="acc-body">${(s.items || []).map((it) => `<div class="fact"><h4>${esc(it.title)}${it.critical ? ' <span class="pill bad">Must know</span>' : ''}</h4><p>${esc(it.text)}</p>${linksHtml(it.links)}</div>`).join('')}</div></details>`).join('')
  const phrases = (info.phrases || []).map((p) => `<div class="phrase"><b>${esc(p.en)}</b><span class="say">${esc(p.say)}</span><span class="th" lang="th">${esc(p.thai)}</span></div>`).join('')
  return `<section class="view" id="info" aria-labelledby="info-title">
<div class="view-head"><span class="eyebrow">Checked ${esc(info.asOf || 'Oct 2026')}</span><h1 class="view-title" id="info-title">Essentials</h1><p class="lede">Money, entry rules, getting around, boats and islands, safety and a few words of Thai.</p></div>
<div class="tiles info-tiles"><a class="tile" href="#money">${icon('money')}<b>Money</b><span>${esc(brands[0] ? "Best rates: " + brands[0].name : "Exchange & ATMs")} · converter</span></a>${apps.length ? `<a class="tile" href="#apps">${icon('apps')}<b>Apps to install</b><span>${esc(plural(apps.filter((a) => a.priority === 'must').length, 'app') + ' before you fly')}</span></a>` : ''}</div>
${nums ? `<h2 class="block-title">Emergency numbers</h2><div class="sos">${nums}</div>` : ''}
<div class="stack">${secs}</div>
${phrases ? `<h2 class="block-title">Useful Thai <small>men end with “krap”, women with “ka”</small></h2><div class="phrases">${phrases}</div>` : ''}
${(info.sources || []).length ? `<details class="more"><summary>Sources</summary><p class="sources">${info.sources.filter(isUrl).map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60))}</a>`).join(' · ')}</p></details>` : ''}
</section>`
}

// ---------- apps ----------
const APP_CAT = { rides: 'Getting around', travel: 'Ferries, flights and airport', maps: 'Maps and language', phone: 'Phone and internet', chat: 'Chat', money: 'Money and payments', safety: 'Safety and health', food: 'Food and delivery', events: 'Parties and tickets', bookings: 'Hotels and tours' }
const APP_PRI = [
  ['must', 'Install before you fly', 'Set these up at home, while your home SIM still gets the SMS codes. Tick each one when it is ready.'],
  ['useful', 'Good to have', ''],
  ['optional', 'Only for some plans', ''],
]
const APP_TONE = { rides: 'sea', travel: 'sea', maps: 'violet', phone: 'violet', chat: 'violet', safety: 'alert', money: 'sun', food: 'leaf', bookings: 'leaf', events: 'pulse' }
const appRank = (a) => [APP_PRI.findIndex((p) => p[0] === a.priority), Object.keys(APP_CAT).indexOf(a.category)]
const appsSorted = apps.slice().sort((a, b) => { const [pa, ca] = appRank(a), [pb, cb] = appRank(b); return pa - pb || ca - cb })
// one letter, or two for names like 'Google Maps' that would otherwise all read 'G'
const appMark = (a) => {
  if (has(a.mark)) return a.mark
  const w = String(a.name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/)
  return (w.length > 1 && /^(google|thailand|thai|bangkok|airports?)$/i.test(w[0]) ? w[0][0] + w[1][0] : w[0][0]).toUpperCase()
}
function appCard(a) {
  const btns = [
    isUrl(a.appStore) ? `<a class="btn" data-store="ios" href="${esc(a.appStore)}" target="_blank" rel="noopener">${icon('download')}App Store</a>` : '',
    isUrl(a.googlePlay) ? `<a class="btn" data-store="android" href="${esc(a.googlePlay)}" target="_blank" rel="noopener">${icon('download')}Google Play</a>` : '',
    isUrl(a.website) ? `<a class="btn" href="${esc(a.website)}" target="_blank" rel="noopener">${icon('globe')}Website</a>` : '',
  ].join('')
  return `<article class="card app-card" id="app-${esc(a.id)}" data-cat="${esc(a.category)}" data-name="${esc(a.name)}" data-kind="App">
<div class="body">
<div class="app-top"><span class="app-mark tone-${APP_TONE[a.category] || 'sea'}" aria-hidden="true">${esc(appMark(a))}</span><div class="app-name"><h3 class="card-title">${esc(a.name)}</h3><p class="subtitle">${esc(APP_CAT[a.category] || '')}</p></div>${a.priority === 'must' ? `<label class="app-done js-only"><input type="checkbox" data-app-done="${esc(a.id)}"><span>Ready</span></label>` : ''}</div>
<p class="desc">${esc(a.what)}</p>
${facts([['At home', a.setup], ['Works', a.where], ['Cost', a.cost]])}
${moreBlock('Tips & help', a.tips, a.links)}
${btns ? `<div class="actions">${btns}</div>` : ''}
</div></article>`
}
function appsView() {
  if (!apps.length) return ''
  const groups = APP_PRI.map(([p, title, note]) => {
    const list = appsSorted.filter((a) => a.priority === p)
    if (!list.length) return ''
    return `<h2 class="block-title">${esc(title)} <small>${plural(list.length, 'app')}</small></h2>${note ? `<p class="note app-note">${esc(note)}</p>` : ''}<div class="list">${list.map(appCard).join('')}</div>`
  }).join('\n')
  return `<section class="view" id="apps" aria-labelledby="apps-title">
<div class="view-head"><span class="eyebrow">${(appsDoc.unverified || []).length ? 'Not fully fact-checked yet' : 'Checked ' + esc(appsDoc.asOf || 'Oct 2026')}</span><h1 class="view-title" id="apps-title">Apps and services</h1><p class="lede">${esc(appsDoc.intro || 'What to install for this trip, and what each app is for.')}</p><p class="app-progress js-only" id="app-progress" aria-live="polite"></p></div>
${groups}
</section>`
}

// the top bar countdown, rendered now (build time) so the first paint shows the clock, not a text chip; src/app.js keeps
// it ticking. Only before the trip; during/after, the plain pill (app.js then shows "Day n" / "Trip done")
const TRIP_START_MS = Date.parse(TRIP.start + 'T00:00:00+07:00')
const beforeTrip = Date.now() < TRIP_START_MS
function topClockHtml() {
  const t = Math.floor(Math.max(0, TRIP_START_MS - Date.now()) / 1000)
  const parts = [['d', Math.floor(t / 86400), 'Days'], ['h', Math.floor(t / 3600) % 24, 'Hrs'], ['m', Math.floor(t / 60) % 60, 'Min'], ['s', t % 60, 'Sec']]
  const flaps = (v) => [...String(v).padStart(2, '0')].map((c) => `<span class="flap"><span class="f-face"><b>${c}</b></span></span>`).join('')
  return `<span class="tb-board" aria-hidden="true">${parts.map(([k, v, label], i) => `${i ? '<span class="pc-sep">:</span>' : ''}<span class="tb-unit pc-${k}"><span class="pc-digits" data-cd="${k}">${flaps(v)}</span><small>${label}</small></span>`).join('')}</span>`
}
function chrome(body) {
  const tab = (id, ic, label) => `<li><a href="#${id}">${icon(ic)}<span>${label}</span></a></li>`
  return `<header class="topbar"><div class="topbar-in">
<a class="brand" href="#home"><span class="brand-mark">HKT</span><span class="brand-text"><b>Phuket</b><small>${TRIP_LABEL.short}</small></span></a>
${beforeTrip ? `<a class="status-pill live" id="trip-status" href="#home" aria-label="counting down to the trip">${topClockHtml()}</a>` : '<a class="status-pill" id="trip-status" href="#home">Jan 2027</a>'}
<a class="icon-btn" href="#info" aria-label="Essentials">${icon('info')}</a>
<button class="icon-btn js-only" type="button" id="theme-btn" aria-label="Switch light or dark">${icon('theme')}</button>
</div></header>
<main id="main">${body}</main>
<button class="back-to-map js-only" id="back-to-map" type="button" hidden>${icon('back')}Back to map</button>
<button class="back-to-map js-only" id="back-to-card" type="button" hidden>${icon('back')}<span>Back to villa</span></button>
<dialog class="vote-dialog dir-dialog" id="dir-dialog" aria-labelledby="dir-title"><form method="dialog"><h2 id="dir-title">Directions</h2><p class="vote-what" id="dir-what"></p><div class="dir-options" id="dir-options"></div><div class="actions"><button class="btn" type="submit">Cancel</button></div></form></dialog>
${buildName === 'standalone' ? `<div class="gate" id="gate" hidden><form class="gate-box" id="gate-form"><h1 class="gate-title">DU OV ES?</h1><p class="gate-hint">PAROLY IM ANUNNA U HING HAT HING</p>
<label for="gate-name">Name<input id="gate-name" name="username" maxlength="40" autocomplete="username" autocapitalize="words" required></label>
<label for="gate-pass">Password<input id="gate-pass" name="password" type="password" maxlength="80" autocomplete="current-password" autocapitalize="none" required></label>
<p class="gate-err" id="gate-err" role="alert"></p><button class="btn primary" type="submit">Enter</button></form></div>
` : ''}<dialog class="vote-dialog" id="vote-dialog" aria-labelledby="vote-title"><form id="vote-form" method="dialog">
<h2 id="vote-title">Like</h2><p class="vote-what" id="vote-what"></p>
<label for="vote-name">Your name<input id="vote-name" name="name" maxlength="40" autocomplete="given-name" required placeholder="e.g. Ani"></label>
<p class="note" id="vote-note">Everyone with the guide sees the names. One vote per name.</p>
<div class="actions"><button class="btn primary" type="submit" data-vote-save>Save vote</button><button class="btn" type="button" data-vote-cancel>Cancel</button></div>
</form></dialog>
<nav class="tabbar" aria-label="Sections"><ul>
${tab('home', 'trip', 'Trip')}${tab('events', 'events', 'Music')}${tab('places', 'places', 'Places')}${tab('areas', 'areas', 'Areas')}${tab('stay', 'stay', 'Stay')}${buildName === 'standalone' ? tab('notes', 'note', 'Notes') + tab('spend', 'wallet', 'Spend') : tab('money', 'money', 'Money')}
</ul></nav>`
}

// ---------- offline satellite tiles (downloaded by tools/sat-tiles.mjs) ----------
const sat = readJSON('assets/sat/coverage.json', null)
const satFiles = []
if (sat) {
  const seen = new Set()
  for (const [z, rs] of Object.entries(sat.ranges)) for (const [x0, x1, y0, y1] of rs) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) seen.add(`${z}/${x}/${y}.webp`)
  satFiles.push(...seen)
  const missing = satFiles.filter((f) => !fs.existsSync(P('assets/sat', f)))
  if (missing.length) throw new Error(`${missing.length} offline satellite tiles are missing (first: assets/sat/${missing[0]}). Run npm run sat.`)
}
// the single file carries the tiles inside it, in their own data block that the app reads only when Satellite is on
const satInline = () => JSON.stringify(Object.fromEntries(satFiles.map((f) => [f.replace(/\.webp$/, ''), 'data:image/webp;base64,' + fs.readFileSync(P('assets/sat', f)).toString('base64')])))

// ---------- client data ----------
const usedKey = (k) => {
  const [kind, id] = k.split(':')
  const list = { events, places, areas, hotels, money: brands }[kind]
  return !!(list && list.some((x) => x.id === id))
}
function clientData(build) {
  const pts = []
  const add = (t, k, it, id, name, sub, card) => {
    if (lowConf(it) || !Number.isFinite(+it.lat) || !Number.isFinite(+it.lng)) return
    const d = dirOf(it)
    const pt = { t, k, id, name, sub: amd.text(sub), lat: +(+it.lat).toFixed(6), lng: +(+it.lng).toFixed(6), q: it.gmapsQuery || name, card }
    if (it.placeId) pt.pid = it.placeId
    if (!d) pt.nodir = 1
    else if (d.lat !== it.lat || d.lng !== it.lng) Object.assign(pt, { dlat: d.lat, dlng: d.lng, dlabel: d.label })
    pts.push(pt)
  }
  // popups stay short on small phones: compact dates, or only the first clause of the pattern
  const popDates = (ds) => (ds.length <= 2 ? ds.map(dayLabel).join(', ') : ds.map((d) => Number(d.slice(8, 10))).join(', ') + ' Jan')
  const popPattern = (r) => {
    const first = String(r || '').split(/;|\.\s/)[0].trim()
    return first.length <= 80 ? first : first.slice(0, 78).replace(/\s+\S*$/, '') + '…'
  }
  // the venue name only: the pin already shows where it is
  const popVenue = (v) => String(v || '').split(',')[0].trim()
  events.forEach((e) => { const ds = (e.dates || []).filter(inTrip); add('event', 'event', e, e.id, e.name, [popVenue(e.venue), ds.length ? popDates(ds) : popPattern(e.recurrence)].filter(has).join(' · '), 'ev-' + e.id) })
  places.forEach((p) => p.tier === 'adult'
    ? add('place', p.category === 'cannabis' ? 'weed' : 'adult', p, p.id, p.name, [ADULT_KIND[p.category], p.rating ? `${trimNum(p.rating)} on Google` : ''].filter(has).join(' · '), 'pl-' + p.id)
    : add('place', p.tier === 'hidden-gem' ? 'gem' : 'place', p, p.id, p.name, [(TIER[p.tier] || [''])[0], p.tier === 'pier' ? '' : durText(p)].filter(has).join(' · '), 'pl-' + p.id))
  // villas: the tier as the line, and the trip total (priceOf) shown big in the popup
  hotels.forEach((h) => {
    add('hotel', 'hotel', h, h.id, h.name, [HTIER[h.tier], h.beds > 0 ? plural(h.beds, 'bed') : '', h.noRoomsOnTrip].filter(has).join(' · '), 'ht-' + h.id)
    const pt = pts.at(-1), pr = priceOf(h)
    // our booked villas: a pin of their own on the map, always on, with its name and dates
    const bv = baseOfVilla(h.id)
    if (pt && pt.id === h.id && pt.t === 'hotel' && bv) Object.assign(pt, { base: bv.key, baseLabel: `${bv.short} · ${baseRange(bv)}` })
    if (pt && pt.id === h.id && pt.t === 'hotel') {
      // the popup: our booked villas show what we paid (in the currency we paid), its drams and the share per person, kept
      // short with no-break spaces so the buttons stay above the tab bar on a 320 px phone (the card has the breakdown);
      // the others drams first (an estimate), then US dollars and the listing's baht price
      const nb = (x) => String(x).replace(/ /g, ' ')
      if (bv && bv.paid) Object.assign(pt, { price: cash(bv.paid.total, bv.paid.currency), priceNote: 'paid', priceAmd: nb(paidAlt(bv.paid, bv.paid.total)[0]), pricePp: `${nb(cash(bv.paid.perPersonStay, bv.paid.currency))} per person${amdRate ? ' (' + nb(paidAmd(bv.paid, bv.paid.perPersonStay)) + ')' : ''}` })
      else if (pr) Object.assign(pt, amdRate
        ? { price: amd.amount(pr.total), priceNote: `for ${pr.nights} nights`, priceAmd: [usd(pr.total), thb(pr.total)].filter(Boolean).join(' · '), pricePp: `${amd.amount(pr.perPerson)} per person per day` }
        : { price: thb(pr.total), priceNote: `for ${pr.nights} nights`, priceAmd: '', pricePp: `${thb(pr.perPerson)} per person per day` })
      if (isUrl(h.website)) Object.assign(pt, { web: h.website, webLabel: h.websiteLabel || 'Website' })
    }
  })
  brands.forEach((b) => (b.branches || []).forEach((x, i) => add('money', 'money', x, b.id + '-' + i, b.name + ' · ' + x.name, x.hoursText || '', 'mx-' + b.id)))
  const mid = Object.fromEntries(midRates().map((m) => [m.currency, m.thbPerUnit]))
  const best = brands[0]
  const bestRates = best ? Object.fromEntries((best.sampleRates || []).filter((r) => r && r.buyTHB).map((r) => [r.currency, r.buyTHB])) : {}
  return {
    build, trip: TRIP, buildId: build === 'standalone' ? '__BUILD_ID__' : '', // the website's build, see version.json
    // our villas, for Directions (start from either) and the map
    bases: BASES.map((b) => ({ key: b.key, short: b.short, from: b.from, to: b.to, range: `${dayLabel(b.from)} → ${dayLabel(b.to)}`, lat: +b.h.lat, lng: +b.h.lng, card: 'ht-' + b.h.id })),
    areas: areasSorted.map((a) => ({ id: a.id, name: a.name, short: shortName(a), tagline: a.tagline, color: AREA_COLORS[a.id] || '#999', label: labelPoint(a), rank: (areaGeo.features.find((f) => f.properties.id === a.id) || { properties: {} }).properties.km2 || 0, gmapsArea: gmaps(a.gmapsQuery || a.name + ', Phuket', a.placeId) })),
    areaGeo, land, roads, points: pts, offlineUrl: extra.offlineUrl || '',
    precacheCount: 6 + Object.keys(images).filter((k) => usedKey(k) && !(extra.dropImages || []).includes(k) && fs.existsSync(P(images[k].file))).length,
    tiles: {
      streets: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', attr: '', maxNative: 19 },
      satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '', maxNative: 18 },
      // under the Esri satellite layer: shows while Esri tiles load, and on its own offline
      offline: sat && build !== 'artifact' ? { url: build === 'single' ? '' : 'sat/{z}/{x}/{y}.webp', inline: build === 'single', ranges: sat.ranges, minZoom: sat.minZoom, maxZoom: sat.maxZoom, attr: sat.attribution } : null,
    },
    satCount: build === 'standalone' ? satFiles.length : 0,
    // shared votes: only the website has the /api/votes server next to it
    votes: build === 'standalone' ? 'api/votes' : '',
    rates: Object.keys(mid).length ? { mid, best: bestRates, bestName: best ? best.name : '', date: (money.midMarket[0] || {}).date || money.asOf || '', source: (money.midMarket[0] || {}).source ? 'mid-market' : 'mid-market' } : null,
  }
}

// ---------- assets ----------
const fontsMeta = readJSON('assets/fonts/fonts.json', [])
function fontCss() {
  const seen = new Set()
  return fontsMeta.filter((f) => f.subset !== 'latin-ext').filter((f) => {
    // Anuphan is variable: one file serves all weights
    const k = f.family === 'Anuphan' ? f.family + f.subset : f.family + f.weight + f.subset
    if (seen.has(k)) return false
    seen.add(k); return true
  }).map((f) => {
    const data = fs.readFileSync(P('assets/fonts', f.file)).toString('base64')
    const weight = f.family === 'Anuphan' ? '400 600' : f.weight
    return `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${f.unicodeRange}}`
  }).join('\n')
}
const leafletCss = fs.readFileSync(P('node_modules/leaflet/dist/leaflet.css'), 'utf8')
  .replace(/\.leaflet-default-icon-path\s*{[^}]*}/g, '')
  .replace(/\.leaflet-control-layers-toggle\s*{[^}]*}/g, '')
  .replace(/\.leaflet-retina \.leaflet-control-layers-toggle\s*{[^}]*}/g, '')
  .replace(/\.leaflet-touch \.leaflet-control-layers-toggle\s*{[^}]*}/g, '')
  .replace(/\.lvml\s*{[^}]*}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
const leafletJs = fs.readFileSync(P('node_modules/leaflet/dist/leaflet.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '')
const appCss = fs.readFileSync(P('src/styles.css'), 'utf8')
const appJs = fs.readFileSync(P('src/app.js'), 'utf8')
const minCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim()

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0a7480"/><circle cx="318" cy="206" r="86" fill="#f2b54e"/><path d="M92 338C120 262 140 176 190 164c44-10 52 70 72 126l22 48z" fill="#0e2329"/><path d="M262 338c10-36 22-74 46-80 26-6 36 40 50 80z" fill="#0e2329" opacity=".85"/><path d="M56 360q50-28 100 0t100 0 100 0 100 0" stroke="#fff" stroke-width="20" fill="none" stroke-linecap="round"/><path d="M56 420q50-28 100 0t100 0 100 0 100 0" stroke="#fff" stroke-opacity=".55" stroke-width="20" fill="none" stroke-linecap="round"/></svg>`

function page(build) {
  buildName = build
  const mode = build === 'single' ? 'inline' : 'file'
  const body = amd.html(chrome([homeView(mode), eventsView(mode), placesView(mode), areasView(mode, { kml: build === 'standalone' }), stayView(mode), moneyView(mode), infoView(), appsView(), notesView(), spendView(), statsView(), adminView()].join('\n')))
  const data = JSON.stringify(clientData(build)).replace(/</g, '\\u003c')
  const css = fontCss() + '\n' + minCss(leafletCss) + '\n' + minCss(appCss)
  const leaflet = build === 'artifact'
    ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js" defer></script>'
    : `<script>${leafletJs}</script>`
  const title = '<title>Phuket Trip Guide</title>'
  // mark JS on, and apply a saved theme before the first paint (not in the artifact, whose viewer sets the theme)
  const boot = build === 'artifact' ? '<script>document.documentElement.classList.add("js")</script>'
    : '<script>document.documentElement.classList.add("js");try{var t=JSON.parse(localStorage.getItem("pg:theme"));if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}</script>'
  const satData = build === 'single' && sat ? `<script type="application/json" id="sat-data">${satInline()}</script>\n` : ''
  const tail = `<script type="application/json" id="guide-data">${data}</script>\n${satData}${leaflet}\n<script>${appJs}</script>`
  if (build === 'artifact') return `${title}\n${boot}\n<style>${css}</style>\n${body}\n${tail}\n`
  const head = `<!doctype html>
<html lang="en"${beforeTrip ? ' class="cd-live"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${title}
<meta name="description" content="Pocket guide for Phuket, ${TRIP_LABEL.full}: music events, places, areas, hotels, money and essentials. Works offline.">
${build === 'standalone' ? siteMeta() : ''}
<meta name="theme-color" content="#0a7480">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
${build === 'standalone' ? '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Phuket">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">' : ''}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON_SVG)}">
${boot}
<style>:root{padding-top:env(safe-area-inset-top,0px)}${css}</style>
</head>
<body>
${body}
${tail}
</body>
</html>
`
  return head
}

// ---------- KML for Google My Maps ----------
function kml() {
  const kc = (hexc, a) => { const h = hexc.replace('#', ''); return a + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2) }
  const ring = (r) => r.map((c) => `${c[0]},${c[1]},0`).join(' ')
  const polyKml = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(p[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`).join('')
  const styles = Object.entries(AREA_COLORS).map(([id, c]) => `<Style id="a-${id}"><LineStyle><color>${kc(c, 'ff')}</color><width>2</width></LineStyle><PolyStyle><color>${kc(c, '66')}</color></PolyStyle></Style>`).join('')
  const pinStyle = (id, c) => `<Style id="${id}"><IconStyle><color>${kc(c, 'ff')}</color><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`
  const cdata = (s) => `<![CDATA[${amd.text(String(s || '')).replace(/]]>/g, ']] >')}]]>`
  const areasK = areasSorted.map((a) => {
    const f = areaGeo.features.find((x) => x.properties.id === a.id); if (!f) return ''
    return `<Placemark><name>${esc(a.name)}</name><description>${cdata(`<b>${a.tagline || ''}</b><br>${a.description || ''}<br><br>${a.stayIf || ''}`)}</description><styleUrl>#a-${a.id}</styleUrl><MultiGeometry>${polyKml(f.geometry)}</MultiGeometry></Placemark>`
  }).join('')
  const pm = (name, desc, lat, lng, style, it) => (Number.isFinite(+lat) && !(it && lowConf(it)) ? `<Placemark><name>${esc(name)}</name><description>${cdata(desc)}</description><styleUrl>#${style}</styleUrl><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>` : '')
  const folder = (name, inner) => `<Folder><name>${esc(name)}</name>${inner}</Folder>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Phuket trip · Jan 2027</name>${styles}${pinStyle('p-event', '#ff5f93')}${pinStyle('p-place', '#0a7480')}${pinStyle('p-gem', '#c4285f')}${pinStyle('p-hotel', '#5a55c6')}${pinStyle('p-money', '#c98414')}${pinStyle('p-adult', '#c4285f')}${pinStyle('p-weed', '#86b812')}
${folder('Areas', areasK)}
${folder('Music & raves', events.map((e) => pm(e.name, `${e.venue || ''}<br>${(e.dates || []).join(', ') || e.recurrence || ''}<br>${e.description || ''}`, e.lat, e.lng, 'p-event', e)).join(''))}
${folder('Places to go', places.filter((p) => p.tier !== 'adult').map((p) => pm(p.name, `${[(TIER[p.tier] || [''])[0], p.tier === 'pier' ? '' : (DUR[p.durationLabel] || [''])[0]].filter(has).join(' · ')}<br>${p.description || ''}`, p.lat, p.lng, p.tier === 'hidden-gem' ? 'p-gem' : 'p-place')).join(''))}
${adultItems.length ? folder('18+ and weed', adultSorted.map((p) => pm(p.name, `${ADULT_KIND[p.category] || ''}<br>${p.description || ''}`, p.lat, p.lng, p.category === 'cannabis' ? 'p-weed' : 'p-adult', p)).join('')) : ''}
${folder('Hotels', hotels.map((h) => { const bv = baseOfVilla(h.id); return pm(h.name, `${HTIER[h.tier] || ''} · ${bv && bv.paid ? `Booked ${baseRange(bv)}: paid ${paidLine(bv.paid)}` : h.priceText || ''}<br>${h.whyStay || ''}`, h.lat, h.lng, 'p-hotel') }).join(''))}
${folder('Money changers', brands.flatMap((b) => (b.branches || []).map((x) => pm(`${b.name} · ${x.name}`, `${x.hoursText || ''}<br>${b.summary || ''}`, x.lat, x.lng, 'p-money'))).join(''))}
</Document></kml>
`
}

// ---------- write ----------
const usedKeys = new Set([
  ...events.map((e) => 'events:' + e.id), ...places.map((p) => 'places:' + p.id), ...areas.map((a) => 'areas:' + a.id),
  ...hotels.map((h) => 'hotels:' + h.id), ...brands.map((b) => 'money:' + b.id),
])
for (const dir of ['dist/img', 'artifact/img']) { fs.rmSync(P(dir), { recursive: true, force: true }); fs.mkdirSync(P(dir), { recursive: true }) }
for (const [k, im] of Object.entries(images)) {
  if (!usedKeys.has(k) || (extra.dropImages || []).includes(k) || !im || !fs.existsSync(P(im.file))) continue
  for (const dir of ['dist/img', 'artifact/img']) fs.copyFileSync(P(im.file), P(dir, path.basename(im.file)))
}
fs.rmSync(P('dist/sat'), { recursive: true, force: true })
for (const f of satFiles) { fs.mkdirSync(path.dirname(P('dist/sat', f)), { recursive: true }); fs.copyFileSync(P('assets/sat', f), P('dist/sat', f)) }
// the website's build id: in the page, and in dist/version.json, which open pages check to offer a reload
const standaloneRaw = page('standalone')
const buildId = crypto.createHash('sha1').update(standaloneRaw).digest('hex').slice(0, 12)
if (standaloneRaw.split('__BUILD_ID__').length !== 2) throw new Error('the build id placeholder must appear once in the page')
const standalone = standaloneRaw.replace('__BUILD_ID__', buildId)
fs.writeFileSync(P('dist/index.html'), standalone)
fs.writeFileSync(P('dist/version.json'), JSON.stringify({ v: buildId }))
await sharePages()
fs.writeFileSync(P('dist/phuket-guide-offline.html'), page('single'))
fs.writeFileSync(P('artifact/index.html'), page('artifact'))
fs.writeFileSync(P('dist/phuket-areas.kml'), kml())

await sharp(Buffer.from(ICON_SVG)).resize(512, 512).png().toFile(P('dist/icon-512.png'))
await sharp(Buffer.from(ICON_SVG)).resize(192, 192).png().toFile(P('dist/icon-192.png'))
await sharp(Buffer.from(ICON_SVG)).resize(180, 180).png().toFile(P('dist/apple-touch-icon.png'))
fs.writeFileSync(P('dist/manifest.webmanifest'), JSON.stringify({
  name: 'Phuket Trip Guide', short_name: 'Phuket', start_url: './', scope: './', display: 'standalone',
  background_color: '#edf3f1', theme_color: '#0a7480', description: `Music events, places, areas, hotels and money tips for Phuket, ${TRIP_LABEL.long}.`,
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
}, null, 1))
const precache = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'phuket-areas.kml',
  ...fs.readdirSync(P('dist/img')).filter((f) => f.endsWith('.webp')).map((f) => 'img/' + f), ...satFiles.map((f) => 'sat/' + f)]
// the cache is named after the page's build, so the page counts its own photos and not an older version's
const version = buildId + '-' + crypto.createHash('sha1').update(precache.join()).digest('hex').slice(0, 6)
fs.writeFileSync(P('dist/sw.js'), fs.readFileSync(P('src/sw.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)))

const kb = (f) => Math.round(fs.statSync(P(f)).size / 1024) + ' KB'
console.log(`events ${events.length} · places ${places.length} · areas ${areas.length} · hotels ${hotels.length} · brands ${brands.length} · images ${Object.keys(images).length}`)
console.log(`dist/index.html ${kb('dist/index.html')} · offline single file ${kb('dist/phuket-guide-offline.html')} · artifact ${kb('artifact/index.html')} · satellite tiles ${satFiles.length} · sw ${version}`)
