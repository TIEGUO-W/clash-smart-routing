import json, sys, urllib.parse, urllib.request, concurrent.futures

API = "http://127.0.0.1:19097"
HDR = {"Authorization": "Bearer probe"}
url = sys.argv[1]
expected = int(sys.argv[2])
timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 8000

def get(path, t=30):
    req = urllib.request.Request(API + path, headers=HDR)
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read().decode())

proxies = get("/proxies")
skip = ("Selector","URLTest","Fallback","Direct","Reject","Compatible","Pass","RejectDrop","LoadBalance","Relay","Dns")
names = [n for n, v in proxies["proxies"].items() if v.get("type") not in skip]

def probe(n):
    enc = urllib.parse.quote(n, safe="")
    p = "/proxies/" + enc + "/delay?url=" + urllib.parse.quote(url, safe="") + "&timeout=" + str(timeout)
    if expected:
        p += "&expected=" + str(expected)
    try:
        return n, get(p).get("delay"), None
    except Exception as e:
        return n, None, str(e)[:24]

res = []
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    for item in ex.map(probe, names):
        res.append(item)
ok = [r for r in res if r[1]]
bad = [r for r in res if not r[1]]
print("%s (expected=%s)  响应: %d / %d   超时或失败: %d" % (url, expected, len(ok), len(res), len(bad)))
if ok:
    ds = sorted(r[1] for r in ok)
    print("  最快 %dms  中位 %dms  最慢 %dms" % (ds[0], ds[len(ds)//2], ds[-1]))
if bad:
    from collections import Counter
    c = Counter(r[2] for r in bad)
    for k, v in c.most_common(5):
        print("   失败原因 %-28s x%d" % (k, v))
