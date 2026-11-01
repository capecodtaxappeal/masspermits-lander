#!/usr/bin/env node
// Title retrofit for FROZEN pages. Node 22, built-ins only. No network.
//
//   node scripts/seo/retrofit-titles.mjs --dry-run [--root .]   (counts only)
//   node scripts/seo/retrofit-titles.mjs --apply   [--root .]   (rewrites files)
//
// THE RULE (must match the private generator exactly): for an indexable HTML
// page (no noindex meta robots and no noindex in _headers) whose <title> text
// is longer than 60 characters and ends with " | MassPermits", remove that
// suffix from the <title> only. Nothing else changes: not og:title, not h1,
// not the description, not one other byte.
//
// Only FROZEN pages are touched: pages the generator never rewrites (sitemap
// priority 0.3, or absent from sitemap.xml). Generated pages (priority above
// 0.3) are left for the generator. Hand-written and noindexed pages are
// skipped. Running it twice changes nothing the second time.
//
// The file is edited as raw bytes: the suffix bytes are cut out of the first
// <title> element and every other byte is copied through unchanged.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUFFIX = " | MassPermits";
export const MAX = 60;
const SKIP_DIRS = new Set([".git", "node_modules"]);

// ---------------------------------------------------------------------------
// Copied from scripts/seo/audit.mjs on the claude/seo-audit branch (draft PR
// #14) so the frozen classification here is the same one the audit reports.
// Keep in sync: HAND_WRITTEN, fileToUrl, normUrl, urlKey, parseSitemap,
// parseHeaders, headerNoindex, decode, the title and robots parts of
// parsePage, and the class expression inside audit().
// ---------------------------------------------------------------------------
export const HAND_WRITTEN = new Set(["index.html", "offer.html", "offer/index.html", "agents.html", "404.html"]);

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

// title and robots parts of parsePage() in audit.mjs
export function pageTitleAndRobots(html) {
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = t ? decode(t[1]).replace(/\s+/g, " ").trim() : null;
  const robots = [];
  for (const m of html.matchAll(TAG("meta"))) {
    const a = attrs(m[0]);
    const name = (a.name || "").toLowerCase();
    if (name === "robots" || name === "googlebot") robots.push((a.content || "").toLowerCase());
  }
  return { title, robotsNoindex: robots.some((r) => /\bnoindex\b|\bnone\b/.test(r)) };
}

// the class expression inside audit() in audit.mjs (first match wins)
export function classify(rel, robotsNoindex, sm, hdrRules) {
  const noindex = robotsNoindex || !!headerNoindex(hdrRules, rel);
  return HAND_WRITTEN.has(rel) ? "hand-written" : noindex ? "noindexed" : (!sm || sm.priority === 0.3) ? "frozen" : "generated";
}
// ---------------------------------------------------------------------------
// end of copied code
// ---------------------------------------------------------------------------

// THE RULE applied to one file's bytes. Returns { buf, before, after } when the
// title should change, or null when it should not. Works on a latin1 view of
// the bytes (one char per byte) so offsets are byte offsets; every searched
// token is plain ASCII.
export function retitle(buf, title) {
  if (!title || title.length <= MAX || !title.endsWith(SUFFIX)) return null;
  const s = buf.toString("latin1");
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  if (!m) return null;
  const innerStart = m.index + m[0].indexOf(">") + 1;
  const innerEnd = innerStart + m[1].length;
  // only the exact raw form " | MassPermits" right before </title> is cut;
  // any other spelling (entities, trailing spaces) is reported, not guessed
  if (!m[1].endsWith(SUFFIX)) return { skip: "suffix not literal in raw title" };
  const cut = innerEnd - SUFFIX.length;
  const out = Buffer.concat([buf.subarray(0, cut), buf.subarray(innerEnd)]);
  return { buf: out, before: title, after: title.slice(0, -SUFFIX.length).replace(/\s+/g, " ").trim() };
}

function walk(root, rel = "", out = []) {
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(d.name)) continue;
    const r = rel ? path.join(rel, d.name) : d.name;
    if (d.isDirectory()) walk(root, r, out);
    else if (d.isFile() && d.name.endsWith(".html")) out.push(r.split(path.sep).join("/"));
  }
  return out;
}

const topOf = (rel) => (rel.includes("/") ? rel.split("/")[0] : "(root)");

export function run(root, { apply = false } = {}) {
  const read = (p) => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return ""; } };
  const smByKey = new Map(parseSitemap(read("sitemap.xml")).map((e) => [urlKey(e.url), e]));
  const hdr = parseHeaders(read("_headers"));
  const r = { scanned: 0, byClass: {}, changed: 0, byFolder: {}, stillOver: 0, skipped: [], files: [] };
  for (const rel of walk(root).sort()) {
    r.scanned++;
    const file = path.join(root, rel);
    const buf = fs.readFileSync(file);
    const p = pageTitleAndRobots(buf.toString("utf8"));
    const sm = smByKey.get(urlKey(fileToUrl(rel))) || null;
    const cls = classify(rel, p.robotsNoindex, sm, hdr);
    r.byClass[cls] = (r.byClass[cls] || 0) + 1;
    if (cls !== "frozen") continue;
    if (sm && !(sm.priority === 0.3)) continue; // belt and braces: never a generated page
    const res = retitle(buf, p.title);
    if (!res) continue;
    if (res.skip) { r.skipped.push({ path: rel, why: res.skip }); continue; }
    // the new title must read back exactly as the rule says
    const check = pageTitleAndRobots(res.buf.toString("utf8")).title;
    if (check !== res.after) { r.skipped.push({ path: rel, why: "re-parse mismatch" }); continue; }
    r.changed++;
    const top = topOf(rel);
    r.byFolder[top] = (r.byFolder[top] || 0) + 1;
    if (res.after.length > MAX) r.stillOver++;
    r.files.push({ path: rel, before: res.before, after: res.after });
    if (apply) fs.writeFileSync(file, res.buf);
  }
  return r;
}

function main(argv) {
  let root = process.cwd(), mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i];
    else if (a === "--dry-run" || a === "--apply") {
      if (mode) throw new Error("pass exactly one of --dry-run or --apply");
      mode = a;
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!mode) throw new Error("pass --dry-run (counts only) or --apply");
  const r = run(path.resolve(root), { apply: mode === "--apply" });
  const lines = [
    `mode: ${mode === "--apply" ? "apply" : "dry run (no file written)"}`,
    `html files scanned: ${r.scanned}`,
    `by class: ${Object.entries(r.byClass).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `frozen titles ${mode === "--apply" ? "changed" : "that would change"}: ${r.changed}`,
    ...Object.entries(r.byFolder).sort().map(([k, v]) => `  ${k}: ${v}`),
    `changed titles still over ${MAX} characters: ${r.stillOver}`,
    `skipped (rule matched but raw title not safe to cut): ${r.skipped.length}`,
  ];
  console.log(lines.join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(String(e.message || e)); process.exit(2); }
}
