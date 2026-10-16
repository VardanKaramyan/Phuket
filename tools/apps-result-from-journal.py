# Rebuilds research/result-apps.json ({ lists, extra }, the return value of tools/workflows/apps.js) from the
# workflow journal, for when the session that ran the workflow ended before the result was saved. The journal keeps
# each finished agent's result, not the workflow's return value. A list whose fact-checker did not finish falls back
# to the unverified research output and is marked in 'changes'; re-run the workflow if you need it verified.
# Usage: python3 -I tools/apps-result-from-journal.py <journal.jsonl> [out, default research/result-apps.json]
# The journal of run wf_979252ad-2ea is on the old machine only:
#   ~/.claude/projects/-Users-mac-Documents-Phuket/7325013c-74b9-46f2-8e7b-729314cad5fc/subagents/workflows/wf_979252ad-2ea/journal.jsonl
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = ['rides-travel', 'money-phone-safety', 'food-events-bookings']  # TASKS in tools/workflows/apps.js
journal = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'research', 'result-apps.json')

labels, res = {}, {}
for line in open(journal, encoding='utf-8'):
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get('type') == 'started':
        labels[d.get('agentId')] = d.get('label', '')
    elif d.get('type') == 'result' and isinstance(d.get('result'), dict):
        res[labels.get(d.get('agentId'), '')] = d['result']


def unverified(r, what):
    return dict(r, changes=['VERIFY MISSING: unverified ' + what + ' (rebuilt from the journal)'])


lists, notes = {}, []
for k in KEYS:
    if 'verify:' + k in res:
        lists[k] = res['verify:' + k]
    elif 'research:' + k in res:
        lists[k] = unverified(res['research:' + k], 'research output')
        notes.append(k + ': not fact-checked')
    else:
        notes.append(k + ': MISSING')
if 'verify:critic-additions' in res:
    extra = res['verify:critic-additions']
elif 'critic:completeness' in res:
    extra = unverified(res['critic:completeness'], 'critic output')
    notes.append('critic additions: not fact-checked')
else:
    extra = None
    notes.append('critic: not finished (no additions)')

if not lists:
    sys.exit('no finished apps lists in ' + journal + ': re-run tools/workflows/apps.js')
json.dump({'lists': lists, 'extra': extra}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(out)
print('items per list:', {k: len(v.get('items') or []) for k, v in lists.items()}, '· critic items:', len((extra or {}).get('items') or []))
print('notes:', '; '.join(notes) if notes else 'all lists and the critic were fact-checked')
