import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , inPath, outPath] = process.argv;
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'verge-script.js'), 'utf8');
const main = new Function(src + '\nreturn main;')();

const cfg = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const before = {
  groups: (cfg['proxy-groups'] || []).length,
  rules: (cfg.rules || []).length,
  proxies: (cfg.proxies || []).length,
};
const out = main(cfg, 'test-profile');
fs.writeFileSync(outPath, JSON.stringify(out));

const BUILTIN = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);
const groups = out['proxy-groups'] || [];
const nodes = new Set((out.proxies || []).map((p) => p && p.name));
const gnames = new Set(groups.map((g) => g.name));
const problems = [];

if (gnames.size !== groups.length) problems.push('策略组重名：' + (groups.length - gnames.size));

for (const g of groups) {
  if (!Array.isArray(g.proxies) || g.proxies.length === 0) problems.push('空策略组：' + g.name);
  const seenM = new Set();
  for (const m of g.proxies || []) {
    if (seenM.has(m)) problems.push('重复成员：' + g.name + ' / ' + m);
    seenM.add(m);
    if (m === g.name) problems.push('自引用：' + g.name);
    if (!nodes.has(m) && !gnames.has(m) && !BUILTIN.has(m)) problems.push('成员不存在：' + g.name + ' / ' + m);
  }
  if (g.type === 'url-test' || g.type === 'fallback') {
    if (!g.url) problems.push('测速组缺 url：' + g.name);
    if (!Number.isInteger(g.interval) || g.interval <= 0) problems.push('测速组 interval 非法：' + g.name);
    // 没有 expected-status 时，一个秒回 503 的死节点会因为"响应最快"被选中
    if (!Number.isInteger(g['expected-status'])) problems.push('测速组缺 expected-status：' + g.name);
  }
}

// 环检测
const adj = new Map(groups.map((g) => [g.name, (g.proxies || []).filter((m) => gnames.has(m))]));
const WHITE = 0, GRAY = 1, BLACK = 2;
const color = new Map(groups.map((g) => [g.name, WHITE]));
const cycles = [];
const dfs = (n, stack) => {
  color.set(n, GRAY);
  for (const m of adj.get(n) || []) {
    if (color.get(m) === GRAY) cycles.push(stack.concat([m]).join(' → '));
    else if (color.get(m) === WHITE) dfs(m, stack.concat([m]));
  }
  color.set(n, BLACK);
};
for (const g of groups) if (color.get(g.name) === WHITE) dfs(g.name, [g.name]);
if (cycles.length) problems.push('存在循环引用：' + cycles.slice(0, 3).join(' | '));

// 规则目标校验
const valid = new Set([...gnames, ...BUILTIN]);
let ruleIssues = 0;
let ruleTotal = 0;
for (const r of out.rules || []) {
  if (typeof r !== 'string' || !r || r.startsWith('#')) continue;
  ruleTotal++;
  const f = r.split(',').map((s) => s.trim());
  const cands = f.slice(1).filter((x) => x && x !== 'no-resolve');
  if (!cands.some((c) => valid.has(c))) {
    ruleIssues++;
    if (ruleIssues <= 5) problems.push('规则目标未知：' + r);
  }
}

const stat = (g) => (g.proxies || []).length;
const mine = ['🚀 智能选择', '⚡ 测速优选', '🛟 故障转移', '🤖 AI 测速', '⚡ 美国优选', '🐙 GitHub', '🐦 推特/X',
  '🇭🇰 香港', '🇹🇼 台湾', '🇯🇵 日本', '🇸🇬 新加坡', '🇺🇸 美国', '🌍 其他地区', '🔰国外流量', '🤖AI服务', '⚓️其他流量'];
const report = {
  before,
  after: { groups: groups.length, rules: (out.rules || []).length, proxies: new Set(nodes).size },
  prependedRules: (out.rules || []).length - before.rules,
  groupsOfInterest: mine
    .map((n) => groups.find((g) => g.name === n))
    .filter(Boolean)
    .map((g) => ({ name: g.name, type: g.type, url: g.url || '-', interval: g.interval || '-', expected: g['expected-status'] || '-', members: stat(g), head: (g.proxies || []).slice(0, 3) })),
  ruleTotal,
  ruleIssues,
  problems,
  verdict: problems.length ? 'FAIL' : 'PASS',
};
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
