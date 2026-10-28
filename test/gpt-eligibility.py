#!/usr/bin/env python3
# 节点体检：逐节点验证"能不能过 GPT"，用来决定 AI 组该用谁。
#
# 用法：先起一个带 REST API 的隔离内核（不碰你正在用的 Verge）：
#   1) 从运行时配置里取 proxies，写成一个最小配置：
#        mixed-port: 17997
#        external-controller: 127.0.0.1:19097
#        secret: probe
#        proxies: <你的节点列表>
#        rules: [MATCH,DIRECT]
#   2) mihomo -f probe.yaml -d <含 geo 文件的目录>
#   3) python3 test/gpt-eligibility.py
#
# 输出：总节点数、能过 GPT 的数量、按地区统计、以及按延迟排序的白名单。

import json, urllib.parse, urllib.request, concurrent.futures, re

API = "http://127.0.0.1:19097"
HDR = {"Authorization": "Bearer probe"}
URL = urllib.parse.quote("https://chatgpt.com/cdn-cgi/trace", safe="")

def get(path, timeout=20):
    req = urllib.request.Request(API + path, headers=HDR)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

proxies = get("/proxies")
names = [n for n, v in proxies["proxies"].items()
         if v.get("type") not in ("Selector", "URLTest", "Fallback", "Direct", "Reject", "Compatible", "Pass", "RejectDrop", "LoadBalance", "Relay")]

REGION = [
    ("香港", re.compile(r"香港|HK\b|Hong", re.I)),
    ("台湾", re.compile(r"台湾|台灣|台北|TW\b|Taiwan", re.I)),
    ("日本", re.compile(r"日本|东京|大阪|JP\b|Japan", re.I)),
    ("新加坡", re.compile(r"新加坡|狮城|SG\b|Singapore", re.I)),
    ("美国", re.compile(r"美国|美國|US\b|United", re.I)),
    ("英国", re.compile(r"英国|UK\b|GB\b", re.I)),
    ("韩国", re.compile(r"韩国|KR\b|Korea", re.I)),
    ("马来", re.compile(r"马来|MY\b|Malaysia", re.I)),
    ("俄罗斯", re.compile(r"俄罗斯|RU\b|Russia", re.I)),
]
def region(n):
    for name, rx in REGION:
        if rx.search(n):
            return name
    return "其他"

def probe(n):
    enc = urllib.parse.quote(n, safe="")
    try:
        d = get("/proxies/" + enc + "/delay?url=" + URL + "&timeout=8000&expected=200", timeout=25)
        return n, True, d.get("delay")
    except Exception as e:
        return n, False, str(e)[:40]

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
    for n, ok, info in ex.map(probe, names):
        results.append((n, ok, info))

ok = [(n, i) for n, o, i in results if o]
bad = [(n, i) for n, o, i in results if not o]
print("总节点: %d  可过 GPT: %d  不可: %d" % (len(results), len(ok), len(bad)))
print()
from collections import Counter
print("按地区统计 可过/总数:")
c_ok = Counter(region(n) for n, _ in ok)
c_all = Counter(region(n) for n, _, _ in results)
for r in ["美国", "日本", "新加坡", "台湾", "香港", "英国", "韩国", "马来", "俄罗斯", "其他"]:
    if c_all.get(r):
        print("  %-5s %2d / %2d" % (r, c_ok.get(r, 0), c_all[r]))
print()
print("可过 GPT 的节点（按延迟升序）:")
for n, i in sorted(ok, key=lambda x: x[1] or 9999):
    print("  %-28s %5s ms  [%s]" % (n, i, region(n)))
print()
print("不可过的节点:")
for n, i in bad:
    print("  %-28s %s  [%s]" % (n, i, region(n)))
