import json, sys, time, urllib.parse, urllib.request
API = "http://127.0.0.1:19097"; HDR = {"Authorization": "Bearer probe"}
def get(p):
    req = urllib.request.Request(API + p, headers=HDR)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())
px = get("/proxies")
skip = ("Selector","URLTest","Fallback","Direct","Reject","Compatible","Pass","RejectDrop","LoadBalance","Relay","Dns")
names = [n for n, v in px["proxies"].items() if v.get("type") not in skip]
url = urllib.parse.quote("https://www.gstatic.com/generate_204", safe="")
ok, fail = [], []
for n in names:
    enc = urllib.parse.quote(n, safe="")
    try:
        d = get("/proxies/" + enc + "/delay?url=" + url + "&timeout=6000")
        ok.append((n, d.get("delay")))
    except Exception as e:
        fail.append((n, str(e)[:26]))
    time.sleep(0.45)
print("串行探测全部 %d 个节点 -> 可用 %d 个" % (len(names), len(ok)))
for n, d in sorted(ok, key=lambda x: x[1] or 9999):
    print("   ✔ %-26s %5s ms" % (n, d))
from collections import Counter
c = Counter(f[1] for f in fail)
for k, v in c.most_common(4):
    print("   ✘ %-30s x%d" % (k, v))
