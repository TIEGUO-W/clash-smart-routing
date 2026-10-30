# 自建 VPS 教程（面向 Clash Verge Rev / mihomo 用户）

> 写给「被机场坑到想自己搭」的人。全部命令可复制，配置可直接用。
> 假设你有 WSL 或 Linux 机器（本文的验证命令都在 WSL 里跑）。

## 0. 先算账：值不值得

| 项 | 机场 | 自建 |
|---|---|---|
| 年成本 | ￥100–300 | ￥150（廉价线路）– ￥800（优质线路） |
| 带宽 | 几十~几百人共用，晚高峰抢 | **独享** |
| 稳定性 | 取决于商家心情 | 取决于你的线路质量 + 是否被墙 |
| 一次性时间 | 0 | **1–2 小时** |
| 每月维护 | 0 | 10–30 分钟（看日志、必要时换 IP） |
| 出事时 | 只能等客服 | 你自己有 root，能立刻换协议/换端口/换 IP |

**结论**：如果你一个月被机场坑 ≥2 次、且能抽出 1–2 小时，值得。如果你只是偶尔用，机场更划算。

**最大的风险不是技术，是「IP 被墙」**——那不叫配置错，叫线路被封。应对方式见第 7 节。

## 1. 选机器

| 维度 | 建议 |
|---|---|
| 位置 | 日本 / 新加坡（延迟 30–80ms，最平衡）；香港（最快但最容易被针对）；美西（便宜、延迟 140ms+） |
| 线路 | **CN2 GIA > 联通 9929 / 移动 CMIN2 > 4837 > 普通 BGP**。这一项比 CPU/内存重要 10 倍 |
| 配置 | 1 核 / 1G / 10G 硬盘足够，月流量 500G–1T 够用 |
| 虚拟化 | 必须 **KVM**，不要 OpenVZ |
| 系统 | Debian 12（最小化安装） |
| 支付 | 支持支付宝的商家更省事 |

**买之前问客服三句话**（重要）：
1. 这条线路是 CN2 GIA / 9929 / CMIN2 中的哪一种？
2. 被墙（IP 被封）能否更换 IP？免费还是收费？
3. 是否 KVM、是否原生 IP？

**预算参考**：￥150/年 档（RackNerd / CloudCone 一类）适合试水，线路一般但便宜；￥400–800/年 档（搬瓦工 CN2 GIA、部分 9929 商家）晚高峰体验明显更好。
先买**月付**试一周，稳定再年付。

## 2. 首次登录 + 加固（10 分钟）

本地生成密钥（WSL 里执行，一路回车即可）：

```bash
ssh-keygen -t ed25519 -C "vps"
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@你的服务器IP
```

然后登录进去做四件事：

```bash
# 1) 系统更新 + 基础工具
apt update && apt -y upgrade
apt -y install curl wget vim ufw fail2ban chrony

# 2) 时间同步（时间偏差会让 TLS 握手失败，很多人栽在这）
systemctl enable --now chrony

# 3) 防火墙：只放 SSH 和要用的端口
ufw allow 22/tcp
ufw allow 443/tcp
ufw allow 8443/udp      # 备用 Hysteria2 用，暂时可不开
ufw --force enable

# 4) 防爆破
systemctl enable --now fail2ban
```

**改成密钥登录、禁用密码登录**（防止被扫爆）：

```bash
# 编辑 /etc/ssh/sshd_config，确认这三行：
#   PubkeyAuthentication yes
#   PasswordAuthentication no
#   PermitRootLogin prohibit-password
systemctl restart ssh
```

**开 BBR**（拥塞控制，跨洋线路提升明显）：

```bash
cat >> /etc/sysctl.conf <<'EOF'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF
sysctl -p
sysctl net.ipv4.tcp_congestion_control   # 应输出 bbr
```

## 3. 安装 Xray（官方脚本）

```bash
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
xray version
```

> 只用官方脚本。任何"一键脚本"都请先看清它到底写了什么——它们有权限改你整台机器。

## 4. 配置 VLESS + Reality（当前最抗封锁的方案）

Reality 的核心优势：**不需要域名、不需要证书**，它把 TLS 握手"借用"成访问真实大站（例如 www.microsoft.com）的样子，主动探测也很难识别。

### 4.1 生成密钥和 shortId

```bash
xray x25519
# 输出形如：
#   Private key: 8K...（服务端用）
#   Public key:  xY...（客户端用）

openssl rand -hex 8   # 生成 shortId，例如 a1b2c3d4e5f60708
cat /proc/sys/kernel/random/uuid   # 生成 UUID
```

把这三个值记下来：**Private key / Public key / UUID / shortId**。

### 4.2 服务端配置

写入 `/usr/local/etc/xray/config.json`（把大写占位替换成你自己的值）：

```json
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": 443,
      "protocol": "vless",
      "settings": {
        "clients": [
          { "id": "你的UUID", "flow": "xtls-rprx-vision" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "www.microsoft.com:443",
          "xver": 0,
          "serverNames": ["www.microsoft.com"],
          "privateKey": "你的PrivateKey",
          "shortIds": ["你的shortId"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "rules": [
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "block" }
    ]
  }
}
```

> `dest` 选一个**从你的服务器能正常访问、且支持 TLS1.3** 的大站（微软、苹果、亚马逊都行）。
> 不要选你自己常访问的站点，也别选国内的。

```bash
systemctl restart xray
systemctl status xray --no-pager | head -5
ss -lntp | grep 443        # 应该有 xray 在听
```

### 4.3 客户端参数对照（mihomo / Verge）

| Xray 服务端 | mihomo 客户端字段 | 值 |
|---|---|---|
| id | `uuid` | 你的 UUID |
| flow | `flow` | `xtls-rprx-vision` |
| serverNames[0] | `servername` | `www.microsoft.com` |
| privateKey 对应的公钥 | `reality-opts.public-key` | `xY...` |
| shortIds[0] | `reality-opts.short-id` | `a1b2...` |
| — | `client-fingerprint` | `chrome` |
| port | `port` | `443` |
| network | `network` | `tcp` |

## 5. 接进 Verge

**方式 A：粘分享链接**（最快）
Verge → 订阅 → 新建 → 类型选「本地」→ 粘贴：

```
vless://你的UUID@你的IP:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=你的PublicKey&sid=你的shortId&type=tcp#自建-日1
```

**方式 B：写进 YAML（推荐，能和我们这套智能策略共存）**
在订阅的 Merge 里追加（或者直接加进自定义配置）：

```yaml
proxies:
  - name: 自建-日1
    type: vless
    server: 你的IP
    port: 443
    uuid: 你的UUID
    network: tcp
    udp: true
    tls: true
    flow: xtls-rprx-vision
    servername: www.microsoft.com
    client-fingerprint: chrome
    reality-opts:
      public-key: 你的PublicKey
      short-id: 你的shortId
```

加完之后，仓库里那套智能策略会自动把它当普通节点用（⚡ 测速优选 / 🤖 AI 测速 里都会出现）——
**自建 + 机场可以同时挂**：机场当兜底，自建当主力。

## 6. 验证（在你的 WSL 里跑，别猜）

```bash
# 1) TLS 握手是否正常（这一步最能说明服务端配置对不对）
openssl s_client -connect 你的IP:443 -servername www.microsoft.com </dev/null 2>/dev/null | head -5

# 2) 装进 Verge 后，走代理测出口
curl -s -m 10 -x http://127.0.0.1:7897 https://api.ip.sb/ip     # 应显示你服务器的 IP
curl -s -m 10 -x http://127.0.0.1:7897 -o /dev/null -w '%{http_code}\n' https://www.google.com   # 期望 200/302
curl -s -m 10 -x http://127.0.0.1:7897 -o /dev/null -w '%{http_code}\n' https://chatgpt.com/cdn-cgi/trace  # 期望 200

# 3) 速度（看晚高峰是否崩）
curl -s -o /dev/null -w '%{speed_download}\n' -x http://127.0.0.1:7897 https://speed.cloudflare.com/__down?bytes=50000000
```

## 7. 备灾（自建最容易被忽略的一节）

1. **同机开第二条协议**（Hysteria2，UDP 8443）——TCP 被 QoS 时 UDP 通常还能跑。服务端自签证书即可，客户端加 `skip-cert-verify: true`。
2. **IP 被墙的判断**：从国内 ping/端口测试全不通，但从国外（比如另一台机器）通 → 就是被墙，不是配置错。这时唯一出路是**换 IP**（问商家）。
3. **配置备份**：把 `/usr/local/etc/xray/config.json` 和你本地的 Verge 配置丢进一个私有 git 仓库。换机器时 10 分钟重建。
4. **别把鸡蛋放一个篮子**：自建 + 一份机场订阅，两条路同时挂在 Verge 里，任一条挂了手动切过去。

## 8. 排查表

| 症状 | 最可能的原因 | 怎么确认 |
|---|---|---|
| 客户端连上但没流量 | `dest` 站点不支持 TLS1.3，或 serverNames 与 dest 不一致 | 换 `www.microsoft.com` 重试 |
| 握手成功但很快断 | 时间不同步（chrony 没跑） | `date -u` 与本地对比 |
| 端口不通 | 防火墙没放行 / 商家侧安全组 | `ss -lntp` + `curl ip:443` |
| 昨天好好的今天全断 | IP 被墙 | 从国外机器 ping，通 = 被墙 |
| 晚高峰极慢 | 线路差（普通 BGP） | 换 CN2 GIA / 9929 线路 |
| ChatGPT 403 | 服务器 IP 被 OpenAI 判为不支持地区 | 换地区或换 IP |

## 9. 合规

自建代理用于**个人合法用途**（开发、学术、访问公开资料）。请遵守你所在地区的法律法规和 VPS 商家的服务条款；
不要用于任何违法用途，也不要把自己的节点分享给不特定人群（那是另一个性质的问题）。
