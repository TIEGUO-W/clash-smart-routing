#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# 把智能策略挂到「当前订阅」的扩展脚本槽位
#
#   bash install.sh            挂上（或覆盖更新）
#   bash install.sh --off      摘掉，恢复机场原版
#   bash install.sh --check    只看状态，不动文件
# ─────────────────────────────────────────────────────────────
set -o pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

detect_verge_home() {
  for c in /mnt/c/Users/*/AppData/Roaming/io.github.clash-verge-rev.clash-verge-rev \
           "$HOME/.local/share/io.github.clash-verge-rev.clash-verge-rev" \
           "$HOME/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"; do
    [ -d "$c" ] && { echo "$c"; return 0; }
  done
  return 1
}
VERGE_HOME="$(detect_verge_home)"
[ -n "$VERGE_HOME" ] || { echo "找不到 Clash Verge 数据目录，请设置 VERGE_HOME"; exit 2; }

INFO="$(python3 - "$VERGE_HOME" <<'PY'
import sys, os, yaml, io
home = sys.argv[1]
d = yaml.safe_load(io.open(os.path.join(home, 'profiles.yaml'), encoding='utf-8'))
cur = d.get('current')
items = d.get('items') or []
prof = next((i for i in items if i.get('uid') == cur), None)
if prof is None or prof.get('type') != 'remote':
    print('')
    sys.exit(0)
script_uid = (prof.get('option') or {}).get('script')
scr = next((i for i in items if i.get('uid') == script_uid), None)
name = (prof.get('name') or prof.get('uid'))
if scr is None:
    print('%s||' % name)
else:
    print('%s|%s|%s' % (name, scr.get('uid'), scr.get('file')))
PY
)"

[ -n "$INFO" ] || { echo "当前没有启用中的远程订阅，先在 Verge 里选一个"; exit 2; }
PROFILE_NAME="$(echo "$INFO" | cut -d'|' -f1)"
SCRIPT_FILE="$(echo "$INFO" | cut -d'|' -f3)"

echo "当前订阅 : $PROFILE_NAME"
if [ -z "$SCRIPT_FILE" ]; then
  echo "扩展脚本 : 该订阅还没绑定脚本槽位"
  echo "           请先到 Verge 订阅卡片 →「编辑」→ 点一次「扩展脚本」保存，再跑本脚本"
  exit 2
fi
TARGET="$VERGE_HOME/profiles/$SCRIPT_FILE"
echo "脚本槽位 : $SCRIPT_FILE"

MD5_LOCAL="$(md5sum "$HERE/verge-script.js" | cut -d' ' -f1)"
MD5_TARGET="$(md5sum "$TARGET" 2>/dev/null | cut -d' ' -f1)"

case "$1" in
  --check)
    echo "本地版本 : $MD5_LOCAL"
    echo "已挂版本 : $MD5_TARGET"
    if [ "$MD5_LOCAL" = "$MD5_TARGET" ]; then echo "状态     : 已是最新"; else echo "状态     : 需要同步"; fi
    ;;
  --off)
    cat > "$TARGET" <<'TPL'
// Define main function (script entry)

function main(config, profileName) {
  return config;
}
TPL
    echo "已摘掉智能策略（恢复机场原版分组），在 Verge 里点「重新应用」生效"
    ;;
  *)
    cp "$HERE/verge-script.js" "$TARGET"
    echo "已挂载 -> $SCRIPT_FILE"
    echo "校验     : $(md5sum "$TARGET" | cut -d' ' -f1)"
    echo
    echo "下一步   : Verge → 订阅卡片 →「重新应用」"
    echo "           然后把 走代理的主组 点成 ⚡ 测速优选（会记住）"
    ;;
esac
