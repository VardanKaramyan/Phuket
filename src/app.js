/* Phuket guide: progressive enhancement over fully rendered HTML. Everything here is optional; the page reads fine without it. */
(() => {
  'use strict'
  const D = JSON.parse(document.getElementById('guide-data').textContent)
  const $ = (s, el = document) => el.querySelector(s)
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s))
  const VIEWS = ['home', 'events', 'places', 'areas', 'stay', 'money', 'info', 'apps', 'notes', 'spend', 'stats']
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

  let toastTimer, holdNews = 0, newsNext = null, newsTimer = 0 // news waits while an Undo, or a toast to read, is up
  // hold: news must not cover this one (the "saved on this phone" notice)
  function toast(msg, action, hold) {
    let t = $('#toast')
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t) }
    t.textContent = msg
    if (action) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-btn'; b.textContent = action.label
      b.addEventListener('click', action.run); t.appendChild(b)
    }
    t.hidden = false
    holdNews = (action && action.label === 'Undo') || hold ? Date.now() + (action ? 9000 : 2600) : 0
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
      if (now < tripStart.getTime()) countdown(false) // the pill counts down live, with the board in the pass
      else if (now <= tripEnd.getTime()) {
        const n = Math.floor((new Date(todayISO + 'T00:00:00+07:00') - tripStart) / DAY) + 1
        pill.textContent = 'Day ' + n + ' of ' + D.trip.days
      } else pill.textContent = 'Trip done'
    }
    dayBtns.forEach((b) => b.classList.toggle('today', b.dataset.day === todayISO))
    const allOpen = $('#agenda-all')?.getAttribute('aria-pressed') === 'true'
    if (!userPickedDay && !allOpen && dayBtns.length && shownToday !== todayISO) { selectDay(defaultDay(), false); shownToday = todayISO }
  }
  const defaultDay = () => (dayBtns.find((b) => b.dataset.day === todayISO) || dayBtns[0]).dataset.day

  /* ---------- countdown: a departure board in the pass (to the trip, then to the flight home) and the live pill ---------- */
  // each digit is a split flap: when it changes, the top half with the old digit falls and the new bottom half drops in
  const flightHome = new Date(D.trip.flight.day + 'T' + D.trip.flight.time + ':00+07:00')
  const board = $('#countdown')
  const two = (n) => String(n).padStart(2, '0')
  const dayWord = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  function makeFlap(v) {
    const f = document.createElement('span')
    f.className = 'flap'
    f.innerHTML = '<span class="f-top"><b></b></span><span class="f-bot"><b></b></span><span class="f-fold f-up"><b></b></span><span class="f-fold f-down"><b></b></span>'
    setFlap(f, v, false)
    return f
  }
  function setFlap(f, v, animate) {
    const old = f.dataset.v
    if (old === v) return
    f.dataset.v = v
    const [top, bot, up, down] = [...f.children].map((c) => c.firstElementChild)
    top.textContent = v; down.textContent = v; up.textContent = old ?? v
    clearTimeout(f.flapTimer)
    if (!animate || old === undefined) { bot.textContent = v; f.classList.remove('go'); return }
    bot.textContent = old // until the new bottom half has dropped over it
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go')
    f.flapTimer = setTimeout(() => { bot.textContent = v; f.classList.remove('go') }, 650)
  }
  function setDigits(box, str, animate) {
    if (box.children.length !== str.length) { box.replaceChildren(...[...str].map(makeFlap)); return }
    ;[...box.children].forEach((f, i) => setFlap(f, str[i], animate))
  }
  let boardSaid = ''
  function countdown(animate) {
    const now = Date.now(), before = now < tripStart.getTime()
    const left = (before ? tripStart.getTime() : flightHome.getTime()) - now
    const pill = $('#trip-status')
    if (left <= 0) { if (board) board.hidden = true; return false }
    const t = Math.floor(left / 1000)
    const d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, sec = t % 60
    if (before && pill) {
      // the top bar: a small copy of the board, with the same flaps
      if (!pill.classList.contains('live')) {
        pill.classList.add('live'); root.classList.add('cd-live')
        pill.innerHTML = '<span class="tb-board" aria-hidden="true">' + [['d', 'Days'], ['h', 'Hrs'], ['m', 'Min'], ['s', 'Sec']].map(([k, l], i) =>
          (i ? '<span class="pc-sep">:</span>' : '') + '<span class="tb-unit pc-' + k + '"><span class="pc-digits" data-cd="' + k + '"></span><small>' + l + '</small></span>').join('') + '</span>'
      }
      ;[['d', d], ['h', h], ['m', m], ['s', sec]].forEach(([k, v]) => setDigits($('[data-cd="' + k + '"]', pill), two(v), animate))
      pill.setAttribute('aria-label', d + ' days and ' + h + ' hours to go')
    } else if (pill && pill.classList.contains('live')) { pill.classList.remove('live'); root.classList.remove('cd-live'); pill.removeAttribute('aria-label'); refreshToday() } // the trip has begun
    if (!board) return true
    board.hidden = false
    const say = (before ? 'Trip starts in ' : 'Flight home in ') + d + ' days, ' + h + ' hours, ' + m + ' minutes'
    if (say !== boardSaid) {
      boardSaid = say
      board.setAttribute('aria-label', say)
      $('#cd-label').textContent = before ? 'Trip starts in' : 'Flight home in'
      $('#cd-when').textContent = before ? dayWord(D.trip.start) + ' · 00:00 Phuket time' : dayWord(D.trip.flight.day) + ' · ' + D.trip.flight.time
    }
    setDigits($('[data-cd="d"]', board), two(d), animate)
    setDigits($('[data-cd="h"]', board), two(h), animate)
    setDigits($('[data-cd="m"]', board), two(m), animate)
    setDigits($('[data-cd="s"]', board), two(sec), animate)
    return true
  }
  // once a second, on the second; the flaps only move while the guide is on screen (and not with reduced motion)
  function tickLoop() {
    if (countdown(!reduceMotion && document.visibilityState === 'visible') === false) { refreshToday(); return }
    setTimeout(tickLoop, 1005 - (Date.now() % 1000))
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') countdown(false) })

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

  // a share page's address (…/s/<name>): it carries the link preview, then opens the guide
  const shareUrl = (name) => new URL('s/' + name, location.origin + location.pathname).href

  /* ---------- favourites ---------- */
  // on the website Saved is the whole group's list (kept by the vote server, with who saved each); elsewhere it is
  // kept on this phone
  const sharedSave = !!D.votes && /^https?:$/.test(location.protocol)
  let savedBy = sharedSave ? store.get('savedShared', {}) : {} // '<item>' -> { by, t }: the last list loaded
  const favs = new Set(sharedSave ? Object.keys(savedBy) : store.get('favs', []))
  let shareSave = null // (item, on): set by the vote code below, which can send it to the server
  const likedItems = new Set() // items with at least one like, for the Liked filter (filled in by renderVotes)
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
    if (sharedSave) { if (shareSave) shareSave(id, !favs.has(id)); return }
    if (favs.has(id)) { favs.delete(id); toast('Removed from saved') } else { favs.add(id); toast('Saved') }
    saveOrWarn('favs', Array.from(favs)); syncFavs()
  })
  function renderSaved() {
    const box = $('#saved-list'); if (!box) return
    const items = Array.from(favs).map((f) => document.querySelector('[data-fav-card="' + CSS.escape(f) + '"]')).filter(Boolean)
    const by = (card) => { const x = savedBy[card.dataset.favCard]; return x && x.by ? ' · saved by ' + x.by : '' }
    const villas = items.filter((c) => c.dataset.stay).length
    box.innerHTML = items.length
      ? items.map((card) => '<li><div><a href="#' + card.id + '">' + esc(card.dataset.name) + '</a> <span>· ' + esc(card.dataset.kind || '') + esc(by(card)) + '</span></div></li>').join('') +
        (villas > 1 ? '<li class="tip"><div><a href="#stay/saved">The saved villas on the Stay tab</a></div></li>' : '')
      : '<li class="tip"><div><span>' + (sharedSave ? 'Tap the star on any event, place or villa to save it here for the whole group.' : 'Tap the star on any event, place or hotel to keep it here.') + '</span></div></li>'
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
      if (value === 'liked') return likedItems.has(card.dataset.favCard)
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
          // a list you can link to (Liked, Saved): its address goes in the address bar, ready to copy
          if ($('.chip[data-link]', bar) && $$('.chip[data-group="' + g + '"]', bar).some((c) => c.hasAttribute('data-link'))) {
            history.replaceState(null, '', '#' + id + (chip.hasAttribute('data-link') ? '/' + chip.dataset.value : ''))
            syncShareList()
          }
        })
      })
      if (search) search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); apply() })
    }
    // open the list on one of its linkable filters (from an address like #stay/liked)
    const pick = (value) => {
      const chip = bar && $('.chip[data-link][data-value="' + CSS.escape(value) + '"]', bar)
      if (!chip) return false
      reset()
      $$('.chip[data-group="' + chip.dataset.group + '"]', bar).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)))
      state[chip.dataset.group] = value; apply(); syncShareList()
      return true
    }
    const shareBtn = bar && $('[data-share-list]', bar)
    function syncShareList() {
      if (!shareBtn) return
      const on = $('.chip[data-link][aria-pressed="true"]', bar)
      shareBtn.hidden = !on || !/^https?:$/.test(location.protocol)
      if (on) shareBtn.dataset.url = shareUrl(id + '-' + on.dataset.value)
    }
    lists.push({ apply, reset, pick, el: listEl })
  })

  /* ---------- hidden villas: 'Hide' on a card, 'Show again' in the Hidden villas list under the cards ---------- */
  // a tap outside a pop-up (on the dim backdrop) closes it, like Cancel; the add sheet keeps what you typed as a draft
  document.addEventListener('click', (e) => {
    const d = e.target
    if (!(d instanceof HTMLDialogElement) || !d.open) return
    const r = d.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return
    const cancel = d.querySelector('[data-vote-cancel]')
    if (cancel) cancel.click(); else d.close()
  })

  /* ---------- Directions: from one of our villas, or from where you are now ---------- */
  // every Directions link carries its destination (data-dir="lat,lng"); with our villas known, a tap asks where from.
  // The villa you sleep in tonight comes first. Without JavaScript the link itself goes from your current location
  const dirDlg = $('#dir-dialog')
  if (dirDlg && (D.bases || []).length) {
    const dirUrl = (from, to) => 'https://www.google.com/maps/dir/?api=1' + (from ? '&origin=' + from : '') + '&destination=' + to + '&travelmode=driving'
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-dir]'); if (!a) return
      e.preventDefault()
      const today = bkkDate(new Date())
      const tonight = D.bases.find((b) => today >= b.from && today < b.to)
      const opts = D.bases.filter((b) => b.key !== a.dataset.dirSkip).sort((x, y) => (y === tonight) - (x === tonight))
      $('#dir-what').textContent = 'To ' + (a.dataset.dirName || 'this place')
      $('#dir-options').innerHTML = opts.map((b) => '<a class="dir-opt" target="_blank" rel="noopener" href="' + esc(dirUrl(b.lat + ',' + b.lng, a.dataset.dir)) + '"><b>From the ' + esc(b.short) + '</b><span>' + esc(b.range) + (b === tonight ? ' · where you sleep tonight' : '') + '</span></a>').join('') +
        '<a class="dir-opt" target="_blank" rel="noopener" href="' + esc(dirUrl('', a.dataset.dir)) + '"><b>From where I am now</b><span>Google Maps uses your location</span></a>'
      track('map', 'dir:' + (a.dataset.dirName || ''))
      if (dirDlg.showModal) dirDlg.showModal(); else dirDlg.setAttribute('open', '')
    })
    $('#dir-options').addEventListener('click', (e) => { if (e.target.closest('.dir-opt')) setTimeout(() => dirDlg.close(), 50) })
  }

  /* ---------- New villas: a badge on the villas this phone has not seen before ---------- */
  // the phone remembers which villas it has shown; one added to the guide since then says New (and the Stay tab counts
  // them) until it has been on screen for a moment, and the badge stays for the rest of that visit. A first visit shows
  // no badges: everything is new then.
  function newStays() {
    const cards = $$('#stay .card[data-stay]')
    const ids = cards.map((c) => c.dataset.stay)
    const known = store.get('knownStays', null)
    if (!Array.isArray(known)) { store.set('knownStays', ids); return }
    const fresh = cards.filter((c) => !known.includes(c.dataset.stay))
    if (!fresh.length) return
    const unseen = new Set(fresh.map((c) => c.dataset.stay))
    const tab = $('.tabbar a[href="#stay"]')
    const dot = document.createElement('span'); dot.className = 'tab-new'
    if (tab) tab.appendChild(dot)
    const syncDot = () => {
      const n = [...unseen].filter((id) => !hiddenStays.has(id)).length
      dot.hidden = !n; dot.textContent = n
      if (tab) tab.setAttribute('aria-label', 'Stay' + (n ? ', ' + n + ' new ' + (n === 1 ? 'villa' : 'villas') : ''))
    }
    const seen = (id) => {
      if (!unseen.delete(id)) return
      store.set('knownStays', [...new Set([...store.get('knownStays', []), id])])
      syncDot()
    }
    for (const c of fresh) {
      const b = document.createElement('span'); b.className = 'pill new'; b.textContent = 'New'
      const top = $('.tag-top', c); if (top) top.prepend(b)
      $('.card-title', c)?.insertAdjacentHTML('beforeend', '<span class="sr-only"> (new)</span>')
    }
    syncDot()
    // seen: at least half the card on the Stay tab for 1.5 s
    if (!('IntersectionObserver' in window)) return
    const timers = new Map()
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      const id = e.target.dataset.stay
      if (e.isIntersecting) { if (!timers.has(id)) timers.set(id, setTimeout(() => { seen(id); io.unobserve(e.target) }, 1500)) }
      else { clearTimeout(timers.get(id)); timers.delete(id) }
    }), { threshold: 0.5 })
    fresh.forEach((c) => io.observe(c))
  }
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
    // a filtered list: #stay/liked, #stay/saved, #events/saved, #places/saved
    const f = /^([a-z]+)\/([a-z]+)$/.exec(id)
    if (f && f[1] === 'spend' && spendPane(f[2])) return show('spend') // Spending: #spend/balances, #spend/stats
    if (f && VIEWS.includes(f[1])) {
      show(f[1])
      const l = lists.find((x) => x.el.dataset.list === f[1])
      if (!l || !l.pick(f[2])) history.replaceState(null, '', '#' + f[1])
      return
    }
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
    const dll = (p.dlat ?? p.lat) + ',' + (p.dlng ?? p.lng)
    const dir = p.nodir ? '' : '<a class="btn" target="_blank" rel="noopener" href="' + gdir(p.dlat ?? p.lat, p.dlng ?? p.lng) + '" data-dir="' + dll + '" data-dir-name="' + esc(p.name) + '">' + esc(p.dlabel || 'Directions') + '</a>'
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
    layers.base = L.layerGroup().addTo(map) // our villas: always shown, in a pane above the other pins
    map.createPane('basePane').style.zIndex = 450
    ;['event', 'place', 'gem', 'hotel'].forEach((t) => layers[t].addTo(map))
    D.points.forEach((p) => {
      // the popup is built when it opens, so it fits the map's size at that moment (full screen or not)
      const m = L.circleMarker([p.lat, p.lng], dotStyle(p.k)).bindPopup(() => popupHtml(p), popupOpts())
      m.kind = p.k
      m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -6] })
      layers[p.k === 'gem' ? 'gem' : p.t].addLayer(m)
      markers[p.t + ':' + p.id] = m
      if (p.base) {
        const home = L.circleMarker([p.lat, p.lng], { pane: 'basePane', radius: 10, color: cssVar('--surface'), weight: 3, fillColor: cssVar('--sun'), fillOpacity: 1 }).bindPopup(() => popupHtml(p), popupOpts())
        home.bindTooltip(esc(p.baseLabel), { permanent: true, direction: 'right', offset: [10, 0], className: 'base-tip' })
        layers.base.addLayer(home)
      }
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
  // the form stays folded away until Add hotel is tapped, and folds again once the hotel is saved (or on Cancel)
  const myOpen = $('#my-hotel-open')
  function showMyForm(open) {
    if (!myForm || !myOpen) return
    myForm.hidden = !open
    myOpen.closest('p').hidden = open
    myOpen.setAttribute('aria-expanded', String(open))
    if (open) $('#mh-name').focus(); else myOpen.focus()
  }
  myOpen?.addEventListener('click', () => showMyForm(true))
  $('#my-hotel-cancel')?.addEventListener('click', () => { myForm.reset(); showMyForm(false) })
  if (myForm) {
    myForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const f = new FormData(myForm)
      const name = String(f.get('name') || '').trim(); if (!name) return
      mine.push({ name, link: String(f.get('link') || '').trim(), dates: String(f.get('dates') || '').trim(), notes: String(f.get('notes') || '').trim() })
      const saved = store.set('myHotels', mine); myForm.reset(); renderMine(); showMyForm(false)
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
  /* ---------- a new version of the guide: a page left open (or resumed from the home screen) offers a reload ---------- */
  if (D.build === 'standalone' && D.buildId && /^https?:$/.test(location.protocol)) {
    let lastCheck = 0, offered = false
    const checkVersion = async () => {
      if (offered || !navigator.onLine || Date.now() - lastCheck < 60000) return // at most once a minute
      lastCheck = Date.now()
      try {
        const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
        const j = r.ok ? await r.json() : null
        if (!j || !j.v || j.v === D.buildId) return
        offered = true
        navigator.serviceWorker?.getRegistration?.().then((g) => g && g.update()).catch(() => {})
        const bar = document.createElement('div')
        bar.className = 'update-bar'; bar.setAttribute('role', 'status')
        bar.innerHTML = '<span>A new version of the guide is ready.</span><button class="btn primary" type="button">Reload</button>'
        $('button', bar).addEventListener('click', () => { bar.remove(); location.reload() })
        document.body.appendChild(bar)
      } catch { /* offline: try again later */ }
    }
    setTimeout(checkVersion, 3000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion() })
    addEventListener('focus', checkVersion)
    addEventListener('online', checkVersion)
  }
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
  const DID = { like: 'liked', skip: 'skipped', unvote: 'took back a vote on', hide: 'hid', show: 'brought back', move: 'moved', reset: 'reset the place of', note: 'added a note on', unnote: 'deleted a note on', save: 'saved', unsave: 'took off the saved list', spend: 'added an expense:', pay: 'added a payment:', respend: 'changed an expense:', repay: 'changed a payment:', unspend: 'deleted an expense:', unpay: 'deleted a payment:' }
  const cardOf = (x) => { const m = /^(ht|ev|pl):(.+)$/.exec(x || ''); return m ? document.getElementById(m[1] + '-' + m[2]) : null }
  function describe(r) {
    const who = r.n || 'Someone'
    if (/^(re|un)?(spend|pay)$/.test(r.e)) return who + ' ' + DID[r.e] + ' ' + (r.x || '')
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
    const to = c ? c.id : /^(re|un)?(spend|pay)$/.test(r.e) && document.getElementById('spend') ? 'spend/expenses' : r.x === 'all' && document.getElementById('notes') ? 'notes' : '' // a group note: the Notes tab
    // news waits while an Undo or the add sheet is on screen, and only the newest waits
    newsNext = { text, to }
    const show = () => {
      newsTimer = 0
      if (!newsNext) return
      if (Date.now() < holdNews || document.querySelector('#spend-sheet[open]')) { newsTimer = setTimeout(show, 1000); return }
      const n = newsNext
      newsNext = null
      toast(n.text, n.to ? { label: 'Show', run: () => { $('#toast').hidden = true; location.hash = n.to } } : undefined)
    }
    if (!newsTimer) show()
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
    likedItems.clear()
    Object.entries(votes).forEach(([k, it]) => { if (it && it.like && it.like.length) likedItems.add(k) })
    lists.forEach((l) => l.apply())
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
    const n = $('#group-picks-n'); if (n) n.textContent = rows.length ? plural(rows.length, 'villa') : ''
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
  let staysSorted = false // the list has been put in order once (the first votes arrive after the page is drawn)
  function sortStays(now, animate) {
    if (!stayList || !votes) return
    const view = document.getElementById('stay')
    // later changes wait while the list is on screen (no jumps); the very first order does not wait
    if (!now && staysSorted && view && !view.hidden && stayList.getBoundingClientRect().top < innerHeight) return
    staysSorted = true
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
    // the Spend tab is drawn again only when the expenses changed (a like elsewhere must not fold an open row)
    if (Array.isArray(j.spend)) { spend = cleanRows(j.spend); store.set('spend', j.spend); const sig = sigOf(j.spend); if (sig !== spendSig) { spendSig = sig; renderSpend() } }
    if ('pins' in j) { pins = j.pins; store.set('villaPins', pins); syncPinUI() }
    $$('[data-move-stay]').forEach((b) => { b.hidden = false }) // the server is there: moving works
    if (j.saved && sharedSave) {
      savedBy = j.saved; store.set('savedShared', savedBy)
      favs.clear(); Object.keys(savedBy).forEach((k) => favs.add(k))
      syncFavs(); moveLocalSaves()
    }
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
  // ms: give up after that long (a weak signal); the error has the server's status and reason
  async function post(body, ms) {
    const ctl = ms && window.AbortController ? new AbortController() : null, timer = ctl && setTimeout(() => ctl.abort(), ms)
    try {
      const r = await fetch(D.votes, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device, ...body }), signal: ctl ? ctl.signal : undefined })
      if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).error || 'post ' + r.status); e.status = r.status; throw e }
      return r.json()
    } finally { clearTimeout(timer) }
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
  // Save (the star) on the website: for the whole group, with your name (asked once). It shows at once, then the
  // server's list replaces it
  async function sendSave(item, on, name) {
    const card = document.querySelector('[data-fav-card="' + CSS.escape(item) + '"]'), what = card?.dataset.name || 'it'
    if (on) { favs.add(item); savedBy[item] = { by: name, t: Date.now() } } else { favs.delete(item); delete savedBy[item] }
    syncFavs()
    try { applyShared(await post({ item, name, save: on })); toast(on ? 'Saved for everyone: ' + what : 'Taken off the saved list for everyone') }
    catch { if (on) favs.delete(item); else favs.add(item); syncFavs(); failed() }
  }
  if (canVote) shareSave = (item, on) => {
    if (voterName()) return sendSave(item, on, voterName())
    const card = document.querySelector('[data-fav-card="' + CSS.escape(item) + '"]')
    openDialog({ title: on ? 'Save for everyone' : 'Take off the saved list', what: card?.dataset.name || '', save: on ? 'Save' : 'Take off',
      note: on ? 'It goes in the Saved list for the whole group, with your name.' : 'It comes off the Saved list for the whole group.', run: (n) => sendSave(item, on, n) })
  }
  // this phone's saves from before Saved was shared: added to the group's list once, when the name is known
  let movingSaves = false
  async function moveLocalSaves() {
    const old = store.get('favs', []).filter((x) => /^(ht|ev|pl):/.test(x) && !favs.has(x))
    if (!canVote || movingSaves || store.get('favsMoved', false) || !voterName()) return
    if (!old.length) { store.set('favsMoved', true); return }
    movingSaves = true
    try {
      let j = null
      for (const item of old.slice(0, 30)) j = await post({ item, name: voterName(), save: true })
      store.set('favsMoved', true)
      if (j) applyShared(j)
      toast('Your saved ' + (old.length === 1 ? 'item is' : 'items are') + ' now in the Saved list for the whole group')
    } catch { /* try again next time */ } finally { movingSaves = false }
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

  /* ---------- Spending: who paid what for the group, the balances, and who pays whom (website only) ---------- */
  // money counts in satang (baht x 100, whole numbers), so the parts of an expense add up exactly; drams, dirhams and
  // dollars count at the rate saved with the expense (older ones: the guide's mid-market rate)
  const PEOPLE = (D.trip && D.trip.people) || []
  const CURS = ['THB', 'AMD', 'AED', 'USD']
  const CAT_NAMES = { food: 'Food', drinks: 'Drinks', groceries: 'Groceries', transport: 'Transport', activities: 'Activities', stay: 'Stay', shopping: 'Shopping', other: 'Other' }
  // the category from the words, until someone picks one (the first that matches)
  const CAT_WORDS = [
    ['stay', /\b(villas?|hotels?|hostel|rooms?|deposit|airbnb|booking|cleaning|laundry)\b/i],
    ['activities', /\b(tours?|trips?|tickets?|entry|entrance|jet ?skis?|massages?|spa|diving|dive|snorkel\w*|parks?|shows?|museum|temple|kayak\w*|surf\w*|lessons?|class|zipline|elephants?|muay thai|cabaret)\b/i],
    ['drinks', /\b(beers?|bar|drinks?|cocktails?|wine|vodka|whisk(e)?y|shots?|alcohol|club|rave|party)\b/i],
    ['food', /\b(dinner|lunch|breakfast|brunch|food|meals?|restaurant|cafe|coffee|seafood|pizza|burgers?|sushi|pad thai|bbq|dessert|ice cream)\b/i],
    ['groceries', /\b(groceries|grocery|supermarket|big ?c|7-?eleven|7-?11|tops|makro|lotus'?s?|family ?mart|water|ice|snacks?|fruits?)\b/i],
    ['transport', /\b(taxis?|grab|bolt|tuk-?tuks?|vans?|bus|ferry|boats?|speedboat|longtail|flights?|airport|cars?|scooters?|bikes?|fuel|petrol|gas|transfers?|rides?|parking)\b/i],
    ['shopping', /\b(e?sims?|souvenirs?|clothes|shop|shopping|market|gifts?|pharmacy|sunscreen|cream)\b/i],
  ]
  const guessCat = (what) => (CAT_WORDS.find(([, re]) => re.test(what || '')) || ['other'])[0]
  const catOf = (x) => (CAT_NAMES[x.cat] ? x.cat : guessCat(x.what))
  // rows as the server sent them, made safe once: a split is a list of names, and a row with no amount, payer or day is
  // left out (an older or broken row must not break the tab)
  const cleanRows = (list) => (Array.isArray(list) ? list : []).filter((x) => x && Number(x.amount) > 0 && typeof x.paid === 'string' && /^\d{4}-\d\d-\d\d$/.test(String(x.date)))
    .map((x) => ({ ...x, split: Array.isArray(x.split) ? x.split.filter((p) => typeof p === 'string') : [] }))
  let spend = canVote ? cleanRows(store.get('spend', [])) : []
  const midOf = (cur) => (cur === 'THB' ? 1 : (D.rates && D.rates.mid && D.rates.mid[cur]) || 0)
  const rateOf = (x) => (x.cur === 'THB' ? 1 : x.rate > 0 ? x.rate : midOf(x.cur))
  const centsOf = (x) => Math.round(Number(x.amount) * rateOf(x) * 100)
  const isPay = (x) => x.kind === 'pay'
  // each person's part of an expense in satang, adding up to the whole: by weight (shares), by amount, or equal; the
  // satang left over by rounding go to the largest remainders (then to the first in the group's order)
  function partsOf(x) {
    const total = centsOf(x), who = PEOPLE.filter((p) => (x.split || []).includes(p))
    if (!(total > 0) || !who.length) return []
    const m = x.amounts || x.shares
    const w = who.map((p) => (m ? Math.max(0, Number(m[p]) || 0) : 1)), sum = w.reduce((a, v) => a + v, 0)
    if (!(sum > 0)) return []
    const raw = w.map((v) => (total * v) / sum), out = raw.map(Math.floor)
    let rest = total - out.reduce((a, v) => a + v, 0)
    raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (rest > 0) { out[i]++; rest-- } })
    return who.map((p, i) => [p, out[i]])
  }
  // per person: paid (for the group), share (their part), payments sent and received; net above 0: gets money back
  function balancesOf(list) {
    const b = Object.fromEntries(PEOPLE.map((p) => [p, { paid: 0, share: 0, sent: 0, got: 0, net: 0 }]))
    for (const x of list) {
      const parts = partsOf(x)
      if (!parts.length || !b[x.paid]) continue
      const total = parts.reduce((a, [, c]) => a + c, 0)
      if (isPay(x)) { b[x.paid].sent += total; b[parts[0][0]].got += total } else { b[x.paid].paid += total; parts.forEach(([p, c]) => { b[p].share += c }) }
    }
    for (const v of Object.values(b)) v.net = v.paid + v.sent - v.share - v.got
    return b
  }
  // the fewest payments that settle everyone: the one who owes most pays the one owed most, and so on (under 1 THB: even)
  function settleUp(b) {
    const cred = [], debt = []
    for (const [p, v] of Object.entries(b)) { if (v.net >= 100) cred.push([p, v.net]); else if (v.net <= -100) debt.push([p, -v.net]) }
    const out = [], big = (a, c) => c[1] - a[1]
    while (cred.length && debt.length) {
      cred.sort(big); debt.sort(big)
      const c = cred[0], d = debt[0], t = Math.min(c[1], d[1])
      out.push({ from: d[0], to: c[0], cents: t })
      c[1] -= t; d[1] -= t
      if (c[1] < 100) cred.shift()
      if (d[1] < 100) debt.shift()
    }
    return out
  }
  // even: under 1 THB, or a few baht left over that no payment can settle (the others are each under 1 THB), so the
  // card, the bars and Settle up always agree
  const evenOf = (p, b, moves) => Math.abs(b[p].net) < 100 || !moves.some((m) => m.from === p || m.to === p)
  // what the totals show in: drams by default (the group thinks in drams), or baht, dirhams or dollars
  let showCur = store.get('spendCur', 'AMD')
  if (!CURS.includes(showCur) || !midOf(showCur)) showCur = 'THB'
  const num = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  const amt = (v, cur) => fmtAmount(v) + '\u00a0' + cur // a no-break space: the number and its currency stay on one line
  const fmtAmount = (v) => { const r = Math.round(v * 100) / 100; return num(r, Number.isInteger(r) ? 0 : 2) }
  const rateText = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  // satang in a currency: baht whole, drams to the nearest 10, dirhams and dollars to the cent (whole: no cents)
  function moneyNum(cents, cur = showCur, rate = midOf(cur), whole) {
    const v = cents / 100 / (rate || 1)
    if (cur === 'AMD') return num(Math.round(v / 10) * 10, 0)
    if (cur === 'THB' || whole) return num(Math.round(v), 0)
    const r = Math.round(v * 100) / 100
    return num(r, Number.isInteger(r) ? 0 : 2)
  }
  const money = (cents, cur = showCur, rate = midOf(cur)) => moneyNum(cents, cur, rate) + '\u00a0' + cur
  // a payment that settles exactly: the amount as shown in a currency, and the rate that brings it back to the same satang
  function payOf(cents, cur = showCur) {
    const mid = midOf(cur)
    if (cur === 'THB' || !mid) return { amount: cents / 100, cur: 'THB' }
    const amount = cur === 'AMD' ? Math.max(10, Math.round(cents / 100 / mid / 10) * 10) : Math.max(0.01, Math.round(cents / mid) / 100)
    return { amount, cur, rate: cents / 100 / amount }
  }
  const orig = (x) => amt(Number(x.amount), x.cur)
  const meOf = () => { const m = store.get('spendMe', ''), v = voterName(); return PEOPLE.includes(m) ? m : (v && PEOPLE.find((p) => same(p, v))) || '' }
  // a person: a coloured round with the initial (two words: both initials), the same colour as on the built page
  const initials = (p) => { const w = p.split(' '); return w.length > 1 ? w[0][0] + w[1][0] : p[0] }
  const av = (p) => '<span class="av p' + PEOPLE.indexOf(p) + '" aria-hidden="true">' + esc(initials(p)) + '</span>'
  const personBtn = (p, attr, on) => '<button class="person" type="button" ' + attr + '="' + esc(p) + '" aria-pressed="' + !!on + '">' + av(p) + '<span>' + esc(p) + '</span></button>'
  const tpl = $('#spend-icons')
  const ic = (k) => (tpl && tpl.content.querySelector('[data-i="' + k + '"]')?.innerHTML) || ''
  const you = (p, me, cap) => (p === me ? (cap ? 'You' : 'you') : p)
  // who shares an expense, in words: everyone, all but Lara, only you, Hovo and Mes, 5 people
  const whoOf = (split, me) => (split.length === PEOPLE.length ? 'everyone' : split.length === PEOPLE.length - 1 ? 'all but ' + you(PEOPLE.find((p) => !split.includes(p)), me)
    : split.length === 1 ? 'only ' + you(split[0], me) : split.length === 2 ? split.map((p) => you(p, me)).join(' and ') : split.length + ' people')
  const lastSplit = () => (store.get('spendLastSplit', []) || []).filter((p) => PEOPLE.includes(p))
  // after the group's days (from 19 Jan most costs are for two), a new expense starts with the people of the last one
  const groupEnd = ((D.trip.phases || []).find((p) => p.id === 'group') || {}).to || D.trip.end
  // what the list was last drawn from (the Spend tab is drawn again only when it changes)
  const sigOf = (list) => list.map((x) => x.id + ':' + (x.editedT || x.t)).join()
  let filter = 'all', picking = false, spendSig = sigOf(spend), draft = null
  const paying = new Set() // payments being sent: from|to|cents
  const spendBox = $('#spend')
  const newSpendId = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => (n % 36).toString(36)).join('')
  // a Paid's id comes from the payment and the list it was worked out from: two phones that tap Paid on the same
  // payment send the same id, and the server adds it once
  const hash36 = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(36) }
  const payId = (from, to, cents) => { const key = [from, to, cents, spend.length, Math.max(0, ...spend.map((x) => Number(x.editedT || x.t) || 0))].join('|'); return ('p' + hash36(key) + hash36(key + '|2')).slice(0, 24) }
  // added without internet (or when the server failed): kept on this phone and sent later; the server adds an expense
  // with the same newId once (and takes a changed one as a change), so sending it again is safe; shown meanwhile,
  // marked "Not sent yet"
  let outbox = canVote ? store.get('spendOutbox', []) : []
  const saveOutbox = () => store.set('spendOutbox', outbox)
  let rows = spend // what the tab shows: the group's expenses and this phone's unsent ones, newest day first
  function shownSpend() {
    const have = new Set(spend.map((x) => x.id)), local = outbox.filter((o) => !have.has(o.spend.newId)) // the server has it: its row shows
    if (!local.length) return spend
    return local.map((o) => ({ ...o.spend, id: 'local:' + o.spend.newId, by: o.name, t: o.t, pending: true })).concat(spend)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.t || 0) - (a.t || 0))
  }
  function keepOnPhone(name, x, msg) {
    outbox = outbox.filter((o) => o.spend.newId !== x.newId).concat({ name, spend: x, t: Date.now() })
    saveOutbox(); renderSpend()
    if (msg) toast(msg, undefined, true) // news must not cover it
  }
  let flushing = false
  async function flushOutbox() {
    if (flushing || !outbox.length || !navigator.onLine) return
    flushing = true
    let sent = 0
    try {
      while (outbox.length) {
        const o = outbox[0], id = o.spend.newId
        let j = null
        try { j = await post({ name: o.name, spend: o.spend }, 15000) } catch (e) {
          if (!(e.status >= 400 && e.status < 500) || e.status === 429) break // still offline, or the server: later
          toast('Not added: ' + (o.spend.what || 'a payment') + '. ' + e.message)
        }
        // off the list by its id: it may have been changed or deleted on this phone while it was on its way
        const now = outbox.find((y) => y.spend.newId === id)
        outbox = outbox.filter((y) => y.spend.newId !== id)
        if (j && now && now !== o) outbox.unshift(now) // changed meanwhile: send that (same newId: a change)
        saveOutbox()
        if (!j) continue
        sent++
        if (!now) { try { j = await post({ name: o.name, deleteSpend: j.id || id }) } catch { /* it stays in the list, for anyone to delete */ } }
        applyShared(j)
      }
    } finally {
      flushing = false
      renderSpend()
      if (sent) toast('Sent to the group')
    }
  }
  // the villas we paid for (TRIP.bases → paid): one tap fills the form, until they are in the list
  const PAID_BASES = ((D.trip && D.trip.bases) || []).filter((b) => b.paid && b.paid.total > 0 && CURS.includes(b.paid.currency))
  const tileLine = $('#home .tile[href="#spend"] span'), tileText = tileLine ? tileLine.textContent : ''
  // after a save or a Paid the button that was tapped is gone (the list is drawn again): put the focus back nearby
  const refocus = (sel) => requestAnimationFrame(() => { if (document.activeElement && document.activeElement !== document.body) return; const el = sel && $(sel); (el || $('#spend-add'))?.focus({ preventScroll: true }) })

  function renderSpend() {
    if (!spendBox || !canVote) return
    $('#spend-off').hidden = true
    rows = shownSpend()
    const me = meOf(), b = balancesOf(rows), moves = settleUp(b)
    // the rows a tap opened stay open
    const open = new Set($$('#spend-bal .bal-row[aria-expanded="true"]').map((r) => r.dataset.p))
    $('#spend-body').hidden = false
    $('.cur-pick', spendBox).hidden = false
    $('#spend-cur').value = showCur
    $('#spend-add').hidden = !me
    renderMe(me, b, moves)
    renderList(me)
    renderBalances(me, b, moves, open)
    renderSpendStats(b)
    // the Trip page's tile: where you stand
    if (tileLine) tileLine.textContent = me && rows.length ? (evenOf(me, b, moves) ? 'You are even' : (b[me].net > 0 ? 'You get back ' : 'You owe ') + money(Math.abs(b[me].net))) : tileText
  }
  // a payment to settle: who pays whom and how much (a tap opens it as a payment you can change), and Mark paid
  const moveLi = (m, me) => '<li class="move">' + (me ? '<button class="move-open" type="button" data-pay-from="' + esc(m.from) + '" data-pay-to="' + esc(m.to) + '" data-cents="' + m.cents + '" aria-label="' + esc(you(m.from, me, true) + ' pays ' + you(m.to, me) + ' ' + money(m.cents)) + '">' : '<span class="move-open">') +
    '<span class="move-who">' + av(m.from) + '<span>' + esc(you(m.from, me, true)) + '</span>' + ic('next') + av(m.to) + '<span>' + esc(you(m.to, me)) + '</span></span><b class="num">' + esc(money(m.cents)) + '</b>' + (me ? '</button>' : '</span>') +
    (me ? '<button class="btn small" type="button" data-settle-from="' + esc(m.from) + '" data-settle-to="' + esc(m.to) + '" data-cents="' + m.cents + '" aria-label="' + esc('Mark paid: ' + you(m.from, me, true) + ' to ' + you(m.to, me) + ', ' + money(m.cents)) + '"' + (paying.has(m.from + '|' + m.to + '|' + m.cents) ? ' disabled>Saving…' : '>' + ic('check') + 'Mark paid') + '</button>' : '') + '</li>'
  // the top card: who you are (asked once), what you owe or get back, and your payments to settle
  function renderMe(me, b, moves) {
    const box = $('#spend-me')
    box.hidden = false
    if (!me || picking) {
      box.className = 'me-card ask'
      box.innerHTML = '<h2 id="spend-who">Who are you?</h2><div class="people" role="group" aria-labelledby="spend-who">' + PEOPLE.map((p) => personBtn(p, 'data-me', p === me)).join('') + '</div>'
      return
    }
    const net = b[me].net, st = evenOf(me, b, moves) ? 'even' : net > 0 ? 'good' : 'bad', alt = showCur === 'THB' ? 'AMD' : 'THB'
    const mine = moves.filter((m) => m.from === me || m.to === me)
    box.className = 'me-card ' + st
    box.innerHTML = '<div class="me-top">' + av(me) + '<b>' + esc(me) + '</b><button class="link-btn" type="button" data-me-change>Not you?</button></div>' +
      (rows.length ? '<div class="me-bal">' + (st === 'even' ? '<b>You are even</b>' : '<span>' + (st === 'good' ? 'You get back' : 'You owe') + '</span><b class="num">' + esc(money(Math.abs(net))) + '</b><small class="num">' + esc(money(Math.abs(net), alt)) + '</small>') + '</div>' +
        (mine.length ? '<ul class="moves">' + mine.slice(0, 3).map((m) => moveLi(m, me)).join('') + '</ul>' : '') +
        (mine.length > 3 ? '<button class="link-btn" type="button" data-pane-go="balances">All ' + mine.length + ' payments</button>' : '') : '')
  }
  function rowOf(x, me, withDay) {
    const pay = isPay(x), parts = partsOf(x), cat = pay ? 'pay' : catOf(x), split = x.split || []
    const title = pay ? you(x.paid, me, true) + ' paid ' + you(split[0], me) : x.what
    const who = whoOf(PEOPLE.filter((p) => split.includes(p)), me)
    let mine = ''
    if (me && !pay) {
      const total = parts.reduce((a, [, c]) => a + c, 0), part = (parts.find(([p]) => p === me) || [])[1] || 0
      mine = x.paid === me ? (total - part > 0 ? '<small class="good">you lent ' + esc(money(total - part)) + '</small>' : '')
        : part > 0 ? '<small class="bad">your part ' + esc(money(part)) + '</small>' : '<small>not in it</small>'
    }
    // the amount in the currency you chose (Show amounts in), and the original under it when it was another one
    const shown = x.cur === showCur ? orig(x) : '≈' + money(centsOf(x))
    const under = x.cur === showCur ? '' : '<small class="x-orig">' + esc(orig(x)) + '</small>'
    return '<button class="xrow" type="button" data-spend-id="' + esc(x.id) + '"><span class="x-ic c-' + cat + '">' + ic(cat) + '</span>' +
      '<span class="x-main"><b>' + esc(title) + '</b><small>' + (x.pending ? '<span class="unsent">Not sent yet</span> · ' : '') + esc(pay ? (withDay ? dayWord(x.date) : 'Payment') : you(x.paid, me, true) + ' paid · ' + who) + '</small></span>' +
      '<span class="x-amt"><b class="num">' + esc(shown) + '</b>' + under + mine + '</span></button>'
  }
  // the expenses by day, newest first, with each day's total (payments are not spending)
  function renderList(me) {
    const inIt = (p) => (x) => x.paid === p || (x.split || []).includes(p)
    const who = filter.startsWith('p:') && PEOPLE.includes(filter.slice(2)) ? filter.slice(2) : filter === 'mine' ? me : ''
    const shown = who ? rows.filter(inIt(who)) : rows
    // All, Mine, and With <someone> (from a balance row)
    $$('[data-spend-filter]', spendBox).forEach((c) => {
      const f = c.dataset.spendFilter, on = f === 'all' ? !who : f === 'mine' ? !!me && who === me && filter === 'mine' : filter.startsWith('p:') && !!who
      c.setAttribute('aria-pressed', String(on))
      c.hidden = f === 'mine' ? !me : f === 'person' ? !(filter.startsWith('p:') && who) : false
      if (f === 'person' && who) $('.t', c).textContent = 'With ' + you(who, me)
      $('.n', c).textContent = f === 'all' ? rows.length : f === 'mine' ? (me ? rows.filter(inIt(me)).length : 0) : who ? shown.length : 0
    })
    $('.chips', $('[data-pane-box="list"]')).hidden = !rows.length || !me
    $('#spend-copy').hidden = !rows.length
    const list = $('#spend-list')
    if (!shown.length) {
      list.innerHTML = '<div class="spend-empty">' + ic('other') + '<p>' + (rows.length ? 'Nothing with ' + esc(you(who, me)) + ' yet' : 'No expenses yet') + '</p>' + (!rows.length && me ? '<button class="btn primary small" type="button" data-add-first>' + ic('plus') + 'Add the first one</button>' : '') + '</div>'
      return
    }
    const dayTotal = {}
    rows.forEach((x) => { if (!isPay(x)) dayTotal[x.date] = (dayTotal[x.date] || 0) + centsOf(x) })
    let day = '', html = ''
    for (const x of shown) {
      if (x.date !== day) html += (day ? '</div>' : '') + '<h3 class="day-h"><span>' + esc(dayWord(day = x.date)) + '</span>' + (dayTotal[day] ? '<span class="num">' + esc(money(dayTotal[day])) + '</span>' : '') + '</h3><div class="day-rows">'
      html += rowOf(x, me)
    }
    list.innerHTML = html + '</div>'
  }
  // everyone's balance as a bar (right: gets back, left: owes), the fewest payments to settle up, and the payments made
  function renderBalances(me, b, moves, open) {
    // nothing yet: the same empty box as the other two
    $('#spend-bal').hidden = $('#spend-settle').hidden = $('#spend-settle-h').hidden = !rows.length
    $('#spend-bal-empty').hidden = !!rows.length
    const order = PEOPLE.slice().sort((p, q) => b[q].net - b[p].net), max = Math.max(1, ...order.map((p) => Math.abs(b[p].net)))
    $('#spend-bal').innerHTML = order.map((p) => {
      const v = b[p], st = evenOf(p, b, moves) ? 'even' : v.net > 0 ? 'good' : 'bad', on = open && open.has(p)
      const more = ['paid ' + money(v.paid), 'part ' + money(v.share)].concat(v.sent ? ['sent ' + money(v.sent)] : [], v.got ? ['got ' + money(v.got)] : []).join(' · ')
      return '<li class="bal ' + st + (p === me ? ' me' : '') + '"><button class="bal-row" type="button" data-p="' + esc(p) + '" aria-expanded="' + !!on + '">' + av(p) + '<span class="bal-name">' + esc(p) + '</span>' +
        '<span class="bal-bar" aria-hidden="true"><i style="width:' + (st === 'even' ? 0 : Math.max(2, Math.round((Math.abs(v.net) / max) * 50))) + '%"></i></span>' +
        '<b class="num">' + (st === 'even' ? 'even' : '<span class="sr-only">' + (st === 'good' ? 'gets back ' : 'owes ') + '</span>' + (st === 'good' ? '+' : '−') + esc(money(Math.abs(v.net)))) + '</b></button>' +
        '<div class="bal-more"' + (on ? '' : ' hidden') + '><p class="num">' + esc(cap1(more)) + '</p><button class="link-btn" type="button" data-filter-person="' + esc(p) + '">See expenses</button></div></li>'
    }).join('')
    // who owes most pays the next bill, so the balances stay small (a tap starts that expense)
    const low = order[order.length - 1], next = $('#spend-next')
    next.hidden = !moves.length || !me
    next.textContent = low ? (low === me ? 'You pay' : low + ' pays') + ' the next bill' : ''
    next.dataset.nextPaid = low || ''
    const mineFirst = moves.filter((m) => m.from === me || m.to === me).concat(moves.filter((m) => m.from !== me && m.to !== me)) // your own payments first
    $('#spend-settle').innerHTML = moves.length ? mineFirst.map((m) => moveLi(m, me)).join('') : '<li class="move quiet">' + (rows.length ? 'Everyone is even' : 'Nothing to settle yet') + '</li>'
    const pays = rows.filter(isPay)
    $('#spend-paid-h').hidden = $('#spend-paid').hidden = !pays.length
    $('#spend-paid').innerHTML = pays.map((x) => rowOf(x, me, true)).join('')
  }
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  function renderSpendStats(b) {
    const box = $('#spend-stats'), ex = rows.filter((x) => !isPay(x))
    if (!ex.length) { box.innerHTML = '<div class="spend-empty">' + ic('other') + '<p>No expenses yet</p></div>'; return }
    const total = ex.reduce((a, x) => a + centsOf(x), 0)
    const byCat = {}, byDay = {}
    ex.forEach((x) => { const c = catOf(x), v = centsOf(x); byCat[c] = (byCat[c] || 0) + v; byDay[x.date] = (byDay[x.date] || 0) + v })
    const cats = Object.entries(byCat).sort((a, c) => c[1] - a[1])
    const trip = []
    for (let t = Date.parse(D.trip.start + 'T12:00:00Z'); t <= Date.parse(D.trip.end + 'T12:00:00Z'); t += 86400000) trip.push(new Date(t).toISOString().slice(0, 10))
    const dmax = Math.max(1, ...trip.map((d) => byDay[d] || 0))
    const outside = ex.filter((x) => x.date < D.trip.start || x.date > D.trip.end).reduce((a, x) => a + centsOf(x), 0)
    const payers = PEOPLE.filter((p) => b[p].paid > 0).sort((p, q) => b[q].paid - b[p].paid), pmax = payers.length ? b[payers[0]].paid : 1
    const bar = (v, of) => '<span class="hb-bar"><i style="width:' + Math.max(2, Math.round((v / of) * 100)) + '%"></i></span>'
    box.innerHTML = '<div class="stat-tiles">' + [[moneyNum(total, showCur, midOf(showCur), true), showCur + ' in total'], [moneyNum(total / PEOPLE.length, showCur, midOf(showCur), true), showCur + ' per person'], [String(ex.length), ex.length === 1 ? 'expense' : 'expenses']].map(([v, t]) => '<div><b class="num">' + esc(v) + '</b><span>' + esc(t) + '</span></div>').join('') + '</div>' +
      '<h3 class="mini-title">By category</h3><ul class="hbars">' + cats.map(([c, v]) => '<li><span class="x-ic c-' + c + '">' + ic(c) + '</span><span class="hb-name">' + CAT_NAMES[c] + '</span>' + bar(v, cats[0][1]) + '<b class="num">' + esc(money(v)) + '</b></li>').join('') + '</ul>' +
      '<h3 class="mini-title">By day</h3><div class="vbars">' + trip.map((d) => '<div class="vb' + (d === todayISO ? ' today' : '') + '" title="' + esc(dayWord(d) + ': ' + money(byDay[d] || 0)) + '"><i style="height:' + (byDay[d] ? Math.max(3, Math.round((byDay[d] / dmax) * 100)) : 0) + '%"></i><small>' + Number(d.slice(8)) + '</small></div>').join('') + '</div>' +
      (outside ? '<p class="note num">Before or after the trip: ' + esc(money(outside)) + '</p>' : '') +
      '<h3 class="mini-title">Who paid</h3><ul class="hbars">' + payers.map((p) => '<li>' + av(p) + '<span class="hb-name">' + esc(p) + '</span>' + bar(b[p].paid, pmax) + '<b class="num">' + esc(money(b[p].paid)) + '</b></li>').join('') + '</ul>'
  }
  function setPane(p, push) {
    if (!['list', 'balances', 'stats'].includes(p)) return false
    session.set('spendPane', p)
    $$('[data-pane]', spendBox).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pane === p)))
    $$('[data-pane-box]', spendBox).forEach((x) => { x.hidden = x.dataset.paneBox !== p })
    if (push) history.replaceState(history.state, '', '#spend' + (p === 'list' ? '' : '/' + p))
    return true
  }
  // a link to a part of the tab: #spend/balances, #spend/stats
  const spendPane = (p) => !!spendBox && canVote && setPane(p === 'expenses' ? 'list' : p)
  // Mark paid on a payment to settle up: saved at once, in the shown currency and to the satang; Undo takes it back
  async function settle(from, to, cents) {
    const me = meOf()
    if (!me) return
    const key = from + '|' + to + '|' + cents
    if (paying.has(key)) return
    const p = payOf(cents), x = { kind: 'pay', what: '', amount: p.amount, cur: p.cur, paid: from, split: [to], date: dayIn(0), newId: payId(from, to, cents) }
    if (p.rate) x.rate = p.rate
    paying.add(key); renderSpend()
    try {
      const j = await post({ name: me, spend: x }, 15000)
      applyShared(j)
      toast(you(from, me, true) + ' paid ' + you(to, me) + ' ' + amt(p.amount, p.cur), j.id ? { label: 'Undo', run: () => unsave(j.id) } : undefined)
    } catch (e) {
      if (e.status >= 400 && e.status < 500) toast(e.message || 'Could not save it.')
      else keepOnPhone(me, x, 'Saved on this phone. It goes to the group later.')
    }
    paying.delete(key)
    renderSpend()
    refocus('[data-settle-from]')
  }
  async function unsave(id) {
    $('#toast').hidden = true; holdNews = 0
    try { applyShared(await post({ name: meOf(), deleteSpend: id })); toast('Taken back') } catch { failed() }
  }

  /* the sheet: add or change an expense or a payment */
  const sheet = $('#spend-sheet'), form = $('#spend-form')
  let st = null // what the open sheet holds
  const fx = (s) => $(s, form)
  // a day for the form: today in Thailand (or n days from it), kept inside the dates the form takes
  function dayIn(n) {
    const d = fx('#sp-date'), t = bkkDate(new Date(Date.now() + n * DAY))
    return t < d.min ? d.min : t > d.max ? d.max : t
  }
  // an amount as typed: 2400, 2,400, 2400.5 or 2400,5
  function parseAmount(s) {
    s = String(s || '').replace(/[\s ']/g, '')
    const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',')
    if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.')
    else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
    return /^(\d+\.?\d*|\.\d+)$/.test(s) ? Math.round(Number(s) * 100) / 100 : NaN
  }
  // the parts in the amounts mode, in the expense's currency: what was typed (0 too), and the rest shared by the others
  function amountParts(total) {
    const who = PEOPLE.filter((p) => st.split.has(p)), T = Math.round(total * 100)
    const fixed = who.filter((p) => st.locked[p] != null), free = who.filter((p) => st.locked[p] == null)
    const rest = T - fixed.reduce((a, p) => a + Math.round(st.locked[p] * 100), 0)
    const out = {}
    fixed.forEach((p) => { out[p] = Math.round(st.locked[p] * 100) })
    if (free.length && rest > 0) free.forEach((p, i) => { out[p] = Math.floor(rest / free.length) + (i < rest % free.length ? 1 : 0) })
    return { out, rest, free: free.length }
  }
  // the same expense twice (8 phones, one dinner): the same day, payer and currency, and about the same amount
  const dupOf = (x) => rows.find((y) => !isPay(y) && y.id !== x.id && y.paid === x.paid && y.cur === x.cur && y.date === x.date && Math.abs(Number(y.amount) - x.amount) <= Math.max(0.01 * x.amount, 1))
  // pre: { paid } for the next bill, or { from, to, cents } for a payment to settle
  function openSheet(x, kind, pre) {
    const me = meOf()
    if (!me || !sheet) return
    if (!x && !kind && !pre && draft) return reopenDraft()
    const last = lastSplit()
    st = x
      ? { id: x.pending ? '' : x.id, local: x.pending ? x.newId : '', newId: x.pending ? x.newId : '', x, kind: isPay(x) ? 'pay' : 'spend', cur: x.cur, rate: rateOf(x), paid: x.paid, to: isPay(x) ? (x.split || [])[0] : '', split: new Set(isPay(x) ? PEOPLE : x.split), mode: x.amounts ? 'amounts' : x.shares ? 'shares' : 'equal', shares: { ...(x.shares || {}) }, locked: { ...(x.amounts || {}) }, cat: x.cat || '', picked: !!x.cat }
      : { newId: newSpendId(), kind: kind || 'spend', cur: CURS.includes(store.get('spendLastCur', 'THB')) ? store.get('spendLastCur', 'THB') : 'THB', paid: (pre && (pre.paid || pre.from)) || me, to: (pre && pre.to) || '', split: new Set(dayIn(0) > groupEnd && last.length ? last : PEOPLE), mode: 'equal', shares: {}, locked: {}, cat: '', picked: false }
    if (!x) st.rate = midOf(st.cur)
    st.opener = document.activeElement
    fx('#sp-amount').value = x ? fmtAmount(Number(x.amount)) : ''
    fx('#sp-what').value = x && !isPay(x) ? x.what : ''
    fx('#sp-date').value = x ? x.date : dayIn(0)
    fx('#sp-err').textContent = ''
    fx('#sp-meta').hidden = !x
    fx('#sp-meta').textContent = !x ? '' : x.pending ? 'Not sent yet' : 'Added by ' + you(x.by || 'someone', me) + (x.editedBy ? ' · changed by ' + you(x.editedBy, me) : '')
    fx('#sp-rate-box').hidden = true
    fx('#sp-cats').hidden = true
    fx('#sp-paid-box').hidden = true
    setSaving(false)
    if (pre && pre.cents) fillPay(pre.cents)
    else if (st.kind === 'pay' && !x) prefillPay()
    syncSheet(true)
    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '')
    form.scrollTop = 0
    root.classList.add('sheet-open')
    // Back closes the sheet, like a sheet in an app (and never leaves it open on another tab)
    history.pushState({ sheet: 1 }, '')
    kb()
    if (!x && !(pre && pre.cents)) fx('#sp-amount').focus()
  }
  function reopenDraft() {
    const d = draft
    draft = null
    st = { ...d.s, dirty: true, discard: false, saved: false, opener: document.activeElement }
    fx('#sp-amount').value = d.amount; fx('#sp-what').value = d.what; fx('#sp-date').value = d.date
    fx('#sp-err').textContent = ''; fx('#sp-meta').hidden = true
    fx('#sp-rate-box').hidden = true; fx('#sp-cats').hidden = true; fx('#sp-paid-box').hidden = true
    setSaving(false)
    syncSheet(true)
    sheet.showModal(); form.scrollTop = 0; root.classList.add('sheet-open'); history.pushState({ sheet: 1 }, ''); kb()
  }
  // a payment filled in to settle: the amount as shown, kept exact (to the satang) while nobody changes it
  function fillPay(cents, cur = showCur) {
    const p = payOf(cents, cur)
    st.cur = p.cur; st.rate = p.rate || 1; st.exact = { cents, amount: p.amount, cur: p.cur }; st.typed = false
    fx('#sp-amount').value = fmtAmount(p.amount)
  }
  // a new payment: from you to the one you owe most, for what you owe; again when From or To changes, until typed
  function prefillPay() {
    if (!st.toPicked || st.to === st.paid) st.to = ''
    const m = settleUp(balancesOf(rows)).find((y) => y.from === st.paid && (!st.to || y.to === st.to))
    if (!st.to) st.to = m ? m.to : ''
    if (st.typed) return
    if (m) fillPay(m.cents)
    else { st.exact = null; fx('#sp-amount').value = '' }
  }
  function setSaving(on) {
    const btn = fx('#sp-save')
    btn.disabled = on; btn.textContent = on ? 'Saving…' : 'Save'
  }
  function closeSheet() { if (sheet && sheet.open) sheet.close() }
  // the keyboard on a phone covers the bottom of the screen: lift the sheet above it, so Save stays in sight
  const vv = window.visualViewport
  function kb() { if (sheet && sheet.open && vv) sheet.style.setProperty('--kb', Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px') }
  // every control from st; whole: also rebuild the split rows (not while someone types in them)
  function syncSheet(whole) {
    if (!st) return
    const pay = st.kind === 'pay', me = meOf(), changing = !!(st.id || st.local)
    fx('#sheet-title').textContent = (changing ? 'Change ' : 'New ') + (pay ? 'payment' : 'expense')
    fx('#sp-kind').hidden = changing
    $$('[data-kind]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === st.kind)))
    $$('[data-only]', form).forEach((el) => { el.hidden = el.dataset.only !== st.kind })
    $$('[data-cur]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cur === st.cur)))
    fx('#sp-amount').setAttribute('aria-label', 'Amount in ' + st.cur)
    fx('#sp-paid-l').textContent = pay ? 'From' : 'Paid by'
    fx('#sp-paid-val').innerHTML = av(st.paid) + '<b>' + esc(you(st.paid, me, true)) + '</b>'
    fx('#sp-paid-row').setAttribute('aria-expanded', String(!fx('#sp-paid-box').hidden))
    $$('[data-paid]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.paid === st.paid)))
    $$('[data-to]', form).forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.to === st.to)); b.disabled = b.dataset.to === st.paid })
    // the category: a tile by What was it (guessed from the words until someone picks one); a tap opens the 8
    const cat = st.picked ? st.cat : guessCat(fx('#sp-what').value), tile = fx('#sp-cat')
    tile.className = 'x-ic cat-tile c-' + cat
    tile.innerHTML = ic(cat)
    tile.setAttribute('aria-label', 'Category: ' + CAT_NAMES[cat])
    tile.setAttribute('aria-expanded', String(!fx('#sp-cats').hidden))
    if (pay) fx('#sp-cats').hidden = true
    $$('[data-cat]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)))
    $$('[data-mode]', form).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode)))
    const date = fx('#sp-date').value
    $$('[data-day]', form).forEach((b) => b.setAttribute('aria-pressed', String(date === dayIn(Number(b.dataset.day)))))
    fx('#sp-delete').hidden = !changing
    // the villas not in the list yet, one tap each, while the sheet is still empty
    const empty = !changing && !pay && !fx('#sp-amount').value.trim() && !fx('#sp-what').value.trim()
    const quick = empty ? PAID_BASES.filter((b) => !rows.some((x) => !isPay(x) && x.cur === b.paid.currency && (String(x.what || '').toLowerCase().includes(b.short.toLowerCase()) || Number(x.amount) === b.paid.total))) : []
    fx('#sp-quick').hidden = !quick.length
    fx('#sp-quick').innerHTML = quick.map((b) => '<button class="cat-chip c-stay" type="button" data-quick="' + PAID_BASES.indexOf(b) + '">' + ic('stay') + esc(b.short + ' · ' + amt(b.paid.total, b.paid.currency)) + '</button>').join('')
    if (whole) renderSplit()
    syncNumbers()
  }
  function renderSplit() {
    const box = fx('#sp-split')
    if (st.mode === 'equal') {
      // Everyone, or the people of the last expense from this phone
      const last = lastSplit()
      const sets = (st.split.size !== PEOPLE.length ? ['<button class="chip" type="button" data-split-set="all">Everyone</button>'] : [])
        .concat(last.length && last.length < PEOPLE.length && !(last.length === st.split.size && last.every((p) => st.split.has(p))) ? ['<button class="chip" type="button" data-split-set="last">Like last time (' + last.length + ')</button>'] : [])
      box.innerHTML = '<div class="people">' + PEOPLE.map((p) => personBtn(p, 'data-split-p', st.split.has(p))).join('') + '</div>' + (sets.length ? '<div class="split-sets">' + sets.join('') + '</div>' : '')
      return
    }
    box.innerHTML = '<div class="srows">' + PEOPLE.map((p) => {
      const on = st.split.has(p), who = '<button class="srow-who" type="button" data-split-p="' + esc(p) + '" aria-pressed="' + on + '">' + av(p) + '<span>' + esc(p) + '</span></button>'
      if (st.mode === 'shares') {
        const n = on ? st.shares[p] || 1 : 0
        return '<div class="srow' + (on ? '' : ' off') + '">' + who + '<span class="stepper"><button type="button" data-step="-1" data-p="' + esc(p) + '" aria-label="One share less for ' + esc(p) + '"' + (on ? '' : ' disabled') + '>−</button><b class="num">' + n + '</b><button type="button" data-step="1" data-p="' + esc(p) + '" aria-label="One share more for ' + esc(p) + '">+</button></span><span class="srow-amt num" data-amt-of="' + esc(p) + '"></span></div>'
      }
      return '<div class="srow' + (on ? '' : ' off') + '">' + who + '<input class="srow-in num" data-amt="' + esc(p) + '" inputmode="decimal" autocomplete="off" aria-label="' + esc(p) + '’s part"' + (on ? '' : ' disabled') + ' value="' + (on && st.locked[p] != null ? esc(String(st.locked[p])) : '') + '"></div>'
    }).join('') + '</div>'
  }
  // the numbers that follow the amount: the conversion and the rate, each person's part, and the check under the split
  function syncNumbers() {
    const total = parseAmount(fx('#sp-amount').value), ok = total > 0, cur = st.cur
    const to = cur !== showCur ? showCur : cur === 'THB' ? 'AMD' : 'THB', rate = cur === 'THB' ? 1 : st.rate
    fx('#sp-conv').textContent = ok && rate && midOf(to) ? '≈ ' + money(Math.round(total * rate * 100), to) : ''
    // the rate of this expense (a tap lets you type the one you got): baht for 1 unit, or drams for 1 baht
    const rb = fx('#sp-rate-btn')
    rb.hidden = cur === 'THB' || !rate
    if (!rb.hidden) rb.textContent = cur === 'AMD' ? '1 THB = ' + rateText(1 / rate) + ' AMD' : '1 ' + cur + ' = ' + rateText(rate) + ' THB'
    const far = st.rateTyped && cur !== 'THB' && rate && midOf(cur) && Math.abs(rate / midOf(cur) - 1) > 0.2
    fx('#sp-rate-warn').hidden = !far
    if (far) fx('#sp-rate-warn').textContent = 'Far from today’s rate: ' + (cur === 'AMD' ? '1 THB = ' + rateText(1 / midOf(cur)) + ' AMD' : '1 ' + cur + ' = ' + rateText(midOf(cur)) + ' THB')
    if (st.kind === 'pay') return
    const who = PEOPLE.filter((p) => st.split.has(p)), sum = fx('#sp-sum')
    sum.className = 'split-sum'
    if (!who.length) { sum.textContent = 'Pick who shares it'; return }
    if (st.mode === 'equal') { sum.textContent = cap1(whoOf(who, '')) + (ok ? ' · ' + amt(total / who.length, cur) + (who.length > 1 ? ' each' : '') : ''); return }
    if (st.mode === 'shares') {
      const w = who.reduce((a, p) => a + (st.shares[p] || 1), 0)
      who.forEach((p) => { const el = $('[data-amt-of="' + CSS.escape(p) + '"]', form); if (el) el.textContent = ok ? amt((total * (st.shares[p] || 1)) / w, cur) : '' })
      $$('[data-amt-of]', form).forEach((el) => { if (!st.split.has(el.dataset.amtOf)) el.textContent = '' })
      sum.textContent = who.length + (who.length === 1 ? ' person, ' : ' people, ') + w + (w === 1 ? ' share' : ' shares')
      return
    }
    const { out, rest, free } = amountParts(ok ? total : 0)
    $$('[data-amt]', form).forEach((el) => { el.placeholder = st.split.has(el.dataset.amt) && st.locked[el.dataset.amt] == null && out[el.dataset.amt] != null ? num(out[el.dataset.amt] / 100, out[el.dataset.amt] % 100 ? 2 : 0) : '' })
    if (!ok) { sum.textContent = 'Add the amount first'; return }
    if (rest < 0) { sum.textContent = 'Over by ' + amt(-rest / 100, cur); sum.classList.add('bad'); return }
    if (!free && rest > 0) { sum.textContent = amt(rest / 100, cur) + ' left'; sum.classList.add('bad'); return }
    sum.innerHTML = ic('check') + 'Adds up to ' + esc(amt(total, cur)); sum.classList.add('good')
  }
  // the sheet as an expense or payment to send, or an error shown in it
  function collect() {
    const err = (m, el) => { fx('#sp-err').className = 'sheet-err'; fx('#sp-err').textContent = m; if (el) fx(el).focus(); return null }
    const amount = parseAmount(fx('#sp-amount').value), date = fx('#sp-date').value
    if (!(amount > 0)) return err('Add the amount', '#sp-amount')
    if (amount > 100000000) return err('That amount is too big', '#sp-amount')
    if (!date) return err('Pick the day')
    if (st.cur !== 'THB' && !(st.rate > 0)) return err('Add the rate', '#sp-rate')
    const x = { amount, cur: st.cur, paid: st.paid, date }
    if (st.id) x.id = st.id; else x.newId = st.newId
    if (st.cur !== 'THB') x.rate = st.rate
    if (st.kind === 'pay') {
      if (!st.to || st.to === st.paid) return err('Pick who got the money')
      // the amount that was filled in to settle, unchanged: the rate that settles it to the satang
      if (st.exact && !st.rateTyped && st.exact.cur === st.cur && st.exact.amount === amount) { if (st.cur === 'THB') delete x.rate; else x.rate = st.exact.cents / 100 / amount }
      return Object.assign(x, { kind: 'pay', what: '', split: [st.to] })
    }
    const what = fx('#sp-what').value.trim()
    if (!what) return err('Say what it was', '#sp-what')
    let split = PEOPLE.filter((p) => st.split.has(p))
    if (!split.length) return err('Pick who shares it')
    x.what = what
    if (st.picked) x.cat = st.cat
    if (st.mode === 'shares') {
      const sh = Object.fromEntries(split.map((p) => [p, st.shares[p] || 1]))
      if (new Set(Object.values(sh)).size > 1) x.shares = sh
    } else if (st.mode === 'amounts') {
      const { out, rest, free } = amountParts(amount)
      if (rest < 0) return err('Over by ' + amt(-rest / 100, st.cur))
      if (!free && rest > 0) return err(amt(rest / 100, st.cur) + ' left')
      split = split.filter((p) => out[p] > 0) // nothing left for someone: not in it
      if (!split.length) return err('Pick who shares it')
      x.amounts = Object.fromEntries(split.map((p) => [p, out[p] / 100]))
    }
    return Object.assign(x, { split })
  }
  if (sheet && form && canVote) {
    $('[data-sheet-close]', sheet).addEventListener('click', () => { if (st) st.discard = true; closeSheet() })
    sheet.addEventListener('click', (e) => { if (e.target === sheet && st && !st.dirty) closeSheet() }) // a tap on the shade, before any change
    sheet.addEventListener('close', () => {
      const s = st
      root.classList.remove('sheet-open'); sheet.style.removeProperty('--kb'); st = null
      // closed by Back or Escape after changes, on a new one: kept, and the next Add brings it back
      draft = s && s.dirty && !s.saved && !s.discard && !s.x && !s.saving ? { s, amount: fx('#sp-amount').value, what: fx('#sp-what').value, date: fx('#sp-date').value } : s && (s.saved || s.discard) ? null : draft
      if (history.state && history.state.sheet) history.back() // the entry Back would have closed
      if (s && s.opener && s.opener.isConnected) s.opener.focus({ preventScroll: true })
    })
    addEventListener('popstate', () => { if (sheet.open && !(history.state && history.state.sheet)) closeSheet() })
    addEventListener('hashchange', () => { if (sheet.open && !/^#spend(\/|$)/.test(location.hash)) closeSheet() })
    if (vv) { vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb) }
    form.addEventListener('click', (e) => {
      const t = e.target.closest('button')
      if (!t || !st || t.type === 'submit') return
      const d = t.dataset
      // opening or closing a part is not a change
      if (t.id === 'sp-paid-row') { fx('#sp-paid-box').hidden = !fx('#sp-paid-box').hidden; syncSheet(false); return }
      if (t.id === 'sp-cat') { fx('#sp-cats').hidden = !fx('#sp-cats').hidden; syncSheet(false); return }
      if (t.id === 'sp-rate-btn') {
        const box = fx('#sp-rate-box')
        box.hidden = !box.hidden
        fx('#sp-rate-l').textContent = st.cur === 'AMD' ? 'AMD for 1 THB' : 'THB for 1 ' + st.cur
        fx('#sp-rate').value = rateText(st.cur === 'AMD' ? 1 / st.rate : st.rate).replace(/,/g, '')
        if (!box.hidden) fx('#sp-rate').focus()
        return
      }
      st.dirty = true; st.dupOk = false; st.curOk = false
      if (d.kind) {
        if (d.kind === 'pay' && st.kind !== 'pay') st.curBefore = st.cur
        st.kind = d.kind
        if (st.kind === 'pay') prefillPay()
        else if (st.exact && !st.typed) { fx('#sp-amount').value = ''; st.exact = null; st.cur = st.curBefore || st.cur; st.rate = midOf(st.cur) }
        syncSheet(true); return
      }
      if (d.cur) {
        // another currency: today's rate for it (a typed rate was for the other one); a filled-in payment follows
        st.cur = d.cur; st.curPicked = true; st.rate = midOf(d.cur); st.rateTyped = false; fx('#sp-rate-box').hidden = true
        if (st.kind === 'pay' && st.exact && !st.typed) fillPay(st.exact.cents, d.cur)
      } else if (d.cat) { st.cat = d.cat; st.picked = true; fx('#sp-cats').hidden = true }
      else if (d.paid) { st.paid = d.paid; fx('#sp-paid-box').hidden = true; if (st.to === st.paid) st.to = ''; if (st.kind === 'pay' && !st.x) prefillPay() }
      else if (d.to) { st.to = d.to; st.toPicked = true; if (!st.x && !st.typed) prefillPay() }
      else if (d.mode) { st.mode = d.mode; syncSheet(true); return }
      else if (d.splitSet) { st.split = new Set(d.splitSet === 'all' ? PEOPLE : lastSplit()); syncSheet(true); return }
      else if (d.splitP) {
        const p = d.splitP
        if (st.split.has(p)) { st.split.delete(p); delete st.locked[p] } else { st.split.add(p); st.shares[p] = st.shares[p] || 1 }
        syncSheet(true); return
      } else if (d.step) {
        const p = d.p, n = (st.split.has(p) ? st.shares[p] || 1 : 0) + Number(d.step)
        if (n <= 0) st.split.delete(p); else { st.split.add(p); st.shares[p] = Math.min(n, 99) }
        syncSheet(true); return
      } else if (d.day) fx('#sp-date').value = dayIn(Number(d.day))
      else if (d.quick) {
        const b = PAID_BASES[Number(d.quick)]
        fx('#sp-what').value = b.short; fx('#sp-amount').value = fmtAmount(b.paid.total)
        Object.assign(st, { cur: b.paid.currency, rate: midOf(b.paid.currency), rateTyped: false, cat: 'stay', picked: true, mode: 'equal', split: new Set(PEOPLE) })
        syncSheet(true); return
      } else return
      fx('#sp-err').textContent = ''
      syncSheet(false)
    })
    // Enter in the amount goes on to What was it; in What was it it closes the keyboard: only Save saves
    fx('#sp-amount').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (st && st.kind === 'spend' && !fx('#sp-what').value.trim()) fx('#sp-what').focus(); else e.target.blur()
    })
    fx('#sp-what').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } })
    form.addEventListener('input', (e) => {
      if (!st) return
      st.dirty = true; st.dupOk = false; st.curOk = false
      const p = e.target.dataset.amt
      // a typed part is kept, 0 too; an empty field shares the rest
      if (p) { const raw = e.target.value.trim(), v = parseAmount(raw); if (!raw) delete st.locked[p]; else if (v >= 0) st.locked[p] = v }
      if (e.target.id === 'sp-amount') st.typed = true
      if (e.target.id === 'sp-rate') { const v = parseAmount(e.target.value); if (v > 0) { st.rate = st.cur === 'AMD' ? 1 / v : v; st.rateTyped = true } }
      fx('#sp-err').textContent = ''
      syncSheet(false)
    })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const s = st
      if (!s || s.saving) return
      const x = collect(), me = meOf()
      if (!x || !me) return
      // a villa's price in another currency (AMD and AED sit side by side): say so once; Save again keeps it
      const villa = !isPay(x) && !s.curOk && PAID_BASES.find((b) => b.paid.currency !== x.cur && Math.abs(Number(x.amount) - b.paid.total) < 0.005)
      if (villa) {
        s.curOk = true
        fx('#sp-err').className = 'sheet-err ask'
        fx('#sp-err').textContent = 'The ' + villa.short + ' cost ' + amt(villa.paid.total, villa.paid.currency) + ', not ' + x.cur + '. Tap ' + villa.paid.currency + ' above, or Save again to keep ' + x.cur + '.'
        return
      }
      // the same expense twice: ask once, and the next Save adds it
      const dup = !x.id && !s.local && !s.dupOk && !isPay(x) && dupOf(x)
      if (dup) {
        s.dupOk = true
        fx('#sp-err').className = 'sheet-err ask'
        fx('#sp-err').textContent = 'Already in the list: ' + dup.what + ', ' + orig(dup) + ', ' + you(dup.paid, me) + ' paid. Save again to add it too.'
        return
      }
      if (s.curPicked && !x.id) store.set('spendLastCur', x.cur) // not one from the villa chip or a change
      if (!isPay(x)) store.set('spendLastSplit', x.split)
      if (s.local) {
        // not sent yet: changed on this phone (it was sent meanwhile: the change goes as a change, same id)
        if (!outbox.some((o) => o.spend.newId === s.local)) { delete x.newId; x.id = s.local; s.id = s.local; s.local = '' } else { s.saved = true; keepOnPhone(me, x, 'Changed on this phone'); closeSheet(); flushOutbox(); return }
      }
      s.saving = true; setSaving(true)
      try {
        const j = await post({ name: me, spend: x }, 15000)
        s.saved = true
        if (st === s) closeSheet()
        applyShared(j)
        if (navigator.vibrate) navigator.vibrate(15)
        toast(x.id ? 'Saved' : isPay(x) ? 'Payment added' : 'Expense added', !x.id && j.id ? { label: 'Undo', run: () => unsave(j.id) } : undefined)
        refocus(x.id ? '[data-spend-id="' + CSS.escape(x.id) + '"]' : '#spend-add')
      } catch (er) {
        const mine = st === s
        if (!x.id && !(er.status >= 400 && er.status < 500)) { s.saved = true; if (mine) closeSheet(); keepOnPhone(me, x, 'Saved on this phone. It goes to the group later.') }
        else if (er.status === 404) { s.saved = true; if (mine) closeSheet(); toast(er.message); loadVotes() }
        else if (mine) { fx('#sp-err').className = 'sheet-err'; fx('#sp-err').textContent = er.status >= 400 && er.status < 500 ? er.message : navigator.onLine ? 'Could not save it. Try again in a minute.' : 'This needs internet.' }
        else toast(navigator.onLine ? 'Could not save it. Try again in a minute.' : 'This needs internet.')
      } finally { s.saving = false; if (st === s) setSaving(false) }
    })
    // Delete: at once, with Undo (it comes back as a new expense, added by you)
    fx('#sp-delete').addEventListener('click', async () => {
      const s = st, x = s && s.x
      if (!x) return
      s.saved = true // not a draft, whatever happens
      if (s.local && outbox.some((o) => o.spend.newId === s.local)) { outbox = outbox.filter((o) => o.spend.newId !== s.local); saveOutbox(); closeSheet(); renderSpend(); toast('Deleted'); return }
      try {
        const j = await post({ name: meOf(), deleteSpend: s.local || x.id })
        if (st === s) closeSheet()
        applyShared(j)
        toast('Deleted: ' + (isPay(x) ? 'payment' : x.what), { label: 'Undo', run: () => restore(x) })
        refocus('#spend-add')
      } catch (er) {
        if (er.status === 404) { if (st === s) closeSheet(); toast(er.message); loadVotes() }
        else if (st === s) fx('#sp-err').textContent = navigator.onLine ? 'Could not delete it. Try again in a minute.' : 'This needs internet.'
      }
    })
  }
  async function restore(x) {
    $('#toast').hidden = true; holdNews = 0
    const back = { what: x.what, amount: x.amount, cur: x.cur, paid: x.paid, split: x.split, date: x.date, newId: /^[a-z0-9]{8,24}$/.test(x.id) ? x.id : newSpendId() }
    ;['cat', 'rate', 'shares', 'amounts', 'kind'].forEach((k) => { if (x[k]) back[k] = x[k] })
    try { applyShared(await post({ name: meOf(), spend: back, keep: { by: x.by, t: x.t, editedBy: x.editedBy, editedT: x.editedT } })); toast('Back in the list') } catch { failed() }
  }
  if (spendBox && canVote) {
    setPane(session.get('spendPane') || 'list')
    $('#spend-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) setPane(b.dataset.pane, true) })
    $('#spend-cur').addEventListener('change', (e) => { showCur = e.target.value; store.set('spendCur', showCur); renderSpend(); if (st) syncNumbers() })
    $('#spend-add').addEventListener('click', () => openSheet(null))
    spendBox.addEventListener('click', (e) => {
      const t = e.target.closest('button')
      if (!t) return
      const d = t.dataset
      if (d.me) {
        const was = store.get('spendMe', '')
        if (!voterName() || (was && same(voterName(), was))) store.set('voterName', d.me) // filled in here: it follows
        store.set('spendMe', d.me); picking = false; renderSpend()
      }
      else if ('meChange' in d) { picking = true; renderSpend() }
      else if (d.settleFrom) settle(d.settleFrom, d.settleTo, Number(d.cents))
      else if (d.payFrom) openSheet(null, 'pay', { from: d.payFrom, to: d.payTo, cents: Number(d.cents) })
      else if (d.nextPaid) openSheet(null, 'spend', { paid: d.nextPaid })
      else if ('addFirst' in d) openSheet(null)
      else if (d.spendFilter) { filter = d.spendFilter === 'person' ? 'all' : d.spendFilter; renderList(meOf()) }
      else if (d.filterPerson) { filter = 'p:' + d.filterPerson; renderList(meOf()); setPane('list', true); $('#spend-seg').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }) }
      else if (d.paneGo) { setPane(d.paneGo, true); $('#spend-seg').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }) }
      else if (d.spendId) {
        const x = rows.find((y) => y.id === d.spendId)
        if (x && meOf()) openSheet(x)
        else { const card = $('#spend-me'); card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash') }
      }
      else if (t.classList.contains('bal-row')) { const more = t.nextElementSibling, open = t.getAttribute('aria-expanded') !== 'true'; t.setAttribute('aria-expanded', String(open)); more.hidden = !open }
    })
    // Share as text: the share sheet on a phone, else copied
    $('#spend-copy').addEventListener('click', async () => {
      const b = balancesOf(rows), moves = settleUp(b)
      const text = ['Spending, Phuket trip', ...rows.map((x) => [dayWord(x.date), isPay(x) ? x.paid + ' paid ' + (x.split || [])[0] : x.what, orig(x), isPay(x) ? '' : x.paid + ' paid', isPay(x) ? '' : whoOf(PEOPLE.filter((p) => (x.split || []).includes(p)), '')].filter(Boolean).join(' · ')), '',
        'Balances:', ...PEOPLE.map((p) => p + ': ' + (evenOf(p, b, moves) ? 'even' : (b[p].net > 0 ? 'gets back ' : 'owes ') + money(Math.abs(b[p].net)))), '',
        'Settle up:', ...moves.map((m) => m.from + ' pays ' + m.to + ' ' + money(m.cents))].join('\n')
      if (navigator.share) { try { await navigator.share({ title: 'Spending, Phuket trip', text }); return } catch (er) { if (er && er.name === 'AbortError') return } }
      try { await navigator.clipboard.writeText(text); toast('Copied') } catch { toast('Could not copy here') }
    })
    renderSpend()
    // the unsent ones: when the phone is back online, and every 15 s while the guide is on screen
    flushOutbox()
    addEventListener('online', flushOutbox)
    setInterval(() => { if (outbox.length && document.visibilityState === 'visible') flushOutbox() }, 15000)
  }

  /* ---------- Stats: who opened the guide and what they did (website only) ---------- */
  const SAID = { visit: 'opened the guide', view: 'opened', card: 'looked at', map: 'opened the map of', share: 'shared', photos: 'browsed the photos of', ...DID }
  function itemLabel(e, x) {
    if (e === 'visit') return ''
    if (e === 'view') return ({ home: 'Trip', events: 'Music', places: 'Places', areas: 'Areas', stay: 'Stay', money: 'Money', info: 'Essentials', apps: 'Apps', notes: 'Notes', spend: 'Spend', stats: 'Stats' }[x] || x) + ' tab'
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
    const b = e.target.closest('[data-share-stay], [data-share-card]'); if (!b) return
    const card = b.closest('.card')
    track('share', card.id)
    // the card's share page (…/s/ht-<id>): messengers show its photo, name and price, and it opens the guide on the
    // card; the single file has no web address, so there a villa shares its listing
    const url = /^https?:$/.test(location.protocol) ? shareUrl(card.id) : b.dataset.listing || ''
    if (!url) { toast('Sharing works on the website: ' + (D.siteUrl || 'phuket-six.vercel.app')); return }
    if (navigator.share) { try { await navigator.share({ title: card.dataset.name, url }) } catch { /* closed */ } return }
    try { await navigator.clipboard.writeText(url); toast('Link copied: paste it in a chat') } catch { toast(url) }
  })

  // Share link on a filtered list (Liked, Saved): its address, e.g. …/#stay/liked
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share-list]'); if (!b || !b.dataset.url) return
    const url = b.dataset.url, title = 'Phuket guide: ' + ($('.chip[data-link][aria-pressed="true"]', b.closest('.toolbar'))?.textContent.replace(/\d+/g, '').trim() || 'list')
    track('share', url.split('#')[1])
    if (navigator.share) { try { await navigator.share({ title, url }) } catch { /* closed */ } return }
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
  newStays()
  syncFavs()
  refreshToday()
  tickLoop()
  route()
  restorePlace()
})()
