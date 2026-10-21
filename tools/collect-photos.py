# Builds data/image-picks.json from the photo workflows' results.
# 1. Only on the machine that ran the workflows: copies each photo agent's result out of the workflow journals
#    into research/photos/<wave>/<label>.json. The journals live in the Claude Code session folder; set
#    PHUKET_WORKFLOWS_DIR to its subagents/workflows directory if it is not the default below.
# 2. On any machine: merges research/photos/<wave>/*.json in wave order (later waves and retries win when they
#    found a photo) and writes the picks with photo paths relative to the project.
# Usage: python3 -I tools/collect-photos.py
import glob, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = os.environ.get('PHUKET_WORKFLOWS_DIR', os.path.expanduser('~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/subagents/workflows'))
# w8: the stays' listing photos, picked by hand (no workflow): research/photos/w8/stays.json
# w12: Bangkok's nights and places, the clubs and festivals (21 Oct 2026 research): research/photos/w12/*.json
# w11: the Promthep area photo, picked by hand (20 Oct 2026): research/photos/w11/areas-south.json
# w9: piers, boat tours, islands, places and events from the 19 Oct 2026 research; w10: the critic's four additions
WAVES = {'w1': 'wf_37b202cc-9ea', 'w2': 'wf_7449d89f-29c', 'w3': 'wf_a1aa8663-200', 'w4': 'wf_f4d31692-ce6', 'w5': 'wf_14607df2-a14', 'w6': 'wf_566ae36a-956', 'w7': 'wf_cf058967-e2e', 'w8': None, 'w9': 'wf_24b94078-911', 'w10': 'wf_e63f8df1-e98', 'w11': None, 'w12': None}

extracted = {}
for wave, wf in WAVES.items():
    if not wf:
        continue
    j = os.path.join(W, wf, 'journal.jsonl')
    if not os.path.exists(j):
        continue
    out = os.path.join(ROOT, 'research/photos', wave)
    os.makedirs(out, exist_ok=True)
    labels = {}
    for line in open(j):
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get('type') == 'started':
            labels[d['agentId']] = d.get('label', '')
        if d.get('type') != 'result' or not isinstance(d.get('result'), dict):
            continue
        lab = labels.get(d['agentId'], '')
        json.dump(d['result'], open(os.path.join(out, re.sub(r'[^\w#-]', '_', lab) + '.json'), 'w'), indent=1)
        extracted[wave] = extracted.get(wave, 0) + 1


def rel(f):
    # agents saved absolute paths of the machine that ran them: keep the part from assets/raw/ on
    if not f:
        return f
    i = f.replace('\\', '/').find('assets/raw/')
    return f.replace('\\', '/')[i:] if i >= 0 else f


picks, used = {}, {}
for wave in WAVES:
    files = sorted(glob.glob(os.path.join(ROOT, 'research/photos', wave, '*.json')))  # photos#1.. before retry#1..
    used[wave] = len(files)
    for fn in files:
        d = json.load(open(fn))
        for r in (d.get('result') or d).get('results', []):  # an agent result, or a whole workflow run file
            k = r.get('key')
            if not k:
                continue
            r = dict(r, file=rel(r.get('file')))
            if k not in picks or r.get('ok'):
                picks[k] = r

def has_file(p):
    return bool(p.get('file')) and os.path.exists(os.path.join(ROOT, p['file']))

json.dump(list(picks.values()), open(os.path.join(ROOT, 'data/image-picks.json'), 'w'), indent=1)
print('journals copied this run:', extracted or 'none (not the machine that ran the workflows, or nothing new)')
print('result files per wave:', used)
ok = [p for p in picks.values() if p.get('ok') and has_file(p)]
print(f'{len(picks)} keys, {len(ok)} with a photo file, {len([p for p in picks.values() if not p.get("ok")])} without')
missing = [p['key'] for p in picks.values() if p.get('ok') and not has_file(p)]
if missing:
    print('ok but file missing:', missing)
print('without photo:', [p['key'] for p in picks.values() if not p.get('ok')])
