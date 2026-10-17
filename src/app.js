/* Phuket guide: progressive enhancement over fully rendered HTML. Everything here is optional; the page reads fine without it. */
(() => {
  'use strict'
  const D = JSON.parse(document.getElementById('guide-data').textContent)
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s))
  const VIEWS = ['home', 'events', 'places', 'areas', 'stay', 'money', 'info', 'apps', 'notes', 'stats']
  // kept for this tab only (it survives a refresh): where you were on the page and on the map
  const session = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('pg:' + k) || 'null') } catch { return null } },
    set(k, v) { try { sessionStorage.setItem('pg:' + k, JSON.stringify(v)) } catch { /* private mode */ } },
  }
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
  // villas hidden with 'Hide': off the list and the map until 'Show again'. On the website the hide is for everyone
  // (kept by the vote server, see the votes below); elsewhere it is kept on this phone only
  const sharedHide = !!D.votes && /^https?:$/.test(location.protocol)
  let hiddenBy = sharedHide ? store.get('hiddenShared', {}) : {} // 'ht:<id>' -> { by, t }: the last list loaded
  const hiddenStays = new Set(sharedHide ? Object.keys(hiddenBy).map((k) => k.slice(3)) : store.get('hiddenStays', []))
  const isHiddenStay = (card) => !!card.dataset.stay && hiddenStays.has(card.dataset.stay)
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
        let ok = !isHiddenStay(card) && Object.entries(state).every(([g, v]) => match(card, g, v))
        if (ok && query) ok = (card.dataset.text || card.textContent).toLowerCase().includes(query)
        card.hidden = !ok; if (ok) shown++
      })
      if (empty) empty.hidden = shown > 0
      if (bar) $$('.chip[data-value]', bar).forEach((chip) => {
        const n = $('.n', chip); if (!n) return
        const g = chip.dataset.group, v = chip.dataset.value
        n.textContent = cards.filter((c) => !isHiddenStay(c) && Object.entries(state).every(([gg, vv]) => gg === g || match(c, gg, vv)) && match(c, g, v)).length
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

  /* ---------- hidden villas: 'Hide' on a card, 'Show again' in the Hidden villas list under the cards ---------- */
  function syncHiddenStays() {
    const box = $('#hidden-stays'), list = $('#hidden-stays-list')
    const cards = Array.from(hiddenStays).map((id) => document.getElementById('ht-' + id)).filter(Boolean)
    if (box && list) {
      box.hidden = !cards.length
      const n = $('#hidden-stays-n'); if (n) n.textContent = cards.length
      list.innerHTML = cards.map((c) => '<div class="mine-item"><b>' + esc(c.dataset.name) + '</b>' +
        (hiddenBy['ht:' + c.dataset.stay]?.by ? '<span class="note">Hidden by ' + esc(hiddenBy['ht:' + c.dataset.stay].by) + '</span>' : '') +
        '<div class="actions"><button class="btn" type="button" data-unhide-stay="' + esc(c.dataset.stay) + '">Show again</button></div></div>').join('') +
        (cards.length > 1 ? '<button class="btn" type="button" data-unhide-stay="*">Show all again</button>' : '')
    }
    syncHiddenPins()
    lists.forEach((l) => l.apply())
  }
  function setStayHidden(id, hide) {
    if (id === '*') hiddenStays.clear(); else if (hide) hiddenStays.add(id); else hiddenStays.delete(id)
    saveOrWarn('hiddenStays', Array.from(hiddenStays)); syncHiddenStays()
  }
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-hide-stay]')
    if (h) {
      e.preventDefault()
      const id = h.dataset.hideStay
      if (sharedHide) { askShared('hide', id); return }
      setStayHidden(id, true)
      toast('Hidden: ' + (document.getElementById('ht-' + id)?.dataset.name || 'villa'), { label: 'Undo', run: () => { setStayHidden(id, false); $('#toast').hidden = true } })
      return
    }
    const u = e.target.closest('[data-unhide-stay]')
    if (u && sharedHide) { e.preventDefault(); askShared('show', u.dataset.unhideStay); return }
    if (u) { e.preventDefault(); setStayHidden(u.dataset.unhideStay, false); toast(u.dataset.unhideStay === '*' ? 'All villas are back on the list' : 'Back on the list') }
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
  /* ---------- Vercel Web Analytics (website only): visitors, countries, devices, and each tab and villa opened ---------- */
  // the guide changes page by #hash, which Vercel's script does not notice, so each tab and villa is sent as its own page
  const vercelVa = (() => {
    if (!D.votes || location.protocol !== 'https:') return false
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments) }
    const s = document.createElement('script')
    s.src = '/_vercel/insights/script.js'; s.defer = true; s.dataset.disableAutoTrack = '1'
    document.head.appendChild(s)
    return true
  })()
  let lastPage = ''
  function pageview(view, focusEl) {
    const path = '/' + view + (focusEl && focusEl.id ? '/' + focusEl.id : '')
    if (!vercelVa || path === lastPage) return
    lastPage = path
    window.va('pageview', { route: path, path })
  }
  let current = null
  function show(view, focusEl) {
    if (exitFull) exitFull() // a link in a map popup opens a card: show the page again
    syncBack(view)
    if (view === 'stay' && current !== 'stay') sortStays(true) // coming to the villas: put them in order now
    if (view !== current) track('view', view)
    if (focusEl) track('card', focusEl.id)
    if (view === 'stats' && current !== 'stats') renderStats()
    // a view that this build does not have (e.g. #apps before data/apps.json exists) falls back to home
    if (!VIEWS.includes(view) || !document.getElementById(view)) view = 'home'
    pageview(view, focusEl)
    VIEWS.forEach((v) => { const el = document.getElementById(v); if (el) el.hidden = v !== view })
    tabs.forEach((a) => { if (a.getAttribute('href') === '#' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') })
    if (view === 'areas') initMap()
    if (focusEl) {
      // a link to a card that the current filters hide: clear that list's filters first
      if (focusEl.hidden) { const l = lists.find((x) => x.el.contains(focusEl)); if (l) l.reset() }
      holdAnchor(focusEl)
      requestAnimationFrame(() => {
        focusEl.scrollIntoView({ block: 'start' })
        focusEl.classList.remove('flash'); void focusEl.offsetWidth; focusEl.classList.add('flash')
      })
    } else if (current !== view) window.scrollTo(0, 0)
    current = view
    if (view === 'areas' && map) setTimeout(() => map.invalidateSize(), 50)
  }
  // a link to a card (a shared villa link, a card from the map) keeps the card at the top of the screen while parts
  // above it appear a moment later (votes, notes, move buttons), until you scroll or tap yourself
  let anchorEl = null, anchorUntil = 0
  function holdAnchor(el) { anchorEl = el; anchorUntil = Date.now() + 6000 }
  ;['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, () => { anchorEl = null }, { passive: true }))
  function reanchor() { if (anchorEl && Date.now() < anchorUntil && anchorEl.offsetParent) anchorEl.scrollIntoView({ block: 'start' }) }
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
  let map = null, layers = {}, markers = {}, bases = {}, base = null, pendingFocus = null, waitingForLeaflet = false, satPack = null, exitFull = null
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
    const villa = p.t === 'hotel'
    // the card link remembers the pin, so the card can offer Back to map
    // came from this card (Open the big map / On map): the same link says Back to villa (event, place)
    const cardLabel = p.card && p.card === backToCard ? backLabel(p.card) : villa ? 'See villa' : 'Details'
    const card = p.card ? '<a class="btn' + (villa ? ' primary' : '') + '" href="#' + p.card + '" data-from-map="' + esc(p.t + ':' + p.id) + '">' + cardLabel + '</a>' : ''
    if (villa) {
      // the card's photo (when the map is tall enough for it), the trip total in bold, Google Maps at the pin's exact
      // spot (Airbnb pins are approximate: the same spot as here, not the door) and the listing
      const img = p.card && map && map.getSize().y >= 440 && document.querySelector('#' + p.card + ' .media img')
      const thumb = img ? '<img class="pop-thumb" src="' + esc(img.getAttribute('src')) + '" alt="">' : ''
      const price = p.price ? '<p class="pop-price"><b>' + esc(p.price) + '</b> ' + esc(p.priceNote || '') + (p.priceAmd ? '<span>' + esc(p.priceAmd) + '</span>' : '') + (p.pricePp ? '<small>' + esc(p.pricePp) + '</small>' : '') + '</p>' : ''
      const web = p.web ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(p.web) + '">' + esc(p.webLabel) + '</a>' : ''
      const gm = '<a class="btn" target="_blank" rel="noopener" data-gmaps-pin href="' + gmaps(p.lat + ',' + p.lng) + '">Google Maps</a>'
      return thumb + '<h4>' + esc(p.name) + '</h4>' + (p.sub ? '<p>' + esc(p.sub) + '</p>' : '') + price + '<div class="actions">' + card + gm + web + '</div>'
    }
    const dir = p.nodir ? '' : '<a class="btn" target="_blank" rel="noopener" href="' + gdir(p.dlat ?? p.lat, p.dlng ?? p.lng) + '">' + esc(p.dlabel || 'Directions') + '</a>'
    return '<h4>' + esc(p.name) + '</h4>' + (p.sub ? '<p>' + esc(p.sub) + '</p>' : '') +
      '<div class="actions"><a class="btn primary" target="_blank" rel="noopener" href="' + gmaps(p.q, p.pid) + '">Google Maps</a>' + dir + card + '</div>'
  }
  function setBase(name, byUser) {
    if (!map) return
    Object.values(bases).forEach((l) => l && map.removeLayer(l))
    if (satPack) map.removeLayer(satPack)
    base = name
    // the vector land and roads sit under the tile pane: real tiles cover them, and they fill any gaps offline
    if (name !== 'simple') {
      const t = name === 'satellite' ? D.tiles.satellite : D.tiles.streets
      // satellite: the saved offline tiles stand in for Esri's when there is no internet (offline now, or Esri's tiles do
      // not load); online the map shows Esri's alone, so the credit line under it names only what is showing
      const pack = name === 'satellite' ? satPack : null
      const usePack = () => { if (pack && !map.hasLayer(pack)) { pack.addTo(map); pack.bringToBack() } }
      let ok = 0, bad = 0, told = false
      const layer = L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19, maxNativeZoom: t.maxNative || 19, crossOrigin: true })
      const reset = () => { ok = 0; bad = 0 }
      layer.on('tileload', () => { ok++ })
      layer.on('tileerror', () => {
        bad++
        if (bad !== 4 || ok !== 0) return
        if (!pack) { setBase('simple'); toast('No map tiles here right now. Showing the offline map.') }
        else { usePack(); if (!told) { told = true; toast('No internet: showing the saved satellite map. It is less sharp up close.') } }
      })
      map.on('movestart', reset)
      layer.on('remove', () => map.off('movestart', reset))
      bases[name] = layer.addTo(map)
      layer.bringToBack()
      if (!navigator.onLine) usePack()
    }
    $$('.basebar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.base === base)))
    // street tiles only come in a light style; invert them for dark mode
    map.getContainer().classList.toggle('dim-tiles', base === 'streets' && isDark())
    if (byUser) store.set('mapBase', base) // 'mapBase', not the old 'base': everyone starts on Satellite (17 Oct 2026)
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
  // Wheel and trackpad zoom that follows the fingers. Leaflet's own wheel zoom collects 40 ms of scrolling, rounds it
  // up to a zoomSnap step and animates each step, so a trackpad zooms in slow, clicky jumps. This eases towards the
  // wanted zoom every frame the way pinch zoom does (map._move with pinch: true), keeps the place under the pointer
  // still, and settles on the zoom snap once the wheel stops.
  function smoothWheel(m) {
    const el = m.getContainer()
    let active = false, goal = 0, z = 0, anchor = null, offset = null, raf = 0, idle = 0
    const centerFor = (zz) => m.unproject(m.project(anchor, zz).subtract(offset), zz)
    const end = () => {
      active = false
      const zz = m._limitZoom(z)
      if (m.options.zoomAnimation) m._animateZoom(centerFor(zz), zz, true, m.options.zoomSnap)
      else m._resetView(centerFor(zz), zz)
    }
    const frame = () => {
      raf = 0
      z = Math.abs(goal - z) < 0.01 ? goal : z + (goal - z) * 0.3
      m._move(centerFor(z), z, { pinch: true, round: false })
      if (z !== goal) raf = requestAnimationFrame(frame)
      else if (!idle) end()
    }
    el.addEventListener('wheel', (e) => {
      e.preventDefault() // the page must not scroll or zoom under the map
      if (!active && m._animatingZoom) return
      const r = el.getBoundingClientRect()
      const pt = L.point(e.clientX - r.left, e.clientY - r.top)
      if (!active) { m._stop(); active = true; z = goal = m.getZoom(); m._moveStart(true, false) }
      anchor = m.containerPointToLatLng(pt)
      offset = pt.subtract(m.getSize().divideBy(2))
      // pixels: 120 per zoom level for a wheel or a two-finger scroll; ctrl + wheel is a trackpad pinch, which Chrome
      // and Firefox scale so that 100 px is a factor of e
      const px = e.deltaY * (e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? 400 : 1)
      const dz = Math.max(-1, Math.min(1, -px / (e.ctrlKey ? 69.3 : 120)))
      goal = Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), goal + dz))
      if (!raf) raf = requestAnimationFrame(frame)
      clearTimeout(idle)
      idle = setTimeout(() => { idle = 0; if (active && !raf) end() }, 160)
    }, { passive: false })
  }
  // The offline satellite layer (EOxCloudless tiles saved with the guide, up to zoom 14). Where this zoom has no saved
  // tile, the nearest lower-zoom tile is shown enlarged, so the whole trip area has a picture at every zoom.
  let satInline = null // the single file's tiles, read once (the big map and the villa maps share them)
  // the map credits (OpenStreetMap, Esri, EOX) go in a line under the map, not in a box on it: the credits of the layers
  // on the map right now, so it only names what is showing (worked out once per frame, as layers come and go)
  const OSM_CREDIT = ''
  function creditsUnder(m, el) {
    if (!el) return
    let queued = false
    const update = () => {
      queued = false
      const seen = new Set()
      m.eachLayer((l) => { const a = l.getAttribution && l.getAttribution(); if (a) seen.add(a) })
      el.innerHTML = [...seen].join(' · ')
    }
    m.on('layeradd layerremove', () => { if (!queued) { queued = true; requestAnimationFrame(update) } })
    update()
  }
  function makeSatPack() {
    const o = D.tiles && D.tiles.offline
    if (!o) return null
    let inline = null
    if (o.inline) { try { inline = satInline || (satInline = JSON.parse($('#sat-data').textContent)) } catch { return null } }
    const has = (z, x, y) => (o.ranges[z] || []).some((r) => x >= r[0] && x <= r[1] && y >= r[2] && y <= r[3])
    const best = (c) => {
      for (let z = Math.min(c.z, o.maxZoom); z >= o.minZoom; z--) {
        const d = c.z - z, x = c.x >> d, y = c.y >> d
        if (has(z, x, y)) return { z, x, y, d }
      }
      return null
    }
    const src = (t) => (inline ? inline[t.z + '/' + t.x + '/' + t.y] : o.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y))
    const Pack = L.GridLayer.extend({
      _isValidTile(c) { return !!best(c) && L.GridLayer.prototype._isValidTile.call(this, c) },
      createTile(c, done) {
        const tile = document.createElement('div')
        const a = best(c), n = 1 << a.d
        const im = new Image()
        im.onload = () => {
          tile.style.backgroundImage = 'url("' + im.src + '")'
          tile.style.backgroundSize = n * 100 + '%'
          // the part of the bigger tile that this tile covers
          if (n > 1) tile.style.backgroundPosition = ((c.x - (a.x << a.d)) / (n - 1)) * 100 + '% ' + ((c.y - (a.y << a.d)) / (n - 1)) * 100 + '%'
          done(null, tile)
        }
        im.onerror = () => done(new Error('offline tile missing'), tile)
        im.src = src(a)
        return tile
      },
    })
    return new Pack({ className: 'sat-pack', maxNativeZoom: o.maxZoom, attribution: o.attr })
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
    map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5, minZoom: 8, maxZoom: 18, maxBounds: [[6.9, 97.6], [10.3, 100.6]], zoomAnimation: anim, fadeAnimation: anim, markerZoomAnimation: anim })
    smoothWheel(map)
    satPack = makeSatPack()
    creditsUnder(map, $('#map-credit'))
    map.createPane('landPane').style.zIndex = 150 // under the tile pane (200)
    map.createPane('roadsPane').style.zIndex = 160
    map.createPane('areasPane').style.zIndex = 350 // below the pins in the overlay pane (400)
    layers.land = L.geoJSON(D.land, { pane: 'landPane', interactive: false, attribution: OSM_CREDIT, style: { fillColor: cssVar('--map-land'), fillOpacity: 1, color: cssVar('--map-line'), weight: 1 } }).addTo(map)
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
    ;['event', 'place', 'gem', 'hotel'].forEach((t) => layers[t].addTo(map))
    D.points.forEach((p) => {
      // the popup is built when it opens, so it fits the map's size at that moment (full screen or not)
      const m = L.circleMarker([p.lat, p.lng], dotStyle(p.k)).bindPopup(() => popupHtml(p), popupOpts())
      m.kind = p.k
      m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -6] })
      layers[p.k === 'gem' ? 'gem' : p.t].addLayer(m)
      markers[p.t + ':' + p.id] = m
    })
    syncHiddenPins()
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
    const chosen = store.get('mapBase', null)
    // Satellite unless someone picked another style; offline the saved satellite tiles (or the plain map without them)
    const start = chosen || 'satellite'
    setBase(!canTiles ? 'simple' : navigator.onLine ? start : start === 'satellite' && satPack ? 'satellite' : 'simple')
    if (canTiles && !navigator.onLine && start === 'streets' && 'caches' in window) {
      // offline but street tiles were saved while browsing: use them, the error fallback covers gaps
      caches.open('guide-tiles').then((c) => c.keys()).then((k) => { if (k.length > 10) setBase('streets') }).catch(() => {})
    }
    // the connection drops while the map is on Satellite: put the saved satellite tiles under it at once
    addEventListener('offline', () => { if (base === 'satellite' && satPack && !map.hasLayer(satPack)) { satPack.addTo(map); satPack.bringToBack() } })
    const home = L.latLngBounds([[7.75, 98.25], [8.30, 98.47]])
    const fitHome = (anim2) => map.fitBounds(home, { paddingTopLeft: [10, 58], paddingBottomRight: [10, 64], animate: anim2 })
    // after a refresh in the same tab the map comes back where it was, otherwise it shows all of Phuket
    const lastView = session.get('mapView')
    if (lastView && Array.isArray(lastView.c)) map.setView(lastView.c, lastView.z, { animate: false }); else fitHome(false)
    map.on('moveend', () => { const c = map.getCenter(); session.set('mapView', { c: [+c.lat.toFixed(5), +c.lng.toFixed(5)], z: map.getZoom() }) })
    const mapEl = map.getContainer()
    // while a popup is open the floating Back to villa button hides, so it never covers the popup's buttons
    map.on('popupopen', () => { mapEl.parentElement.classList.add('popup-open'); root.classList.add('map-popup') })
    map.on('popupclose', () => { mapEl.parentElement.classList.remove('popup-open'); root.classList.remove('map-popup') })
    const zoomClass = () => { mapEl.classList.toggle('z-low', map.getZoom() < 9.75); requestAnimationFrame(declutterLabels) }
    map.on('zoomend moveend', zoomClass); zoomClass()
    $('#map-zoom-in')?.addEventListener('click', () => map.zoomIn())
    $('#map-zoom-out')?.addEventListener('click', () => map.zoomOut())
    $('#map-fit')?.addEventListener('click', () => fitHome(!reduceMotion))
    // full screen: the map box covers the page (CSS), and the browser's own full screen hides its bars where it
    // exists (Android, desktop); iPhone Safari has no full screen for pages, so there it is the CSS part alone
    const box = mapEl.parentElement, fullBtn = $('#map-full')
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement
    const quiet = (fn, ctx) => { try { const r = fn && fn.call(ctx); if (r && r.catch) r.catch(() => {}) } catch { /* not available */ } }
    const setFull = (on) => {
      if (box.classList.contains('full') === on) return
      box.classList.toggle('full', on)
      root.classList.toggle('map-full', on)
      if (fullBtn) { fullBtn.setAttribute('aria-pressed', String(on)); fullBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen') }
      if (!on && fsEl()) quiet(document.exitFullscreen || document.webkitExitFullscreen, document)
      map.invalidateSize()
    }
    exitFull = () => setFull(false)
    fullBtn?.addEventListener('click', () => {
      const on = !box.classList.contains('full')
      setFull(on)
      if (on && !fsEl()) quiet(box.requestFullscreen || box.webkitRequestFullscreen, box)
    })
    ;['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
      if (!fsEl()) setFull(false)
      setTimeout(() => map.invalidateSize(), 60) // the browser bars come and go after the event
    }))
    // Esc in full screen closes an open popup first, then full screen
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !box.classList.contains('full')) return
      if (box.classList.contains('popup-open')) map.closePopup(); else setFull(false)
    })
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
  function syncHiddenPins() {
    if (!map) return
    Object.entries(markers).forEach(([k, m]) => {
      if (!k.startsWith('hotel:')) return
      if (hiddenStays.has(k.slice(6))) layers.hotel.removeLayer(m); else layers.hotel.addLayer(m)
    })
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
    const card = b.closest('.card')
    backToCard = card ? card.id : null
    openOnMap(b.dataset.onMap)
  })
  function openOnMap(key) {
    track('map', key)
    if (location.hash !== '#areas') { pendingFocus = key; location.hash = 'areas' } else if (map) focusPoint(key)
    setTimeout(() => { if (map && pendingFocus) { focusPoint(pendingFocus); pendingFocus = null } }, 120)
  }
  // from a map popup to its card and back: the card's view shows Back to map, which reopens the same popup;
  // going anywhere else drops it
  let backTo = null
  const backBtn = $('#back-to-map')
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-from-map]'); if (a) backTo = { key: a.dataset.fromMap, view: null } }, true)
  backBtn?.addEventListener('click', () => { const k = backTo && backTo.key; backTo = null; backBtn.hidden = true; if (k) openOnMap(k) })
  function syncBack(view) {
    if (backTo && backTo.view === null) backTo.view = view
    if (backTo && (view !== backTo.view || view === 'areas')) backTo = null
    if (backBtn) backBtn.hidden = !backTo
    // and the other way: from a card to the big map, the map shows Back to villa (or event, place), back to that card
    if (backToCard && view !== 'areas') backToCard = null
    if (backCardBtn) {
      backCardBtn.hidden = !backToCard
      if (backToCard) $('span', backCardBtn).textContent = backLabel(backToCard)
    }
  }
  let backToCard = null // the id of the card the big map was opened from
  const backLabel = (id) => 'Back to ' + ({ ht: 'villa', ev: 'event', pl: 'place', mx: 'money changer' }[id.slice(0, 2)] || 'the list')
  const backCardBtn = $('#back-to-card')
  backCardBtn?.addEventListener('click', () => { const id = backToCard; backToCard = null; backCardBtn.hidden = true; if (id) location.hash = id })
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
    const whole = (c) => c === 'THB' || c === 'AMD' // no coins worth showing
    const fmt = (n, c) => (c === 'THB' ? '฿' : '') + n.toLocaleString('en-US', { maximumFractionDigits: whole(c) ? 0 : 2 }) + (c === 'THB' ? '' : ' ' + c)
    function calc() {
      const a = parseFloat(String(amt.value).replace(/,/g, '')) || 0
      const r = rates[cur.value]
      if (!r) { out.textContent = '—'; return }
      const res = toThb ? a * r : a / r
      const best = D.rates.best && D.rates.best[cur.value]
      // a currency worth less than a baht (the dram) reads better as "฿1 ≈ 10.8 AMD"
      const perBaht = '฿1 ≈ ' + (1 / r).toLocaleString('en-US', { maximumFractionDigits: 1 / r >= 10 ? 1 : 4 }) + ' ' + cur.value
      let extra = toThb ? (r < 1 ? perBaht : '1 ' + cur.value + ' ≈ ฿' + r.toFixed(2)) + ' (mid-market)' : perBaht
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
      let missing = 0, missingSat = 0
      try {
        const key = (await caches.keys()).find((k) => k.startsWith('guide-') && k !== 'guide-tiles')
        if (key) {
          const keys = (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname)
          const sat = keys.filter((p) => p.includes('/sat/')).length
          missing = Math.max(0, (D.precacheCount || 0) - (keys.length - sat))
          missingSat = Math.max(0, (D.satCount || 0) - sat)
        }
      } catch { /* cache API not available */ }
      if (ios && !standalone) setOff('Saved in Safari for now. Add it to your Home Screen to keep it: Safari clears sites you have not opened for a week.', false)
      else if (missing > 0) setOff('Saved for offline use, but ' + missing + (missing === 1 ? ' photo is' : ' photos are') + ' missing. Open the guide again on good Wi-Fi.', false)
      else if (missingSat > 0) setOff('Saved for offline use, but part of the offline satellite map is missing. Open the guide again on good Wi-Fi.', false)
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

  /* ---------- villa photo galleries: swipe through the listing's photos ---------- */
  // the photos come from Airbnb / Booking.com: each is fetched only when you get near it (the next one once the card is
  // on screen); the artifact cannot show outside photos, so its galleries stay on the saved photo
  const OFFLINE_PHOTO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 405"><rect width="720" height="405" fill="#8a9a9c"/><text x="360" y="212" fill="#fff" font-family="sans-serif" font-size="30" text-anchor="middle">Photo needs internet</text></svg>')
  const galleries = D.build === 'artifact' ? [] : $$('[data-gallery]')
  const near = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.galleryNear(); near.unobserve(e.target) } }), { rootMargin: '200px 0px' }) : null
  galleries.forEach((g) => {
    const media = g.parentElement, imgs = $$('img', g), count = $('.gal-count', media)
    const prev = $('.gal-btn.prev', media), next = $('.gal-btn.next', media)
    g.classList.add('on')
    const load = (i) => { const im = imgs[i]; if (im && im.dataset.src) { im.src = im.dataset.src; im.removeAttribute('data-src') } }
    imgs.forEach((im) => im.addEventListener('error', () => { if (!im.classList.contains('gal-off')) { im.classList.add('gal-off'); im.src = OFFLINE_PHOTO } }))
    const at = () => Math.round(g.scrollLeft / (g.clientWidth || 1))
    let shown = -1
    const update = () => {
      const i = Math.min(imgs.length - 1, Math.max(0, at()))
      if (i === shown) return
      shown = i
      if (count) count.textContent = (i + 1) + ' / ' + imgs.length
      if (prev) prev.disabled = i === 0
      if (next) next.disabled = i === imgs.length - 1
      load(i); load(i + 1)
      if (i > 0 && !g.tracked) { g.tracked = true; track('photos', g.closest('.card')?.id || '') } // once per villa
    }
    g.galleryNear = () => load(at() + 1)
    let ticking = false
    g.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; update() }) } }, { passive: true })
    const go = (d) => g.scrollTo({ left: (at() + d) * g.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' })
    prev?.addEventListener('click', () => go(-1))
    next?.addEventListener('click', () => go(1))
    g.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(e.key === 'ArrowRight' ? 1 : -1) } })
    if (prev) prev.disabled = true
    if (near) near.observe(g); else g.galleryNear()
  })

  /* ---------- shared votes (Like / Skip by name) and villas hidden for everyone, on the website (api/votes) ---------- */
  const voteBars = $$('[data-vote-item]')
  // this phone: a random id kept on it, for the Stats page, and so your own changes do not pop up as news
  const device = (() => {
    let d = store.get('device', '')
    if (!/^[a-z0-9]{8,32}$/.test(d)) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join(''); store.set('device', d) }
    return d
  })()
  let ver = 0 // the server's version last loaded
  let seenT = store.get('seenT', 0) // the newest shared change this phone has seen
  let firstAnnounce = true
  // other people's changes, as they happen: "Ani liked Mouana Breeze", with Show to go to it
  const DID = { like: 'liked', skip: 'skipped', unvote: 'took back a vote on', hide: 'hid', show: 'brought back', move: 'moved', reset: 'reset the place of', note: 'added a note on', unnote: 'deleted a note on' }
  const cardOf = (x) => { const m = /^(ht|ev|pl):(.+)$/.exec(x || ''); return m ? document.getElementById(m[1] + '-' + m[2]) : null }
  function describe(r) {
    const who = r.n || 'Someone'
    if (r.x === 'all') return r.e === 'reset' ? who + ' reset all villa positions' : who + (r.e === 'note' ? ' added a group note' : r.e === 'unnote' ? ' deleted a group note' : ' changed something')
    const c = cardOf(r.x)
    return who + ' ' + (DID[r.e] || r.e) + ' ' + (c ? c.dataset.name : 'a villa')
  }
  function announce(recent) {
    const fresh = recent.filter((r) => r.t > seenT && r.d !== device)
    const newest = Math.max(seenT, ...recent.map((r) => r.t || 0))
    const hadSeen = seenT > 0
    if (newest > seenT) { seenT = newest; store.set('seenT', seenT) }
    const first = firstAnnounce; firstAnnounce = false
    if (!fresh.length || (first && !hadSeen)) return // a first visit: no flood of old news
    const r = fresh[0], c = cardOf(r.x)
    const text = (first ? 'Since your last visit: ' : '') + describe(r) + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ' more)' : '')
    const to = c ? c.id : r.x === 'all' && document.getElementById('notes') ? 'notes' : '' // a group note: the Notes tab
    toast(text, to ? { label: 'Show', run: () => { $('#toast').hidden = true; location.hash = to } } : undefined)
  }
  // what people do in the guide, for the Stats page: sent in small batches (and when the page is closed)
  const queue = []
  let flushTimer = 0
  function flush(closing) {
    if (!queue.length || !navigator.onLine) return
    const body = JSON.stringify({ device, name: voterName(), track: queue.splice(0, 30) })
    if (closing && navigator.sendBeacon) { navigator.sendBeacon(D.votes, new Blob([body], { type: 'application/json' })); return }
    fetch(D.votes, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  }
  function track(e, x) {
    if (!D.votes || !/^https?:$/.test(location.protocol)) return
    queue.push({ e, x: String(x || '').slice(0, 100) })
    clearTimeout(flushTimer)
    if (queue.length >= 20) flush(); else flushTimer = setTimeout(flush, 6000)
  }
  addEventListener('pagehide', () => flush(true))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true) })
  const dlg = $('#vote-dialog')
  const VOTE = { like: 'Like', skip: 'Skip' }
  const canVote = !!D.votes && /^https?:$/.test(location.protocol) && !!dlg
  let votes = canVote ? store.get('votes', null) : null // the last votes loaded, also shown offline
  let pending = null // what the open name dialog will send: { body(name) -> [POST bodies], done(name, first body) -> toast }
  const voterName = () => store.get('voterName', '')
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  const mineOf = (it) => { const me = voterName(); return !me ? null : it.like.some((n) => same(n, me)) ? 'like' : it.skip.some((n) => same(n, me)) ? 'skip' : null }
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's')
  function renderVotes() {
    if (!votes) return
    voteBars.forEach((bar) => {
      const it = votes[bar.dataset.voteItem] || { like: [], skip: [] }
      const mine = mineOf(it)
      bar.hidden = false
      ;['like', 'skip'].forEach((v) => {
        const b = $('[data-vote-btn="' + v + '"]', bar)
        $('b', b).textContent = it[v].length
        b.setAttribute('aria-pressed', String(mine === v))
      })
      $('.voters', bar).textContent = [it.like.length ? 'Like: ' + it.like.join(', ') : '', it.skip.length ? 'Skip: ' + it.skip.join(', ') : ''].filter(Boolean).join(' · ')
    })
    sortStays()
    // Group picks: the villas with likes, most first (fewer skips breaks a tie)
    const box = $('#group-picks-box'), list = $('#group-picks')
    if (!box || !list) return
    const rows = Object.entries(votes).filter(([k, it]) => k.startsWith('ht:') && it.like.length && !hiddenStays.has(k.slice(3)))
      .map(([k, it]) => ({ it, card: document.getElementById('ht-' + k.slice(3)) })).filter((r) => r.card)
      .sort((a, b) => b.it.like.length - a.it.like.length || a.it.skip.length - b.it.skip.length)
    box.hidden = !rows.length
    list.innerHTML = rows.map((r) => '<li><a href="#' + r.card.id + '">' + esc(r.card.dataset.name) + '</a> <span>' + plural(r.it.like.length, 'like') +
      (r.it.skip.length ? ' · ' + plural(r.it.skip.length, 'skip') : '') + '</span><small>' + esc(r.it.like.join(', ')) + '</small></li>').join('')
  }
  // the villa list order, the same for everyone:
  //   1. villas someone moved by hand (Move up / down) keep the place they were moved to;
  //   2. the rest fill the other places: liked villas first, most likes first, then the newest like, then fewer
  //      skips; then the others in the guide's own order (listFirst first).
  // Other people's changes only re-sort it while you are not reading it, so cards do not move under your finger; your
  // own moves and likes re-sort it at once, and the cards slide to their new places
  const stayList = $('[data-list="stay"]')
  const stayCards = stayList ? $$(':scope > .card', stayList) : [] // in the guide's order
  let pins = canVote ? store.get('villaPins', null) : null // { map: { id: place }, by, t }, the last pins loaded
  function stayOrder() {
    const it = (c) => (votes && votes['ht:' + c.dataset.stay]) || { like: [], skip: [], last: 0 }
    const natural = stayCards.slice().sort((a, b) => it(b).like.length - it(a).like.length || (it(b).last || 0) - (it(a).last || 0) ||
      it(a).skip.length - it(b).skip.length || stayCards.indexOf(a) - stayCards.indexOf(b))
    const map = (pins && pins.map) || {}
    const placed = new Array(stayCards.length).fill(null)
    stayCards.filter((c) => Number.isInteger(map[c.dataset.stay])).sort((a, b) => map[a.dataset.stay] - map[b.dataset.stay]).forEach((c) => {
      let at = Math.min(map[c.dataset.stay], placed.length - 1)
      while (at < placed.length && placed[at]) at++ // a place already taken: the next free one
      if (at >= placed.length) { at = placed.lastIndexOf(null) }
      placed[at] = c
    })
    const rest = natural.filter((c) => !placed.includes(c))
    return placed.map((c) => c || rest.shift())
  }
  // put the cards in order; with animate, every card that changes place slides there (FLIP: measure, move, then
  // animate from where it was), and the page does not scroll
  function sortStays(now, animate) {
    if (!stayList || !votes) return
    const view = document.getElementById('stay')
    if (!now && view && !view.hidden && stayList.getBoundingClientRect().top < innerHeight) return
    const sorted = stayOrder()
    if (!sorted.some((c, i) => stayList.children[i] !== c)) return
    const was = animate && !reduceMotion ? new Map(stayCards.map((c) => [c, c.getBoundingClientRect().top])) : null
    sorted.forEach((c) => stayList.appendChild(c))
    if (!was) return
    stayCards.forEach((c) => {
      const dy = was.get(c) - c.getBoundingClientRect().top
      if (!dy || c.hidden || !c.animate) return
      c.style.position = 'relative'; c.style.zIndex = dy < 0 ? '2' : '1'
      c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' })
        .finished.then(() => { c.style.position = ''; c.style.zIndex = '' }, () => {})
    })
  }
  // Reset position on a villa that has a fixed place, and Reset all positions while any villa has one
  function syncPinUI() {
    const map = (pins && pins.map) || {}
    $$('[data-unpin-stay]').forEach((b) => { b.hidden = !canVote || !Number.isInteger(map[b.closest('.card').dataset.stay]) })
    const note = $('#pins-note'); if (note) note.hidden = !canVote || !Object.keys(map).length
  }
  async function unpin(ids, name) {
    const before = pins, map = { ...((pins && pins.map) || {}) }
    ids.forEach((id) => delete map[id])
    pins = { map, by: name, t: Date.now() }
    sortStays(true, true); syncPinUI()
    try {
      applyShared(await post({ name, pins: Object.fromEntries(ids.map((id) => [id, null])) }))
      toast(ids.length > 1 ? 'All positions reset for everyone' : 'Position reset for everyone')
    } catch { pins = before; sortStays(true, true); syncPinUI(); failed() }
  }
  // the next villa on the list in that direction (hidden and filtered-out ones are skipped)
  function neighbourOf(card, dir) {
    let n = card
    do { n = dir === 'up' ? n.previousElementSibling : n.nextElementSibling } while (n && n.hidden)
    return n
  }
  // a move pins the villa to its neighbour's place; a neighbour that was pinned too takes the villa's old place
  async function moveStay(card, dir, name) {
    const other = neighbourOf(card, dir)
    if (!other) { toast(dir === 'up' ? 'Already at the top' : 'Already at the bottom'); return }
    const cards = [...stayList.children], from = cards.indexOf(card), to = cards.indexOf(other)
    const map = { ...((pins && pins.map) || {}) }
    const change = { [card.dataset.stay]: to }
    if (Number.isInteger(map[other.dataset.stay])) change[other.dataset.stay] = from
    const before = pins
    Object.assign(map, change)
    pins = { map, by: name, t: Date.now() }
    sortStays(true, true); syncPinUI()
    try {
      applyShared(await post({ name, pins: change }))
      toast('Moved ' + dir + ' for everyone')
    } catch {
      pins = before; sortStays(true, true); syncPinUI() // slide back
      toast(navigator.onLine ? 'Could not move it. Try again in a minute.' : 'This needs internet.')
    }
  }
  // every few seconds: one small question (has anything changed since version ver?), and everything only if it has
  async function loadVotes() {
    if (!canVote || !navigator.onLine) return
    try {
      const r = await fetch(D.votes + (ver ? '?ver=' + ver : ''), { cache: 'no-store' })
      if (!r.ok) throw new Error('votes ' + r.status)
      const j = await r.json()
      if (!j.same) applyShared(j)
    } catch { /* offline, or voting not set up yet: keep the last votes */ }
  }
  // what the server sent: everyone's votes and the villas hidden for everyone
  function applyShared(j) {
    if (j.ver) ver = j.ver
    if (j.recent) announce(j.recent)
    votes = j.votes || {}; store.set('votes', votes)
    if (j.notes) { notes = j.notes; store.set('notes', notes); renderNotes() }
    if ('pins' in j) { pins = j.pins; store.set('villaPins', pins); syncPinUI() }
    $$('[data-move-stay]').forEach((b) => { b.hidden = false }) // the server is there: moving works
    if (j.hidden) {
      hiddenBy = j.hidden; store.set('hiddenShared', hiddenBy)
      hiddenStays.clear(); Object.keys(hiddenBy).forEach((k) => hiddenStays.add(k.slice(3)))
      syncHiddenStays()
    }
    renderVotes()
    requestAnimationFrame(reanchor)
  }
  const NOTE_VOTE = 'Everyone with the guide sees the names. One vote per name.'
  // shared notes: on each villa (its Notes accordion) and for the whole trip (Group notes on the Trip page)
  let notes = canVote ? store.get('notes', null) : null // the last notes loaded, also shown offline
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  function renderNotes() {
    if (!notes) return
    const me = voterName()
    const noteLi = (x) => '<li><p>' + esc(x.text).replace(/\n/g, '<br>') + '</p><small>' + esc(x.by) + ' · ' + esc(when(x.t)) + '</small>' +
      (me && same(x.by, me) ? '<button class="note-del" type="button" data-note-del="' + esc(x.id) + '" aria-label="Delete this note">' + '×' + '</button>' : '') + '</li>'
    $$('[data-notes]').forEach((box) => {
      const list = notes[box.dataset.notes] || []
      box.hidden = false
      const n = $('.notes-n', box); if (n) n.textContent = list.length ? '(' + list.length + ')' : ''
      // a villa with no notes shows just Add a note; Group notes says there are none yet
      box.classList.toggle('empty', !list.length)
      $('.notes-list', box).innerHTML = list.length ? list.map(noteLi).join('') : '<li class="quiet">No notes yet.</li>'
    })
    // the Notes tab: every villa's notes in one list, the villa with the newest note first
    const vbox = $('#villa-notes')
    if (!vbox) return
    const rows = Object.entries(notes).filter(([k, l]) => k.startsWith('ht:') && l.length && document.getElementById('ht-' + k.slice(3)))
      .sort((a, b) => Math.max(...b[1].map((x) => x.t || 0)) - Math.max(...a[1].map((x) => x.t || 0)))
    const count = rows.reduce((a, [, l]) => a + l.length, 0)
    $('#villa-notes-n').textContent = rows.length ? count + (count === 1 ? ' note' : ' notes') + ' on ' + rows.length + (rows.length === 1 ? ' villa' : ' villas') : ''
    vbox.innerHTML = rows.length ? rows.map(([k, l]) => {
      const card = document.getElementById('ht-' + k.slice(3))
      return '<div class="villa-notes"><h3><a href="#' + card.id + '">' + esc(card.dataset.name) + '</a></h3><ul class="notes-list">' + l.map(noteLi).join('') + '</ul></div>'
    }).join('') : '<p class="note">No notes on villas yet. Add one from a villa’s card on the Stay tab.</p>'
  }
  async function post(body) {
    const r = await fetch(D.votes, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, ...body }) })
    if (!r.ok) throw new Error('post ' + r.status)
    return r.json()
  }
  const failed = () => toast(navigator.onLine ? 'Could not save it. Try again in a minute.' : 'This needs internet.')
  // run: instead of sending bodies, do this with the name (moving a villa)
  function openDialog({ title, what, save, note, body, done, run }) {
    pending = { body, done, run }
    $('#vote-title').textContent = title
    $('#vote-what').textContent = what
    $('#vote-note').textContent = note
    $('#vote-name').value = voterName()
    $('[data-vote-save]', dlg).textContent = save
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '')
    ;(voterName() ? $('[data-vote-save]', dlg) : $('#vote-name')).focus()
  }
  // Hide / Show again on the website: for the whole group, with a name like a vote (id '*': every hidden villa)
  function askShared(what, id) {
    if (!canVote) return
    const ids = id === '*' ? [...hiddenStays] : [id]
    const name = id === '*' ? 'Every hidden villa' : document.getElementById('ht-' + id)?.dataset.name || 'This villa'
    const send = (hide) => (n) => ids.map((x) => ({ item: 'ht:' + x, name: n, hide }))
    openDialog(what === 'hide'
      ? { title: 'Hide for everyone', what: name, save: 'Hide', note: 'It goes off the list and the map for the whole group. Anyone can show it again.', body: send(true), done: () => 'Hidden for everyone: ' + name }
      : { title: 'Show again for everyone', what: name, save: 'Show again', note: 'It comes back on the list and the map for the whole group.', body: send(false), done: () => (id === '*' ? 'All villas are back for everyone' : 'Back on the list for everyone') })
  }
  if (canVote) {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vote-btn]'); if (!b) return
      const bar = b.closest('[data-vote-item]'), v = b.dataset.voteBtn, item = bar.dataset.voteItem
      const remove = b.getAttribute('aria-pressed') === 'true'
      openDialog({
        title: remove ? 'Take back your ' + VOTE[v] : VOTE[v], what: bar.dataset.voteName, save: remove ? 'Take back' : 'Save vote', note: NOTE_VOTE,
        // a different name is a different person: for them it is a new vote, not taking one back
        body: (n) => [{ item, name: n, vote: remove && same(n, voterName()) ? null : v }],
        done: (n, sent) => (sent.vote ? VOTE[sent.vote] + ' saved for ' + n : 'Vote taken back'),
      })
    })
    $('[data-vote-cancel]', dlg).addEventListener('click', () => { pending = null; dlg.close() })
    // Add note: straight away once the guide knows your name (the first time it asks, like a vote); delete your own
    document.addEventListener('submit', (e) => {
      const f = e.target.closest('.note-form'); if (!f) return
      e.preventDefault()
      const box = f.closest('[data-notes]'), ta = $('textarea', f), text = ta.value.trim()
      if (!text) return
      const send = async (name) => {
        try { applyShared(await post({ name, note: { item: box.dataset.notes, text } })); ta.value = ''; const add = f.closest('details'); if (add) add.open = false; toast('Note added for everyone') } catch { failed() }
      }
      if (voterName()) send(voterName())
      else openDialog({ title: 'Add a note', what: box.dataset.notes === 'all' ? 'Group notes' : (box.closest('.card')?.dataset.name || ''), save: 'Add note', note: 'Everyone with the guide sees the note and your name.', run: send })
    })
    document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-note-del]'); if (!b) return
      try { applyShared(await post({ name: voterName(), deleteNote: b.dataset.noteDel })); toast('Note deleted') } catch { toast(navigator.onLine ? 'Could not delete it. Try again in a minute.' : 'This needs internet.') }
    })
    // Reset position / Reset all positions: the villas go back to their places by likes, for everyone
    document.addEventListener('click', (e) => {
      const one = e.target.closest('[data-unpin-stay]'), all = e.target.closest('#unpin-all')
      if (!one && !all) return
      const ids = one ? [one.closest('.card').dataset.stay] : Object.keys((pins && pins.map) || {})
      if (!ids.length) return
      if (voterName()) { unpin(ids, voterName()); return }
      openDialog({ title: all ? 'Reset all positions' : 'Reset position', what: one ? one.closest('.card').dataset.name : 'Every villa moved by hand', save: 'Reset',
        note: 'It goes back to its place by likes, for the whole group.', run: (n) => unpin(ids, n) })
    })
    // Move up / down: one tap once the guide knows your name (the first time it asks, like a vote)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-move-stay]'); if (!b) return
      const card = b.closest('.card'), dir = b.dataset.moveStay
      if (voterName()) { moveStay(card, dir, voterName()); return }
      openDialog({ title: 'Move ' + dir + ' for everyone', what: card.dataset.name, save: 'Move ' + dir, note: 'Moves change the villa order for the whole group. The guide remembers your name for the next move.', run: (n) => moveStay(card, dir, n) })
    })
    $('#vote-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = $('#vote-name').value.replace(/\s+/g, ' ').trim()
      if (!name || !pending) return
      const { body, done, run } = pending
      if (run) { store.set('voterName', name); pending = null; dlg.close(); run(name); return }
      const bodies = body(name) // before the name is remembered: taking back a vote compares with the last name
      store.set('voterName', name)
      pending = null; dlg.close()
      try {
        let j = null
        for (const b of bodies) j = await post(b)
        if (j) applyShared(j)
        if (bodies.some((b) => 'vote' in b && String(b.item).startsWith('ht:'))) sortStays(true, true) // your like moves the villa now
        toast(done(name, bodies[0] || {}))
      } catch { toast(navigator.onLine ? 'Could not save it. Try again in a minute.' : 'This needs internet.') }
    })
    renderVotes()
    renderNotes()
    syncPinUI()
    loadVotes()
    // other people's changes: when the guide comes back to the front, and every 5 s while it is on screen
    window.addEventListener('focus', loadVotes)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadVotes() })
    setInterval(() => { if (document.visibilityState === 'visible') loadVotes() }, 5000)
    track('visit', location.hash || '#home')
  }

  /* ---------- Stats: who opened the guide and what they did (website only) ---------- */
  const SAID = { visit: 'opened the guide', view: 'opened', card: 'looked at', map: 'opened the map of', share: 'shared', photos: 'browsed the photos of', ...DID }
  function itemLabel(e, x) {
    if (e === 'visit') return ''
    if (e === 'view') return ({ home: 'Trip', events: 'Music', places: 'Places', areas: 'Areas', stay: 'Stay', money: 'Money', info: 'Essentials', apps: 'Apps', notes: 'Notes', stats: 'Stats' }[x] || x) + ' tab'
    const id = String(x || '').replace(/^mini:/, '').replace(/^(ht|ev|pl|mx):/, '$1-').replace(/^(hotel|event|place|money):/, (m, k) => ({ hotel: 'ht-', event: 'ev-', place: 'pl-', money: 'mx-' }[k]))
    const el = document.getElementById(id)
    return x === 'all' ? 'Group notes' : el ? el.dataset.name || el.querySelector('h2, h3')?.textContent || id : String(x || '')
  }
  async function renderStats() {
    const box = $('#stats-body'); if (!box) return
    if (!canVote) { box.innerHTML = '<p class="note">The stats are on the website only.</p>'; return }
    box.innerHTML = '<p class="note">Loading…</p>'
    try {
      // a password set as STATS_KEY on Vercel: asked once, kept on this phone
      let r = await fetch(D.votes + '?stats=1&key=' + encodeURIComponent(store.get('statsKey', '')), { cache: 'no-store' })
      if (r.status === 401) {
        box.innerHTML = '<form class="myform" id="stats-key-form"><label for="stats-key">Password for the stats<input id="stats-key" type="password" autocomplete="current-password" required></label><button class="btn primary" type="submit">Show the stats</button></form>'
        $('#stats-key-form').addEventListener('submit', (e) => { e.preventDefault(); store.set('statsKey', $('#stats-key').value); renderStats() })
        $('#stats-key').focus()
        return
      }
      if (!r.ok) throw new Error('stats ' + r.status)
      const { visitors = {}, log = [] } = await r.json()
      const kind = (d) => (visitors[d] && visitors[d].kind) || 'device'
      const name = (d) => (visitors[d] && visitors[d].n) || (d ? 'Someone on ' + kind(d) + ' · ' + d.slice(0, 4) : 'Someone')
      const day = (t) => new Date(t).toDateString(), today = day(Date.now())
      const visits = log.filter((x) => x.e === 'visit')
      const devs = Object.entries(visitors).sort((a, b) => (b[1].last || 0) - (a[1].last || 0))
      const count = (pred) => log.filter(pred).length
      const tiles = [['People (phones)', devs.length], ['Visits', devs.reduce((a, [, v]) => a + (v.visits || 0), 0)], ['Visits today', visits.filter((x) => day(x.t) === today).length],
        ['Likes', count((x) => x.e === 'like')], ['Notes', count((x) => x.e === 'note')], ['Shares', count((x) => x.e === 'share')]]
      const people = devs.map(([d, v]) => '<tr><td>' + esc(name(d)) + '<small>' + esc(kind(d)) + '</small></td><td>' + (v.visits || 0) + '</td><td>' + count((x) => x.d === d && x.e !== 'visit') +
        '</td><td>' + esc(when(v.last || v.first)) + '</td></tr>').join('')
      // what people looked at most: villa cards, their maps, photos and shares, plus likes
      const seen = {}
      for (const x of log) if (['card', 'map', 'photos', 'share', 'like'].includes(x.e)) { const l = itemLabel(x.e, x.x); if (/Villa|BR|Pool|House|Townhouse|Home/i.test(l) || String(x.x).includes('ht')) seen[l] = (seen[l] || 0) + 1 }
      const top = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 8)
      const tabs = {}
      for (const x of log) if (x.e === 'view') tabs[itemLabel('view', x.x)] = (tabs[itemLabel('view', x.x)] || 0) + 1
      const recent = log.slice(0, 80).map((x) => '<li><small>' + esc(when(x.t)) + '</small> <b>' + esc(x.n || name(x.d)) + '</b> ' + esc(SAID[x.e] || x.e) + (itemLabel(x.e, x.x) ? ' ' + esc(itemLabel(x.e, x.x)) : '') + '</li>').join('')
      box.innerHTML = '<div class="stats-tiles">' + tiles.map(([k, v]) => '<div><b>' + esc(String(v)) + '</b><span>' + esc(k) + '</span></div>').join('') + '</div>' +
        '<h2 class="block-title">People</h2><div class="stats-table"><table><thead><tr><th>Who</th><th>Visits</th><th>Actions</th><th>Last seen</th></tr></thead><tbody>' + (people || '<tr><td colspan="4">Nobody yet.</td></tr>') + '</tbody></table></div>' +
        (top.length ? '<h2 class="block-title">Villas looked at most</h2><ol class="picks">' + top.map(([l, n]) => '<li>' + esc(l) + ' <span>' + n + '</span></li>').join('') + '</ol>' : '') +
        (Object.keys(tabs).length ? '<h2 class="block-title">Tabs opened</h2><p class="stats-tabs">' + Object.entries(tabs).sort((a, b) => b[1] - a[1]).map(([l, n]) => esc(l) + ' <b>' + n + '</b>').join(' · ') + '</p>' : '') +
        '<h2 class="block-title">Latest activity</h2><ul class="stats-log">' + (recent || '<li>Nothing yet.</li>') + '</ul>' +
        '<p class="note">Counted on the website since the stats were added (17 Oct 2026). Phones show up by the name used to vote or add a note.</p>'
    } catch { box.innerHTML = '<p class="note">' + (navigator.onLine ? 'Could not load the stats. Try again in a minute.' : 'The stats need internet.') + '</p>' }
  }

  /* ---------- Share a villa: the phone's share sheet, or a copy to paste in a chat ---------- */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share-stay]'); if (!b) return
    const card = b.closest('.card')
    track('share', card.id)
    // just the link to this villa in the guide (it opens the guide on the villa); the single file has no web address,
    // so there it is the listing's link
    const url = /^https?:$/.test(location.protocol) ? location.origin + location.pathname + '#' + card.id : b.dataset.listing || ''
    if (!url) return
    if (navigator.share) { try { await navigator.share({ title: card.dataset.name, url }) } catch { /* closed */ } return }
    try { await navigator.clipboard.writeText(url); toast('Link copied: paste it in a chat') } catch { toast(url) }
  })

  // the Map button on a villa card: opens its Show on map accordion and brings the map on screen
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-map]'); if (!b) return
    const d = $('details.mapacc', b.closest('.card')); if (!d) return
    d.open = true
    requestAnimationFrame(() => d.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }))
  })

  // Add a note: opening it puts the cursor in the box (on a phone the keyboard comes up, as it is your tap)
  document.addEventListener('toggle', (e) => {
    const d = e.target
    if (d instanceof HTMLDetailsElement && d.open && d.matches('details.note-add')) $('textarea', d)?.focus()
  }, true)

  /* ---------- a villa's own small map, in its Show on map accordion ---------- */
  // drawn the first time it opens, with the same picture as the big map: street or satellite tiles online, the saved
  // satellite tiles offline (or the plain land map); a soft circle says the pin is approximate
  document.addEventListener('toggle', (e) => {
    const d = e.target
    if (!(d instanceof HTMLDetailsElement) || !d.open || !d.matches('[data-mini-map]')) return
    const box = $('.mini-map', d)
    if (!box || typeof L === 'undefined') return
    if (box.leafletMap) { box.leafletMap.invalidateSize(); return }
    track('map', 'mini:' + (d.closest('.card')?.id || ''))
    const ll = [Number(d.dataset.lat), Number(d.dataset.lng)]
    const m = L.map(box, { zoomControl: true, attributionControl: false, scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 8, maxZoom: 18 }).setView(ll, 14)
    box.leafletMap = m
    creditsUnder(m, $('.map-credit', d))
    const online = navigator.onLine && D.build !== 'artifact'
    const chosen = store.get('mapBase', 'satellite')
    const pack = D.build !== 'artifact' && !online ? makeSatPack() : null
    if (pack) pack.addTo(m)
    if (online && D.tiles) {
      const t = chosen === 'satellite' ? D.tiles.satellite : D.tiles.streets
      L.tileLayer(t.url, { attribution: t.attr, maxZoom: 19, maxNativeZoom: t.maxNative || 19, crossOrigin: true }).addTo(m)
      m.getContainer().classList.toggle('dim-tiles', chosen !== 'satellite' && isDark())
    } else if (!pack && D.land) L.geoJSON(D.land, { interactive: false, attribution: OSM_CREDIT, style: { fillColor: cssVar('--map-land'), fillOpacity: 1, color: cssVar('--map-line'), weight: 1 } }).addTo(m)
    L.circle(ll, { radius: 300, color: cssVar('--violet'), weight: 1.5, dashArray: '4 4', fillOpacity: 0.12, interactive: false }).addTo(m)
    L.circleMarker(ll, dotStyle('hotel')).addTo(m)
    requestAnimationFrame(() => m.invalidateSize())
  }, true)

  /* ---------- keep your place across a refresh ---------- */
  // the card (or day, section) at the top of the screen and how far down it was, kept for this tab; after a refresh the
  // page goes back to it, even if the villa list was re-sorted in between. A link to a card still opens that card.
  try { history.scrollRestoration = 'manual' } catch { /* old browser */ }
  function savePlace() {
    const view = current && document.getElementById(current)
    if (!view) return
    const below = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0
    const anchor = $$('.card[id], .agenda-day[id], .acc[id], .callout[id], .stack[id]', view).find((e) => e.offsetParent && e.getBoundingClientRect().bottom > below + 8)
    session.set('place', { hash: location.hash, view: current, y: Math.round(scrollY), id: anchor ? anchor.id : null, off: anchor ? Math.round(anchor.getBoundingClientRect().top) : 0 })
  }
  let placeTimer = 0
  addEventListener('scroll', () => { clearTimeout(placeTimer); placeTimer = setTimeout(savePlace, 200) }, { passive: true })
  addEventListener('pagehide', savePlace)
  function restorePlace() {
    const p = session.get('place')
    if (!p || p.hash !== location.hash || p.view !== current) return
    let touched = false
    ;['touchstart', 'wheel', 'keydown'].forEach((ev) => addEventListener(ev, () => { touched = true }, { once: true, passive: true }))
    const go = () => {
      if (touched) return // the person is already scrolling: leave them
      const el = p.id && document.getElementById(p.id)
      window.scrollTo(0, el && el.offsetParent ? el.getBoundingClientRect().top + scrollY - p.off : p.y)
    }
    // now, after the first paint (a card link scrolls then), and once more when late content (votes, notes) is in
    go(); requestAnimationFrame(go); setTimeout(go, 400)
  }

  syncHiddenStays()
  syncFavs()
  refreshToday()
  route()
  restorePlace()
})()
