// ─────────────────────────────────────────────────────────────
// Clash Verge Rev · 扩展脚本：智能选节点 + 保留手动选 IP
// 挂载：订阅卡片 → 编辑 → 扩展脚本（Script）
// 每次订阅更新后自动重建策略组，订阅本体不被改动
// ─────────────────────────────────────────────────────────────

const TEST_URL = 'https://www.gstatic.com/generate_204';   // 通用测速：HTTP 204，最省流量
const AI_TEST_URL = 'https://chatgpt.com/cdn-cgi/trace';   // AI 测速：只认真正能过 OpenAI 的线路
// 间隔别开太猛：实测并发刷几十个节点会被机场回 504，全组一起变红。
const INTERVAL = 600;        // 通用组测速间隔（秒，10 分钟）
const AI_INTERVAL = 600;     // AI 组测速间隔（秒）
const FALLBACK_INTERVAL = 1800; // 故障转移组更懒（它的价值是"连不上就换"，不依赖新鲜度）
const TOLERANCE = 50;        // 迟滞：新节点必须快 50ms 以上才切换，防来回跳
// 健康判据：必须真的返回期望状态码才算"活着"。
// 不写这两行的话，一个立刻返回 503 的死节点会因为"响应最快"而被选中。
const TEST_EXPECTED = 204;   // gstatic/generate_204
const AI_EXPECTED = 200;     // chatgpt.com/cdn-cgi/trace：能过 GPT 才是 200
const JUNK = /官网|剩余|到期|套餐|订阅|流量|重置|过期|网址|群组/i;

const G = {
  master: '🚀 智能选择',
  auto: '⚡ 测速优选',
  fallback: '🛟 故障转移',
  aiAuto: '🤖 AI 测速',
  usAuto: '⚡ 美国优选',
  github: '🐙 GitHub',
  twitter: '🐦 推特/X',
  abroad: '🔰国外流量',
  ai: '🤖AI服务',
  other: '⚓️其他流量',
  hk: '🇭🇰 香港', tw: '🇹🇼 台湾', jp: '🇯🇵 日本',
  sg: '🇸🇬 新加坡', us: '🇺🇸 美国', misc: '🌍 其他地区',
};

const REGIONS = [
  ['hk', /香港|HK\b|Hong\s*Kong/i],
  ['tw', /台湾|台灣|台北|新北|TW\b|Taiwan/i],
  ['jp', /日本|东京|大阪|埼玉|JP\b|Japan/i],
  ['sg', /新加坡|狮城|SG\b|Singapore/i],
  ['us', /美国|美國|洛杉矶|圣何塞|西雅图|纽约|US\b|United\s*States/i],
  ['gb', /英国|英國|伦敦|UK\b|GB\b|United\s*Kingdom/i],
  ['kr', /韩国|韓國|首尔|KR\b|Korea/i],
  ['my', /马来|馬來|MY\b|Malaysia/i],
  ['ru', /俄罗斯|俄羅斯|莫斯科|RU\b|Russia/i],
];

function regionOf(name) {
  for (const pair of REGIONS) if (pair[1].test(name)) return pair[0];
  return 'misc';
}

function dedupe(list) {
  const out = [];
  for (const x of list) if (x && out.indexOf(x) === -1) out.push(x);
  return out;
}

function main(config, profileName) {
  if (!config || typeof config !== 'object') return config;
  if (!Array.isArray(config['proxy-groups'])) return config;
  if (!Array.isArray(config.proxies)) return config;

  const nodes = [];
  const seen = new Set();
  for (const p of config.proxies) {
    const n = p && p.name;
    if (typeof n !== 'string' || !n || seen.has(n) || JUNK.test(n)) continue;
    seen.add(n);
    nodes.push(n);
  }
  if (nodes.length === 0) return config;

  const buckets = { hk: [], tw: [], jp: [], sg: [], us: [], gb: [], kr: [], my: [], ru: [], misc: [] };
  for (const n of nodes) buckets[regionOf(n)].push(n);

  // AI 组不再按地区名预筛（实测该机场的香港/俄罗斯节点多数也能过 GPT，
  // 反而把好节点排除了）。真正的判据是 expected-status: 200。

  const groups = config['proxy-groups'];
  const byName = new Map();
  for (const g of groups) if (g && g.name) byName.set(g.name, g);

  const addons = [];
  const upsert = function (g) {
    const cur = byName.get(g.name);
    if (cur) {
      Object.assign(cur, g);
      return;
    }
    byName.set(g.name, g);
    addons.push(g);
  };
  const urlTest = function (name, list, url, interval, expected) {
    return { name: name, type: 'url-test', url: url, interval: interval, tolerance: TOLERANCE,
             'expected-status': expected, lazy: false, proxies: list };
  };
  const fallback = function (name, list, expected) {
    return { name: name, type: 'fallback', url: TEST_URL, interval: FALLBACK_INTERVAL,
             'expected-status': expected, proxies: list };
  };
  const select = function (name, list) {
    return { name: name, type: 'select', proxies: dedupe(list) };
  };

  // ── 建组（顺序即界面顺序）──────────────────────────────────
  upsert(select(G.master, [G.auto, G.fallback, G.github, G.twitter, G.ai,
    G.hk, G.tw, G.jp, G.sg, G.us, G.misc]));
  upsert(urlTest(G.auto, nodes, TEST_URL, INTERVAL, TEST_EXPECTED));
  upsert(fallback(G.fallback, nodes, TEST_EXPECTED));
  upsert(urlTest(G.aiAuto, nodes, AI_TEST_URL, AI_INTERVAL, AI_EXPECTED));
  if (buckets.us.length) upsert(urlTest(G.usAuto, buckets.us, TEST_URL, INTERVAL, TEST_EXPECTED));

  upsert(select(G.github, [G.auto, G.fallback, G.us, G.jp, G.sg, G.tw, G.hk]));
  upsert(select(G.twitter, [G.auto, G.fallback, G.us, G.jp, G.sg, G.tw, G.hk]));

  const regionNames = [];
  const regionPlan = [[G.hk, 'hk'], [G.tw, 'tw'], [G.jp, 'jp'], [G.sg, 'sg'], [G.us, 'us'], [G.misc, 'misc']];
  for (const plan of regionPlan) {
    const name = plan[0];
    const key = plan[1];
    let list = buckets[key];
    if (key === 'misc') list = buckets.gb.concat(buckets.kr, buckets.my, buckets.ru, buckets.misc);
    if (!list.length) continue;
    if (key === 'us' && byName.has(G.usAuto)) list = [G.usAuto].concat(list);
    upsert(select(name, list));
    regionNames.push(name);
  }

  // ── 改造机场自带的三层组：默认智能，仍可手动钉死 ──────────
  const smart = [G.auto, G.fallback];
  const pinSelect = function (name, list) {
    const cur = byName.get(name);
    if (!cur) return false;
    cur.type = 'select';
    cur.proxies = dedupe(list);
    delete cur.filter;
    delete cur['include-all'];
    delete cur['include-all-proxies'];
    delete cur.use;
    return true;
  };
  // 记下真正被改造的机场组，稍后决定兜底规则要不要接管
  const pinned = [];
  if (pinSelect(G.abroad, smart.concat([G.master], regionNames, nodes))) pinned.push(G.abroad);
  if (pinSelect(G.other, smart.concat([G.master], regionNames, nodes))) pinned.push(G.other);
  if (pinSelect(G.ai, [G.aiAuto]
    .concat(byName.has(G.us) ? [G.us] : [], byName.has(G.jp) ? [G.jp] : [])
    .concat(byName.has(G.sg) ? [G.sg] : [], byName.has(G.tw) ? [G.tw] : [])
    .concat(smart, buckets.us))) pinned.push(G.ai);

  // ── 补规则：GitHub / 推特/X（机场自带规则里没有）──────────
  const extra = [];
  const known = function (n) { return byName.has(n); };
  if (known(G.github)) {
    for (const d of ['github.com', 'githubusercontent.com', 'githubassets.com', 'github.dev', 'ghcr.io', 'github.io', 'githubstatus.com']) {
      extra.push('DOMAIN-SUFFIX,' + d + ',' + G.github);
    }
  }
  if (known(G.twitter)) {
    for (const d of ['x.com', 'twitter.com', 't.co', 'twimg.com', 'twttr.com', 'twitter.jp']) {
      extra.push('DOMAIN-SUFFIX,' + d + ',' + G.twitter);
    }
  }
  // 机场命名千差万别：若兜底 MATCH 没落在被改造的组上（例如机场自己的 PROXY），
  // 把它接到总开关，否则规则之外的所有流量仍然是"手动选节点"的老样子。
  // DIRECT / REJECT 兜底则尊重原意，不接管。
  const ruleList = Array.isArray(config.rules) ? config.rules : [];
  for (let i = ruleList.length - 1; i >= 0; i--) {
    const line = String(ruleList[i] || '');
    if (line.indexOf('MATCH,') !== 0) continue;
    const target = line.slice(6).trim();
    if (target !== 'DIRECT' && target !== 'REJECT' && pinned.indexOf(target) === -1) {
      ruleList[i] = 'MATCH,' + G.master;
    }
    break;
  }
  config.rules = extra.concat(ruleList);

  // ── 兜底剪枝：不同机场的组名千差万别。
  // 只要引用了不存在的名字（例如某些机场没有 🤖AI服务），内核会直接拒绝整份配置，
  // 表现为"应用后完全没网"。这里把所有悬空引用去掉，空的组直接丢弃。
  const nodeSet = new Set(nodes);
  const prune = function (list) {
    return dedupe(list).filter(function (n) { return nodeSet.has(n) || byName.has(n); });
  };
  for (const g of addons) if (Array.isArray(g.proxies)) g.proxies = prune(g.proxies);

  const dropped = new Set();
  for (const g of addons) if (Array.isArray(g.proxies) && g.proxies.length === 0) dropped.add(g.name);

  const kept = addons.filter(function (g) { return !dropped.has(g.name); });
  for (const g of kept.concat(groups)) {
    if (!Array.isArray(g.proxies)) continue;
    g.proxies = g.proxies.filter(function (n) { return !dropped.has(n); });
  }
  config['proxy-groups'] = kept.concat(groups);
  return config;
}
