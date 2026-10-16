# Prints one line per finished agent across workflow journals (for a Monitor). Usage: watch-workflows.py <journal>...
import json, sys, time, os
paths = sys.argv[1:]
seen = {p: sum(1 for _ in open(p)) if os.path.exists(p) else 0 for p in paths}
labels = {}
while True:
    for p in paths:
        if not os.path.exists(p): continue
        lines = open(p).readlines()
        for i, line in enumerate(lines):
            try: d = json.loads(line)
            except Exception: continue
            if d.get('type') == 'started': labels[d.get('agentId')] = d.get('label')
            if i < seen[p]: continue
            t = d.get('type')
            if t in ('started', 'launched'): continue
            tag = p.split('/')[-2][:11]
            if t == 'result':
                r = d.get('result')
                n = len(r.get('items', r.get('results', []))) if isinstance(r, dict) and ('items' in r or 'results' in r) else ('ok' if r else 'EMPTY')
                print(tag, 'finished', labels.get(d.get('agentId'), d.get('agentId')), n, flush=True)
            else:
                print(tag, t, d.get('label', ''), str(d.get('message', ''))[:160], flush=True)
        seen[p] = len(lines)
    time.sleep(20)
