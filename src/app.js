/* Phuket guide: progressive enhancement over fully rendered HTML. Everything here is optional; the page reads fine without it. */
(() => {
  'use strict'
  const D = JSON.parse(document.getElementById('guide-data').textContent)
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s))
  const VIEWS = ['home', 'events', 'places', 'areas', 'stay', 'money', 'info', 'apps']
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pg:' + k); return v == null ? d : JSON.parse(v) } catch { return d } },
    set(k, v) { try { localStorage.setItem('pg:' + k, JSON.stringify(v)); return true } catch { return false } },
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const gmaps = (q, pid) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + (pid ? '&query_place_id=' + encodeURIComponent(pid) : '')
  const gdir = (lat, lng) => 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  let toastTimer
  function toast(msg, action) {
    let t = $('#toast')
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t) }
    t.textContent = msg
    if (action) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label
      b.addEventListener('click', action.run); t.appendChild(b)
    }
    t.hidden = false
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true }, action ? 9000 : 2600)
  }
  const saveOrWarn = (k, v) => { if (!store.set(k, v)) toast('Could not save on this device (private mode or full storage).') }

  /* ---------- theme (the saved choice is applied in <head> before first paint) ---------- */
  const root = document.documentElement
  const isDark = () => root.getAttribute('data-theme') === 'dark' || (!root.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
  const themeBtn = $('#theme-btn')
  if (themeBtn) {
    if (D.build === 'artifact') themeBtn.hidden = true
    themeBtn.addEventListener('click', () => {
      const next = isDark() ? 'light' : 'dark'
      root.setAttribute('data-theme', next); store.set('theme', next)
      restyleMap()
    })
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => restyleMap())

  /* ---------- trip status and today (re-checked when the app comes back to the foreground) ---------- */
  const DAY = 86400000
  const tripStart = new Date(D.trip.start + 'T00:00:00+07:00'), tripEnd = new Date(D.trip.end + 'T23:59:59+07:00')
  const bkkDate = (d) => new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10) // date in Thailand
  let todayISO = bkkDate(new Date())
  let userPickedDay = false, shownToday = null
  const dayBtns = $$('.day-btn')
  function refreshToday() {
    todayISO = bkkDate(new Date())
    const pill = $('#trip-status')
    if (pill) {
      const now = Date.now()
      if (now < tripStart.getTime()) {
        const days = Math.ceil((tripStart.getTime() - now) / DAY)
        pill.textContent = days === 1 ? 'Tomorrow' : days + ' days to go'
      } else if (now <= tripEnd.getTime()) {
        const n = Math.floor((new Date(todayISO + 'T00:00:00+07:00') - tripStart) / DAY) + 1
        pill.textContent = 'Day ' + n + ' of ' + D.trip.days
      } else pill.textContent = 'Trip done'
    }
    dayBtns.forEach((b) => b.classList.toggle('today', b.dataset.day === todayISO))
    const allOpen = $('#agenda-all')?.getAttribute('aria-pressed') === 'true'
    if (!userPickedDay && !allOpen && dayBtns.length && shownToday !== todayISO) { selectDay(defaultDay(), false); shownToday = todayISO }
  }
  const defaultDay = () => (dayBtns.find((b) => b.dataset.day === todayISO) || dayBtns[0]).dataset.day

  /* ---------- day strip (home) ---------- */
  function selectDay(iso, scroll) {
    dayBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.day === iso)))
    $$('#agenda .agenda-day').forEach((el) => { el.hidden = el.dataset.day !== iso })
    const all = $('#agenda-all')
    if (all) { all.setAttribute('aria-pressed', 'false'); all.textContent = 'Show all days' }
    if (scroll) $('#agenda')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  if (dayBtns.length) {
    dayBtns.forEach((b) => {
      b.setAttribute('role', 'button') // so screen readers announce the pressed state
      b.addEventListener('click', (e) => { e.preventDefault(); userPickedDay = true; selectDay(b.dataset.day, false) })
    })
    $('#agenda-all')?.addEventListener('click', (e) => {
      const btn = e.currentTarget
      const showAll = btn.getAttribute('aria-pressed') !== 'true'
      if (showAll) {
        $$('#agenda .agenda-day').forEach((el) => { el.hidden = false })
        dayBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'))
        btn.setAttribute('aria-pressed', 'true'); btn.textContent = 'Show one day'
      } else selectDay(defaultDay(), false)
    })
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshToday() })
  window.addEventListener('pageshow', refreshToday)

  /* ---------- favourites ---------- */
  const favs = new Set(store.get('favs', []))
  function syncFavs() {
    $$('.fav').forEach((b) => b.setAttribute('aria-pressed', String(favs.has(b.dataset.fav))))
    const n = $('#saved-count'); if (n) n.textContent = favs.size ? favs.size + ' saved' : 'Nothing saved yet'
    renderSaved()
    lists.forEach((l) => l.apply())
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.fav'); if (!b) return
    e.preventDefault()
    const id = b.dataset.fav
    if (favs.has(id)) { favs.delete(id); toast('Removed from saved') } else { favs.add(id); toast('Saved') }
    saveOrWarn('favs', Array.from(favs)); syncFavs()
  })
  function renderSaved() {
    const box = $('#saved-list'); if (!box) return
    const items = Array.from(favs).map((f) => document.querySelector('[data-fav-card="' + CSS.escape(f) + '"]')).filter(Boolean)
    box.innerHTML = items.length
      ? items.map((card) => '<li><div><a href="#' + card.id + '">' + esc(card.dataset.name) + '</a> <span>· ' + esc(card.dataset.kind || '') + '</span></div></li>').join('')
      : '<li class="tip"><div><span>Tap the star on any event, place or hotel to keep it here.</span></div></li>'
  }

  /* ---------- filterable lists ---------- */
  const lists = []
  $$('[data-list]').forEach((listEl) => {
    const id = listEl.dataset.list
    const bar = document.querySelector('[data-toolbar="' + id + '"]')
    const state = {}
    let query = ''
    const cards = $$(':scope > .card', listEl)
    const empty = document.querySelector('[data-empty="' + id + '"]')
    const search = bar && $('input[type="search"]', bar)
    const match = (card, group, value) => {
      if (value === 'all') return true
      if (value === 'saved') return favs.has(card.dataset.favCard)
      const v = card.dataset[group] || ''
      return v.split(' ').includes(value)
    }
    const apply = () => {
      let shown = 0
      cards.forEach((card) => {
        let ok = Object.entries(state).every(([g, v]) => match(card, g, v))
        if (ok && query) ok = (card.dataset.text || card.textContent).toLowerCase().includes(query)
        card.hidden = !ok; if (ok) shown++
      })
      if (empty) empty.hidden = shown > 0
      if (bar) $$('.chip[data-value]', bar).forEach((chip) => {
        const n = $('.n', chip); if (!n) return
        const g = chip.dataset.group, v = chip.dataset.value
        n.textContent = cards.filter((c) => Object.entries(state).every(([gg, vv]) => gg === g || match(c, gg, vv)) && match(c, g, v)).length
      })
    }
    const reset = () => {
      if (bar) $$('.chip[data-group]', bar).forEach((c) => {
        const first = c === $('.chip[data-group="' + c.dataset.group + '"]', bar)
        c.setAttribute('aria-pressed', String(first)); if (first) state[c.dataset.group] = c.dataset.value
      })
      query = ''; if (search) search.value = ''
      apply()
    }
    if (bar) {
      $$('.chip[data-group]', bar).forEach((chip) => {
        const g = chip.dataset.group
        if (chip.getAttribute('aria-pressed') === 'true') state[g] = chip.dataset.value
        chip.addEventListener('click', () => {
          $$('.chip[data-group="' + g + '"]', bar).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)))
          state[g] = chip.dataset.value; apply()
        })
      })
      if (search) search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); apply() })
    }
    lists.push({ apply, reset, el: listEl })
  })

  /* ---------- apps: 'Ready' ticks (kept on this phone only) and the store button for this phone ---------- */
  {
    const boxes = $$('[data-app-done]')
    const done = new Set(store.get('appsDone', []))
    const progress = $('#app-progress')
    const paint = () => {
      boxes.forEach((b) => { b.checked = done.has(b.dataset.appDone); b.closest('.app-card')?.classList.toggle('done', b.checked) })
      if (progress && boxes.length) {
        const n = boxes.filter((b) => b.checked).length
        progress.textContent = n === boxes.length ? 'All ' + n + ' must-have apps are ready' : 'Ready: ' + n + ' of ' + boxes.length + ' must-have apps'
      }
    }
    boxes.forEach((b) => b.addEventListener('change', () => {
      if (b.checked) done.add(b.dataset.appDone); else done.delete(b.dataset.appDone)
      saveOrWarn('appsDone', Array.from(done)); paint()
    }))
    paint()
    const ua = navigator.userAgent
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const mine = ios ? 'ios' : /Android/.test(ua) ? 'android' : ''
    if (mine) $$('[data-store="' + mine + '"]').forEach((a) => a.classList.add('primary'))
  }

  /* ---------- router ---------- */
  const tabs = $$('.tabbar a')
  let current = null
  function show(view, focusEl) {
    // a view that this build does not have (e.g. #apps before data/apps.json exists) falls back to home
    if (!VIEWS.includes(view) || !document.getElementById(view)) view = 'home'
    VIEWS.forEach((v) => { const el = document.getElementById(v); if (el) el.hidden = v !== view })
    tabs.forEach((a) => { if (a.getAttribute('href') === '#' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') })
    if (view === 'areas') initMap()
    if (focusEl) {
      // a link to a card that the current filters hide: clear that list's filters first
      if (focusEl.hidden) { const l = lists.find((x) => x.el.contains(focusEl)); if (l) l.reset() }
      requestAnimationFrame(() => {
        focusEl.scrollIntoView({ block: 'start' })
        focusEl.classList.remove('flash'); void focusEl.offsetWidth; focusEl.classList.add('flash')
      })
    } else if (current !== view) window.scrollTo(0, 0)
    current = view
    if (view === 'areas' && map) setTimeout(() => map.invalidateSize(), 50)
  }
  function route() {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id || VIEWS.includes(id)) return show(id || 'home')
    const el = document.getElementById(id)
    if (!el) return show('home')
    const view = el.closest('.view')
    if (el.classList.contains('agenda-day')) { userPickedDay = true; selectDay(el.dataset.day, false) }
    show(view ? view.id : 'home', el)
  }
  window.addEventListener('hashchange', route)

  /* ---------- map ---------- */
  let map = null, layers = {}, markers = {}, bases = {}, base = null, pendingFocus = null, waitingForLeaflet = false
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim()
  function restyleMap() {
    if (!map) return
    layers.land.setStyle({ fillColor: cssVar('--map-land'), color: cssVar('--map-line') })
    if (layers.roads) layers.roads.setStyle({ color: cssVar('--map-road') })
    Object.values(markers).forEach((m) => m.setStyle(dotStyle(m.kind)))
    map.getContainer().classList.toggle('dim-tiles', base === 'streets' && isDark())
  }
  const DOT = { event: '--pulse', place: '--sea', gem: '--leaf', hotel: '--violet', money: '--sun' }
  function dotStyle(kind) {
    return { radius: kind === 'event' ? 7 : 6, color: cssVar('--surface'), weight: 2, fillColor: cssVar(DOT[kind] || '--sea'), fillOpacity: 1 }
  }
  const popupOpts = () => {
    const w = map ? map.getSize().x : 360
    // narrow enough to fit between the left edge and the zoom buttons (popup chrome adds about 30 px)
    // the layer chips and attribution hide while a popup is open, so only the style switch and zoom buttons need room
    return { maxWidth: Math.min(300, w - 112), minWidth: Math.min(200, w - 140), autoPanPaddingTopLeft: L.point(10, 64), autoPanPaddingBottomRight: L.point(60, 16) }
  }
  function popupHtml(p) {
    const card = p.card ? '<a class="btn" href="#' + p.card + '">Details</a>' : ''
    const dir = p.nodir ? '' : '<a class="btn" target="_blank" rel="noopener" href="' + gdir(p.dlat ?? p.lat, p.dlng ?? p.lng) + '">' + esc(p.dlabel || 'Directions') + '</a>'
    return '<h4>' + esc(p.name) + '</h4>' + (p.sub ? '<p>' + esc(p.sub) + '</p>' : '') +
      '<div class="actions"><a class="btn primary" target="_blank" rel="noopener" href="' + gmaps(p.q, p.pid) + '">Google Maps</a>' + dir + card + '</div>'
  }
  function setBase(name, byUser) {
    if (!map) return
    Object.values(bases).forEach((l) => l && map.removeLayer(l))
    base = name
    // the vector land and roads sit under the tile pane: real tiles cover them, and they fill any gaps offline
    if (name !== 'simple') {
      const t = name === 'satellite' ? D.tiles.satellite : D.tiles.streets
      let ok = 0, bad = 0
      const layer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19, maxNativeZoom: t.maxNative || 19, crossOrigin: true })
      layer.on('tileload', () => { ok++ })
      layer.on('tileerror', () => {
        bad++
        if (bad === 4 && ok === 0) { setBase('simple'); toast('No map tiles here right now. Showing the offline map.') }
      })
      map.on('movestart', () => { ok = 0; bad = 0 })
      bases[name] = layer.addTo(map)
      layer.bringToBack()
    }
    $$('.basebar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === base)))
    // street tiles only come in a light style; invert them for dark mode
    map.getContainer().classList.toggle('dim-tiles', base === 'streets' && isDark())
    if (byUser) store.set('base', base)
  }
  function declutterLabels() {
    // hide area labels that would overlap a bigger area's label
    const els = $$('.area-label span').map((s) => ({ s, rank: Number(s.dataset.rank || 0) }))
    els.forEach((x) => { x.s.style.visibility = '' })
    els.sort((a, b) => b.rank - a.rank)
    const kept = []
    for (const x of els) {
      const r = x.s.getBoundingClientRect()
      if (!r.width) continue
      const hit = kept.some((k) => !(r.right + 2 < k.left || r.left - 2 > k.right || r.bottom + 1 < k.top || r.top - 1 > k.bottom))
      if (hit) x.s.style.visibility = 'hidden'; else kept.push(r)
    }
  }
  function initMap() {
    if (map) return
    if (typeof L === 'undefined') {
      // Leaflet loads with defer (artifact) or inline; if the page is fully loaded and it is still missing, give up
      const fail = () => {
        if ($('#map-fallback-note')) return
        const box = $('.mapbox'); if (box) box.hidden = true
        const st = $('.staticmap'); if (st) st.classList.add('show')
        if (box) box.insertAdjacentHTML('afterend', '<p class="note" id="map-fallback-note">The interactive map could not load here, so this is the simple map. Every area below has a Google Maps button.</p>')
      }
      if (document.readyState === 'complete') fail()
      else if (!waitingForLeaflet) {
        waitingForLeaflet = true
        window.addEventListener('load', () => { if (typeof L !== 'undefined') { if (current === 'areas') initMap() } else fail() }, { once: true })
      }
      return
    }
    const anim = !reduceMotion
    map = L.map('map', { zoomControl: false, attributionControl: true, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 8, maxZoom: 18, maxBounds: [[6.9, 97.6], [10.3, 100.6]], zoomAnimation: anim, fadeAnimation: anim, markerZoomAnimation: anim })
    map.attributionControl.setPrefix(false)
    map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>')
    map.createPane('landPane').style.zIndex = 150 // under the tile pane (200)
    map.createPane('roadsPane').style.zIndex = 160
    map.createPane('areasPane').style.zIndex = 350 // below the pins in the overlay pane (400)
    layers.land = L.geoJSON(D.land, { pane: 'landPane', interactive: false, style: { fillColor: cssVar('--map-land'), fillOpacity: 1, color: cssVar('--map-line'), weight: 1 } }).addTo(map)
    if (D.roads) layers.roads = L.geoJSON(D.roads, { pane: 'roadsPane', interactive: false, style: (f) => ({ color: cssVar('--map-road'), weight: f.properties.k === 'trunk' ? 2.2 : f.properties.k === 'primary' ? 1.6 : 1, opacity: 0.9 }) }).addTo(map)
    const areaById = Object.fromEntries(D.areas.map((a) => [a.id, a]))
    layers.areas = L.layerGroup().addTo(map)
    L.geoJSON(D.areaGeo, {
      pane: 'areasPane',
      style: (f) => ({ fillColor: areaById[f.properties.id]?.color || '#999', fillOpacity: 0.4, color: areaById[f.properties.id]?.color || '#999', weight: 1.4, opacity: 0.95 }),
      onEachFeature: (f, layer) => {
        const a = areaById[f.properties.id]; if (!a) return
        layer.bindPopup('<h4>' + esc(a.name) + '</h4><p>' + esc(a.tagline) + '</p><div class="actions"><a class="btn primary" href="#ar-' + a.id + '">About this area</a><a class="btn" target="_blank" rel="noopener" href="' + a.gmapsArea + '">Google Maps</a></div>', popupOpts())
        layers.areas.addLayer(layer)
        layers.areas.addLayer(L.marker([a.label[0], a.label[1]], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'area-label', html: '<span data-rank="' + (a.rank || 0) + '">' + esc(a.short || a.name) + '</span>', iconSize: [0, 0] }) }))
      },
    })
    ;['event', 'place', 'gem', 'hotel', 'money'].forEach((t) => { layers[t] = L.layerGroup() })
    ;['event', 'place', 'gem'].forEach((t) => layers[t].addTo(map))
    D.points.forEach((p) => {
      const m = L.circleMarker([p.lat, p.lng], dotStyle(p.k)).bindPopup(popupHtml(p), popupOpts())
      m.kind = p.k
      m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -6] })
      layers[p.k === 'gem' ? 'gem' : p.t].addLayer(m)
      markers[p.t + ':' + p.id] = m
    })
    $$('.layerbar .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const on = chip.getAttribute('aria-pressed') !== 'true'
        chip.setAttribute('aria-pressed', String(on))
        const ls = chip.dataset.layer.split(' ').map((k) => layers[k]).filter(Boolean)
        ls.forEach((l) => { if (on) l.addTo(map); else map.removeLayer(l) })
        if (chip.dataset.layer === 'areas') setTimeout(declutterLabels, 30)
      })
    })
    const canTiles = D.build !== 'artifact'
    const bb = $('.basebar'); if (bb) bb.hidden = !canTiles
    $$('.basebar button').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base, true)))
    const chosen = store.get('base', null)
    setBase(canTiles && navigator.onLine ? (chosen || 'streets') : 'simple')
    if (canTiles && !navigator.onLine && chosen !== 'simple' && 'caches' in window) {
      // offline but street tiles were saved while browsing: use them, the error fallback covers gaps
      caches.open('guide-tiles').then((c) => c.keys()).then((k) => { if (k.length > 10) setBase(chosen || 'streets') }).catch(() => {})
    }
    const home = L.latLngBounds([[7.75, 98.25], [8.30, 98.47]])
    const fitHome = (anim2) => map.fitBounds(home, { paddingTopLeft: [10, 58], paddingBottomRight: [10, 64], animate: anim2 })
    fitHome(false)
    const mapEl = map.getContainer()
    map.on('popupopen', () => mapEl.parentElement.classList.add('popup-open'))
    map.on('popupclose', () => mapEl.parentElement.classList.remove('popup-open'))
    const zoomClass = () => { mapEl.classList.toggle('z-low', map.getZoom() < 9.75); requestAnimationFrame(declutterLabels) }
    map.on('zoomend moveend', zoomClass); zoomClass()
    $('#map-zoom-in')?.addEventListener('click', () => map.zoomIn())
    $('#map-zoom-out')?.addEventListener('click', () => map.zoomOut())
    $('#map-fit')?.addEventListener('click', () => fitHome(!reduceMotion))
    const locBtn = $('#map-locate')
    if (locBtn) {
      if (!('geolocation' in navigator) || D.build === 'artifact') locBtn.hidden = true
      let me = null
      locBtn.addEventListener('click', () => {
        navigator.geolocation.getCurrentPosition((pos) => {
          const ll = [pos.coords.latitude, pos.coords.longitude]
          if (me) me.setLatLng(ll); else me = L.circleMarker(ll, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2b7de9', fillOpacity: 1 }).addTo(map)
          map.setView(ll, Math.max(map.getZoom(), 13), { animate: anim })
        }, () => toast('Location is not available'), { enableHighAccuracy: true, timeout: 10000 })
      })
    }
    if (pendingFocus) { focusPoint(pendingFocus); pendingFocus = null }
  }
  function focusPoint(key) {
    const m = markers[key]
    if (!m) return
    const t = key.split(':')[0]
    const chip = $('.layerbar .chip[data-layer~="' + (m.kind === 'gem' ? 'gem' : t) + '"]')
    if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click()
    map.closePopup()
    const ll = m.getLatLng()
    const near = map.getBounds().pad(-0.2).contains(ll)
    const open = () => { m.bringToFront(); m.setStyle({ radius: 11 }); m.openPopup(); m.once('popupclose', () => m.setStyle(dotStyle(m.kind))) }
    map.once('moveend', () => setTimeout(open, 30))
    map.setView(ll, Math.max(map.getZoom(), 14), { animate: near && !reduceMotion })
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-on-map]'); if (!b) return
    e.preventDefault()
    const key = b.dataset.onMap
    if (location.hash !== '#areas') { pendingFocus = key; location.hash = 'areas' } else if (map) focusPoint(key)
    setTimeout(() => { if (map && pendingFocus) { focusPoint(pendingFocus); pendingFocus = null } }, 120)
  })
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-area-map]'); if (!b) return
    e.preventDefault()
    const go = () => {
      const layer = layers.areas && layers.areas.getLayers().find((l) => l.feature && l.feature.properties.id === b.dataset.areaMap)
      if (layer) { map.fitBounds(layer.getBounds(), { padding: [20, 20], animate: !reduceMotion }); layer.openPopup() }
    }
    if (location.hash !== '#areas') { location.hash = 'areas'; setTimeout(() => { if (map) { map.invalidateSize(); go() } }, 120) } else if (map) go()
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  })

  /* ---------- converter ---------- */
  const conv = $('#converter')
  if (conv && D.rates) {
    const amt = $('#conv-amount'), cur = $('#conv-cur'), dirBtn = $('#conv-dir'), out = $('#conv-out'), note = $('#conv-note')
    let rates = Object.assign({}, D.rates.mid), live = store.get('liveRates', null), toThb = true
    if (live && live.rates) rates = Object.assign(rates, live.rates)
    const fmt = (n, c) => (c === 'THB' ? '฿' : '') + n.toLocaleString('en-US', { maximumFractionDigits: c === 'THB' ? 0 : 2 }) + (c === 'THB' ? '' : ' ' + c)
    function calc() {
      const a = parseFloat(String(amt.value).replace(/,/g, '')) || 0
      const r = rates[cur.value]
      if (!r) { out.textContent = '—'; return }
      const res = toThb ? a * r : a / r
      const best = D.rates.best && D.rates.best[cur.value]
      let extra = toThb ? '1 ' + cur.value + ' ≈ ฿' + r.toFixed(2) + ' (mid-market)' : '฿1 ≈ ' + (1 / r).toFixed(4) + ' ' + cur.value
      if (toThb && best) extra += ' · at ' + D.rates.bestName + ' about ฿' + Math.round(a * best).toLocaleString('en-US')
      out.innerHTML = esc(fmt(res, toThb ? 'THB' : cur.value)) + '<small>' + esc(extra) + '</small>'
    }
    function label() {
      $('#conv-from-label').textContent = toThb ? 'You give' : 'Price in baht'
      dirBtn.setAttribute('aria-label', toThb ? 'Switch to baht → ' + cur.value : 'Switch to ' + cur.value + ' → baht')
    }
    amt.addEventListener('input', calc)
    cur.addEventListener('input', () => { label(); calc() })
    dirBtn.addEventListener('click', () => { toThb = !toThb; label(); calc() })
    label(); calc()
    const stamp = (when, src) => { note.textContent = 'Rates: ' + src + ', ' + when + '. Booth rates change daily; check the board.' }
    stamp(live ? live.date : D.rates.date, live ? 'live mid-market' : D.rates.source)
    if (D.build !== 'artifact' && navigator.onLine && (!live || live.date !== todayISO)) {
      fetch('https://open.er-api.com/v6/latest/THB').then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((j) => {
        if (!j || !j.rates) return
        const fresh = {}
        Object.keys(rates).forEach((c) => { if (j.rates[c]) fresh[c] = 1 / j.rates[c] })
        live = { date: todayISO, rates: fresh }; store.set('liveRates', live)
        Object.assign(rates, fresh); calc(); stamp(todayISO, 'live mid-market')
      }).catch(() => { /* offline or blocked: keep saved rates */ })
    }
  }

  /* ---------- my hotels ---------- */
  const myForm = $('#my-hotel-form'), myList = $('#my-hotels')
  let mine = store.get('myHotels', [])
  function renderMine() {
    if (!myList) return
    myList.innerHTML = mine.length ? mine.map((h, i) => {
      const link = h.link && /^https?:\/\//.test(h.link) ? h.link : gmaps(h.name + ', Thailand')
      return '<div class="mine-item"><b>' + esc(h.name) + '</b>' +
        (h.dates ? '<span class="note">' + esc(h.dates) + '</span>' : '') + (h.notes ? '<p>' + esc(h.notes) + '</p>' : '') +
        '<div class="actions"><a class="btn primary" target="_blank" rel="noopener" href="' + esc(link) + '">Open in Google Maps</a>' +
        '<button class="btn" type="button" data-del="' + i + '">Remove</button></div></div>'
    }).join('') + '<button class="btn" type="button" id="mine-copy">Copy my hotels as text</button>'
      : '<p class="note">Nothing added yet. Add your booked hotel so its address is one tap away, even offline.</p>'
  }
  if (myForm) {
    myForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const f = new FormData(myForm)
      const name = String(f.get('name') || '').trim(); if (!name) return
      mine.push({ name, link: String(f.get('link') || '').trim(), dates: String(f.get('dates') || '').trim(), notes: String(f.get('notes') || '').trim() })
      const saved = store.set('myHotels', mine); myForm.reset(); renderMine()
      toast(saved ? 'Hotel added' : 'Shown here, but this device could not save it. Use "Copy my hotels as text" to keep it.')
    })
    myList?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-del]')
      if (b) { mine.splice(Number(b.dataset.del), 1); saveOrWarn('myHotels', mine); renderMine(); return }
      if (e.target.closest('#mine-copy')) {
        const text = mine.map((h) => [h.name, h.dates, h.notes, h.link].filter(Boolean).join(' | ')).join('\n')
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied. Paste it into Notes or a chat as a backup.'), () => toast(text))
        else toast(text)
      }
    })
    renderMine()
  }

  /* ---------- copy buttons ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return
    const text = b.dataset.copy
    const done = () => toast('Copied ' + text)
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast(text))
    else toast(text)
  })

  /* ---------- offline state ---------- */
  const off = $('#offline-state')
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const setOff = (text, good) => { if (off) { off.textContent = text; off.className = 'offline-state' + (good ? ' good' : '') } }
  if (D.build === 'standalone' && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const hadController = !!navigator.serviceWorker.controller
    const failMsg = () => setOff('Could not save for offline use. Open the guide again on good Wi-Fi.', false)
    const timer = setTimeout(() => { if (!navigator.serviceWorker.controller) failMsg() }, 45000)
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const w = reg.installing
      if (w) w.addEventListener('statechange', () => { if (w.state === 'redundant') failMsg() })
      return navigator.serviceWorker.ready
    }).then(async () => {
      clearTimeout(timer)
      navigator.storage?.persist?.().catch(() => {})
      // count what is really in the cache: photos that failed during install are fetched again as you browse online
      let missing = 0
      try {
        const key = (await caches.keys()).find((k) => k.startsWith('guide-') && k !== 'guide-tiles')
        if (key) missing = Math.max(0, (D.precacheCount || 0) - (await (await caches.open(key)).keys()).length)
      } catch { /* cache API not available */ }
      if (ios && !standalone) setOff('Saved in Safari for now. Add it to your Home Screen to keep it: Safari clears sites you have not opened for a week.', false)
      else if (missing > 0) setOff('Saved for offline use, but ' + missing + (missing === 1 ? ' photo is' : ' photos are') + ' missing. Open the guide again on good Wi-Fi.', false)
      else setOff('Saved for offline use on this phone.', true)
    }).catch(() => { clearTimeout(timer); setOff('Offline saving is not available in this browser.', false) })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('The guide was updated.', { label: 'Reload', run: () => location.reload() })
    })
  } else if (D.build === 'single') {
    setOff('This file works offline as it is. Keep it on your phone or laptop.', true)
  } else if (D.build === 'artifact') {
    setOff(D.offlineUrl ? 'This copy needs internet. For the trip, open the offline version once and add it to your Home Screen:' : 'This copy needs internet. For the trip, keep the offline file of this guide (phuket-guide-offline.html) on your phone: it works with no internet.', false)
    if (D.offlineUrl && off) off.insertAdjacentHTML('afterend', '<p><a href="' + esc(D.offlineUrl) + '" target="_blank" rel="noopener">' + esc(D.offlineUrl) + '</a></p>')
  } else setOff('Open this guide from its web address once to save it for offline use.', false)
  const installTip = $('#install-tip')
  if (installTip && D.build === 'standalone' && !standalone) {
    installTip.hidden = false
    $('#install-ios').hidden = !ios
    $('#install-android').hidden = ios
  }

  syncFavs()
  refreshToday()
  route()
})()
