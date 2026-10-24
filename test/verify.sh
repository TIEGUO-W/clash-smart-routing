#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 用「真实订阅 + 真实 mihomo 内核」验证 verge-script.js 的产物
#   订阅 -> 跑脚本 -> 断言（成员/循环/规则目标）-> mihomo -t
#
# 可用环境变量覆盖自动探测： VERGE_HOME / PROFILE / MIHOMO
# ─────────────────────────────────────────────────────────────
set -uo pipefail
VERGE_HOME=""
MIHOMO=""
PROFILE=""
HERE="$(cd "$(dirname "$0")/.." && pwd)"

detect_verge_home() {
  for c in /mnt/c/Users/*/AppData/Roaming/io.github.clash-verge-rev.clash-verge-rev \
           "$HOME/.local/share/io.github.clash-verge-rev.clash-verge-rev" \
           "$HOME/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"; do
    if [ -d "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

detect_mihomo() {
  for c in verge-mihomo mihomo \
           "/mnt/d/Program Files/Clash Verge/verge-mihomo.exe" \
           "/mnt/c/Program Files/Clash Verge/verge-mihomo.exe" \
           "/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo"; do
    if [ -x "$c" ]; then echo "$c"; return 0; fi
    if command -v "$c" >/dev/null 2>&1; then echo "$c"; return 0; fi
  done
  return 1
}

if [ -z "$VERGE_HOME" ]; then VERGE_HOME="$(detect_verge_home)"; fi
if [ -z "$MIHOMO" ]; then MIHOMO="$(detect_mihomo)"; fi
if [ -z "$VERGE_HOME" ]; then echo "找不到 Clash Verge 数据目录，请设置 VERGE_HOME"; exit 2; fi
if [ -z "$MIHOMO" ]; then echo "找不到 mihomo 可执行文件，请设置 MIHOMO"; exit 2; fi

echo "verge-home: $VERGE_HOME"
echo "mihomo    : $MIHOMO"
echo "kernel    : $("$MIHOMO" -v 2>&1 | head -1)"

if [ -z "$PROFILE" ]; then
  PROFILE="$(python3 - "$VERGE_HOME" <<'PY'
import sys, os, yaml
home = sys.argv[1]
idx = os.path.join(home, 'profiles.yaml')
if not os.path.exists(idx):
    sys.exit(0)
d = yaml.safe_load(open(idx, encoding='utf-8'))
items = d.get('items') or []
cur = d.get('current')
pick = next((i for i in items if i.get('uid') == cur and i.get('type') == 'remote'), None)
if pick is None:
    pick = next((i for i in items if i.get('type') == 'remote'), None)
print(os.path.join(home, 'profiles', pick['file']) if pick else '')
PY
)"
fi
if [ ! -f "$PROFILE" ]; then echo "找不到订阅文件（可设置 PROFILE）：$PROFILE"; exit 2; fi
echo "profile   : $PROFILE"

# 临时目录放在 Verge 数据目录内：Windows 内核(.exe)也能看到
TMP="$VERGE_HOME/.verify-tmp"
mkdir -p "$TMP"
for f in Country.mmdb geoip.dat geosite.dat; do
  if [ ! -f "$TMP/$f" ]; then cp "$VERGE_HOME/$f" "$TMP/$f" 2>/dev/null; fi
done

python3 - "$PROFILE" "$TMP/in.json" <<'PY'
import sys, yaml, json
d = yaml.safe_load(open(sys.argv[1], encoding='utf-8'))
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('input: proxies=%d groups=%d rules=%d' % (len(d.get('proxies', [])), len(d.get('proxy-groups', [])), len(d.get('rules', []))))
PY

node "$HERE/test/run-script.mjs" "$TMP/in.json" "$TMP/out.json"
rc=$?
echo "script-assertions exit=$rc"

python3 - "$TMP/out.json" "$TMP/out.yaml" <<'PY'
import sys, json, yaml
yaml.safe_dump(json.load(open(sys.argv[1], encoding='utf-8')),
               open(sys.argv[2], 'w', encoding='utf-8'),
               allow_unicode=True, sort_keys=False, default_flow_style=False)
PY

echo '--- mihomo -t ---'
case "$MIHOMO" in
  *.exe)
    "$MIHOMO" -t -f "$(wslpath -w "$TMP/out.yaml")" -d "$(wslpath -w "$TMP")" 2>&1 | tail -6
    ;;
  *)
    "$MIHOMO" -t -f "$TMP/out.yaml" -d "$TMP" 2>&1 | tail -6
    ;;
esac
echo "mihomo-exit=$?"

# 5) 回归：换一个"组名完全不同"的机场，兜底规则应被接管到总开关
FIX="$HERE/test/fixtures/other-airport.yaml"
if [ -f "$FIX" ]; then
  echo '--- 回归：异名机场订阅'
  python3 - "$FIX" "$TMP/fx.json" <<'PY'
import sys, yaml, json
d = yaml.safe_load(open(sys.argv[1], encoding='utf-8'))
json.dump(d, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
yaml.safe_dump(d, open(sys.argv[2].replace('.json', '.yaml'), 'w', encoding='utf-8'),
               allow_unicode=True, sort_keys=False)
PY
  node "$HERE/test/run-script.mjs" "$TMP/fx.json" "$TMP/fx-out.json" > "$TMP/fx.log" 2>&1
  python3 - "$TMP/fx-out.json" <<'PY'
import sys, json
d = json.load(open(sys.argv[1], encoding='utf-8'))
match = [r for r in (d.get('rules') or []) if r.startswith('MATCH,')]
groups = [g['name'] for g in (d.get('proxy-groups') or [])]
names = [p['name'] for p in (d.get('proxies') or [])]
ok = match == ['MATCH,🚀 智能选择']
print('  MATCH 改写 ->', match[0] if match else '(无)')
print('  策略组数    ->', len(groups))
print('  新建的组    ->', [g for g in groups if g in ('🚀 智能选择', '⚡ 测速优选', '🤖 AI 测速', '🇺🇸 美国')])
print('  被滤掉的信息节点 ->', [n for n in names if '流量' in n])
sys.exit(0 if ok else 1)
PY
  rc2=$?
  python3 - "$TMP/fx-out.json" "$TMP/fx-out.yaml" <<'PY'
import sys, json, yaml
yaml.safe_dump(json.load(open(sys.argv[1], encoding='utf-8')), open(sys.argv[2], 'w', encoding='utf-8'),
               allow_unicode=True, sort_keys=False, default_flow_style=False)
PY
  case "$MIHOMO" in
    *.exe) "$MIHOMO" -t -f "$(wslpath -w "$TMP/fx-out.yaml")" -d "$(wslpath -w "$TMP")" 2>&1 | tail -2 ;;
    *)     "$MIHOMO" -t -f "$TMP/fx-out.yaml" -d "$TMP" 2>&1 | tail -2 ;;
  esac
  echo "  fixture-exit=$rc2"
  if [ "$rc2" -ne 0 ]; then rc=1; fi
fi

rm -f "$TMP/in.json" "$TMP/out.json" "$TMP/out.yaml" "$TMP/fx.json" "$TMP/fx-out.json" "$TMP/fx-out.yaml" "$TMP/fx.yaml" "$TMP/fx.log"
exit $rc
