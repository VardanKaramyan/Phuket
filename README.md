# Phuket Trip Guide (8–26 Jan 2027)

A phone-first guide that works offline: music events, places to go, areas drawn on a map, hotels, money exchange, essentials and the apps to install.
**To continue the work, read `HANDOFF.md`.** It has the status, the next steps and every decision.

## Outputs

| File | Use |
| --- | --- |
| `dist/` | Static web app. Host it anywhere with HTTPS, open it once on the phone, then *Add to Home Screen*. A service worker keeps the page and all photos offline. |
| `dist/phuket-guide-offline.html` | Single self-contained file with the photos inside. Keep it on the phone or a laptop. |
| `dist/phuket-areas.kml` | Area outlines and all pins, for Google My Maps → *Import* (then in the Google Maps app under *Saved → Maps*). |
| `artifact/index.html` | The claude.ai artifact build (republish it to update the online copy, which needs internet): https://claude.ai/artifact/Nxy3LAarKyhwtFtf1HvZKD |

## Setup on any machine

You need Node.js 20.3+, Python 3.9+, and Google Chrome or Chromium for the tests (set `CHROME_PATH` if Chrome is not found). Every check and test exits with code 1 when it fails.

```sh
npm install
npm run all        # data (import + curate + apps) -> build -> check, offline test, popup test
npm run qa         # screenshots for a visual check, in qa-out/
npm run serve      # dist/ on http://localhost:8080
```

Step by step:

```sh
node tools/import.mjs research/result-final.json   # research -> data/*.json (overwrites them)
node tools/curate.mjs                              # all editorial fixes + the 19-26 Jan research merge
node tools/import-apps.mjs research/result-apps.json   # apps page data (skipped if the file is missing)
python3 -I tools/collect-photos.py                 # photo picks from research/photos/
node tools/images.mjs                              # photos -> assets/img/*.webp
node tools/check.mjs                               # sanity checks on the data
node tools/build.mjs                               # writes dist/ and artifact/
node tools/offline-test.mjs                        # serves dist/, stops the server, reloads, checks it still works
node tools/popup-test.mjs                          # map popups stay tappable at 390, 360 and 320 px
```

Content edits: hand-written copy is in `data/extra.json`. The villa list (Where to stay) is hand-written in `data/stays.json`: `curate.mjs` swaps it in for the researched hotels, and its photos are picked in `research/photos/w8/stays.json`. Every other fix goes into `tools/curate.mjs` as code (Apps page fixes go into `tools/import-apps.mjs`), because the import overwrites `data/*.json`. Fixes to items from the late-January research go after `mergeLateJan(...)` in `curate.mjs`, or the merge overwrites them. Then run `npm run data`: `curate.mjs` refuses to run twice on the same import. The trip dates live in `tools/trip.mjs`.

## Deploy `dist/`

Vercel (17 Oct 2026): the project imports `VardanKaramyan/Phuket` from GitHub, and `vercel.json` tells it to skip the install and build and serve the committed `dist/`. So rebuild locally (`npm run build`), commit `dist/`, and push to the `karamyan` remote; each push to `main` redeploys.

Any other static host works too, for example:

```sh
npx vercel deploy dist --prod              # after: npx vercel login
npx netlify-cli deploy --dir dist --prod   # after: npx netlify-cli login
npx surge dist                             # asks for an email + password the first time
```

The pages carry `noindex`, so search engines skip them.

## Credits

Map data © OpenStreetMap contributors (ODbL). Street and satellite tiles © Esri and contributors. Photos: Wikimedia Commons contributors (licenses on each photo) and the venues' own websites (personal use). Fonts: Chakra Petch and Anuphan by Cadson Demak (SIL Open Font License).
