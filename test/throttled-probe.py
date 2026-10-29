import json, sys, time, urllib.parse, urllib.request
API = "http://127.0.0.1:19097"; HDR = {"Authorization": "Bearer probe"}
def get(p):
    req = urllib.request.Request(API + p, headers=HDR)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())
px = get("/proxies")
skip = ("Selector","URLTest","Fallback","Direct","Reject","Compatible","Pass","RejectDrop","LoadBalance","Relay","Dns")
names = [n for n, v in px["proxies"].items() if v.get("type") not in skip][:24]
url = urllib.parse.quote("https://www.gstatic.com/generate_204", safe="")
ok = fail = 0
for n in names:
    enc = urllib.parse.quote(n, safe="")
    try:
        d = get("/proxies/" + enc + "/delay?url=" + url + "&timeout=8000")
        print("  OK   %-26s %sms" % (n, d.get("delay"))); ok += 1
    except Exception as e:
        print("  FAIL %-26s %s" % (n, str(e)[:34])); fail += 1
    time.sleep(0.6)
print("串行限速探测结果: 通 %d / 失败 %d" % (ok, ok + fail))
