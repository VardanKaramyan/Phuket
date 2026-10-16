export const meta = {
  name: 'phuket-handoff-check',
  description: 'Verify the Phuket guide handoff works on a fresh machine: a dry run in a clean copy plus an independent review of HANDOFF.md against the repo',
  phases: [
    { title: 'Check', detail: 'fresh-machine dry run in a temp copy, and a fresh-eyes review of HANDOFF.md / README.md' },
  ],
}

const PROJECT = args.project
const TMP = args.tmp
const RULES = `HARD RULES
- NEVER modify, move or delete anything in ${PROJECT} (the real project) or in ~/.claude. Read-only there.
- Do not publish, deploy, push, log in anywhere or send data to any service. 'npm ci' / 'npm install' downloads are fine.
- Work only inside ${TMP} for anything you write.
- Report facts you observed (commands, exit codes, output tails), not guesses.`

const PROBLEM = { type: 'object', properties: {
  severity: { type: 'string', enum: ['high', 'medium', 'low'] },
  where: { type: 'string', description: 'file and line or section, or the command' },
  problem: { type: 'string' },
  fix: { type: 'string', description: 'the exact change that would fix it' },
}, required: ['severity', 'where', 'problem', 'fix'] }
const STEP = { type: 'object', properties: { command: { type: 'string' }, ok: { type: 'boolean' }, tail: { type: 'string', description: 'last lines of output' } }, required: ['command', 'ok'] }

const dryRun = () => agent(`You are testing a project handoff: can someone pick this project up on a FRESH machine using only its docs?
Project (real, read-only): ${PROJECT}. Your sandbox: ${TMP}.

${RULES}

DO THIS
1. Make a clean copy WITHOUT node_modules: mkdir -p ${TMP} && rsync -a --exclude node_modules --exclude .DS_Store --exclude qa-out "${PROJECT}/" "${TMP}/Phuket/". Work in ${TMP}/Phuket from now on. Before rebuilding, save a copy of the original build for comparison: cp ${TMP}/Phuket/dist/index.html ${TMP}/original-dist-index.html.
2. Read ${TMP}/Phuket/HANDOFF.md (section 1 and section 6) and README.md. Follow ONLY what they say, as a newcomer would.
3. Simulate another machine: export PHUKET_WORKFLOWS_DIR=/nonexistent (so the old session's workflow journals cannot be used). Use the Chrome on this machine (or CHROME_PATH if the tools ask for it).
4. Run, in ${TMP}/Phuket: npm ci (or npm install if the docs say so), npm run all, npm run photos (or python3 -I tools/collect-photos.py then node tools/images.mjs), node tools/build.mjs again, npm test, npm run qa (it writes qa-out/ inside the copy). Record each command, whether it worked, and the last lines of output.
5. Check reproducibility: compare ${TMP}/Phuket/dist/index.html with ${TMP}/original-dist-index.html (cmp or diff | head). They should be identical when nothing changed. If not, find what differs and why.
6. Look for machine-specific leftovers in the copy: grep -rn "/Users/mac" in tools/ src/ data/ package.json (exclude data/research-log.json only if the hits are just quoted text) and say which ones would break on another machine. Check that every file and command named in HANDOFF.md exists and runs (e.g. tools/workflows/apps.js, tools/qa-shots.mjs, tools/chrome.mjs, npm scripts).
7. Report every problem with an exact fix (file + what to change). 'identicalBuild' = true only if step 5 matched.`, { label: 'dry-run:fresh-machine', phase: 'Check', schema: { type: 'object', properties: {
  steps: { type: 'array', items: STEP }, identicalBuild: { type: 'boolean' }, problems: { type: 'array', items: PROBLEM }, notes: { type: 'string' },
}, required: ['steps', 'identicalBuild', 'problems'] } })

const review = () => agent(`You are a senior engineer who has NEVER seen this project. Tomorrow you must continue it on another computer using only ${PROJECT}/HANDOFF.md and ${PROJECT}/README.md. Review them hard.

${RULES}

DO THIS
1. Read HANDOFF.md and README.md fully.
2. Verify every concrete claim against the repo (read-only): file paths and names, npm scripts in package.json, command arguments, numbers (events / places / areas / hotels / photos counts: compute them from data/*.json and data/images.json), the artifact URL and version, field names it mentions (check tools/build.mjs, tools/merge-late-jan.mjs, tools/curate.mjs, src/app.js), the workflow scripts and their args (tools/workflows/*.js: what args each one really reads), and the in-progress Apps task (tools/import-apps.mjs, appsView in tools/build.mjs, the apps code in src/app.js).
3. Find what is MISSING for a newcomer: steps that are not written down, steps written in the wrong order, things that only work on the old machine, unclear instructions (for example how exactly to run a workflow script and save its result), any stale text that still describes the old 8-18 Jan trip as current, contradictions between HANDOFF.md, README.md and the code.
4. Also check the user-facing facts in HANDOFF section 3 against data/events.json and data/extra.json (dates, times), and flag anything that does not match.
Report each problem with severity and an exact fix (which file, what text to add or change). Do not report style nits unless they would confuse a newcomer.`, { label: 'review:handoff', phase: 'Check', schema: { type: 'object', properties: {
  problems: { type: 'array', items: PROBLEM }, verified: { type: 'array', items: { type: 'string' }, description: 'claims you checked and found correct' }, notes: { type: 'string' },
}, required: ['problems', 'verified'] } })

phase('Check')
const [run, rev] = await parallel([dryRun, review])
return { dryRun: run, review: rev }
