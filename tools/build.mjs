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
import { TRIP, TRIP_DAYS, TRIP_LABEL, inTrip, phaseOf, phaseRange, phaseLabel } from './trip.mjs'
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
const midRates = () => (amdRate ? [{ currency: 'AMD', thbPerUnit: 1 / amdRate.perThb, date: amdRate.date }] : [])
  .concat((money.midMarket || []).filter((m) => m && m.thbPerUnit && m.currency !== 'AMD'))
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
const OFF_ISLAND = { 'koh-kaew': 'Koh Kaew', 'phang-nga': 'Phang Nga', 'khao-lak': 'Khao Lak', krabi: 'Krabi', 'phi-phi': 'Phi Phi', 'koh-yao': 'Koh Yao', 'koh-lanta': 'Koh Lanta', 'koh-phangan': 'Koh Phangan', 'koh-samui': 'Koh Samui', other: '' }
const areaName = (id) => (id === 'other' ? '' : AREA_NAMES[id] || OFF_ISLAND[id] || (id ? cap(String(id).replace(/-/g, ' ')) : ''))

const AREA_COLORS = {
  patong: '#D9435F', kamala: '#8C6FD1', surin: '#D45D79', 'bang-tao': '#3D7FD1', layan: '#9A7BD8', 'nai-thon': '#E39A4F',
  'nai-yang': '#E0719A', 'mai-khao': '#3FA37A', karon: '#F0963A', kata: '#2FB59A', 'kata-noi': '#7E6BD6', 'nai-harn': '#F2A541',
  rawai: '#E07BB0', chalong: '#3B9FD1', 'phuket-town': '#E8A33D', kathu: '#6FA83D', 'cape-panwa': '#9BBF45', 'ao-po': '#5C8FD6',
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
  note: '<path d="M5.5 3.5h9l4 4v12a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4M8 12h8M8 15.5h5"/>',
  down: '<path d="M12 4.5V19M6 13l6 6 6-6"/>',
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
  if (d) parts.push(`<a class="btn" href="${gdir(d.lat, d.lng)}" target="_blank" rel="noopener">${icon('route')}${esc(d.label)}</a>`)
  ;(item.extraMaps || []).forEach((x) => parts.push(`<a class="btn" href="${gmaps(x.q, x.placeId)}" target="_blank" rel="noopener">${icon('pin')}${esc(x.label)}</a>`))
  if (mapKey && !lowConf(item)) parts.push(`<button class="btn js-only" type="button" data-on-map="${esc(mapKey)}">${icon('areas')}On map</button>`)
  parts.push(extraBtns)
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
// list order: top picks in the trip first, then dated events in the trip, then weekly nights and clubs, then outside the dates
const firstInTrip = (e) => (e.dates || []).filter(inTrip).sort()[0] || '9999'
const evGroup = (e) => (e.window === 'in' && e.pick ? 0 : e.window === 'in' && e.kind === 'dated' ? 1 : e.kind !== 'dated' ? 2 : 3)
const eventsSorted = events.slice().sort((a, b) => evGroup(a) - evGroup(b) || (evGroup(a) === 2 ? (b.undergroundScore || 0) - (a.undergroundScore || 0) : 0) || firstInTrip(a).localeCompare(firstInTrip(b)) || eventSort(a, b))

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
  const phases = dates.length ? Array.from(new Set(dates.filter(inTrip).map(phaseOf))).join(' ') : (e.kind === 'venue' ? 'group duo solo' : '')
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
${facts([['When', recurring ? e.recurrence || e.timeText : e.timeText], ['Where', lowConf(e) ? 'Exact place not public yet. Check the organiser before you go.' : ''], ['Tickets', e.priceText]])}
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
const TIER = { 'must-see': ['Must-see', 'must'], 'hidden-gem': ['Hidden gem', 'gem'], 'day-trip': ['Day trip', 'trip'] }
const tierOrder = { 'must-see': 0, 'hidden-gem': 1, 'day-trip': 2 }
const placeIndex = new Map(places.map((p, i) => [p.id, i]))
const placesSorted = places.slice().sort((a, b) => (a.category === 'food') - (b.category === 'food') || (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3) || placeIndex.get(a.id) - placeIndex.get(b.id))
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
  const durLabel = durText(p)
  const [tierLabel, tierCls] = TIER[p.tier] || ['Place', 'soft']
  const tierKeys = [p.tier, p.category === 'food' ? 'food' : ''].filter(Boolean).join(' ')
  const days = (p.days || []).length && p.days.length < 7 ? 'Only ' + p.days.join(', ') : ''
  const sub = [areaName(p.area), cap(p.category)].filter(has).join(' · ')
  return `<article class="card" id="pl-${esc(p.id)}" data-fav-card="pl:${esc(p.id)}" data-name="${esc(p.name)}" data-kind="Place" data-tier="${esc(tierKeys)}" data-dur="${durKey}" data-text="${textOf(p.name, p.nameThai, p.category, areaName(p.area), p.goodFor, p.tier)}">
${imgTag('places:' + p.id, p.name, mode, '◆')}<div class="tag-top"><span class="pill ${p.category === 'food' ? 'food' : tierCls}">${p.category === 'food' ? 'Food' : tierLabel}</span></div><div class="tag-bottom"><span class="pill">${icon('clock')}${esc(durLabel)}</span></div></div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(p.name)}</h2><p class="subtitle">${esc(sub)}${has(p.nameThai) ? ` · <span lang="th">${esc(p.nameThai)}</span>` : ''}</p></div></div>
<p class="desc">${esc(p.description)}</p>
${facts([['Time', durLabel + (['1-2h', '2-3h'].includes(p.durationLabel) ? ' on site' : '')], ['Best time', p.bestTime], ['Cost', p.feeText]])}
${moreBlock('Opening, getting there & tips', p.tips, p.links, [['Open', [p.openText, days].filter(has).join(' · ')], ['Getting there', p.gettingThere]])}
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
${facts([['Prices', price], ['Airport', a.airportDriveMin ? `≈ ${a.airportDriveMin} min drive` : '']])}
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
  if (['karon', 'kata', 'kata-noi', 'nai-harn', 'rawai', 'chalong'].includes(h.area)) return 'south'
  if (h.area === 'phuket-town') return 'town'
  if (h.area === 'koh-phangan') return 'phangan'
  return 'other'
}
const ZONES = [['west', 'Kamala & beach-club coast'], ['natai', 'Natai'], ['patong', 'Patong'], ['south', 'Kata · Rawai'], ['town', 'Old Town'], ['phangan', 'Koh Phangan'], ['airport', 'Near the airport']]
const hotelOrder = { luxury: 0, boutique: 1, 'mid-range': 2, budget: 3, hostel: 4 }
const STAY_GUESTS = 8
// the trip total, read from the start of priceText ("241,500 THB for 10 nights (8-18 Jan, 8 guests), ..."), so the big
// number on the card and the price notes can never disagree; a villa with no rooms on the dates has none
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
${villaMedia(h, mode)}<div class="tag-top"><span class="pill ${h.tier === 'luxury' ? 'must' : 'soft'}">${esc(HTIER[h.tier] || h.tier)}</span>${h.noRoomsOnTrip ? `<span class="pill bad">${esc(h.noRoomsOnTrip)}</span>` : ''}${h.adultsOnly ? '<span class="pill soft">Adults only</span>' : ''}${h.beachfront ? '<span class="pill soft">Beachfront</span>' : ''}</div></div>
<div class="body">
<div class="title-row"><div><h2 class="card-title">${esc(h.name)}</h2><p class="subtitle">${esc(areaName(h.area))}${has(h.ratingText) ? ' · ' + esc(h.ratingText) : ''}</p></div></div>
${bedRow(h)}
${priceBox(h)}
${villaMap(h)}
<p class="desc">${esc(h.whyStay)}</p>
${vibe.length ? `<div class="tags">${vibe.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
${facts([['January', h.priceText]])}
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
const markets = places.filter((p) => (p.category === 'market' || p.category === 'food') && (p.days || []).length && p.days.length < 7)
// the plan has the two of you on Koh Phangan on these nights, so its parties come first in the agenda
const PLAN_PHANGAN = new Set(['2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22'])
function dayAgenda(iso) {
  // flight day: you are at the airport by 15:20, so evening parties and markets do not apply
  if (iso === TRIP.flight.day) return { evs: [], mk: [] }
  const here = PLAN_PHANGAN.has(iso) ? 'koh-phangan' : 'phuket'
  const near = (e) => (whereOf(e) === here ? 0 : 1)
  const evs = events.filter((e) => (e.dates || []).includes(iso)).sort((a, b) => near(a) - near(b) || (b.pick ? 1 : 0) - (a.pick ? 1 : 0) || (b.undergroundScore || 0) - (a.undergroundScore || 0))
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
    return `<article class="agenda-day" id="day-${iso}" data-day="${iso}"><h3>${dayLabel(iso)} <small>Sunrise ${st.rise} · Sunset ${st.set}</small></h3>${items.length ? `<ul>${items.join('')}</ul>` : '<p class="quiet">No parties listed yet. A good day for a beach, a viewpoint or a day trip.</p>'}</article>`
  }).join('')
  // a hand-picked list (extra.beforeYouFly); without one, the first 'must know' facts of the pre-trip sections
  const tripSections = new Set(['phangan-week', 'solo', 'departure'])
  // a link to #apps only makes sense once the Apps view exists (data/apps.json)
  const beforeFly = (extra.beforeYouFly || []).length ? extra.beforeYouFly.filter((c) => c.href !== '#apps' || apps.length)
    : (info.sections || []).filter((s) => !tripSections.has(s.id)).flatMap((s) => (s.items || []).filter((i) => i.critical).map((i) => ({ text: i.title, href: '#info-' + s.id }))).slice(0, 5)
  const bestBrand = brands[0]
  const tiles = [
    ['events', 'events', 'Music & raves', plural(datedEvents.filter((e) => e.window === 'in').length, 'dated event') + ' in your dates'],
    ['places', 'places', 'Places to go', plural(places.filter((p) => p.tier !== 'day-trip').length, 'spot') + ' · ' + plural(places.filter((p) => p.tier === 'day-trip').length, 'day trip')],
    ['areas', 'areas', 'Areas & map', plural(areas.length, 'area') + ', drawn on the map'],
    ['stay', 'stay', 'Where to stay', plural(hotels.length, 'villa') + ' + your own'],
    ['money', 'money', 'Money', bestBrand ? `Best rates: ${bestBrand.name}` : 'Exchange & ATMs'],
    ['info', 'info', 'Essentials', 'Entry, transport, safety, phrases'],
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
<div class="block-title"><h2>Day by day</h2><button class="chip js-only" type="button" id="agenda-all" aria-pressed="false">Show all days</button></div>
<div class="agenda" id="agenda">${agenda}</div>
<div class="tiles">${tiles}</div>
${beforeFly.length ? `<div class="callout alert"><h3>Before you fly</h3><ul>${beforeFly.map((c) => `<li>${c.href ? `<a href="${esc(c.href)}">${esc(c.text)}</a>` : esc(c.text)}</li>`).join('')}</ul><p><a href="#info">Read the essentials</a></p></div>` : ''}
<div class="stack js-only"><div class="block-title"><h2>Saved</h2><small id="saved-count"></small></div><div class="agenda-day"><ul id="saved-list"></ul></div></div>
<div class="callout" id="offline-box"><h3>Offline use</h3><p class="offline-state" id="offline-state">${OFFLINE_TEXT[buildName] || ''}</p>
<div id="install-tip" hidden><p id="install-ios">iPhone: tap Share, then “Add to Home Screen”. Open it once with internet. After that it works offline.</p><p id="install-android">Android: tap ⋮, then “Add to Home screen” or “Install app”.</p></div>
<p class="note">For offline turn-by-turn directions, also download Phuket in the Google Maps app: profile picture → Offline maps → Select your own map.</p></div>
<footer class="footer-note">${buildName === 'standalone' ? '<p class="js-only"><a href="#stats">Visits and activity</a>: the website counts visits and what people do in it, for the group.</p>' : ''}<p>Researched on ${esc(extra.researchedOn || '15 Oct 2026')}. Lineups, prices and opening hours change: check the official link before you go.</p><p>Map data © OpenStreetMap contributors (ODbL). Photos: Wikimedia Commons contributors and the venues’ own sites, credited on each photo.</p></footer>
</section>`
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
// Stats: filled in by src/app.js from the vote server (website only)
function statsView() {
  return `<section class="view" id="stats" aria-labelledby="stats-title">
<div class="view-head"><span class="eyebrow">Website only</span><h1 class="view-title" id="stats-title">Visits and activity</h1><p class="lede">Who opened the guide and what they did: visits, tabs, villas looked at, maps, photos, shares, likes and notes.</p></div>
<div id="stats-body"><p class="note">Open the guide's website to see the stats.</p></div>
</section>`
}
// links: values that have their own address (#<list>/<value>, e.g. #stay/liked), so a filtered list can be shared
function chipRow(listId, group, items, label, links = [], after = '') {
  return `<div class="chips" role="toolbar" aria-label="${esc(label)}">${items.map(([v, t], i) => `<button class="chip" type="button" data-group="${group}" data-value="${v}"${links.includes(v) ? ' data-link' : ''} aria-pressed="${i === 0}">${esc(t)} <span class="n"></span></button>`).join('')}${after}</div>`
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
${chipRow('events', 'where', [['all', 'Everywhere'], ['phuket', 'Phuket & Natai'], ['koh-phangan', 'Koh Phangan'], ['other', 'Other islands']], 'Filter by place')}
<input class="search" type="search" id="events-search" placeholder="Search events, venues, genres" aria-label="Search events">
</div>
<div class="list" data-list="events">${eventsSorted.map((e) => eventCard(e, mode)).join('\n')}</div>
<p class="empty" data-empty="events" hidden>No events match these filters.</p>
${extra.eventsFooter ? `<div class="callout sun"><h3>${esc(extra.eventsFooter.title)}</h3><ul>${extra.eventsFooter.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
</section>`
}
function placesView(mode) {
  return `<section class="view" id="places" aria-labelledby="places-title">
<div class="view-head"><span class="eyebrow">Must-see · hidden gems · day trips</span><h1 class="view-title" id="places-title">Places to go</h1><p class="lede">${esc(extra.placesIntro || 'Each place shows how long it takes, the best time to go and what it costs. In January the west-coast sea is calm and clear.')}</p></div>
<div class="toolbar" data-toolbar="places">
${chipRow('places', 'tier', [['all', 'All'], ['must-see', 'Must-see'], ['hidden-gem', 'Hidden gems'], ['day-trip', 'Day trips'], ['food', 'Food'], ['saved', 'Saved']], 'Filter places', ['saved'], shareListBtn)}
${chipRow('places', 'dur', [['all', 'Any length'], ['short', 'Up to 3 hours'], ['half', 'Half day'], ['full', 'Full day +'], ['evening', 'Evening']], 'Filter by time needed')}
<input class="search" type="search" id="places-search" placeholder="Search beaches, temples, markets…" aria-label="Search places">
</div>
<div class="list" data-list="places">${placesSorted.map((p) => placeCard(p, mode)).join('\n')}</div>
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
<button class="chip" type="button" data-layer="money" aria-pressed="false"><i style="background:var(--sun)"></i>Money</button>
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
function stayView(mode) {
  const zonesUsed = ZONES.filter(([z]) => hotels.some((h) => zoneOf(h) === z))
  // only the price chips that match a card (the villa list has no boutique hotels)
  const tiersUsed = [['luxury', 'Luxury'], ['boutique', 'Boutique'], ['mid-range', 'Mid-range'], ['budget', 'Budget']].filter(([t]) => hotels.some((h) => (h.tier === 'hostel' ? 'budget' : h.tier) === t))
  return `<section class="view" id="stay" aria-labelledby="stay-title">
<div class="view-head"><span class="eyebrow">8 guests · 8–18 Jan</span><h1 class="view-title" id="stay-title">Where to stay</h1><p class="lede">${esc(extra.stayIntro || 'Add your own bookings, and browse hotels picked for this trip, from Circoloco’s beach to Old Town.')}</p></div>
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
<div class="view-head"><span class="eyebrow">Checked ${esc(info.asOf || 'Oct 2026')}</span><h1 class="view-title" id="info-title">Essentials</h1><p class="lede">Money, entry rules, getting around, safety and a few words of Thai.</p></div>
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

function chrome(body) {
  const tab = (id, ic, label) => `<li><a href="#${id}">${icon(ic)}<span>${label}</span></a></li>`
  return `<header class="topbar"><div class="topbar-in">
<a class="brand" href="#home"><span class="brand-mark">HKT</span><span class="brand-text"><b>Phuket</b><small>${TRIP_LABEL.short}</small></span></a>
<a class="status-pill" id="trip-status" href="#home">Jan 2027</a>
<a class="icon-btn" href="#info" aria-label="Essentials">${icon('info')}</a>
<button class="icon-btn js-only" type="button" id="theme-btn" aria-label="Switch light or dark">${icon('theme')}</button>
</div></header>
<main id="main">${body}</main>
<button class="back-to-map js-only" id="back-to-map" type="button" hidden>${icon('back')}Back to map</button>
<button class="back-to-map js-only" id="back-to-card" type="button" hidden>${icon('back')}<span>Back to villa</span></button>
<dialog class="vote-dialog" id="vote-dialog" aria-labelledby="vote-title"><form id="vote-form" method="dialog">
<h2 id="vote-title">Like</h2><p class="vote-what" id="vote-what"></p>
<label for="vote-name">Your name<input id="vote-name" name="name" maxlength="40" autocomplete="given-name" required placeholder="e.g. Ani"></label>
<p class="note" id="vote-note">Everyone with the guide sees the names. One vote per name.</p>
<div class="actions"><button class="btn primary" type="submit" data-vote-save>Save vote</button><button class="btn" type="button" data-vote-cancel>Cancel</button></div>
</form></dialog>
<nav class="tabbar" aria-label="Sections"><ul>
${tab('home', 'trip', 'Trip')}${tab('events', 'events', 'Music')}${tab('places', 'places', 'Places')}${tab('areas', 'areas', 'Areas')}${tab('stay', 'stay', 'Stay')}${buildName === 'standalone' ? tab('notes', 'note', 'Notes') : tab('money', 'money', 'Money')}
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
  places.forEach((p) => add('place', p.tier === 'hidden-gem' ? 'gem' : 'place', p, p.id, p.name, [(TIER[p.tier] || [''])[0], durText(p)].filter(has).join(' · '), 'pl-' + p.id))
  // villas: the tier as the line, and the trip total (priceOf) shown big in the popup
  hotels.forEach((h) => {
    add('hotel', 'hotel', h, h.id, h.name, [HTIER[h.tier], h.beds > 0 ? plural(h.beds, 'bed') : '', h.noRoomsOnTrip].filter(has).join(' · '), 'ht-' + h.id)
    const pt = pts.at(-1), pr = priceOf(h)
    if (pt && pt.id === h.id && pt.t === 'hotel') {
      // the popup: drams first (an estimate), then US dollars and the listing's baht price
      if (pr) Object.assign(pt, amdRate
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
  const body = amd.html(chrome([homeView(mode), eventsView(mode), placesView(mode), areasView(mode, { kml: build === 'standalone' }), stayView(mode), moneyView(mode), infoView(), appsView(), notesView(), statsView()].join('\n')))
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${title}
<meta name="description" content="Pocket guide for Phuket, ${TRIP_LABEL.full}: music events, places, areas, hotels, money and essentials. Works offline.">
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
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Phuket trip · Jan 2027</name>${styles}${pinStyle('p-event', '#ff5f93')}${pinStyle('p-place', '#0a7480')}${pinStyle('p-gem', '#c4285f')}${pinStyle('p-hotel', '#5a55c6')}${pinStyle('p-money', '#c98414')}
${folder('Areas', areasK)}
${folder('Music & raves', events.map((e) => pm(e.name, `${e.venue || ''}<br>${(e.dates || []).join(', ') || e.recurrence || ''}<br>${e.description || ''}`, e.lat, e.lng, 'p-event', e)).join(''))}
${folder('Places to go', places.map((p) => pm(p.name, `${(TIER[p.tier] || [''])[0]} · ${(DUR[p.durationLabel] || [''])[0]}<br>${p.description || ''}`, p.lat, p.lng, p.tier === 'hidden-gem' ? 'p-gem' : 'p-place')).join(''))}
${folder('Hotels', hotels.map((h) => pm(h.name, `${HTIER[h.tier] || ''} · ${h.priceText || ''}<br>${h.whyStay || ''}`, h.lat, h.lng, 'p-hotel')).join(''))}
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
const version = crypto.createHash('sha1').update(standalone).update(precache.join()).digest('hex').slice(0, 10)
fs.writeFileSync(P('dist/sw.js'), fs.readFileSync(P('src/sw.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)))

const kb = (f) => Math.round(fs.statSync(P(f)).size / 1024) + ' KB'
console.log(`events ${events.length} · places ${places.length} · areas ${areas.length} · hotels ${hotels.length} · brands ${brands.length} · images ${Object.keys(images).length}`)
console.log(`dist/index.html ${kb('dist/index.html')} · offline single file ${kb('dist/phuket-guide-offline.html')} · artifact ${kb('artifact/index.html')} · satellite tiles ${satFiles.length} · sw ${version}`)
