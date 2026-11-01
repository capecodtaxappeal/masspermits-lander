#!/usr/bin/env node
// SEO audit of a static checkout of the site. Node 22, built-ins only.
//
// Reads every HTML page in a checkout plus sitemap.xml, _headers and
// research/evidence/coverage.json, and writes audit.json and summary.md to an
// output directory that must be OUTSIDE the checkout. It never writes inside
// the repo and makes no network call.
//
//   node scripts/seo/audit.mjs --out /some/dir/outside/the/repo [--root .]
//        [--thin N] [--cluster 0.6] [--pairs 3000] [--max-tier 4000] [--seed 1]
//
// Checks, per page:
//   1. path class: hand-written, noindexed, frozen, generated (first match wins)
//   2. title and description length, missing, duplicate; town pages whose
//      title lacks the town name
//   3. conflicts: noindex in sitemap, canonical elsewhere while in sitemap,
//      sitemap URL with no file, file neither in sitemap nor noindexed
//   4. thin pages: content word count under a threshold
//   5. near duplicate clusters inside each tier (6 gram Jaccard, MinHash
//      candidates verified exactly), median sibling Jaccard per tier
//   6. freshness words on pages of towns listed as monthly or failing in
//      research/evidence/coverage.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HAND_WRITTEN = new Set(["index.html", "offer.html", "offer/index.html", "agents.html", "404.html"]);
export const LIMITS = { titleMin: 30, titleMax: 60, descMin: 70, descMax: 160 };
export const FRESHNESS = [
  ["this week", /\bthis week\b/i],
  ["every monday", /\bevery monday\b/i],
  ["weekly", /\bweekly\b/i],
  ["recent", /\brecent(ly)?\b/i],
];
const SKIP_DIRS = new Set([".git", "node_modules"]);
const SHINGLE = 6;
const MINHASH = 64;
const BANDS = 16;

// ---------- small helpers ----------

export function parseArgs(argv) {
  const o = { root: process.cwd(), out: null, thin: null, cluster: 0.6, pairs: 3000, maxTier: 4000, seed: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--root") { o.root = v; i++; }
    else if (a === "--out") { o.out = v; i++; }
    else if (a === "--thin") { o.thin = Number(v); i++; }
    else if (a === "--cluster") { o.cluster = Number(v); i++; }
    else if (a === "--pairs") { o.pairs = Number(v); i++; }
    else if (a === "--max-tier") { o.maxTier = Number(v); i++; }
    else if (a === "--seed") { o.seed = Number(v); i++; }
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.out) throw new Error("--out <dir> is required (a directory outside the checkout)");
  return o;
}

function realish(p) {
  // realpath of the nearest existing ancestor, with the missing tail appended
  let cur = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(cur)) {
    tail.unshift(path.basename(cur));
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return path.join(fs.realpathSync(cur), ...tail);
}

export function assertOutsideRepo(root, out) {
  const r = realish(root), o = realish(out);
  const rel = path.relative(r, o);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`refusing to write inside the checkout: ${o}`);
  }
  return o;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---------- URLs, sitemap, headers ----------

export function fileToUrl(rel) {
  rel = rel.split(path.sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return "/" + rel.slice(0, -"index.html".length);
  return "/" + rel.replace(/\.html$/, "");
}

export function normUrl(u) {
  if (!u) return null;
  let s = String(u).trim().replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/index(\.html)?$/, "/").replace(/\.html$/, "");
  return s;
}

export const urlKey = (u) => (u === "/" ? "/" : u.replace(/\/$/, ""));

export function parseSitemap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(m[1]);
    if (!loc) continue;
    const pr = /<priority>\s*([0-9.]+)\s*<\/priority>/.exec(m[1]);
    out.push({ loc: loc[1], url: normUrl(loc[1]), priority: pr ? Number(pr[1]) : null });
  }
  return out;
}

export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), noindex: false }; rules.push(cur); continue; }
    if (cur && /^\s*x-robots-tag\s*:.*noindex/i.test(line)) cur.noindex = true;
  }
  return rules.filter((r) => r.noindex);
}

export function headerNoindex(rules, rel) {
  const u = fileToUrl(rel);
  const forms = new Set([u, "/" + rel.split(path.sep).join("/"), urlKey(u)]);
  for (const r of rules) {
    for (const f of forms) {
      if (r.pattern.endsWith("*") ? f.startsWith(r.pattern.slice(0, -1)) : f === r.pattern) return r.pattern;
    }
  }
  return null;
}

// ---------- HTML parsing ----------

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: " ", ndash: " ", hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: " ", times: "x", copy: "(c)", rarr: " ", larr: " " };
export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return " "; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

const TAG = (name) => new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, "gi");
function attrs(tag) {
  const o = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    o[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return o;
}

function stripBlocks(html, names) {
  for (const n of names) html = html.replace(new RegExp(`<${n}\\b[\\s\\S]*?<\\/${n}\\s*>`, "gi"), " ");
  return html;
}

function toText(html) {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parsePage(html) {
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = t ? decode(t[1]).replace(/\s+/g, " ").trim() : null;
  let description = null, robots = [], canonical = null;
  for (const m of html.matchAll(TAG("meta"))) {
    const a = attrs(m[0]);
    const name = (a.name || "").toLowerCase();
    if (name === "description" && description == null) description = (a.content || "").replace(/\s+/g, " ").trim();
    if (name === "robots" || name === "googlebot") robots.push((a.content || "").toLowerCase());
  }
  for (const m of html.matchAll(TAG("link"))) {
    const a = attrs(m[0]);
    if ((a.rel || "").toLowerCase().split(/\s+/).includes("canonical") && canonical == null) canonical = a.href || "";
  }
  let body = html.replace(/<!--[\s\S]*?-->/g, " ");
  body = stripBlocks(body, ["head", "script", "style", "noscript", "template", "svg", "iframe"]);
  const visible = toText(body);
  const content = toText(stripBlocks(body, ["header", "nav", "footer"]));
  return { title, description, robotsNoindex: robots.some((r) => /\bnoindex\b|\bnone\b/.test(r)), canonical, visible, content };
}

export function words(text) {
  return text.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
}

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function shingles(ws, k = SHINGLE) {
  const out = new Set();
  if (ws.length < k) { if (ws.length) out.add(fnv(ws.join(" "))); }
  else for (let i = 0; i + k <= ws.length; i++) out.add(fnv(ws.slice(i, i + k).join(" ")));
  return Uint32Array.from(out).sort();
}

export function jaccard(a, b) {
  if (!a.length && !b.length) return 1;
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { inter++; i++; j++; } else if (a[i] < b[j]) i++; else j++;
  }
  return inter / (a.length + b.length - inter);
}

function mix(x, s) {
  x = (x ^ s) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
const SEEDS = Array.from({ length: MINHASH }, (_, i) => fnv("seed" + i));
function minhash(sh) {
  const sig = new Uint32Array(MINHASH).fill(0xffffffff);
  for (let k = 0; k < sh.length; k++) {
    const x = sh[k];
    for (let i = 0; i < MINHASH; i++) { const h = mix(x, SEEDS[i]); if (h < sig[i]) sig[i] = h; }
  }
  return sig;
}

// ---------- towns and tiers ----------

export const slugify = (s) => s.toLowerCase().replace(/,\s*ma$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) => " " + s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";

export function loadTowns(root) {
  const slugs = new Set();
  const names = new Map();
  const partOfCity = new Set();
  const dir = (p) => { try { return fs.readdirSync(path.join(root, p), { withFileTypes: true }); } catch { return []; } };
  for (const d of dir("news")) if (d.isDirectory()) slugs.add(d.name);
  for (const d of dir("widget/v1/t")) if (d.isFile() && d.name.endsWith(".html") && d.name !== "index.html") slugs.add(d.name.slice(0, -5));
  // a guide prefix counts as a town only when a permits hub page exists for it
  for (const d of dir("guides")) {
    const m = /^(.+)-building-permits\.html$/.exec(d.name);
    if (m && fs.existsSync(path.join(root, "permits", m[1] + ".html"))) slugs.add(m[1]);
  }
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(root, "widget/v1/index.json"), "utf8"));
    for (const t of idx.towns || []) {
      if (!t.slug) continue;
      slugs.add(t.slug);
      if (t.town) names.set(t.slug, t.town);
      if (t.kind && t.kind !== "town") partOfCity.add(t.slug);
    }
  } catch { /* optional */ }
  let coverage = { live: new Set(), monthly: new Set(), failing: new Set(), found: false };
  try {
    const c = JSON.parse(fs.readFileSync(path.join(root, "research/evidence/coverage.json"), "utf8"));
    const st = c.stats || {};
    coverage = {
      found: true,
      live: new Set((st.table || []).filter((r) => (r.rows || 0) > 0).map((r) => slugify(r.source))),
      monthly: new Set((st.monthly || []).map(slugify)),
      failing: new Set((st.errors || []).map(slugify)),
    };
  } catch { /* optional */ }
  const sorted = [...slugs].sort((a, b) => b.length - a.length);
  const nameOf = (s) => names.get(s) || s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  // dark: a town with pages but no current rows (not in the coverage table,
  // or failing), unless it is a neighbourhood or village of a covered place
  const isDark = (s) => coverage.found && !partOfCity.has(s) && (!coverage.live.has(s) || coverage.failing.has(s));
  return { slugs, sorted, nameOf, coverage, isDark };
}

export function townOf(rel, towns) {
  rel = rel.split(path.sep).join("/");
  let m;
  if ((m = /^news\/([^/]+)\//.exec(rel))) return towns.slugs.has(m[1]) ? m[1] : null;
  if ((m = /^widget\/v1\/t\/([^/]+)\.html$/.exec(rel))) return m[1];
  if ((m = /^(?:permits|guides)\/([^/]+)\.html$/.exec(rel))) {
    const b = m[1];
    for (const s of towns.sorted) if (b === s || b.startsWith(s + "-")) return s;
  }
  return null;
}

export function tierOf(rel, town) {
  rel = rel.split(path.sep).join("/");
  if (HAND_WRITTEN.has(rel)) return "hand-written";
  const base = path.posix.basename(rel, ".html");
  const top = rel.includes("/") ? rel.split("/")[0] : "(root)";
  if (top === "permits") {
    if (!town) return "permits/other";
    if (base === town) return "permits/town";
    return base.endsWith("-cost") ? "permits/town-trade-cost" : "permits/town-trade";
  }
  if (top === "news") return town ? (base === "index" ? "news/town-index" : "news/town-week") : "news/other";
  if (top === "guides") return town ? "guides/town" : "guides/other";
  if (top === "projects") return /-cost-/.test(base) ? "projects/cost" : /-permits-/.test(base) ? "projects/permits" : "projects/other";
  if (top === "widget") return town ? "widget/town" : "widget/other";
  if (top === "report") return /^\d{4}-\d{2}-\d{2}$/.test(base) ? "report/week" : "report/other";
  if (top === "(root)" && /-leads-/.test(base)) return "root/trade-region-leads";
  return top;
}

// ---------- the audit ----------

function walk(root, rel = "", out = []) {
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(d.name)) continue;
    const r = rel ? path.join(rel, d.name) : d.name;
    if (d.isDirectory()) walk(root, r, out);
    else if (d.isFile() && d.name.endsWith(".html")) out.push(r.split(path.sep).join("/"));
  }
  return out;
}

export function audit(root, opts = {}) {
  const o = { thin: null, cluster: 0.6, pairs: 3000, maxTier: 4000, seed: 1, ...opts };
  const t0 = Date.now();
  const read = (p) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return null; } };
  const sitemap = parseSitemap(read("sitemap.xml") || "");
  const smByKey = new Map(sitemap.map((e) => [urlKey(e.url), e]));
  const hdr = parseHeaders(read("_headers") || "");
  const towns = loadTowns(root);
  const files = walk(root).sort();

  const pages = [];
  for (const rel of files) {
    const html = read(rel);
    const p = parsePage(html);
    const url = fileToUrl(rel);
    const sm = smByKey.get(urlKey(url)) || null;
    const hdrRule = headerNoindex(hdr, rel);
    const noindex = p.robotsNoindex || !!hdrRule;
    const cls = HAND_WRITTEN.has(rel) ? "hand-written" : noindex ? "noindexed" : (!sm || sm.priority === 0.3) ? "frozen" : "generated";
    const town = townOf(rel, towns);
    const ws = words(p.content);
    pages.push({
      path: rel, url, class: cls, tier: tierOf(rel, town), town,
      dark: town ? towns.isDark(town) : false,
      noindex, noindexSource: p.robotsNoindex ? "meta" : hdrRule ? `_headers ${hdrRule}` : null,
      inSitemap: !!sm, priority: sm ? sm.priority : null,
      title: p.title, titleLen: p.title ? p.title.length : 0,
      description: p.description, descLen: p.description ? p.description.length : 0,
      canonical: p.canonical, words: ws.length,
      _ws: ws, _visible: p.visible,
    });
  }
  const owner = (pg) => pg.class === "hand-written" ? "hand-written" : pg.class === "frozen" ? "frozen-retrofit" : pg.dark ? "dark-branch" : "generator";
  for (const pg of pages) pg.owner = owner(pg);
  const indexable = (pg) => !pg.noindex;

  // 2. titles and descriptions
  const flags = new Map(pages.map((p) => [p.path, []]));
  const flag = (pg, f) => flags.get(pg.path).push(f);
  const dupGroups = { title: new Map(), description: new Map() };
  for (const pg of pages) {
    if (!pg.title) flag(pg, "title-missing");
    else if (pg.titleLen < LIMITS.titleMin) flag(pg, "title-short");
    else if (pg.titleLen > LIMITS.titleMax) flag(pg, "title-long");
    if (!pg.description) flag(pg, "description-missing");
    else if (pg.descLen < LIMITS.descMin) flag(pg, "description-short");
    else if (pg.descLen > LIMITS.descMax) flag(pg, "description-long");
    if (indexable(pg)) {
      for (const k of ["title", "description"]) {
        if (!pg[k]) continue;
        const key = pg[k].toLowerCase();
        if (!dupGroups[k].has(key)) dupGroups[k].set(key, []);
        dupGroups[k].get(key).push(pg.path);
      }
    }
    if (pg.town && pg.title && !norm(pg.title).includes(norm(towns.nameOf(pg.town)))) flag(pg, "title-lacks-town");
  }
  const dupReport = {};
  for (const k of ["title", "description"]) {
    const groups = [...dupGroups[k].entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
    for (const [, v] of groups) for (const p of v) flags.get(p).push(`${k}-duplicate`);
    dupReport[k] = { groups: groups.length, pages: groups.reduce((n, [, v]) => n + v.length, 0),
      top: groups.slice(0, 20).map(([text, v]) => ({ text, count: v.length, sample: v.slice(0, 5) })) };
  }

  // 3. conflicts
  const byKey = new Map(pages.map((p) => [urlKey(p.url), p]));
  for (const pg of pages) {
    if (pg.noindex && pg.inSitemap) flag(pg, "noindex-in-sitemap");
    if (pg.canonical != null) {
      const c = normUrl(pg.canonical);
      const offHost = /^https?:\/\//i.test(pg.canonical) && !/^https?:\/\/(www\.)?masspermits\.com(\/|$)/i.test(pg.canonical);
      if ((offHost || urlKey(c) !== urlKey(pg.url)) && pg.inSitemap) flag(pg, "canonical-elsewhere-in-sitemap");
    }
    if (!pg.inSitemap && !pg.noindex) flag(pg, "not-in-sitemap-not-noindexed");
  }
  const fnExists = (u) => {
    const b = u === "/" ? "index" : u.replace(/^\/|\/$/g, "");
    return ["", "/index"].some((s) => [".js", ".ts", ".mjs"].some((e) => fs.existsSync(path.join(root, "functions", b + s + e))));
  };
  const sitemapNoFile = sitemap.filter((e) => !byKey.has(urlKey(e.url))).map((e) => ({ loc: e.loc, priority: e.priority, functionRoute: fnExists(e.url) }));

  // 4. thin pages
  const idxWords = pages.filter(indexable).map((p) => p.words);
  const dist = Object.fromEntries([5, 10, 25, 50, 75, 90].map((q) => [`p${q}`, pct(idxWords, q)]));
  const thin = o.thin != null ? { threshold: o.thin, rule: "set with --thin" } : thinFromDistribution(idxWords);
  const thinThreshold = thin.threshold;
  for (const pg of pages) if (pg.words < thinThreshold) flag(pg, "thin");

  // 5. near duplicate clusters per tier
  const rand = mulberry32(o.seed);
  const tiers = new Map();
  for (const pg of pages) { if (!tiers.has(pg.tier)) tiers.set(pg.tier, []); tiers.get(pg.tier).push(pg); }
  const tierStats = [];
  const clusters = [];
  for (const [tier, all] of [...tiers.entries()].sort()) {
    let members = all;
    let sampled = false;
    if (members.length > o.maxTier) {
      members = [...members].sort(() => rand() - 0.5).slice(0, o.maxTier);
      sampled = true;
    }
    const sh = members.map((p) => shingles(p._ws));
    const n = members.length;
    // median sibling Jaccard over random pairs (or all pairs when few)
    const js = [];
    const allPairs = (n * (n - 1)) / 2;
    if (n > 1 && allPairs <= o.pairs) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) js.push(jaccard(sh[i], sh[j]));
    } else if (n > 1) {
      for (let k = 0; k < o.pairs; k++) {
        const i = Math.floor(rand() * n);
        let j = Math.floor(rand() * (n - 1));
        if (j >= i) j++;
        js.push(jaccard(sh[i], sh[j]));
      }
    }
    // clusters: MinHash LSH candidates, verified with exact Jaccard
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const edges = [];
    if (n > 1) {
      const sigs = sh.map(minhash);
      const rows = MINHASH / BANDS;
      const seen = new Set();
      for (let b = 0; b < BANDS; b++) {
        const buckets = new Map();
        for (let i = 0; i < n; i++) {
          let key = "";
          for (let r = 0; r < rows; r++) key += sigs[i][b * rows + r].toString(36) + ".";
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(i);
        }
        for (const ids of buckets.values()) {
          if (ids.length < 2) continue;
          for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
            const i = ids[x], j = ids[y];
            const k = i * n + j;
            if (seen.has(k)) continue;
            seen.add(k);
            let eq = 0;
            for (let h = 0; h < MINHASH; h++) if (sigs[i][h] === sigs[j][h]) eq++;
            if (eq / MINHASH < o.cluster - 0.15) continue;
            const jj = jaccard(sh[i], sh[j]);
            if (jj >= o.cluster) { edges.push(jj); parent[find(i)] = find(j); }
          }
        }
      }
    }
    const comp = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); }
    let inClusters = 0;
    for (const ids of comp.values()) {
      if (ids.length < 2) continue;
      inClusters += ids.length;
      const ps = ids.map((i) => members[i]);
      for (const p of ps) flag(p, "near-duplicate");
      const a = sh[ids[0]], b = sh[ids[1]];
      clusters.push({ tier, size: ids.length, indexable: ps.filter(indexable).length,
        classes: countBy(ps, (p) => p.class), sampleJaccard: r3(jaccard(a, b)), sample: ps.slice(0, 8).map((p) => p.path) });
    }
    tierStats.push({ tier, pages: all.length, analysed: n, sampled, pairsMeasured: js.length,
      medianJaccard: r3(median(js)), p90Jaccard: r3(pct(js, 90)), clusterPages: inClusters, clusterEdges: edges.length,
      medianWords: median(all.map((p) => p.words)) });
  }
  clusters.sort((a, b) => b.size - a.size || a.tier.localeCompare(b.tier));

  // 6. freshness words on monthly or failing towns
  const fresh = [];
  const watched = new Set([...towns.coverage.monthly, ...towns.coverage.failing]);
  for (const pg of pages) {
    if (!pg.town || !watched.has(pg.town)) continue;
    const fields = { title: pg.title || "", description: pg.description || "", body: pg._visible };
    const hits = [];
    for (const [term, re] of FRESHNESS) for (const [f, txt] of Object.entries(fields)) if (re.test(txt)) hits.push(`${term}@${f}`);
    if (hits.length) {
      flag(pg, "freshness-claim");
      if (hits.some((h) => !h.endsWith("@body"))) flag(pg, "freshness-claim-snippet");
      fresh.push({ path: pg.path, town: pg.town, status: towns.coverage.failing.has(pg.town) ? "failing" : "monthly", class: pg.class, hits });
    }
  }

  // roll up
  for (const pg of pages) { pg.flags = flags.get(pg.path); delete pg._ws; delete pg._visible; }
  const classes = ["hand-written", "noindexed", "frozen", "generated"];
  const checkNames = ["title-missing", "title-short", "title-long", "title-duplicate", "title-lacks-town",
    "description-missing", "description-short", "description-long", "description-duplicate",
    "noindex-in-sitemap", "canonical-elsewhere-in-sitemap", "not-in-sitemap-not-noindexed",
    "thin", "near-duplicate", "freshness-claim", "freshness-claim-snippet"];
  const perCheck = {};
  for (const c of checkNames) {
    const ps = pages.filter((p) => p.flags.includes(c));
    perCheck[c] = { total: ps.length, byClass: Object.fromEntries(classes.map((k) => [k, ps.filter((p) => p.class === k).length])),
      byOwner: countBy(ps, (p) => p.owner), byTier: countBy(ps, (p) => p.tier) };
  }
  perCheck["sitemap-url-no-file"] = { total: sitemapNoFile.length, functionRoutes: sitemapNoFile.filter((e) => e.functionRoute).length };

  const fixes = rankFixes(pages, perCheck);
  const noindexCandidates = pages
    .filter((p) => indexable(p) && p.class !== "hand-written" && p.flags.includes("thin") && p.flags.includes("near-duplicate"))
    .map((p) => ({ path: p.path, tier: p.tier, words: p.words, owner: p.owner }));

  return {
    generatedAt: new Date().toISOString(),
    seconds: (Date.now() - t0) / 1000,
    options: { thinThreshold, thinRule: thin.rule, cluster: o.cluster, pairs: o.pairs, maxTier: o.maxTier, seed: o.seed, shingle: SHINGLE, minhash: MINHASH, bands: BANDS, limits: LIMITS },
    totals: { htmlFiles: pages.length, sitemapUrls: sitemap.length, byClass: countBy(pages, (p) => p.class), byOwner: countBy(pages, (p) => p.owner), byTier: countBy(pages, (p) => p.tier) },
    wordDistributionIndexable: dist,
    checks: perCheck,
    duplicates: dupReport,
    sitemapNoFile,
    tiers: tierStats,
    clusters: { total: clusters.length, top: clusters.slice(0, 20) },
    freshness: { watchedTowns: [...watched].sort(), pages: fresh },
    fixes,
    noindexCandidates: { note: "candidates only: indexable, thin and in a near duplicate cluster. Not a recommendation to noindex.", count: noindexCandidates.length, pages: noindexCandidates },
    pages,
  };
}

// Thin threshold from the distribution of content words on indexable pages.
// Word counts on this kind of site are bimodal: a mode of short list pages
// and a mode of full pages. The threshold is the lower edge of the emptiest
// 25 word bin between the largest bin below the median and the median, that
// is, the valley between the two modes. With no valley (or too few pages) it
// falls back to 200 words, about one screen of prose.
export function thinFromDistribution(counts, bin = 25) {
  const fallback = { threshold: 200, rule: "fallback: 200 words (no valley below the median)" };
  if (counts.length < 20) return fallback;
  const med = median(counts);
  const h = new Map();
  for (const c of counts) { const b = Math.floor(c / bin) * bin; h.set(b, (h.get(b) || 0) + 1); }
  let peak = null;
  for (let b = 0; b < med; b += bin) if (peak == null || (h.get(b) || 0) > (h.get(peak) || 0)) peak = b;
  if (peak == null) return fallback;
  let low = null;
  for (let b = peak + bin; b + bin <= med; b += bin) if (low == null || (h.get(b) || 0) < (h.get(low) || 0)) low = b;
  if (low == null || (h.get(low) || 0) >= (h.get(peak) || 0) / 2) return fallback;
  return { threshold: low, rule: `valley: bin ${low} to ${low + bin} holds ${h.get(low) || 0} pages against ${h.get(peak)} in the short page mode at ${peak} to ${peak + bin}; median ${med}` };
}

function countBy(xs, f) {
  const o = {};
  for (const x of xs) { const k = f(x); o[k] = (o[k] || 0) + 1; }
  return o;
}

const FIX_TEXT = {
  "title-long": "Shorten titles to 60 characters or fewer so the town and trade are not cut off in results",
  "title-short": "Lengthen titles under 30 characters with town and trade",
  "title-missing": "Add a title",
  "title-duplicate": "Make duplicate titles unique (town, trade or date in the title)",
  "title-lacks-town": "Put the town name in the title of every town page",
  "description-long": "Shorten meta descriptions to 160 characters or fewer",
  "description-short": "Lengthen meta descriptions under 70 characters",
  "description-missing": "Add a meta description",
  "description-duplicate": "Make duplicate meta descriptions unique",
  "noindex-in-sitemap": "Drop noindexed pages from sitemap.xml",
  "canonical-elsewhere-in-sitemap": "List only self canonical URLs in sitemap.xml",
  "not-in-sitemap-not-noindexed": "Decide each orphan file: list it in sitemap.xml or treat it as a noindex candidate",
  "thin": "Add page specific content to thin indexable pages",
  "near-duplicate": "Differentiate near duplicate indexable pages",
  "freshness-claim": "Remove weekly or recent wording anywhere on pages of monthly or failing towns",
  "freshness-claim-snippet": "Remove weekly or recent wording from titles and descriptions of monthly or failing towns",
};

// One fix per check and tier, so each line names a template someone can
// change. Indexable pages only: noindexed pages cannot cost search traffic,
// except for the sitemap conflict, which is about noindexed pages. The
// "anywhere on the page" freshness check is left out of the ranking because
// the snippet variant covers almost the same pages with a sharper fix.
function rankFixes(pages, perCheck) {
  const groups = new Map();
  for (const p of pages) {
    for (const check of p.flags) {
      if (!FIX_TEXT[check] || check === "freshness-claim") continue;
      if (p.noindex && check !== "noindex-in-sitemap") continue;
      const k = check + "|" + p.tier;
      if (!groups.has(k)) groups.set(k, { check, tier: p.tier, fix: `${FIX_TEXT[check]} (${p.tier})`, ps: [] });
      groups.get(k).ps.push(p);
    }
  }
  const out = [...groups.values()].map((g) => ({ check: g.check, tier: g.tier, fix: g.fix, pages: g.ps.length,
    byOwner: countBy(g.ps, (p) => p.owner), sample: g.ps.slice(0, 5).map((p) => p.path) }));
  const nf = perCheck["sitemap-url-no-file"];
  if (nf.total - nf.functionRoutes > 0) out.push({ check: "sitemap-url-no-file", tier: "sitemap", fix: "Remove sitemap URLs that have no file", pages: nf.total - nf.functionRoutes, byOwner: { generator: nf.total - nf.functionRoutes }, sample: [] });
  return out.sort((a, b) => b.pages - a.pages || a.fix.localeCompare(b.fix));
}

export function summaryMarkdown(r) {
  const L = [];
  L.push(`# SEO audit`, ``, `${r.totals.htmlFiles} HTML files, ${r.totals.sitemapUrls} sitemap URLs, ${r.seconds.toFixed(1)} s.`, ``);
  L.push(`## Path classes`, ``, `| class | pages |`, `|---|---|`);
  for (const [k, v] of Object.entries(r.totals.byClass)) L.push(`| ${k} | ${v} |`);
  L.push(``, `## Checks (pages flagged)`, ``, `| check | total | hand-written | noindexed | frozen | generated |`, `|---|---|---|---|---|---|`);
  for (const [k, v] of Object.entries(r.checks)) {
    if (!v.byClass) { L.push(`| ${k} | ${v.total} | | | | |`); continue; }
    const b = v.byClass;
    L.push(`| ${k} | ${v.total} | ${b["hand-written"]} | ${b.noindexed} | ${b.frozen} | ${b.generated} |`);
  }
  const d = r.wordDistributionIndexable;
  L.push(``, `Thin threshold: ${r.options.thinThreshold} content words (${r.options.thinRule}). Indexable distribution: p5 ${d.p5}, p10 ${d.p10}, p25 ${d.p25}, median ${d.p50}, p75 ${d.p75}, p90 ${d.p90}.`);
  L.push(``, `## Tiers (6 gram Jaccard)`, ``, `| tier | pages | median J | p90 J | pages in clusters | median words |`, `|---|---|---|---|---|---|`);
  for (const t of r.tiers) L.push(`| ${t.tier} | ${t.pages}${t.sampled ? " (sampled)" : ""} | ${t.medianJaccard ?? ""} | ${t.p90Jaccard ?? ""} | ${t.clusterPages} | ${t.medianWords} |`);
  L.push(``, `## Largest near duplicate clusters (J >= ${r.options.cluster})`, ``);
  for (const c of r.clusters.top) L.push(`- ${c.tier}: ${c.size} pages (${c.indexable} indexable), e.g. ${c.sample.slice(0, 3).join(", ")}`);
  L.push(``, `## Fixes ranked by pages affected (indexable pages)`, ``);
  r.fixes.slice(0, 10).forEach((f, i) => L.push(`${i + 1}. ${f.fix}: ${f.pages} pages (${Object.entries(f.byOwner).map(([k, v]) => `${k} ${v}`).join(", ")})`));
  const terms = {};
  for (const f of r.freshness.pages) for (const h of f.hits) terms[h] = (terms[h] || 0) + 1;
  L.push(``, `Freshness: ${r.freshness.pages.length} pages of ${r.freshness.watchedTowns.length} monthly or failing towns use weekly or recent wording. By term and field: ${Object.entries(terms).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  L.push(`Noindex candidates (listed only): ${r.noindexCandidates.count}.`, ``);
  return L.join("\n");
}

export function main(argv) {
  const o = parseArgs(argv);
  const root = path.resolve(o.root);
  const out = assertOutsideRepo(root, o.out);
  const r = audit(root, o);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "audit.json"), JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(out, "summary.md"), summaryMarkdown(r));
  return { out, report: r };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { out, report } = main(process.argv.slice(2));
    console.log(`wrote ${path.join(out, "audit.json")} and summary.md (${report.totals.htmlFiles} pages, ${report.seconds.toFixed(1)} s)`);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
}
