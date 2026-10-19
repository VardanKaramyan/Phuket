# Phuket Trip Guide (8–26 Jan 2027)

A phone-first guide that works offline: music events, places to go, islands, boat tours and the boats from each pier, areas drawn on a map, villas, money exchange, essentials and the apps to install.
**To continue the work, read `HANDOFF.md`.** It has the status, the next steps and every decision.

**Live site: https://phuket-six.vercel.app** (Vercel publishes `main` of `VardanKaramyan/Phuket` on every push). Open it once on the phone, then *Add to Home Screen* to use it offline.

## Outputs

| File | Use |
| --- | --- |
| `dist/` | Static web app, live at https://phuket-six.vercel.app. Host it anywhere with HTTPS, open it once on the phone, then *Add to Home Screen*. A service worker keeps the page, all photos and the offline satellite map (`sat/`) offline. |
| `dist/phuket-guide-offline.html` | Single self-contained file with the photos and the offline satellite map inside. Keep it on the phone or a laptop. |
| `dist/phuket-areas.kml` | Area outlines and all pins, for Google My Maps → *Import* (then in the Google Maps app under *Saved → Maps*). |
| `artifact/index.html` | The claude.ai artifact build (republish it to update the online copy, which needs internet): https://claude.ai/artifact/Nxy3LAarKyhwtFtf1HvZKD |

## Setup on any machine

You need Node.js 20.3+, Python 3.9+, and Google Chrome or Chromium for the tests (set `CHROME_PATH` if Chrome is not found). Every check and test exits with code 1 when it fails.

```sh
npm install
npm run all        # data (import + curate + apps) -> build -> check, dram, offline, popup, map, votes and gallery tests
npm run qa         # screenshots for a visual check, in qa-out/
npm run serve      # dist/ on http://localhost:8080
```

Step by step:

```sh
node tools/import.mjs research/result-final.json   # research -> data/*.json (overwrites them)
node tools/curate.mjs                              # all editorial fixes + the 19-26 Jan and 19 Oct island research merges
node tools/import-apps.mjs research/result-apps.json   # apps page data (skipped if the file is missing)
python3 -I tools/collect-photos.py                 # photo picks from research/photos/
node tools/images.mjs                              # photos -> assets/img/*.webp
node tools/sat-tiles.mjs                           # offline satellite tiles -> assets/sat/ (only once; skips saved tiles)
node tools/check.mjs                               # sanity checks on the data
node tools/build.mjs                               # writes dist/ and artifact/
node tools/offline-test.mjs                        # serves dist/, stops the server, reloads, checks it still works
node tools/popup-test.mjs                          # map popups stay tappable at 390, 360 and 320 px
node tools/map-test.mjs                            # smooth wheel zoom, full screen, offline satellite
node tools/amd-test.mjs                            # every baht price on the page has its dram amount
node tools/votes-test.mjs                          # the vote server and the Like / Skip buttons, two people voting
node tools/gallery-test.mjs                        # villa photo galleries: swipe, load on demand, offline, artifact
node tools/countdown-test.mjs                      # the countdown board and pill: before, during and after the trip
node tools/new-villas-test.mjs                     # New badges on villas this phone has not seen yet
node tools/update-test.mjs                         # new versions: shown on the first reload, offline copy, Reload offer
```

The map: wheel and trackpad zoom glide (`smoothWheel` in `src/app.js` replaces Leaflet's stepped wheel zoom), the top button opens full screen, and Satellite works offline. The offline satellite layer is EOxCloudless 2025 (Sentinel-2, 10 m per pixel) for the trip region, Phuket and Koh Phangan, up to zoom 14 (769 tiles, 3.6 MB, listed in `assets/sat/coverage.json`). Online, the sharp Esri imagery draws on top of it. Esri's tiles are not saved in advance (their terms do not allow offline export outside ArcGIS); the service worker keeps up to 2500 tiles you have looked at.

Dram prices: the build adds the Armenian dram amount next to every baht price, on the page, in the map popups and in the KML (`tools/amd.mjs`: `500 THB (≈5,400 AMD)`, inside brackets `(100 baht, ≈1,100 AMD)`). The rate is `amdRate` in `data/extra.json` (10.8 AMD per baht, 17 Oct 2026); AMD also comes first in the converter, which refreshes it online. Decimal amounts are left alone (they are exchange rates), and a number without THB or baht right next to it gets no dram amount.

Content edits: hand-written copy is in `data/extra.json`. The villa list (Where to stay) is hand-written in `data/stays.json`: `curate.mjs` swaps it in for the researched hotels, and its photos are picked in `research/photos/w8/stays.json`. Each `priceText` must start with `<total> THB for <nights> nights`: the build reads the big price on the card and the map popup from it, and stops with an error otherwise. Check Airbnb prices in the listing's booking box for 8 adults, 8-18 Jan (`?adults=8&check_in=2027-01-08&check_out=2027-01-18&currency=THB`); the total there includes all fees. Villa photo galleries: `npm run gallery` (or `node tools/stay-gallery.mjs <villa id>`) saves each listing's photo addresses into `data/stays.json` → `gallery` (nothing is downloaded); the cards swipe through them online, the saved photo first. Then `npm run data` and `npm run build`. Every other fix goes into `tools/curate.mjs` as code (Apps page fixes go into `tools/import-apps.mjs`), because the import overwrites `data/*.json`. Fixes to items from the late-January research go after `mergeLateJan(...)` in `curate.mjs`, or the merge overwrites them. Fixes to items from the 19 Oct 2026 island research (piers, boat tours, islands, island events) go in the hook tables of `tools/merge-islands-events.mjs`. Then run `npm run data`: `curate.mjs` refuses to run twice on the same import. The trip dates live in `tools/trip.mjs`.

## Deploy `dist/`

Vercel (17 Oct 2026): the project imports `VardanKaramyan/Phuket` from GitHub, and `vercel.json` tells it to skip the install and build and serve the committed `dist/`. So rebuild locally (`npm run build`), commit `dist/`, and push to the `karamyan` remote; each push to `main` redeploys https://phuket-six.vercel.app.

Votes: `api/votes.js` is a Vercel function (no packages) at `/api/votes` that keeps the group's Like / Skip votes in the Upstash Redis database connected to the project (Vercel → Storage). It finds the database from the variables Vercel created, whatever their prefix (`KV_REST_API_URL`, `STORAGE_REST_API_URL`, or a `rediss://…upstash.io` URL). Never put the token in the repo. Only the website can vote; the single file and the artifact hide the buttons. `node tools/votes-test.mjs` tests the function and the page against a stand-in database.

Any other static host works too, for example:

```sh
npx vercel deploy dist --prod              # after: npx vercel login
npx netlify-cli deploy --dir dist --prod   # after: npx netlify-cli login
npx surge dist                             # asks for an email + password the first time
```

The pages carry `noindex`, so search engines skip them.

## Credits

Map data © OpenStreetMap contributors (ODbL). Street and satellite tiles © Esri and contributors. Offline satellite map: EOxCloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0, so the guide stays non-commercial. Photos: Wikimedia Commons contributors (licenses on each photo) and the venues' own websites (personal use). Fonts: Chakra Petch and Anuphan by Cadson Demak (SIL Open Font License).
