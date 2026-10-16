# Compact digest of an interrupted agent transcript: its notes, tool calls and (truncated) tool results,
# so a restarted agent can recover its findings instead of searching again.
import json, sys
src, dst, limit = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 900
out, n = [], 0
for line in open(src):
    try: d = json.loads(line)
    except Exception: continue
    t = d.get('type'); c = d.get('message', {}).get('content')
    if not isinstance(c, list): continue
    for p in c:
        if not isinstance(p, dict): continue
        if t == 'assistant' and p.get('type') == 'text' and p['text'].strip():
            out.append('NOTE: ' + p['text'].strip())
        elif t == 'assistant' and p.get('type') == 'tool_use':
            n += 1
            inp = p.get('input', {})
            arg = inp.get('command') or inp.get('query') or inp.get('url') or inp.get('file_path') or json.dumps(inp)[:400]
            if inp.get('prompt') and inp.get('url'): arg += '  [prompt: ' + inp['prompt'][:200] + ']'
            out.append(f'\n#{n} {p.get("name")}: {str(arg)[:600]}')
        elif t == 'user' and p.get('type') == 'tool_result':
            cc = p.get('content')
            s = '\n'.join(x.get('text', '') for x in cc if isinstance(x, dict)) if isinstance(cc, list) else str(cc)
            s = s.strip()
            if len(s) > limit: s = s[:limit] + f' …[{len(s) - limit} more chars]'
            out.append('RESULT: ' + s)
open(dst, 'w').write('\n'.join(out))
print(dst, n, 'calls', sum(len(x) for x in out) // 1024, 'KB')
