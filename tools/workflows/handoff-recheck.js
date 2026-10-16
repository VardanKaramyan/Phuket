export const meta = {
  name: 'phuket-handoff-recheck',
  description: 'Second pass on the Phuket guide handoff: confirm the 30 first-pass findings are fixed, repeat the fresh-machine run, look for anything new',
  phases: [{ title: 'Recheck', detail: 'fresh-machine re-run with failure cases, and a review of the fixed HANDOFF.md against the repo' }],
}

const PROJECT = args.project
const TMP = args.tmp
const FIRST = args.first
const RULES = `HARD RULES
- NEVER modify, move or delete anything in ${PROJECT} (the real project) or in ~/.claude. Read-only there.
- Do not publish, deploy, push, log in anywhere or send data to any service. npm downloads are fine.
- Write only inside ${TMP}. Port 8765/8766 (offline-test) may be busy if the other agent runs it: if so wait and retry.
- Report facts you observed (commands, exit codes, output tails), not guesses.`
const PROBLEM = { type: 'object', properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'where', 'problem', 'fix'] }
const STATUS = { type: 'object', properties: { finding: { type: 'string', description: 'short name of the first-pass finding' }, status: { type: 'string', enum: ['fixed', 'partly', 'open', 'not applicable'] }, evidence: { type: 'string' } }, required: ['finding', 'status', 'evidence'] }
const OUT = { type: 'object', properties: { firstPass: { type: 'array', items: STATUS }, newProblems: { type: 'array', items: PROBLEM }, notes: { type: 'string' } }, required: ['firstPass', 'newProblems'] }

const brief = `The first pass found 30 problems in this project's handoff (machine independence and docs). They are in ${FIRST} (JSON: dryRun.problems and review.problems, each with severity, where, problem, fix). The author says all of them are fixed now.`

phase('Recheck')
const [dry, rev] = await parallel([
  () => agent(`${brief}
You re-do the FRESH-MACHINE test. Project (read-only): ${PROJECT}. Sandbox: ${TMP}/dry.

${RULES}

1. Copy without node_modules into a folder WITH A SPACE: rsync -a --exclude node_modules --exclude .DS_Store --exclude qa-out "${PROJECT}/" "${TMP}/dry/space test/Phuket/". Work there. export PHUKET_WORKFLOWS_DIR=/nonexistent.
2. Follow only HANDOFF.md section 1 and README.md: npm ci, npm run all (exit code must be 0), npm run photos, npm test, npm run qa, node tools/shoot.mjs dist/phuket-guide-offline.html qa-out/shoot light. Record exit codes and output tails.
3. Reproducibility: the fresh dist/index.html must equal ${PROJECT}/dist/index.html (cmp).
4. Failure cases in a SECOND scratch copy (${TMP}/dry/broken/Phuket, same rsync): (a) put a bad date into data/events.json and run node tools/check.mjs: exit code must be 1; (b) delete one dist/img file of a Places photo after building and run node tools/offline-test.mjs: must exit 1; (c) delete 3 area photos from dist/img and run offline-test: must exit 1 (the page reports missing photos); (d) run node tools/curate.mjs twice after npm run data: the second must exit 1 with a clear message; (e) with no data/apps.json, open the built page and tap the Before-you-fly links: none may lead to a blank page, and there must be no href="#apps" in the HTML.
5. Check that tools/apps-result-from-journal.py, tools/trip.mjs, tools/chrome.mjs, tools/qa-shots.mjs, tools/workflows/*.js exist, parse, and that no tool in tools/ or src/ hard-codes /Users/mac except documented defaults that an argument or env var overrides.
6. For EVERY first-pass finding that concerns tools, tests, paths or builds (mostly dryRun.problems), set status fixed / partly / open with evidence. Then list anything NEW you found.`, { label: 'recheck:fresh-machine', phase: 'Recheck', schema: OUT }),
  () => agent(`${brief}
You re-do the DOCS REVIEW as a newcomer who must continue tomorrow on another computer with only ${PROJECT}/HANDOFF.md and ${PROJECT}/README.md.

${RULES}

1. Read HANDOFF.md and README.md fully, then ${FIRST}.
2. For EVERY first-pass finding that concerns the docs or the content (mostly review.problems), check the current files and code and set status fixed / partly / open with evidence (quote the new text or code).
3. Verify the new parts against the repo (read-only): section 1 step 0 (the cp path and the journal path exist on this machine; tools/apps-result-from-journal.py reads what the journal has), section 4 steps 1 and 3 (the INFO_FIX / TIP_FIX block exists right after mergeLateJan in tools/curate.mjs and works: test it in a copy under ${TMP}/review with one real old sentence, run npm run data there, and confirm the sentence changed), section 6 (curate refuses a second run), section 7 (tools/trip.mjs is used by build, import, merge-late-jan, check, curate; the workflow args listed match what each script reads), section 9 step 0 (the Argy presale facts match data/events.json), section 10 'If the trip dates change' (would editing TRIP in tools/trip.mjs really move the page copy and checks? try it in your copy: change end to 2027-01-27 and lastNight to 2027-01-26, build, and confirm the pass header and chips change; then discard).
4. Report anything still missing, wrong or confusing for a newcomer, with exact fixes. No style nits.`, { label: 'recheck:docs', phase: 'Recheck', schema: OUT }),
])
return { dry, rev }
