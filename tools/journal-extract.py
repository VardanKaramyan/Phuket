# Saves each finished workflow agent's result to research/raw/<label>.json (label taken from the 'started' entry).
import json, sys, os, re
journal, outdir = sys.argv[1], sys.argv[2]
labels, done = {}, []
for line in open(journal):
    try: d = json.loads(line)
    except Exception: continue
    if d.get('type') == 'started': labels[d['agentId']] = d.get('label', d['agentId'])
    elif d.get('type') == 'result':
        lab = labels.get(d.get('agentId'), d.get('agentId'))
        fn = os.path.join(outdir, re.sub(r'[^a-zA-Z0-9#_-]+', '_', lab) + '.json')
        json.dump(d.get('result'), open(fn, 'w'), ensure_ascii=False, indent=1)
        r = d.get('result') or {}
        n = len(r.get('items', [])) if isinstance(r, dict) and 'items' in r else ('object' if r else 'null')
        done.append(f"{lab}: {n}")
print('\n'.join(done))
