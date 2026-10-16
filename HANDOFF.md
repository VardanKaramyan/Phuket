# Handoff: Phuket Trip Guide

**Status, 16 Oct 2026: done.** The guide is built, tested and published for the full trip (8-26 Jan 2027), including the new **Apps and services** page: 51 apps from 3 fact-checked lists. The online copy is version 5. Nothing is half-done. Optional follow-ups are in section 9.
This file is meant to be enough on its own, on any machine. Open the folder in Claude Code and say: **"Read HANDOFF.md and continue."**

---
 
## 1. Start here on a new machine

Everything the project needs is inside this folder. The old machine's Claude Code memory and session logs do **not** move with it; what mattered from them is written down in this file.

0. **On the old machine, optional:** `research/result-apps.json` already exists (3 fact-checked lists, rebuilt from the run's journal). The run's last step, the completeness critic, had not finished. If `~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/workflows/wf_979252ad-2ea.json` exists later, it holds the full result with the critic's additions. Copy it over `research/result-apps.json` (as below) and run `npm run all`. These were the steps when the run was still going:
   - If the Apps research (section 4) is still running there, keep that Claude Code session open until it finishes. Then save its result from the project folder:
     ```sh
     cp ~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/workflows/wf_979252ad-2ea.json research/result-apps.json && chmod 644 research/result-apps.json
     ```
   - If the session closed before the run finished, **resume** it first, without editing `tools/workflows/apps.js` (a changed prompt re-runs that agent and every agent after it). In a Claude Code session in this folder, ask Claude to call the Workflow tool with `{ scriptPath: "/Users/mac/Documents/Phuket/tools/workflows/apps.js", resumeFromRunId: "wf_979252ad-2ea" }`. Finished agents come back from the cache. Then copy the new run's file:
     ```sh
     ls -t ~/.claude/projects/*/*/workflows/*.json | head -3
     ```
     The newest file is the resumed run; copy it as above.
   - Only if that fails, rebuild what exists from the journal. Lists whose fact-check did not finish are marked, and the Apps page then says "Not fully fact-checked yet":
     ```sh
     python3 -I tools/apps-result-from-journal.py ~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/subagents/workflows/wf_979252ad-2ea/journal.jsonl
     ```
   - Also copy that `journal.jsonl` to `research/journal-apps.jsonl`, so the new machine can do the same rebuild later.
   - Then run `npm run all` once, so `dist/` matches the data, and copy the folder.
1. Copy the whole folder. You can leave out `node_modules/`, `qa-out/` and `.claude/scheduled_tasks.lock`; `npm install` and `npm run qa` recreate the first two. Folder names with spaces are fine.
2. Install the tools:
   - Node.js 20.3 or newer (tested with 20.20.2 and 24.13).
   - Python 3.9 or newer, for `tools/collect-photos.py` and a few helpers.
   - Google Chrome (or Chromium), for the tests and screenshots. It is found automatically on macOS, Linux and Windows; otherwise set `CHROME_PATH=/path/to/chrome`.
3. Run `npm install`, then `npm run all`. That rebuilds the data, builds the site and runs the tests. It should exit with code 0 and print:
   - `checked: 40 events, 71 places, 20 areas, 16 hotels, 8 brands` and `no problems found`
   - `OFFLINE TEST PASSED`
   - 27 lines of `buttons ok` (3 phone sizes × 9 popups), then `POPUP TEST PASSED`
   - `51 apps · by priority {"must":12,"useful":23,"optional":16} …`, and the 4 `apps fix:` lines from curate.

   Every check and test exits with code 1 when it fails.
4. To look at the result, open `dist/phuket-guide-offline.html` in a browser (after step 3, so it matches the data), or run `npm run serve` and open http://localhost:8080.
5. The online copy is a private claude.ai artifact: https://claude.ai/artifact/Nxy3LAarKyhwtFtf1HvZKD (version 5, 16 Oct 2026). To update it, Claude Code must be logged in to the **same claude.ai account**. See section 8.

`npm run all` = `npm run data` (import, curate, apps import) + `npm run build` + `npm test`. Every step on its own is in section 6.

---

## 2. The user

- A frontend developer, so web tooling terms are fine.
- Writes short, informal English with typos; English is not their first language. All guide copy uses **short, simple, concrete English**: no marketing words, no emoji, no exclamation marks, no em-dash asides.
- Likes big tasks done thoroughly. They turn on **max effort and "ultracode"** (run substantive work as Workflow orchestrations with adversarial fact-checks). They expect progress updates while long workflows run.
- Wants this `HANDOFF.md` kept up to date during long work. They switch sessions and machines, and a terminal restart once killed a long workflow mid-run.
- Ask before anything outward-facing: hosting `dist/`, a Google My Maps import, pushing to GitHub. They chose **"Skip for now"** on hosting (16 Oct 2026), then set up Vercel themselves on 17 Oct 2026 (see section 9, item 2).
- Two GitHub remotes: `origin` = `vardan-k/Phuket`, `karamyan` = `VardanKaramyan/Phuket` (public; Vercel deploys from its `main`). Push with `git push karamyan main` and `git push origin main`.
- Loves underground techno (Bassiani / Berlin style), good raves and festivals. Events are ranked underground-first.

## 3. The trip (the content depends on these facts)

- **8-26 Jan 2027, 19 days.** It was first planned as 8-18 Jan; the user changed it on 16 Oct 2026.
  - **Group, 8-18 Jan:** a big group, based in Kamala.
  - **Two of you, 19-23 Jan:** the plan is Koh Phangan for full-moon week. Fly Phuket to Koh Samui at 14:15 or earlier, then a boat to Thong Sala, and stay in Ban Tai. On Sat 23 take a boat to Samui and the 15:05 flight back for the last Circoloco in Natai (the user said "we will remain 2 people till jan 23").
  - **Solo, 24-26 Jan:** last nights near the airport (Nai Yang).
  - **Flight home: Tue 26 Jan 2027, 18:20 HKT.** Be at the airport by 15:20. The last night out is Mon 25 Jan.
- **Key events:**
  - Circoloco, Baba Beach Club Natai: Sat 9, 16 and 23 Jan.
  - Café del Mar, Kamala: Argy on Fri 8 Jan (presale Tue 20 Oct, 18:00 Thai time), Marco Carola on Wed 13 Jan.
  - Koh Phangan: Lost Jungle 9-11 Jan, Halfmoon 15-16 Jan.
  - Full-moon week: OXA Tue 19 (moved from Friday), Waterfall Wed 20 and Sun 24 (expected), Jungle Experience Thu 21 (expected), Full Moon Party Fri 22.
  - DnB Allstars, Chalong: 22-24 Jan, 3-day tickets only.
  - Shelter: Fri and Sat. Courage Bar crews in Old Town are the most underground.
  - Outside the dates: Zamna 29-30 Jan (after), Carl Cox 3 Jan (before).
- **Money:** Mamy Exchange in Koh Kaew has the best rates; also Lion (Jungceylon) and the SuperRich partner in Old Town (closed Sundays). Thai ATMs charge 250-350 THB per withdrawal.

---

## 4. The Apps page (done 16 Oct 2026)

The user asked (16 Oct 2026): "add also if theres none the apps and services that we will need to download and use there like bolt app grab etc".

**Done:**
- 51 apps and services in `data/apps.json`: 12 must-have, 23 useful, 16 optional. They come from the three fact-checked lists in `research/result-apps.json`, rebuilt from the run's journal (`research/journal-apps.jsonl`). The completeness critic's additions were not waited for, because time ran out; see section 1 step 0 to add them.
- Of the 16 corrections to older guide texts, 12 were confirmed correct. 4 were fixed:
  - 12Go: e-ticket versus a printed voucher.
  - LINE: "answers faster" had no source.
  - The RA link: the Phuket page is empty, so it now links Shelter's RA club page.
  - The Argy ticket link: `megatix.co.th` was a parked domain.

  The first three are in the corrections block of `curate.mjs`; the Argy link is set in its event fix.
- The checker of the money list found a TAT source (Jul 2026) saying the Tourist Police app works without a Thai SIM. The sentence stays removed (safe either way).
- The "steps" below were the plan while it was running. Use them to redo or extend the research.

**Already done (code):**
- `tools/build.mjs`:
  - `appsView()` with groups "Install before you fly" (must), "Good to have" (useful) and "Only for some plans" (optional).
  - Cards with App Store, Google Play and Website buttons.
  - A full-width home tile "Apps to install".
  - A link from the top of Essentials.
- `src/app.js`: the `apps` view; a "Ready" tick on must-have cards, saved in `localStorage` (`pg:appsDone`); a progress line; the store button for the viewer's phone gets the primary style.
- `src/styles.css`: the apps block at the end.
- `tools/import-apps.mjs`: merges the research into `data/apps.json`, removes duplicates and prints the corrections to existing guide texts.
- The view, the tile and the Before-you-fly line that links to `#apps` only appear once `data/apps.json` exists. The router also sends any view missing from the build back to home. So building or publishing in between is safe.
- The home "Before you fly" box is now a hand-picked list in `data/extra.json` → `beforeYouFly` (TDAC, apps, Samui flights and Ban Tai room, party tickets, vapes, passport). Before, it took the first "must know" facts and, after the late-January update, showed Koh Phangan travel steps there.
- Fixed: the Tourist Police app text no longer claims it "works without a Thai SIM" (no source; `curate.mjs`).

**Research:**
- Workflow script `tools/workflows/apps.js`: 3 researchers (rides and travel; money, phone, chat, maps and safety; food, party tickets and bookings), an adversarial fact-checker for each, then a completeness critic whose additions are fact-checked too.
- Each researcher also re-checks app claims already in the guide and returns `corrections`.
- Run id on the old machine: `wf_979252ad-2ea`.

**To finish:**
1. Get a **fact-checked** `research/result-apps.json`:
   - **If it exists,** run `grep -c "VERIFY MISSING\|VERIFY FAILED" research/result-apps.json`. 0 means every list was fact-checked: go to step 2. Otherwise get the missing checks first (resume or re-run, below), or ask the user, before you publish anything from it.
   - **On the old machine:** run section 1, step 0. It resumes the run if needed.
   - **If `research/journal-apps.jsonl` exists:** `python3 -I tools/apps-result-from-journal.py research/journal-apps.jsonl` rebuilds what that journal has. Lists without a finished fact-check are marked; check them before you publish.
   - **Otherwise re-run the workflow** (resume only works on the machine that started the run):
     - First change "today is 16 Oct 2026" in `tools/workflows/apps.js` and `asOf` in `tools/import-apps.mjs` to the day you run it.
     - Open Claude Code in this folder (max effort, ultracode on; "ultracode" is the user's setting for running substantive work as Workflow scripts). Ask Claude to call the Workflow tool with `{ scriptPath: "<absolute path of this folder>/tools/workflows/apps.js" }`. It takes no args.
     - The tool's answer gives the run id: write it into sections 4 and 11 straight away.
     - Keep that session open until the run finishes (about 1-2 hours; a closed session ends the run, but the same machine can resume it with `resumeFromRunId`).
     - Then copy its result file to `research/result-apps.json` and run `chmod 644` on it. Find the file with `ls ~/.claude/projects/*/*/workflows/<run id>.json`. `import-apps.mjs` reads its `result` key. Claude Code names the project folder after the project's absolute path, with every character that is not a letter or digit replaced by `-`.
2. Run `node tools/import-apps.mjs research/result-apps.json`. It writes `data/apps.json` and prints counts, apps without store links, and every **correction**. If it prints `WARNING: NOT FACT-CHECKED`, go back to step 1.
3. Apply the corrections in `tools/curate.mjs`, in the block **"corrections from the apps research"** right after `mergeLateJan(ROOT, log)`:
   - `INFO_FIX = [['old text', 'new text'], …]` for Info facts.
   - `TIP_FIX = [['event-id', 'old text', 'new text'], …]` for event tips.
   - `LINK_FIX = [['old url', 'new url', or '' to drop], …]` for links in Info facts and event cards.

   To change an Info title, edit it in the same block by section id and title.

   Do not use the earlier "the trip is 8 to 26 Jan" block: it runs before the late-January merge, which adds Info sections and replaces the tips of re-checked events (Circoloco among them). `swap()` cannot edit Info facts. Each fix logs `apps fix: …`, or `NO MATCH` when the old text is not found.

   Where the texts live. The same app is often described with other words in more than one fact, so fix every wording:
   - Info → Getting around: "Grab and Bolt" (fares); "From the airport" (Exit 8 / Exit 1, limousine board); "Phuket Smart Bus" (payment).
   - Info → Island hopping and Koh Phangan full-moon week: 12Go.
   - Info → Power and apps: inDrive, Translate, Maps, LINE, 12Go, Klook, Wise, Tourist Police.
   - Info → SIM, eSIM and Wi-Fi: eSIM apps.
   - Info → Your solo days: "Hostelworld app chats", "Join-in boat trips" (Klook), "Plan the ride home" (Grab, Bolt, Share My Ride), "Help numbers" (Tourist Police app), "Find the techno people" (RA link).
   - Info → Flight home: "Book the ride the day before" (Grab Advance Booking, Bolt), "Cheapest ride: the Smart Bus", "Paid lounges" (Klook).
   - Event cards: the Circoloco tips ("Dice says 18+…"), and ticket links.

   **Copy each old text from `data/essentials.json` or `data/events.json`** (`grep -n "<app name>" data/essentials.json data/events.json`), not from the import-apps output: that quotes the claims as they were on 16 Oct, and some were edited since. For example, the Tourist Police "works without a Thai SIM" is already removed.

   Then run `npm run data` and grep `data/*.json` to confirm each old sentence is gone.
4. Optional clean-up: Info → "Power and apps" still has short app facts (Grab/Bolt/inDrive, Translate, Maps, LINE, 12Go, Klook, Wise, Tourist Police). Once the Apps page covers them, cut that section down to "Plugs and voltage" in `curate.mjs`, and keep the ATM fee fact (it is also in Money).
5. Run `npm run all`, then `npm run qa` and look at `qa-out/apps-1.png`, `apps-2.png` and so on (the Apps page in 1600 px slices), and at `qa-out/pass-*.png`.
6. Republish the artifact (section 8) and AirDrop the new `dist/phuket-guide-offline.html` to the phone. Then update section 1 step 5 (the version), sections 4, 5 and 11 of this file, and the README's Outputs table.

---

## 5. Where everything stands (done and tested)

- **Content:** 40 music items (dated events, weekly nights, clubs), 71 places (must-see, hidden gems, day trips, food), 20 areas, 16 villas for the group (the user's own Airbnb and Booking.com shortlist for 8 guests, 8-18 Jan, which replaced the 28 researched hotels on 16 Oct 2026), 8 money-changer brands, 12 Info sections and 16 Thai phrases. Every item was researched and then adversarially fact-checked: coordinates re-derived, closures checked, dates confirmed on ticket sites. Each item has a `verification` note, and there is a log in `data/research-log.json`.
- **Photos:** 173 photos, 166 in use. Each was looked at by an agent and cropped to 640×360 WebP. Sources are Wikimedia Commons (with author and license) or the venue's own site or social accounts, for personal use only.
- **Site:**
  - Hash-routed and works with JavaScript off (CSS `:target`); light and dark themes.
  - Home: a boarding-pass header with one row of days per trip phase, the flight, and a day agenda. On 19-22 Jan the agenda lists Koh Phangan first; flight day lists no evening events.
  - An 18-night plan grouped by phase, phase and place filters, favourites, "My hotels", Hide / Show again on the villa cards, a converter.
  - Google place IDs on 142 links; Directions go to piers or car parks where the pin is in the sea or uphill.
  - Map popups use short texts so they fit a 320×640 phone.
- **Outputs:**
  - `dist/`: the offline web app (service worker; not hosted yet).
  - `dist/phuket-guide-offline.html`: about 8.4 MB single file with photos inside; the copy to keep on the phone. The copy now on the phone is older, so AirDrop the new one (and again after each rebuild).
  - `artifact/index.html`: the build of the online copy, published as **version 5** (16 Oct 2026, with the Apps page).
  - `dist/phuket-areas.kml`: for Google My Maps.
- **Tests, last run 16 Oct 2026, all pass:**
  - `check`: no problems.
  - `offline-test`: both host styles.
  - `popup-test`: 27/27.
  - Screenshots in light and dark at 390 and 320 px: no console errors, no sideways scroll, tab bar not covered.

---

## 6. Pipeline and commands

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `node tools/import.mjs research/result-final.json` | Main research result → `data/{events,places,areas,hotels,exchanges,essentials}.json` (normalized) + `data/research-log.json` + `data/photo-items.json`. **Overwrites those files.** |
| 2 | `node tools/curate.mjs` | All editorial fixes, in order: duplicates, QA fixes, texts for the 8-26 Jan dates, then `mergeLateJan()` (`tools/merge-late-jan.mjs` reads `research/result-late-jan.json`), the apps corrections, Google place ids, area labels that match the map polygons. **Hand edits to data go here** (as code), not straight into `data/*.json`, or the next import wipes them. It runs once per fresh import (it appends tips), so it refuses to run on curated data: after editing it, run `npm run data`. |
| 3 | `node tools/import-apps.mjs research/result-apps.json` | Apps research → `data/apps.json` (skips if the file is missing). Fixes to apps belong in this script. |
| 4 | `python3 -I tools/collect-photos.py` | Rebuilds `data/image-picks.json` from `research/photos/<wave>/*.json`. On the old machine it first copies results out of the workflow journals; set `PHUKET_WORKFLOWS_DIR` if needed. **Photos for new items:** list them like `research/photo-items-wave7.json` (key, kind, name, where, gmapsQuery, website, candidates) in `research/photo-items-wave8.json`. Run `tools/workflows/photos.js` with absolute `outDir` (`<folder>/assets/raw`) and `itemsFile`, and `batches` (arrays of keys, about 6 each). Save its result as `research/photos/w8/photos.json` (the whole `~/.claude/projects/*/*/workflows/<run id>.json` file works too), add `'w8': '<run id>'` to `WAVES` in `collect-photos.py`, then run `npm run photos` and `npm run all`. |
| 5 | `node tools/images.mjs` | `assets/raw/*` → `assets/img/*.webp` (640×360) + `data/images.json` + `data/contact-*.png` contact sheets. `POSITION` and `BAND` set crops by hand. |
| 6 | `node tools/geo.mjs` | Only if the map geometry must change: `data/geo/*` (OSM extracts) → `areas.geojson`, `land.geojson`, `roads.geojson`. |
| 7 | `node tools/check.mjs` | Coordinates on land / inside their area, dates in the window, ids, links. |
| 8 | `node tools/build.mjs` | Writes `dist/`, `dist/phuket-guide-offline.html`, `artifact/index.html` (+ `artifact/img/`). |
| 9 | `node tools/offline-test.mjs` | Serves `dist/`, installs the service worker, **stops the server**, reloads, checks everything still works (plain host and a host that redirects `/index.html`). |
| 10 | `node tools/popup-test.mjs` | Taps "On map" on 9 cards in a row at 390, 360 and 320 px; every popup button must be tappable. |
| 11 | `node tools/qa-shots.mjs [html] [outdir]` | Screenshots: pass at 390 light / 320 dark, every agenda day, phase-filter counts, every Info section, the Apps view, chosen cards (`CARDS=id,id`). The sticky bars are made static so they do not cover content; the Apps view is saved in slices (`apps-1.png`, …). Exits 1 if it found problems. |
| 12 | `node tools/shoot.mjs <html> <outdir> light\|dark [views…]` | Full-view phone screenshots (`WIDTH=320` for small phones; default views include `apps`, skipped while it is not built); reports console errors, overflow, covered tab bar, and exits 1 if it found any. |

npm shortcuts: `npm run data`, `npm run photos`, `npm run build`, `npm run check`, `npm test`, `npm run qa`, `npm run all`, `npm run serve`. `GUIDE_DATA=<dir> node tools/build.mjs` builds from another data folder (layout tests with sample data; it still writes to `dist/` and `artifact/`).

## 7. Files

| Path | What |
| --- | --- |
| `src/styles.css` | Design tokens (light + dark), layout, components, CSS-only routing for the no-JS case. |
| `src/app.js` | Router (`VIEWS`), filters (generic: chip `data-group` ↔ card `data-<group>`), favourites, day planner, Leaflet map (vector offline basemap + Esri tiles online), converter, My hotels, hidden villas (`pg:hiddenStays`), Apps ticks, service-worker registration. |
| `src/sw.js` | Service worker template (precache list and version injected by the build). |
| `tools/trip.mjs` | **The trip dates in one place:** `TRIP` (start, end, last night, flight, phases), `TRIP_DAYS`, `inTrip`, `windowOf`, `phaseOf`, and date words for the copy. The build, import, merge, check and curate scripts all import it. |
| `tools/build.mjs` | Renders every view to static HTML from `data/*.json`; inlines fonts, CSS, JS and Leaflet; writes the outputs, manifest, icons and KML. `PLAN_PHANGAN` (the nights the plan puts the two of them on Koh Phangan) is plan-specific. |
| `tools/curate.mjs` | Every editorial fix after import (see the table above). |
| `tools/merge-late-jan.mjs` | The 19-26 Jan research merge: `TAKE` (fields a re-checked copy replaces), `AFTER` (keeps facts the researchers lacked), `SKIP` (left out on purpose), `NEW_FIX`, `DEAD_LINKS`. |
| `tools/import.mjs`, `tools/import-apps.mjs` | Research result → data. |
| `tools/apps-result-from-journal.py` | Rebuilds `research/result-apps.json` from the apps workflow's `journal.jsonl` (section 1, step 0). |
| `tools/check.mjs`, `tools/offline-test.mjs`, `tools/popup-test.mjs`, `tools/qa-shots.mjs`, `tools/shoot.mjs`, `tools/chrome.mjs` | Checks, tests and screenshots (`chrome.mjs` finds Chrome; `CHROME_PATH` overrides). |
| `tools/images.mjs`, `tools/collect-photos.py`, `tools/photo-items-from-raw.mjs`, `tools/geo.mjs` | Photos and map geometry. `photo-items-from-raw.mjs` overwrites `data/photo-items.json` (142 items instead of 144; `npm run data` writes it back). |
| `tools/journal-extract.py`, `tools/transcript-digest.py`, `tools/watch-workflows.py` | Helpers for Claude Code workflow journals (only useful on the machine that ran the workflows). |
| `tools/workflows/` | Workflow scripts. Run one by asking Claude Code to call the Workflow tool with `{ scriptPath: "<absolute path>", args: {…} }`.<br>• `research.js`: the original 8-18 Jan research. `args.root` = project folder; `args.resume` / `args.precomputed` resume a killed run.<br>• `late-january.js`: the 19-26 Jan research. `args.known` = ids already in the guide.<br>• `apps.js`: the apps research (no args).<br>• `photos.js`: the photo hunt. `args.outDir` and `args.itemsFile` as absolute paths, `args.batches` = arrays of item keys.<br>• `qa.js` (`args.project`, `args.shots` = a folder of `light-/dark-<view>.png`) and `qa-2.js` (`args.project`): review rounds.<br>• `handoff-check.js` (`args.project`, `args.tmp`): the fresh-machine test of this handoff.<br>• `handoff-recheck.js` (`args.project`, `args.tmp`, `args.first` = an earlier check's JSON): the second pass that confirms its fixes. |
| `data/events.json`, `places.json`, `areas.json`, `hotels.json`, `exchanges.json`, `essentials.json` | Content (generated by import + curate). |
| `data/stays.json` | The villa shortlist, hand-written (16 Oct 2026: price for 8 guests on 8-18 Jan, copy, approximate Airbnb pins). `curate.mjs` replaces `hotels.json` with it after the late-January merge. Photos: `research/photos/w8/stays.json` → `npm run photos`. |
| `data/extra.json` | Hand-written copy, edited directly: intros, `eventsCallout.groups` (18-night plan per phase), `eventsFooter`, `dayTips` (per date), `areasRecommendation`, `beforeYouFly`, `imageNotes` (stand-in photo labels), `dropImages`, `researchedOn` (the footer date: update it after re-checks), and `offlineUrl` (not in the file yet: add `"offlineUrl": "https://…"` once hosted). |
| `data/apps.json` | Apps page content (from `import-apps.mjs`). |
| `data/images.json`, `data/image-picks.json` | Processed photos and the chosen source photos (paths relative to the project). |
| `data/geo/` | OSM extracts and the built map layers. |
| `research/` | Every research output:<br>• `result-final.json` (main), `result-late-jan.json`, `result-apps.json` (when done), and `journal-apps.jsonl` (if copied).<br>• `result-provisional.json`: an early main result with 61 places, replaced by `result-final.json` and not used.<br>• `raw/` (each agent's output) and `resume/` (digests of interrupted agents).<br>• `photos/w1-w7/` (photo agents' results) and `photo-items-wave*.json` (photo search lists; wave 7 is written again only while late-January items lack photos).<br>• `qa-result*.json` (review findings) and `qa-shots*/` (old QA screenshots).<br>• `google-place-ids.json`, and `prior-events-research.md` (the first events research chat). |
| `assets/fonts/`, `assets/raw/`, `assets/img/` | Fonts (OFL, inlined at build), original photos, processed WebP photos. |

**Data fields worth knowing:**
- Events: `kind` (dated/recurring/venue), `dates` (ISO; only days that matter), `window` (in/before/after), `status` (`unconfirmed` shows as "Maybe" / "not confirmed"), `undergroundScore`, `pick`, `agendaNote`, `tile`, `placeId`, `extraMaps`.
- Places: `tier`, `durationLabel`, `days`, `dirLat`/`dirLng`/`dirLabel`, `noDirections`.
- Hotels: `lastNights`, `noRoomsOnTrip`, `websiteLabel` (the site button text, e.g. Airbnb). Villas with approximate Airbnb pins use `coordConfidence: medium` + `noDirections`, so they stay on the map without a Directions button.
- Low `coordConfidence` pins get no map dot and no Directions button.

## 8. Publishing the artifact

- **From the same session that published it:** publish `artifact/index.html` with `files` mapping every `artifact/img/<name>.webp` to `img/<name>.webp`.
- **From a new session or machine:** first `Artifact({ action: "read", url: "https://claude.ai/artifact/Nxy3LAarKyhwtFtf1HvZKD" })`, then publish with that `url` and the same `files`.

Run this from the project folder; it prints the `files` map:
```sh
python3 -I -c "import os,json; print(json.dumps({'img/'+f: 'artifact/img/'+f for f in sorted(os.listdir('artifact/img')) if f.endswith('.webp')}))"
```
The artifact is online-only: claude.ai blocks service workers and external tiles, so it uses the vector map. Its Offline box points to the offline file.

## 9. Next steps, in order

0. **Tue 20 Oct 2026, 18:00 Thai time:** the Argy presale opens on Megatix (Limited Presale 900 THB, entry by 16:00). Remind the user. After that date:
   - Update the Argy `priceText` in `tools/curate.mjs` (the `cafe-del-mar-pyramid-2027-01-08` fix) and the ticket line in `data/extra.json` → `beforeYouFly`.
   - Check the ticket link. It points to Café del Mar's Megatix page, `https://megatix.in.th/cafedelmarphuket`, because the old `megatix.co.th` link was a parked domain (checked 16 Oct 2026). Use the Argy event page on Megatix once it is listed.
1. Optional: add the critic's additions to the Apps page (section 1 step 0), and cut Info → "Power and apps" down to "Plugs and voltage", now that the Apps page covers those apps.
2. **Hosting:** Vercel, imported from `VardanKaramyan/Phuket` on 17 Oct 2026. `vercel.json` skips the install and build and serves the committed `dist/`, so rebuild locally, commit `dist/`, and push to `karamyan`. Once the URL is known, add it as `offlineUrl` in `data/extra.json` and rebuild. Other static hosts work too:
   - `npx vercel deploy dist --prod` after `npx vercel login`
   - `npx netlify-cli deploy --dir dist --prod`
   - `npx surge dist`
   - Netlify Drop

   Then set `offlineUrl` in `data/extra.json`, rebuild, and republish the artifact. On the phone: open the URL once, then Add to Home Screen (iOS Safari clears normal tabs after 7 unused days).
3. **Late December 2026 re-checks** (small parties are announced 1-3 weeks ahead):
   - RA, Telegram "Phangan Party Guide", Instagram of Shelter / Courage Bar / Retro Mountain.
   - The expected full-moon-week dates (Waterfall 20/24, Jungle Experience 21, Utopia 20, Seaside, Unclave).
   - Café del Mar shows for 18-25 Jan.
   - Seats on the Samui-Phuket flights on Sat 23 Jan (only 7 a day).
   - Koh Sirey's golden-rock shrine (landslide).
   - The 450-baht entry fee.
   - Edit `data/extra.json`, or `tools/curate.mjs` **after** `mergeLateJan(ROOT, log)`. Most of these events come from the late-January merge, which replaces the `TAKE` fields (time, price, status, recurrence, genres, description, tips) of anything fixed above it and merges dates. Use `INFO_FIX` / `TIP_FIX` / `LINK_FIX`, or a block there such as:
     ```js
     { const d = rd('events.json'); const x = d.items.find((e) => e.id === 'waterfall-festival-phangan'); if (x) { x.status = 'listed'; x.dates = ['2027-01-20', '2027-01-24'] } wr('events.json', d); log.push('re-check: waterfall') }
     ```
   - Set `researchedOn` in `data/extra.json`, then run `npm run all`, republish, and send the new offline file to the phone.
4. Optional (needs the user's Google account and consent): import `dist/phuket-areas.kml` into Google My Maps.

## 10. Decisions worth knowing

- **If the trip dates change:**
  1. Edit **all** of `TRIP` in `tools/trip.mjs`: `start`, `end`, `lastNight` (the night before the flight), `flight.day` and `time`, and the `from` / `to` of every phase. The phases must cover every day (`trip.mjs` throws an error otherwise). The page copy, the day rows, the phase chips, the three late-January Info titles and every date check follow from it.
  2. Move `PLAN_PHANGAN` in `tools/build.mjs` if the Koh Phangan nights move.
  3. Rewrite the date texts:
     - `data/extra.json`: the `dayTips` keys, `eventsCallout`, `areasRecommendation`, `beforeYouFly`.
     - `tools/curate.mjs`: the "the trip is 8 to 26 Jan" block and the Koh Phangan trip plan texts.
     - `tools/merge-late-jan.mjs`: the `AFTER` texts.

     `grep -n "Jan" data/extra.json tools/curate.mjs tools/merge-late-jan.mjs` finds them. New dates may also need new research: `tools/workflows/late-january.js` shows how the 19-26 Jan research was done.
  4. Run `npm run all`.

- **Three outputs** because of platform limits:
  - claude.ai artifacts block service workers and all external images and tiles, so the artifact is online-only with the vector map.
  - `dist/` is the real offline app (service worker; Esri tiles cached as you view them).
  - The single file is the backup kept on the phone. iOS Files previews show it without JavaScript, which is why every section renders as static HTML and routes with CSS `:target`.
- **Map tiles:** CARTO now returns "API KEY REQUIRED" tiles, and OSM's own tiles label Phuket in Thai, so streets and satellite come from Esri. Offline, the map falls back to the bundled vector land, roads and area outlines.
- **Areas** follow official subdistricts (tambon) clipped to the coastline:
  - Karon, Choeng Thale, Sakhu, Rawai, Wichit and Pa Khlok are split with seed points.
  - Ko Kaeo is left unassigned.
  - Natai is cut from the mainland coastline.
  - Talat Yai is "island minus all the other subdistricts".
- **Google Maps links:** "Google Maps" opens the item's `gmapsQuery` (plus a place id when known); "Directions" uses lat/lng or the `dir*` override.
- **Late-January merge rules:**
  - Re-checked copies replace text fields; dates, links and sources are merged.
  - Left out on purpose: O Beach x Club SEEN Samui (commercial; you are elsewhere then) and Black Box Samui (an earlier check removed it; nothing announced).
  - The FAKE PALM Instagram link is dropped: no source confirms the account.
- **The day agenda** puts Koh Phangan first on 19-22 Jan (the plan's location) and lists nothing on flight day.
- **Popups** show the venue name, compact dates or the first clause of the pattern, and the headline hotel price. Full texts made them too tall on 320×640 phones.
- **Photos** from official sites are for this personal guide only. Keep the page private and `noindex` (already set).

## 11. Research history (workflow runs)

The journals of these runs are only on the old machine: `~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/subagents/workflows/<run id>/journal.jsonl`. Their results are saved in this folder:

| Run | Id | Saved as |
| --- | --- | --- |
| Research v1 (killed by a terminal restart) and v2 (resumed) | `wf_e31b0450-006`, `wf_e70358b7-288` | `research/raw/`, `research/resume/`, `research/result-final.json` |
| Photos, waves w1-w6 (music, places, day trips / food / areas, hotels, replacements) | `wf_37b202cc-9ea`, `wf_7449d89f-29c`, `wf_a1aa8663-200`, `wf_f4d31692-ce6`, `wf_14607df2-a14`, `wf_566ae36a-956` | `research/photos/w1`-`w6/`, `assets/raw/` |
| QA rounds 1 and 2 | `wf_b10b9b5c-7aa`, `wf_abb5b0cb-e93` | `research/qa-result.json`, `research/qa-result-2.json`, `research/qa-shots*/` |
| Late January (19-26 Jan) research + fact-check | `wf_f72ec0b6-320` | `research/result-late-jan.json` |
| Photos, wave w7 (17 new items) | `wf_cf058967-e2e` | `research/photos/w7/`, `assets/raw/` |
| Apps research (3 lists and their fact-checks done; the critic was still running) | `wf_979252ad-2ea` | `research/result-apps.json` (rebuilt from the journal), `research/journal-apps.jsonl` |
| Handoff check: fresh-machine dry run + review (30 findings, all fixed on 16 Oct 2026) | `wf_f201079e-c9e` | `research/handoff-check-1.json` |
| Handoff recheck: 55 of the 60 first-pass checks confirmed fixed; the other 5 and 23 smaller new findings fixed the same day | `wf_c2d3717f-9b9` | `research/handoff-check-2.json` |
