// Shared test harness for Mission Control. Test-only; nothing here ships.
//
// * tempCopy(): copies the SHIPPED files (and _cf-access.js / _presend.js,
//   which they import) byte for byte into a temp dir with a {"type":"module"}
//   package.json, keeping the relative layout, and load() imports from there.
// * FakeR2: in-memory get/head/list/put/delete, every op recorded, etags are
//   the 32-hex MD5 of the body (production shape), httpEtag the same quoted.
// * installFetch(): a global fetch stub that serves the test JWKS and fixture
//   Stripe URLs, records every call, and THROWS on any other URL.
// * an RS256 JWT minter with a key generated here (node:crypto).
// * synthetic fixture worlds: @example.com, cus_TEST..., invented people.

import { createHash, createHmac, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SHIPPED = [
  "functions/api/_owner_gate.js",
  "functions/api/_mission_r2.js",
  "functions/api/_mission_stripe.js",
  "functions/api/_mission_data.js",
  "functions/admin/api/mission.js",
  "functions/admin/api/mission-outreach.js",
  "admin/mission-view.js",
  "admin/mission-render.js",
  "admin/mission-app.js",
];
const IMPORTED = ["functions/api/_cf-access.js", "functions/api/_presend.js"];

let tmpDir = null;
export function tempCopy() {
  if (tmpDir) return tmpDir;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-test-"));
  for (const rel of [...IMPORTED, ...SHIPPED]) {
    const dst = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), dst);
    if (!fs.readFileSync(dst).equals(fs.readFileSync(path.join(REPO, rel)))) throw new Error("copy differs: " + rel);
  }
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }));
  return tmpDir;
}

let loaded = null;
export async function load() {
  if (loaded) return loaded;
  const dir = tempCopy();
  const imp = (rel) => import(pathToFileURL(path.join(dir, rel)).href);
  loaded = {
    mission: await imp("functions/admin/api/mission.js"),
    gate: await imp("functions/api/_owner_gate.js"),
    r2: await imp("functions/api/_mission_r2.js"),
    stripe: await imp("functions/api/_mission_stripe.js"),
    data: await imp("functions/api/_mission_data.js"),
    presend: await imp("functions/api/_presend.js"),
    outreach: await imp("functions/admin/api/mission-outreach.js"),
    view: await imp("admin/mission-view.js"),
    render: await imp("admin/mission-render.js"),
  };
  return loaded;
}

export async function resetCaches() {
  const m = await load();
  m.r2.resetMissionCaches();
  m.stripe.resetMissionCaches();
}

// ── time ───────────────────────────────────────────────────────────────────
export const HOUR = 3600_000;
export const DAY = 86400_000;
export const T = (s) => Date.parse(s);
export const isoDay = (t) => new Date(t).toISOString().slice(0, 10);

// Most recent Monday 12:00 UTC at or before now (the send due time).
export function mondayDue(now) {
  const d = new Date(now);
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 1 + 7) % 7));
  let t = d.getTime();
  if (t > now) t -= 7 * DAY;
  return t;
}

// The refresh "landed at 14:20Z on the most recent day it could have landed".
export function refreshLanded(now) {
  const d = new Date(now);
  d.setUTCHours(14, 20, 0, 0);
  let t = d.getTime();
  if (t + 60_000 > now) t -= DAY;
  return t;
}

// ── fake R2 ─────────────────────────────────────────────────────────────────
export const md5 = (s) => createHash("md5").update(s).digest("hex");

export class FakeR2 {
  constructor() {
    this.objects = new Map();
    this.ops = [];
    this.fail = new Set();   // "get:key", "head:key", "list:prefix", "get:*"
    this.listLimit = 1000;
  }
  set(key, value, opts = {}) {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    this.objects.set(key, {
      body,
      etag: md5(body),
      uploaded: new Date(opts.uploaded !== undefined ? opts.uploaded : T("2026-09-01T00:00:00Z")),
      size: Buffer.byteLength(body),
      customMetadata: opts.customMetadata || {},
    });
    return this;
  }
  remove(key) { this.objects.delete(key); return this; }
  json(key) { const o = this.objects.get(key); return o ? JSON.parse(o.body) : undefined; }
  etags() { return [...this.objects.values()].map((o) => o.etag); }
  _meta(key, o) {
    return {
      key, etag: o.etag, httpEtag: '"' + o.etag + '"', uploaded: o.uploaded, size: o.size,
      customMetadata: { ...o.customMetadata }, version: md5("v" + o.etag),
    };
  }
  _check(op, key) {
    if (this.fail.has(op + ":" + key) || this.fail.has(op + ":*")) throw new Error("r2 " + op + " failed for test");
  }
  async get(key) {
    this.ops.push({ op: "get", key });
    this._check("get", key);
    const o = this.objects.get(key);
    if (!o) return null;
    const body = o.body;
    return { ...this._meta(key, o), text: async () => body, json: async () => JSON.parse(body),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  }
  async head(key) {
    this.ops.push({ op: "head", key });
    this._check("head", key);
    const o = this.objects.get(key);
    return o ? this._meta(key, o) : null;
  }
  async list(opts = {}) {
    const prefix = opts.prefix || "";
    this.ops.push({ op: "list", key: prefix });
    this._check("list", prefix);
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const limit = Math.min(opts.limit || this.listLimit, this.listLimit);
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    const withMeta = Array.isArray(opts.include) && opts.include.includes("customMetadata");
    return {
      objects: page.map((k) => {
        const m = this._meta(k, this.objects.get(k));
        if (!withMeta) delete m.customMetadata;
        return m;
      }),
      truncated,
      cursor: truncated ? String(start + limit) : undefined,
      delimitedPrefixes: [],
    };
  }
  // Honours onlyIf.etagMatches as R2 does: a mismatch writes nothing and returns null.
  async put(key, value, opts = {}) {
    this.ops.push({ op: "put", key, opts });
    this._check("put", key);
    const want = opts && opts.onlyIf && opts.onlyIf.etagMatches;
    const cur = this.objects.get(key);
    if (want !== undefined && (!cur || cur.etag !== String(want).replace(/"/g, ""))) return null;
    this.set(key, String(value), { uploaded: opts.uploadedAt });
    return this._meta(key, this.objects.get(key));
  }
  async delete(key) { this.ops.push({ op: "delete", key }); this.objects.delete(key); }
}

// ── a minimal fake DOM (test-only; no dependency) ──────────────────────────
// Enough of the DOM for mission-render.js and the demo boot. The HTML sinks
// throw, so a render that reached for one fails the test.
const SVG_NS_URI = "http://www.w3.org/2000/svg";
export class FakeNode {
  constructor(doc, tag, ns) {
    this.ownerDocument = doc;
    this.tagName = tag ? tag.toUpperCase() : "#text";
    this.localName = tag || "#text";
    this.namespaceURI = ns || null;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = {};
    this._text = "";
    this.hidden = false;
  }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((c) => c.tagName !== "#text"); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c; }
  replaceChildren(...kids) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; for (const k of kids) this.appendChild(k); }
  setAttribute(k, v) {
    if (/^on/i.test(k) || k === "style") throw new Error("forbidden attribute " + k);
    if (k === "hidden") this.hidden = true; else this.attrs.set(k, String(v));
  }
  getAttribute(k) { return k === "hidden" ? (this.hidden ? "" : null) : this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { if (k === "hidden") this.hidden = false; else this.attrs.delete(k); }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  get textContent() { return this.tagName === "#text" ? this._text : this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) {
    if (this.tagName === "#text") { this._text = String(v); return; }
    this.replaceChildren();
    if (v !== "") this.appendChild(this.ownerDocument.createTextNode(String(v)));
  }
  get className() { return this.getAttribute("class") || ""; }
  get innerHTML() { throw new Error("innerHTML is forbidden"); }
  set innerHTML(_) { throw new Error("innerHTML is forbidden"); }
  get outerHTML() { throw new Error("outerHTML is forbidden"); }
  set outerHTML(_) { throw new Error("outerHTML is forbidden"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML is forbidden"); }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  dispatch(type, extra = {}) {
    const ev = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n = this; n; n = n.parentNode) for (const f of n.listeners[type] || []) f(ev);
    return ev;
  }
  click() { return this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; }
  walk(fn) { fn(this); for (const c of this.childNodes) c.walk(fn); }
  all(pred) { const out = []; this.walk((n) => { if (n.tagName !== "#text" && pred(n)) out.push(n); }); return out; }
  byPart(name) { return this.all((n) => n.getAttribute("data-part") === name); }
  isShown() { for (let n = this; n; n = n.parentNode) if (n.hidden) return false; return true; }
}
export class FakeDocument {
  constructor() {
    this.documentElement = new FakeNode(this, "html");
    this.body = new FakeNode(this, "body");
    this.documentElement.appendChild(this.body);
    this.activeElement = null;
    this.listeners = {};
  }
  createElement(t) { return new FakeNode(this, t.toLowerCase(), "http://www.w3.org/1999/xhtml"); }
  createElementNS(ns, t) { return new FakeNode(this, t, ns); }
  createTextNode(s) { const n = new FakeNode(this, null); n._text = String(s); return n; }
  getElementById(id) { let hit = null; this.documentElement.walk((n) => { if (!hit && n.getAttribute && n.getAttribute("id") === id) hit = n; }); return hit; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  write() { throw new Error("document.write is forbidden"); }
}
// Parses the page's own static body markup (simple, well-formed, no script)
// into a FakeDocument.
export function fakeDocumentFrom(bodyHtml) {
  const doc = new FakeDocument();
  const stack = [doc.body];
  const VOID = new Set(["meta", "link", "br", "img", "input", "hr"]);
  const re = /<\/([a-z0-9]+)\s*>|<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(bodyHtml))) {
    const top = stack[stack.length - 1];
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[5] !== undefined) { if (m[5].trim()) top.appendChild(doc.createTextNode(m[5])); continue; }
    const tag = m[2].toLowerCase();
    const inSvg = tag === "svg" || top.namespaceURI === SVG_NS_URI;
    const node = inSvg ? doc.createElementNS(SVG_NS_URI, tag) : doc.createElement(tag);
    for (const a of m[3].matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)) node.setAttribute(a[1].toLowerCase(), a[2] === undefined ? "" : a[2]);
    top.appendChild(node);
    if (!VOID.has(tag) && !m[4]) stack.push(node);
  }
  return doc;
}

// ── JWT ─────────────────────────────────────────────────────────────────────
export const TEAM = "example-team.cloudflareaccess.com";
export const ISS = "https://" + TEAM;
export const AUD = "mission-test-aud";
export const OWNER = "owner@example.com";
export const STRANGER = "stranger@example.com";

const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function makeSigner(kid = "test-kid-1") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwk, kid };
}

export function mint(signer, claims, opt = {}) {
  const header = { alg: opt.alg || "RS256", kid: opt.kid || signer.kid, typ: "JWT" };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  let sig;
  if (header.alg === "RS256") sig = createSign("RSA-SHA256").update(h + "." + p).sign(signer.privateKey);
  else if (header.alg === "HS256") sig = createHmac("sha256", "shared-secret").update(h + "." + p).digest();
  else sig = Buffer.alloc(0);
  let s = b64url(sig);
  if (opt.tamper) s = (s[0] === "A" ? "B" : "A") + s.slice(1);
  return h + "." + p + "." + s;
}

export function claims(over = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  return {
    aud: [AUD], email: OWNER, exp: nowS + 600, iat: nowS, nbf: nowS, iss: ISS,
    type: "app", identity_nonce: "nonce", sub: randomUUID(), country: "US", ...over,
  };
}

// ── fetch stub ──────────────────────────────────────────────────────────────
export function installFetch() {
  const stub = { calls: [], jwks: {}, stripe: null };
  globalThis.fetch = async (input, init = {}) => {
    const u = typeof input === "string" ? input : input.url;
    const method = String(init.method || (input && input.method) || "GET").toUpperCase();
    stub.calls.push({ url: u, method, headers: { ...(init.headers || {}) } });
    const p = new URL(u);
    if (p.pathname === "/cdn-cgi/access/certs" && stub.jwks[p.host]) {
      return new Response(JSON.stringify({ keys: stub.jwks[p.host] }), { status: 200 });
    }
    if (p.origin === "https://api.stripe.com" && stub.stripe) {
      const r = stub.stripe(p, method);
      if (r) {
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body),
          { status: r.status || 200, headers: { "Content-Type": "application/json" } });
      }
    }
    throw new Error("unexpected network call in a test: " + p.origin + p.pathname);
  };
  stub.stripeCalls = () => stub.calls.filter((c) => c.url.startsWith("https://api.stripe.com"));
  stub.reset = () => { stub.calls.length = 0; };
  return stub;
}

// ── requests ────────────────────────────────────────────────────────────────
export function env(r2, over = {}) {
  return { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_ALLOWED_EMAILS: OWNER, BUNDLES: r2, ...over };
}

export function request(o = {}) {
  const host = o.host || "masspermits.com";
  const url = "https://" + host + (o.path || "/admin/api/mission") + (o.query || "");
  const h = new Headers();
  if (o.token !== undefined && o.token !== null) h.set("Cf-Access-Jwt-Assertion", o.token);
  if (o.cookie) h.set("Cookie", o.cookie);
  if (o.mission !== false) h.set("X-MassPermits-Mission", "1");
  if (o.site !== null) h.set("Sec-Fetch-Site", o.site || "same-origin");
  for (const [k, v] of Object.entries(o.headers || {})) h.set(k, v);
  return new Request(url, { method: o.method || "GET", headers: h });
}

export async function call(mod, o) {
  const res = await mod.onRequestGet({ request: request(o), env: o.env, now: o.now });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  return { status: res.status, headers: res.headers, text, body };
}

// ── fixtures ────────────────────────────────────────────────────────────────
export const PRICE_A = "price_TESTfeedmonthly";
export const PRICE_B = "price_TESTradaryearly";
export const PRICE_OTHER = "price_TESTotherproduct";
export const liveKey = () => "rk_" + "live_" + "T".repeat(24);

const FIRST = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan",
  "Morgan", "Parker", "Quinn", "Reese", "Riley", "Rowan", "Sawyer", "Skyler", "Taylor", "Wren", "Ellis", "Jules"];
const LAST = ["Testwood", "Fakerly", "Samplesen", "Mockford", "Placeholt"];
export const NAME_PARTS = Object.freeze({ first: FIRST.slice(), last: LAST.slice() });

export function rosterRows(n, now, over = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      email: "customer" + String(i + 1).padStart(2, "0") + "@example.com",
      name: FIRST[i % FIRST.length] + " " + LAST[i % LAST.length],
      customer: "cus_TEST" + String(i + 1).padStart(6, "0"),
      since: isoDay(now - (40 + i) * DAY),
      active: true,
      token: md5("synthetic-token-" + i),
      ...over,
    });
  }
  return rows;
}

// Town keys (from the shipped constant) for synthetic sources; the three
// outreach fixture towns are never used as sources.
export async function sourceTowns(n, skip = 0) {
  const { data } = await load();
  const avoid = new Set(["Adams", "Alford", "Ashfield", "Becket", "Foxborough"]);
  return data.TOWN_KEYS.filter((t) => !avoid.has(t)).slice(skip, skip + n);
}

// A healthy world: everything landed on time, everyone got Monday's email.
export async function healthyWorld(now, o = {}) {
  const r2 = new FakeR2();
  const n = o.roster ?? 5;
  const roster = rosterRows(n, now);
  const ranAt = o.ranAt ?? refreshLanded(now);
  const towns = await sourceTowns(o.sources ?? 30);
  const monthly = towns.slice(0, 2);
  const sources = {}, cadence = {}, newest = {}, sh = {};
  for (const t of towns) {
    const k = t + ", MA";
    sources[k] = 40;
    newest[k] = isoDay(ranAt - DAY);
    if (monthly.includes(t)) cadence[k] = "monthly";
    sh[k] = shRecord("ok", ranAt, { cadence: monthly.includes(t) ? "monthly" : undefined });
  }
  const status = {
    ok: true, degraded: false, error: null, traceback: null, runner: "github",
    ran_at: new Date(ranAt).toISOString(), count: 40 * towns.length,
    coverage: { live_sources: towns.length, expected_sources: towns.length, attempted_sources: towns.length,
      lost_sources: 0, rows: 40 * towns.length, disclose: false, monthly_sources: monthly.map((t) => t + ", MA") },
    sources, errors: {}, cadence, newest, contracts: { floor: 0 },
    source_health: { tracked: towns.length, by_state: { ok: towns.length }, dead: [], failing: [], collapsed: [],
      vanished: [], stale: [], events: [] },
  };
  r2.set("refresh-status.json", status, { uploaded: ranAt });
  r2.set("latest-weekly.zip", "PK-weekly-" + ranAt, { uploaded: ranAt + 60_000 });
  r2.set("latest-weekly.html", "<html>weekly " + ranAt + "</html>", { uploaded: ranAt + 60_000 });
  r2.set("latest-monthly.zip", "PK-monthly-" + ranAt, { uploaded: ranAt + 60_000 });
  r2.set("source-health.json", sourceHealth(sh, ranAt), { uploaded: ranAt + 30_000 });
  const due = mondayDue(now);
  const sendAt = o.sendAt ?? due + 3 * HOUR + 40 * 60_000; // 15:40Z
  if (o.mondayLog !== false) {
    r2.set("feed-send-log.json", [logEntry(sendAt, roster.map((r) => ({ to: r.email, ok: true })))],
      { uploaded: sendAt });
    r2.set("last-send-attempt.json", { at: new Date(sendAt - 60_000).toISOString(), subscribers: n, degraded: false },
      { uploaded: sendAt });
  }
  r2.set("subscribers.json", roster, { uploaded: now - 3 * DAY });
  r2.set("funnel-metrics.json", [
    funnelEntry(now - 12 * HOUR, n), funnelEntry(now - 7 * DAY, n), funnelEntry(now - 14 * DAY, n),
  ], { uploaded: now - 12 * HOUR });
  r2.set("delivery-log.json", [
    { at: new Date(now - 2 * DAY).toISOString(), to: roster[0].email, kind: "monthly", bundle: "latest-monthly.zip" },
    { at: new Date(now - 9 * DAY).toISOString(), to: roster[1 % n].email, kind: "weekly", bundle: "latest-weekly.zip" },
  ], { uploaded: now - 2 * DAY });
  r2.set("engagement.json", { at: new Date(now - DAY).toISOString(),
    counts: { cancelled: 0, "payment-failing": 0, unattributable: 0, warming: 0, "never-downloaded": 0, lapsed: 0, healthy: n },
    rows: roster.map((r) => ({ t8: r.token.slice(0, 8), state: "healthy" })) }, { uploaded: now - DAY });
  r2.set("probe-map.json", probeMap(towns, now - (o.registryAgeDays ?? 5) * DAY), { uploaded: now - (o.registryAgeDays ?? 5) * DAY });
  // email-keyed prefixes: customMetadata only is ever read
  r2.set("prospects/lead.one@example.com", "", { customMetadata: { stage: "sent", ts: String(now - DAY), trade: "roofing" } });
  r2.set("prospects/lead.two@example.com", "", { customMetadata: { stage: "sent", ts: String(now - 20 * DAY), trade: "hvac" } });
  r2.set("agent-prospects/agent.one@example.com", "", { customMetadata: { ts: String(now - 2 * DAY), town: "Barnstable", stage: "sent" } });
  r2.set("newsletter/reader.one@example.com", "", { customMetadata: { c: "1", un: "0", ts: String(now - 3 * DAY), tok: md5("newsletter-tok-1") } });
  r2.set("newsletter/reader.two@example.com", "", { customMetadata: { c: "0", un: "0", ts: String(now - 30 * DAY), tok: md5("newsletter-tok-2") } });
  if (o.outreach) r2.set("admin/outreach.json", o.outreach, { uploaded: now - DAY });
  const w = { r2, roster, towns, ranAt, due, sendAt, now, status, shSources: sh };
  w.statusUploaded = ranAt;
  // Re-write refresh-status.json and source-health.json after a mutation.
  w.save = (extra = {}) => {
    r2.set("refresh-status.json", w.status, { uploaded: w.statusUploaded });
    const doc = { ...sourceHealth(w.shSources, ranAt), ...extra };
    r2.set("source-health.json", doc, { uploaded: ranAt + 30_000 });
  };
  return w;
}

export function shRecord(state, ranAt, o = {}) {
  const r = {
    state, first_seen: "2026-03-01T14:00:00Z", last_good: new Date(o.lastGood ?? ranAt).toISOString(),
    last_good_rows: 40, consecutive_failures: state === "ok" ? 0 : 3, consecutive_low: o.consecutiveLow ?? 0,
    last_error: o.lastError ?? null, last_error_at: o.lastError ? new Date(ranAt).toISOString() : null,
    alerted_at: o.alertedAt ? new Date(o.alertedAt).toISOString() : null, alert_kind: o.alertKind ?? null,
    newest_seen: isoDay(ranAt - DAY), newest_advanced_at: new Date(ranAt).toISOString(),
    recent: [{ at: new Date(ranAt).toISOString(), rows: state === "ok" ? 40 : 0, ok: state === "ok", err: o.lastError ?? null }],
  };
  if (o.cadence) r.cadence = o.cadence;
  return r;
}

export function sourceHealth(sources, ranAt) {
  const by = {};
  for (const r of Object.values(sources)) by[r.state] = (by[r.state] || 0) + 1;
  return {
    version: 3, updated_at: new Date(ranAt).toISOString(), last_scored_at: new Date(ranAt).toISOString(),
    runs_seen: 120,
    totals: { by_state: by, dead: by.dead || 0, failing: by.failing || 0, stale: by.stale || 0,
      collapsed: by.collapsed || 0, vanished: by.vanished || 0, tracked: Object.keys(sources).length },
    sources,
  };
}

export function logEntry(at, sent, extra = {}) {
  return {
    at: new Date(at).toISOString(), subscribers: sent.length, sent,
    bundle_etag: md5("bundle-" + at), bundle_bytes: 120000,
    coverage: { live_sources: 30, expected_sources: 30 }, ...extra,
  };
}

export function funnelEntry(at, paying, over = {}) {
  return { at: new Date(at).toISOString(), paying, paying_total: paying, payment_failing: 0, no_customer_id: 0,
    newsletter: { confirmed: 1 }, prospects: { total: 2 }, ...over };
}

export function probeMap(towns, generated) {
  return {
    generated_at: new Date(generated).toISOString(),
    registry: {
      available: true, generated: new Date(generated).toISOString(),
      towns: towns.map((t) => ({ name: t, county: "Test", method: "html", feasibility: "live", already_live: true })),
    },
    sources: { note: "private endpoint detail that must never be read into a payload", endpoints: ["https://example.invalid/private"] },
  };
}

// The "refresh crashed" FAILURE SHAPE, exactly (R2 OBJECTS).
export function crashedStatus(ranAt, traceback = "Traceback (most recent call last): ... /home/runner/CANARYTB") {
  return {
    ok: false, degraded: false, error: "refresh crashed", traceback, runner: "github",
    ran_at: new Date(ranAt).toISOString(),
    coverage: null, count: null, sources: null, errors: null, cadence: null, newest: null, contracts: null,
  };
}

// source-health after a run the engine could not score.
export function unscored(sh, at, why = "refresh crashed") {
  return { ...sh, updated_at: new Date(at).toISOString(), runs_seen: (sh.runs_seen || 0) + 1,
    runs_unscored: 1, last_unscored_at: new Date(at).toISOString(), last_unscored_why: why };
}

// ── Stripe fixtures ─────────────────────────────────────────────────────────
// A tiny fake Stripe: lists served in pages, has_more honoured, both invoice
// line shapes. handler(url, method) -> {status, body}.
export function stripeFake(data, o = {}) {
  const pageSize = o.pageSize || 100;
  return (u, method) => {
    if (method !== "GET") return { status: 405, body: { error: { message: "GET only in fixtures" } } };
    const route = u.pathname;
    const status = u.searchParams.get("status");
    let list;
    if (route === "/v1/subscriptions") list = data.subscriptions || [];
    else if (route === "/v1/invoices" && status === "paid") list = data.invoices_paid || [];
    else if (route === "/v1/invoices" && status === "open") list = data.invoices_open || [];
    else if (route === "/v1/checkout/sessions") list = data.sessions || [];
    else if (route === "/v1/webhook_endpoints") list = data.webhooks || [];
    else return null;
    const fail = o.fail && o.fail(route, status);
    if (fail) return fail;
    const after = u.searchParams.get("starting_after");
    const start = after ? list.findIndex((x) => x.id === after) + 1 : 0;
    const page = list.slice(start, start + pageSize);
    const forcedMore = o.alwaysMore && o.alwaysMore(route, status);
    return { status: 200, body: { object: "list", data: page, has_more: forcedMore || start + pageSize < list.length,
      url: route } };
  };
}

export function subscription(i, customer, o = {}) {
  const nowS = Math.floor((o.now || Date.now()) / 1000);
  const item = {
    id: "si_TEST" + String(i).padStart(6, "0"),
    price: { id: o.price || PRICE_A, unit_amount: o.amount ?? 4900, currency: "usd",
      recurring: { interval: o.interval || "month", interval_count: 1 } },
    quantity: 1,
    current_period_end: o.periodEnd ?? nowS + 20 * 86400,
  };
  const items = [item];
  if (o.extraPrice) items.push({ id: "si_TESTx" + i, price: { id: o.extraPrice, unit_amount: 1000, currency: "usd",
    recurring: { interval: "month", interval_count: 1 } }, quantity: 1, current_period_end: item.current_period_end });
  return {
    id: "sub_TEST" + String(i).padStart(6, "0"), object: "subscription", customer,
    status: o.status || "active", cancel_at_period_end: !!o.cancel, trial_end: o.trialEnd ?? null,
    currency: "usd", items: { object: "list", data: items },
  };
}

export function stripeData(roster, now, o = {}) {
  const nowS = Math.floor(now / 1000);
  const subs = roster.map((r, i) => subscription(i + 1, r.customer, { now }));
  subs.push(subscription(900, "cus_TESTother01", { now, price: PRICE_OTHER, amount: 99900 }));
  return {
    subscriptions: subs,
    invoices_paid: [
      // older line shape
      { id: "in_TESTpaid0001", customer: roster[0].customer, status: "paid", amount_paid: 4900, amount_due: 4900,
        currency: "usd", created: nowS - 3 * 86400, attempt_count: 1, billing_reason: "subscription_create",
        lines: { data: [{ price: { id: PRICE_A } }] } },
      // newer line shape
      { id: "in_TESTpaid0002", customer: roster[1 % roster.length].customer, status: "paid", amount_paid: 4900,
        amount_due: 4900, currency: "usd", created: nowS - 10 * 86400, attempt_count: 1, billing_reason: "subscription_cycle",
        lines: { data: [{ pricing: { price_details: { price: PRICE_A } } }] } },
      // another product: never counted
      { id: "in_TESTother001", customer: "cus_TESTother01", status: "paid", amount_paid: 99900, amount_due: 99900,
        currency: "usd", created: nowS - 2 * 86400, attempt_count: 1, billing_reason: "subscription_cycle",
        lines: { data: [{ price: { id: PRICE_OTHER } }] } },
    ],
    invoices_open: o.openInvoices || [],
    sessions: [
      { id: "cs_TESTpack0001", customer: roster[2 % roster.length].customer, mode: "payment", amount_total: 2900,
        currency: "usd", created: nowS - 1 * 86400, invoice: null,
        line_items: { data: [{ price: { id: PRICE_B } }] } },
      { id: "cs_TESTother001", customer: "cus_TESTother01", mode: "payment", amount_total: 50000,
        currency: "usd", created: nowS - 1 * 86400, invoice: null,
        line_items: { data: [{ price: { id: PRICE_OTHER } }] } },
    ],
    webhooks: o.webhooks || [{ id: "we_TEST000001", status: "enabled",
      enabled_events: ["checkout.session.completed", "invoice.payment_failed", "customer.subscription.deleted"] }],
  };
}

// ── walkers used by the privacy assertions ──────────────────────────────────
export function allStrings(v, out = [], skipKey = "signed_in_as") {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out, skipKey));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) { out.push(k); if (k !== skipKey) allStrings(x, out, skipKey); }
  }
  return out;
}

export function allKeys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

export const FORBIDDEN_MEMBERS = ["err", "error", "traceback", "last_error", "last_unscored_why", "contracts",
  "etag", "httpEtag", "bundle_etag", "version"];

// ── the production-shaped quiet day (P1-15) ─────────────────────────────────
export const BLOCKED_ERR = "HTTP 403 from https://example.invalid/permits. That is an authorization " +
  "decision by the site; it is never retried.";

export async function quietWorld(now, o = {}) {
  const w = await healthyWorld(now, { roster: 20, sources: 60, registryAgeDays: 45, sendAt: o.sendAt });
  const extra = await sourceTowns(7, 60);
  const [v1, v2, v3, v4, oldDead, blocked, failing] = extra;
  w.names = { vanished: [v1, v2, v3, v4], oldDead, blocked, failing };
  const R = w.ranAt;
  for (const t of [v1, v2, v3, v4]) {
    w.shSources[t + ", MA"] = shRecord("vanished", R, { lastGood: now - 60 * DAY });
  }
  w.shSources[oldDead + ", MA"] = shRecord("dead", R, { lastGood: now - 20 * DAY, alertedAt: now - DAY,
    alertKind: "dead", lastError: "Read timed out after 30 s" });
  w.status.sources[oldDead + ", MA"] = 0;
  w.shSources[blocked + ", MA"] = shRecord("dead", R, { lastGood: now - 3 * DAY, lastError: BLOCKED_ERR });
  w.status.sources[blocked + ", MA"] = 0;
  w.status.errors[blocked + ", MA"] = BLOCKED_ERR;
  w.shSources[failing + ", MA"] = { ...shRecord("failing", R, { lastGood: R - DAY, lastError: "Read timed out" }),
    consecutive_failures: 1 };
  w.status.sources[failing + ", MA"] = 0;
  w.status.errors[failing + ", MA"] = "Read timed out";
  Object.assign(w.status.coverage, { live_sources: 60, expected_sources: 90, attempted_sources: 63,
    lost_sources: 3, disclose: true });
  w.status.source_health = { tracked: 67, by_state: { ok: 60, vanished: 4, dead: 2, failing: 1 },
    dead: [oldDead + ", MA", blocked + ", MA"], failing: [failing + ", MA"], collapsed: [],
    vanished: [v1, v2, v3, v4].map((t) => t + ", MA"), stale: [], events: [] };
  w.save();
  const eng = w.r2.json("engagement.json");
  eng.counts["never-downloaded"] = 1;
  eng.counts.healthy = 19;
  w.r2.set("engagement.json", eng, { uploaded: now - DAY });
  return w;
}

// ── per-file setup ──────────────────────────────────────────────────────────
export async function setup() {
  const m = await load();
  const stub = installFetch();
  const signer = makeSigner();
  stub.jwks[TEAM] = [signer.jwk];
  const owner = (over) => mint(signer, claims(over));
  const get = async (w, o = {}) => {
    if (o.cold !== false) await resetCaches();
    const e = env(w.r2, o.env);
    const now = o.now ?? w.now;
    const res = await call(m.mission, { ...o, env: e, now, token: o.token === undefined ? owner() : o.token });
    // P4-COR: every answered request is traced against the independent oracle.
    if ((res.status === 200 || res.status === 503) && o.oracle !== false && e.BUNDLES === w.r2 && !process.env.MISSION_ORACLE_OFF) oracleCheck(m, stub, w.r2, e, now, o.query, res);
    return res;
  };
  return { m, stub, signer, owner, get };
}

// ── P4-COR oracle hook ──────────────────────────────────────────────────────
// Town keys and aliases come from the public geometry file, not from the
// shipped constant, so the oracle's join is independent of _mission_data.js.
let oracleTowns = null;
function townsForOracle() {
  if (oracleTowns) return oracleTowns;
  const g = JSON.parse(fs.readFileSync(path.join(REPO, "admin", "mission-towns.json"), "utf8"));
  oracleTowns = setTowns(Object.keys(g.towns), g.aliases);
  return oracleTowns;
}
export const oracleRuns = { main: 0, map: 0 };
function oracleCheck(m, stub, r2, e, now, query, res) {
  const towns = townsForOracle();
  let bad;
  if (query === "?view=map") {
    oracleRuns.map++;
    bad = checkMap(oracleMap({ r2, now, towns }), res);
  } else if (!query) {
    oracleRuns.main++;
    if (res.status !== 200) bad = ["main.status: expected 200, got " + res.status];
    else bad = checkMain(oracleMain({ r2, env: e, now, handler: stub.stripe, towns,
      normalisePolicy: m.presend.normalisePolicy }), res.body);
  } else return;
  if (process.env.MISSION_ORACLE_LOG) {
    fs.appendFileSync(process.env.MISSION_ORACLE_LOG, JSON.stringify({ file: process.argv[1], tally: tally, runs: oracleRuns }) + "\n");
  }
  if (bad.length) throw new Error("P4-COR oracle disagrees with the route:\n  " + bad.join("\n  "));
}

// A 200 body that is clean of identifiers: no redactions, no red privacy line,
// no forbidden member, no fixture etag / bundle_etag (whole or first 8), no "@".
export function assertClean(assert, res, r2, label = "") {
  assert.equal(res.status, 200, label + " status");
  assert.equal(res.body.privacy_redactions, 0, label + " privacy_redactions");
  if (res.body.needs_you) {
    assert.ok(!res.body.needs_you.some((l) => l.id === "privacy"), label + " privacy line");
  }
  const keys = allKeys(res.body);
  for (const k of FORBIDDEN_MEMBERS) assert.ok(!keys.has(k), label + " member " + k);
  const tags = new Set(r2.etags());
  const log = r2.objects.has("feed-send-log.json") ? r2.json("feed-send-log.json") : [];
  for (const e of Array.isArray(log) ? log : []) if (e && e.bundle_etag) tags.add(e.bundle_etag);
  for (const t of tags) {
    assert.ok(!res.text.includes(t), label + " etag leaked");
    assert.ok(!res.text.includes(t.slice(0, 8)), label + " etag prefix leaked");
  }
  for (const s of allStrings(res.body)) assert.ok(!s.includes("@"), label + " '@' in " + JSON.stringify(s));
}

export function lineIds(body, severity) {
  return body.needs_you.filter((l) => !severity || l.severity === severity).map((l) => l.id);
}

export function tileOf(body, id) {
  return body.tiles.find((t) => t.id === id);
}

// ══ P4-COR: an INDEPENDENT oracle for Mission Control ═════════════════════
//
// It re-derives every number the two views emit from the rules in the build
// prompt (TIMING, MONDAY, TILES, FAILED TILE, NEEDS YOU, SOURCE TRIAGE, MAP,
// OUTREACH), reading the fixture world straight out of the FakeR2 (no op is
// recorded) and the fixture Stripe handler (no call is recorded). It does not
// import functions/api/_mission_data.js and copies none of its code. The only
// shipped code it uses is _presend.js normalisePolicy (the policy's own range
// rule, which the prompt names as the thing to reuse).
//
// The harness runs it after every route call a test makes through setup().get,
// so every fixture world in every test file (healthy, hostile, quiet day, the
// D drills, the map drills, the demo scenarios, the security worlds) is traced.

const MIN = 60_000;
const SKEW = HOUR; // P4-SEC F7: a time more than 1 h ahead is not a run or a send

// ── reading the fixture world (no op recorded) ─────────────────────────────
const failed = (r2, op, key) => r2.fail.has(op + ":" + key) || r2.fail.has(op + ":*");
function rawGet(r2, key) {
  if (failed(r2, "get", key)) return { state: "unreadable" };
  const o = r2.objects.get(key);
  if (!o) return { state: "absent" };
  try { return { state: "ok", value: JSON.parse(o.body), uploaded: o.uploaded.getTime(), size: o.size }; } catch (_) {
    return { state: "unreadable", uploaded: o.uploaded.getTime(), size: o.size };
  }
}
function rawHead(r2, key) {
  if (failed(r2, "head", key)) return { state: "unreadable" };
  const o = r2.objects.get(key);
  return o ? { state: "present", uploaded: o.uploaded.getTime(), size: o.size } : { state: "absent" };
}
function rawList(r2, prefix, pages = 3) {
  if (failed(r2, "list", prefix)) return { state: "unreadable" };
  const keys = [...r2.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  const cap = pages * r2.listLimit;
  return { state: "ok", items: keys.slice(0, cap).map((k) => ({ ...r2.objects.get(k).customMetadata })),
    truncated: keys.length > cap };
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const t = (v) => (typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const norm = (e) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const dollars = (c) => "$" + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// ── ENGINE TEXT RULE ───────────────────────────────────────────────────────
export function oErrKind(s) {
  if (typeof s !== "string" || s === "") return "other";
  const rules = [
    ["owner_name_gate", /owner name|rule 5/i],
    ["access_controlled", /\b40[13]\b|authori[sz]ation decision|login wall|requires_credentials|robots/i],
    ["no_rows", /returned \d+ rows|no rows|silently dead/i],
    ["timeout", /timed? ?out/i],
    ["http_error", /\bHTTP\b|\b[45]\d\d\b|URLError|connection|SSL/i],
    ["parse", /pars(e|ing|er)|column|header|decode|JSON/i],
  ];
  for (const [code, re] of rules) if (re.test(s)) return code;
  return "other";
}
export function oFailKind(st) {
  if (!isObj(st) || st.ok !== false || st.degraded === true) return null;
  const e = typeof st.error === "string" ? st.error : "";
  return /crashed/.test(e) ? "crash" : /^ABORT\b/.test(e) ? "gate" : "unknown";
}

// ── TIMING ─────────────────────────────────────────────────────────────────
// The most recent 09:00 UTC at or before now.
export const oRefreshDue = (now) => Math.floor((now - 9 * HOUR) / DAY) * DAY + 9 * HOUR;

export function oRefresh(now, head, status, zipUploaded) {
  if (head.state === "unreadable") return { state: "grey", grey: "unavailable", rule: "unavailable" };
  if (head.state === "present" && !isObj(status)) return { state: "grey", grey: "unavailable", rule: "unavailable" };
  if (!isObj(status)) return { state: "red", rule: "missing" };
  const ran = t(status.ran_at);
  if (!isNum(ran) || ran > now + SKEW) return { state: "red", rule: "missing" };
  if (now - ran > 36 * HOUR) return { state: "red", rule: "too_old" };
  const fk = oFailKind(status);
  if (fk) return { state: "red", rule: "failed", fail_kind: fk };
  const due = oRefreshDue(now);
  if (ran >= due) return status.degraded === true ? { state: "amber", rule: "reduced" } : { state: "green", rule: "landed" };
  if (isNum(zipUploaded) && zipUploaded >= due) return { state: "amber", rule: "bundles_shipped" };
  if (now < due + 8 * HOUR) return { state: "grey", grey: "pending", rule: "pending" };
  return { state: "red", rule: "not_landed" };
}

// The most recent send (dow, hour) at or before now, and that day's hold.
export function oSendDue(now, p) {
  const today = Math.floor(now / DAY) * DAY;
  const back = (new Date(now).getUTCDay() - p.send_dow + 7) % 7;
  let due = today - back * DAY + p.send_hour * HOUR;
  if (due > now) due -= 7 * DAY;
  return { due, hold: Math.floor(due / DAY) * DAY + p.hold_until_hour * HOUR };
}

// MONDAY. rows: roster rows or null (unreadable).
export function oMonday(now, p, log, attempt, rows) {
  const { due, hold } = oSendDue(now, p);
  const mondayDate = ymd(due);
  const entries = (Array.isArray(log) ? log : []).filter((e) => isObj(e) && isNum(t(e.at)) &&
    t(e.at) >= due && t(e.at) <= now + SKEW);
  const sent = (e) => (Array.isArray(e.sent) ? e.sent : []).filter(isObj);
  const okN = new Map();
  for (const e of entries) for (const s of sent(e)) if (s.ok) okN.set(norm(s.to), (okN.get(norm(s.to)) || 0) + 1);
  okN.delete("");
  const failedSet = new Set();
  for (const e of entries) {
    for (const s of sent(e)) {
      if (s.ok || !norm(s.to)) continue;
      const later = entries.some((x) => t(x.at) >= t(e.at) && sent(x).some((y) => y.ok && norm(y.to) === norm(s.to)));
      if (!later) failedSet.add(norm(s.to));
    }
  }
  const anyDelivered = okN.size > 0;
  const dups = [...okN.values()].filter((n) => n > 1).length;
  const skippedOnly = entries.length > 0 && !anyDelivered && entries.every((e) => e.skipped);
  const noResult = isObj(attempt) && isNum(t(attempt.at)) && t(attempt.at) >= due && entries.length === 0;
  const expected = [], joined = [];
  let newSince = 0;
  const active = rows ? rows.filter((r) => isObj(r) && r.email && r.active !== false) : [];
  for (const r of active) {
    const since = typeof r.since === "string" ? r.since.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(since) && since > mondayDate) newSince++;
    else if (since === mondayDate) { if (!okN.has(norm(r.email))) joined.push(r); }
    else expected.push(r);
  }
  const missing = anyDelivered ? expected.filter((r) => !okN.has(norm(r.email))) : [];
  let state, rule;
  if (failedSet.size) [state, rule] = ["red", "failed"];
  else if (missing.length) [state, rule] = ["red", "missing"];
  else if (skippedOnly) [state, rule] = ["red", "skipped"];
  else if (noResult) [state, rule] = ["red", "no_result"];
  else if (!anyDelivered && now >= hold) [state, rule] = ["red", "nothing"];
  else if (!anyDelivered) [state, rule] = ["grey", "pending"];
  else if (dups) [state, rule] = ["amber", "duplicate"];
  else if (!rows) [state, rule] = ["amber", "roster_unreadable"];
  else [state, rule] = ["green", "delivered"];
  return { state, rule, due, hold, mondayDate, delivered: okN.size, expected: rows ? expected.length : null,
    missing: missing.length, failed: failedSet.size, duplicates: dups, joined: joined.length, newSince, skippedOnly };
}

// ── STRIPE ─────────────────────────────────────────────────────────────────
const priceOf = (l) => (isObj(l) ? (isObj(l.price) ? l.price.id : undefined) ??
  (isObj(l.pricing) && isObj(l.pricing.price_details) ? l.pricing.price_details.price : undefined) : undefined);
const linesOf = (o, m) => (isObj(o) && isObj(o[m]) && Array.isArray(o[m].data) ? o[m].data : []);

function oList(handler, path, params) {
  if (typeof handler !== "function") return { state: "unavailable", items: [] };
  const items = [];
  let after = null;
  for (let page = 0; page < 3; page++) {
    const u = new URL("https://api.stripe.com" + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("limit", "100");
    if (after) u.searchParams.set("starting_after", after);
    const r = handler(u, "GET");
    if (!r || (r.status || 200) < 200 || (r.status || 200) > 299) return { state: "unavailable", items: [] };
    let body = r.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { return { state: "unavailable", items: [] }; } }
    if (!isObj(body) || !Array.isArray(body.data)) return { state: "unavailable", items: [] };
    items.push(...body.data);
    if (!body.has_more) return { state: "ok", items };
    const last = body.data[body.data.length - 1];
    if (!isObj(last) || typeof last.id !== "string" || !/^[a-z]+_[A-Za-z0-9]+$/.test(last.id)) return { state: "partial", items };
    after = last.id;
  }
  return { state: "partial", items };
}

export function oStripe(env, now, handler) {
  const key = env.STRIPE_READ_KEY;
  if (key === undefined || key === null || key === "") return { state: "not-connected", why: "key" };
  if (typeof key !== "string" || !/^rk_live_[A-Za-z0-9]{10,}$/.test(key)) return { state: "refused" };
  const prices = new Set(String(env.MASSPERMITS_PRICE_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!prices.size) return { state: "not-connected", why: "prices" };
  const since = String(Math.floor((now - 30 * DAY) / 1000));
  const L = {
    subscriptions: oList(handler, "/v1/subscriptions", { status: "all" }),
    invoices_paid: oList(handler, "/v1/invoices", { status: "paid", "created[gte]": since }),
    invoices_open: oList(handler, "/v1/invoices", { status: "open" }),
    sessions: oList(handler, "/v1/checkout/sessions", { status: "complete", "created[gte]": since, "expand[]": "data.line_items" }),
    webhooks: oList(handler, "/v1/webhook_endpoints", {}),
  };
  const mine = (o, m) => linesOf(o, m).some((l) => prices.has(priceOf(l)));
  const subs = L.subscriptions.items.filter((s) => mine(s, "items")).map((s) => {
    const its = linesOf(s, "items");
    const ends = its.map((i) => i && i.current_period_end).filter(isNum);
    const mp = its.filter((i) => prices.has(priceOf(i)));
    let monthly = 0, amount = 0;
    for (const i of mp) {
      const unit = isObj(i.price) && isNum(i.price.unit_amount) ? i.price.unit_amount : 0;
      const q = isNum(i.quantity) ? i.quantity : 1;
      const rec = isObj(i.price) && isObj(i.price.recurring) ? i.price.recurring : {};
      const per = { month: 1, year: 1 / 12, week: 52 / 12, day: 365 / 12 }[rec.interval] || 0;
      amount += unit * q;
      monthly += (unit * q * per) / (rec.interval_count || 1);
    }
    return { id: s.id, customer: typeof s.customer === "string" ? s.customer : isObj(s.customer) ? s.customer.id : null,
      status: s.status, cancel: s.cancel_at_period_end === true, cpe: ends.length ? Math.min(...ends) : null,
      monthly, amount, other: its.map(priceOf).filter((p) => p && !prices.has(p)).length };
  });
  const inv = (x) => x.items.filter((i) => mine(i, "lines"));
  const hooks = { "invoice.payment_failed": false, "customer.subscription.deleted": false };
  for (const w of L.webhooks.items) {
    if (!isObj(w) || w.status === "disabled" || !Array.isArray(w.enabled_events)) continue;
    for (const ev of Object.keys(hooks)) if (w.enabled_events.includes(ev) || w.enabled_events.includes("*")) hooks[ev] = true;
  }
  const states = Object.values(L).map((x) => x.state);
  return {
    state: states.includes("unavailable") ? "unavailable" : states.includes("partial") ? "partial" : "ok",
    sec: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.state])),
    subs, paid: inv(L.invoices_paid), open: inv(L.invoices_open),
    sessions: L.sessions.items.filter((c) => mine(c, "line_items")),
    hooks: L.webhooks.state === "unavailable" ? null : hooks,
  };
}

// ── SOURCE TRIAGE ──────────────────────────────────────────────────────────
const TOWNS = { set: null, aliases: null };
export function oJoin(key, towns) {
  if (typeof key !== "string") return null;
  const s = key.replace(/,\s*MA\s*$/i, "").trim();
  if (towns.set.has(s)) return s;
  const a = towns.aliases[s.toLowerCase()];
  return a && towns.set.has(a) ? a : null;
}

export function oTriage(now, shSources, errors, towns) {
  const recs = isObj(shSources) ? shSources : {};
  const keys = new Set(Object.keys(recs).filter((k) => isObj(recs[k]) && recs[k].state !== "ok"));
  if (isObj(errors)) for (const k of Object.keys(errors)) keys.add(k);
  const groups = { sources_blocked: [], sources_vanished: [], sources_failing: [], sources_stale: [], sources_down: [], sources_down_long: [] };
  const list = [];
  for (const k of keys) {
    const rec = isObj(recs[k]) ? recs[k] : null;
    const inErr = isObj(errors) && Object.prototype.hasOwnProperty.call(errors, k);
    const state = inErr && (!rec || rec.state === "ok") ? "failing" : rec ? rec.state : "unknown";
    const ek = inErr ? oErrKind(errors[k]) : rec ? oErrKind(rec.last_error) : "other";
    const sinceRaw = rec ? rec.last_good || rec.first_seen : null;
    const since = typeof sinceRaw === "string" && isNum(t(sinceRaw)) ? new Date(t(sinceRaw)).toISOString().slice(0, 10) : null;
    const town = oJoin(k, towns) || k.replace(/,\s*MA$/i, "");
    let id = null, recent = false;
    if (ek === "access_controlled") id = "sources_blocked";
    else if (state === "vanished") id = "sources_vanished";
    else if (state === "failing") id = "sources_failing";
    else if (state === "stale") id = "sources_stale";
    else if (state === "dead") {
      recent = !isNum(t(sinceRaw)) || now - t(sinceRaw) <= 7 * DAY;
      id = recent ? "sources_down" : "sources_down_long";
    } else if (state === "collapsed") {
      recent = !Number.isInteger(rec.consecutive_low) || rec.consecutive_low <= 3 + 7;
      id = recent ? "sources_down" : "sources_down_long";
    }
    if (id) groups[id].push(town);
    list.push({ town, state, since, ek, recent });
  }
  return { groups, list };
}

// ── MAP ────────────────────────────────────────────────────────────────────
export function oOutreach(got) {
  if (got.state === "absent") return { state: "absent", towns: {}, ignored: [] };
  if (got.state !== "ok" || (got.size || 0) > 64 * 1024 || !isObj(got.value) || !isObj(got.value.towns)) {
    return { state: "unreadable", towns: {}, ignored: [] };
  }
  return { state: "present", raw: got.value.towns };
}

export function oMap(now, status, shSources, registryTowns, outreach, towns) {
  const st = isObj(status) ? status : {};
  const rowsBy = isObj(st.sources) ? st.sources : {};
  const errors = isObj(st.errors) ? st.errors : {};
  const cadBy = isObj(st.cadence) ? st.cadence : {};
  const newestBy = isObj(st.newest) ? st.newest : {};
  const recs = isObj(shSources) ? shSources : {};
  const prodKeys = new Set([...Object.keys(rowsBy), ...Object.keys(errors), ...Object.keys(recs)]);
  const byTown = {}, unmatched = new Set();
  for (const k of prodKeys) {
    const town = oJoin(k, towns);
    if (!town) { unmatched.add(k.replace(/,\s*MA\s*$/i, "").trim()); continue; }
    (byTown[town] = byTown[town] || []).push(k);
  }
  const keyFacts = (k) => {
    const rec = isObj(recs[k]) ? recs[k] : null;
    const rows = isNum(rowsBy[k]) ? rowsBy[k] : null;
    const inErr = Object.prototype.hasOwnProperty.call(errors, k);
    const bad = ["dead", "failing", "collapsed", "vanished", "stale"];
    const dead = inErr || (rec ? bad.includes(rec.state) : !(rows > 0));
    const live = !dead && (rec ? rec.state === "ok" : rows > 0);
    const cad = cadBy[k] || (rec && rec.cadence) || null;
    const ek = inErr ? oErrKind(errors[k]) : rec && rec.state !== "ok" ? oErrKind(rec.last_error) : null;
    return { dead, live, rows, newest: typeof newestBy[k] === "string" ? newestBy[k].slice(0, 10) : null,
      state: rec ? rec.state : null, cadence: cad, ek };
  };
  // outreach: exact key first, then alias
  const out = {}, ignored = [];
  if (outreach.state === "present") {
    for (const [name, v] of Object.entries(outreach.raw)) {
      const key = towns.set.has(name) ? name : oJoin(name, towns);
      if (!key) { ignored.push(name); continue; }
      if (!isObj(v)) continue;
      out[key] = {
        outreach: ["planned", "sent", "answered", "declined"].includes(v.outreach) ? v.outreach : null,
        since: typeof v.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.since) ? v.since.slice(0, 10) : null,
        locked: typeof v.locked === "boolean" ? v.locked : null,
      };
    }
  }
  const counts = { dead: 0, weekly: 0, monthly: 0, answered: 0, sent: 0, locked: 0, none: 0 };
  const res = {};
  let reg = 0, ownerList = 0;
  for (const town of towns.keys) {
    const ks = byTown[town] || [];
    const fs = ks.map(keyFacts);
    const p = fs.length ? { dead: fs.some((f) => f.dead), live: !fs.some((f) => f.dead) && fs.some((f) => f.live),
      one: fs.length === 1 ? fs[0] : null, cadence: (fs.find((f) => f.live) || {}).cadence || null } : null;
    const r = registryTowns[town] || null;
    const o = out[town] || null;
    if (r && r.method === "opengov") reg++;
    if (o && o.locked === true) ownerList++;
    let code, lk = null;
    if ((p && p.dead) || (r && r.feasibility === "built_not_wired")) { code = "dead"; if (!(p && p.dead)) lk = "paused"; }
    else if (p && p.live) code = p.cadence ? "monthly" : "weekly";
    else if (o && (o.outreach === "answered" || o.outreach === "declined")) code = "answered";
    else if (o && o.outreach === "sent") code = "sent";
    else if ((o && o.locked === true) || (!(o && o.locked === false) && r && r.method === "opengov")) {
      code = "locked"; lk = o && o.locked === true ? "owner" : "opengov";
    } else code = "none";
    counts[code]++;
    res[town] = { code, multi: fs.length > 1, facts: p && p.one ? p.one : null, lk,
      o: o ? o.outreach : null, os: o ? o.since : null, planned: !!(o && o.outreach === "planned") };
  }
  return { counts, towns: res, unmatched: [...unmatched].sort(), ignored, opengov: { registry: reg, owner_list: ownerList } };
}

// ── the whole default view, as numbers and codes ───────────────────────────
export function oracleMain({ r2, env, now, handler, towns, normalisePolicy }) {
  const policyRaw = rawGet(r2, "presend-policy.json");
  const p = normalisePolicy(policyRaw.state === "ok" ? policyRaw.value : null);
  const statusHead = rawHead(r2, "refresh-status.json");
  const statusGot = rawGet(r2, "refresh-status.json");
  const status = statusGot.state === "ok" ? statusGot.value : null;
  const logGot = rawGet(r2, "feed-send-log.json");
  const attemptGot = rawGet(r2, "last-send-attempt.json");
  const zip = rawHead(r2, "latest-weekly.zip");
  const html = rawHead(r2, "latest-weekly.html");
  const roster = rawGet(r2, "subscribers.json");
  const rosterRows = roster.state === "ok" && Array.isArray(roster.value) ? roster.value.filter(isObj) : null;
  const active = rosterRows ? rosterRows.filter((r) => r.email && r.active !== false) : null;
  const funnelGot = rawGet(r2, "funnel-metrics.json");
  const funnel = funnelGot.state === "ok" && Array.isArray(funnelGot.value) ? funnelGot.value.filter(isObj) : null;
  const dl = rawGet(r2, "delivery-log.json");
  const eng = rawGet(r2, "engagement.json");
  const outreachGot = rawGet(r2, "admin/outreach.json");
  const probe = rawHead(r2, "probe-map.json");
  const shHead = rawHead(r2, "source-health.json");
  const shGot = rawGet(r2, "source-health.json");
  const shState = shHead.state === "unreadable" || (shHead.state === "present" && shGot.state !== "ok") ? "unreadable"
    : shHead.state === "absent" ? "absent" : "ok";
  const shSources = shState === "ok" && isObj(shGot.value) && isObj(shGot.value.sources) ? shGot.value.sources : {};
  const lists = { prospects: rawList(r2, "prospects/"), agents: rawList(r2, "agent-prospects/"), newsletter: rawList(r2, "newsletter/") };
  const S = oStripe(env, now, handler);
  const on = ["ok", "partial", "unavailable"].includes(S.state);
  const usable = (sec) => on && S.sec[sec] !== "unavailable";
  const partial = (sec) => on && S.sec[sec] === "partial";
  const entitled = usable("subscriptions") ? S.subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status)) : [];

  const E = { tiles: {}, lines: [], detail: {} };
  const tile = (id, state, value, extra = {}) => { E.tiles[id] = { state, value: state === "grey" && extra.grey !== "unverified" ? null : value, ...extra }; };

  // paying + paying_drop (like with like: roster now vs the funnel entry nearest now - 7 d)
  let drop = null;
  if (active && funnel && funnel.length) {
    const target = now - 7 * DAY;
    const withT = funnel.filter((e) => isNum(t(e.at)) && isNum(e.paying));
    withT.sort((a, b) => Math.abs(t(a.at) - target) - Math.abs(t(b.at) - target));
    if (withT.length && active.length < withT[0].paying) drop = { was: withT[0].paying, now: active.length };
  }
  if (usable("subscriptions")) {
    const trials = entitled.filter((s) => s.status === "trialing").length;
    tile("paying", drop ? "amber" : "green", entitled.length, { source: "stripe", trials, atLeast: partial("subscriptions") });
  } else if (active) tile("paying", drop ? "amber" : "green", active.length, { source: "r2", subExact: "roster: feed and radar mixed, trials included" });
  else tile("paying", "grey", null, { grey: "unavailable", source: "r2" });

  // revenue
  const since30 = now - 30 * DAY, since7 = now - 7 * DAY;
  if (!on) tile("revenue", "grey", null, { grey: "not-connected", source: "none" });
  else if (!usable("invoices_paid") || !usable("sessions")) tile("revenue", "grey", null, { grey: "unavailable", source: "stripe" });
  else {
    const gross = S.paid.filter((i) => (i.created || 0) * 1000 >= since30).reduce((a, i) => a + (i.amount_paid || 0), 0) +
      S.sessions.filter((c) => c.mode === "payment" && !c.invoice && (c.created || 0) * 1000 >= since30).reduce((a, c) => a + (c.amount_total || 0), 0);
    const rate = usable("subscriptions") ? entitled.filter((s) => s.status !== "trialing").reduce((a, s) => a + s.monthly, 0) : null;
    tile("revenue", "green", gross, { source: "stripe", rate,
      atLeast: partial("invoices_paid") || partial("sessions") || partial("subscriptions") });
  }

  // renewals
  const due14 = entitled.filter((s) => isNum(s.cpe) && s.cpe * 1000 >= now && s.cpe * 1000 <= now + 14 * DAY);
  const ending = due14.filter((s) => s.cancel).length;
  if (!on) tile("renewals", "grey", null, { grey: "not-connected", source: "none" });
  else if (!usable("subscriptions")) tile("renewals", "grey", null, { grey: "unavailable", source: "stripe" });
  else tile("renewals", ending ? "amber" : "green", due14.length, { source: "stripe", ending, atLeast: partial("subscriptions") });

  // failed (FAILED TILE)
  if (S.state === "ok") {
    const pd = S.subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length;
    const op = S.open.filter((i) => (i.attempt_count || 0) > 0).length;
    tile("failed", pd + op > 0 ? "red" : "green", pd + op, { source: "stripe", pd, op });
  } else if (rosterRows) {
    const n = rosterRows.filter((r) => r.payment_failing).length;
    if (n) tile("failed", "red", n, { source: "r2" });
    else tile("failed", "grey", 0, { grey: "unverified", source: "r2", subExact: "webhook flags only; registration not verified" });
  } else tile("failed", "grey", null, { grey: "unavailable", source: "r2" });

  // monday
  const M = oMonday(now, p, logGot.state === "ok" ? logGot.value : null, attemptGot.state === "ok" ? attemptGot.value : null, rosterRows);
  // An unreadable send log: nothing can be judged. An unreadable attempt file
  // matters only where it could turn "not yet" into the "started, no result"
  // red; every red the log proves on its own stays red (COR-11).
  const mUnread = logGot.state === "unreadable" || (attemptGot.state === "unreadable" && M.state === "grey");
  if (mUnread) tile("monday", "grey", null, { grey: "unavailable", source: "r2" });
  else if (M.state === "grey") tile("monday", "grey", null, { grey: "pending", source: "r2", subExact: "not sent yet; recent sends 15:20-18:46 UTC" });
  else tile("monday", M.state, M.delivered, { source: "r2" });

  // refresh
  const R = oRefresh(now, statusHead, status, zip.state === "present" ? zip.uploaded : null);
  const count = isObj(status) && isNum(status.count) ? status.count : null;
  if (R.state === "grey") tile("refresh", "grey", null, { grey: R.grey, source: "r2", ...(R.grey === "pending" ? { subExact: "not landed yet, usually 13:00-16:00 UTC" } : {}) });
  else tile("refresh", R.state, count, { source: "r2" });

  // sales
  if (dl.state === "ok" && Array.isArray(dl.value)) {
    const recent = dl.value.filter((e) => isObj(e) && t(e.at) >= since7);
    const money = usable("invoices_paid") && usable("sessions") ? {
      newSub: S.paid.filter((i) => i.billing_reason === "subscription_create" && (i.created || 0) * 1000 >= since7).reduce((a, i) => a + (i.amount_paid || 0), 0),
      pack: S.sessions.filter((c) => c.mode === "payment" && !c.invoice && (c.created || 0) * 1000 >= since7).reduce((a, c) => a + (c.amount_total || 0), 0),
    } : null;
    tile("sales", "green", recent.filter((e) => e.kind === "monthly").length, { source: "r2", money,
      atLeast: partial("invoices_paid") || partial("sessions") });
    E.detail.sales = { new_checkouts: E.tiles.sales.value, renewal_deliveries: recent.filter((e) => e.kind === "weekly").length,
      gross_cents: money ? money.newSub + money.pack : null, new_subscription_cents: money ? money.newSub : null, pack_cents: money ? money.pack : null };
  } else { tile("sales", "grey", null, { grey: "unavailable", source: "r2" }); E.detail.sales = null; }

  // signups
  if (Object.values(lists).every((l) => l.state === "ok")) {
    const ts = (m) => { const v = m && m.ts; if (typeof v === "number") return v > 1e12 ? v : v * 1000;
      if (typeof v !== "string" || !v) return NaN; if (/^\d+$/.test(v)) { const n = Number(v); return n > 1e12 ? n : n * 1000; } return Date.parse(v); };
    const recent = (m) => isNum(ts(m)) && ts(m) >= since7 && ts(m) <= now + SKEW;
    const pr = lists.prospects.items.filter(recent), ag = lists.agents.items.filter(recent);
    const nlAll = lists.newsletter.items.filter((m) => m.un !== "1");
    const nl = nlAll.filter(recent);
    const byDay = {};
    for (let d = Math.floor(since7 / DAY) * DAY; d <= now; d += DAY) byDay[ymd(d)] = 0;
    for (const m of [...pr, ...ag, ...nl]) byDay[ymd(Math.min(ts(m), now))]++;
    const trades = {};
    for (const m of pr) { const k = typeof m.trade === "string" && m.trade ? m.trade.toLowerCase() : "unknown"; trades[k] = (trades[k] || 0) + 1; }
    const atLeast = Object.values(lists).some((l) => l.truncated);
    tile("signups", "green", pr.length + ag.length + nl.length, { source: "r2", split: [pr.length, ag.length, nl.length], atLeast });
    E.detail.signups = { prospects: pr.length, agents: ag.length, newsletter_new: nl.length,
      newsletter_confirmed: nlAll.filter((m) => m.c === "1").length, newsletter_pending: nlAll.filter((m) => m.c !== "1").length,
      at_least: atLeast, by_day: byDay, trades };
  } else { tile("signups", "grey", null, { grey: "unavailable", source: "r2" }); E.detail.signups = null; }

  // ── NEEDS YOU ──
  const L = (id, severity, extra = {}) => E.lines.push({ id, severity, ...extra });
  const tr = oTriage(now, shSources, isObj(status) ? status.errors : null, towns);
  const onMonday = new Date(now).getUTCDay() === 1;
  const mondaySend = Math.floor(now / DAY) * DAY + p.send_hour * HOUR;
  const deliveredSinceSend = (Array.isArray(logGot.value) ? logGot.value : []).some((e) => isObj(e) &&
    t(e.at) >= mondaySend && t(e.at) <= now + SKEW && Array.isArray(e.sent) && e.sent.some((s) => s && s.ok));
  const T = E.tiles;
  if (T.refresh.state === "red") L("refresh", "red", { rule: R.rule, mondayClause: R.rule === "failed" && onMonday && !deliveredSinceSend });
  if (T.monday.state === "red") L("monday", "red", { rule: M.rule });
  if (T.failed.state === "red") L("failed_payments", "red", { n: T.failed.value });
  if (T.refresh.state === "amber") L("refresh", "amber", { rule: R.rule });
  if (T.monday.state === "amber") L("monday", "amber", { rule: M.rule });
  if (usable("subscriptions") && rosterRows) {
    const onRoster = new Set(rosterRows.map((r) => r.customer).filter(Boolean));
    const n = entitled.filter((s) => s.customer && !onRoster.has(s.customer)).length;
    if (n) L("paid_not_served", "amber", { n });
  }
  if (tr.groups.sources_down.length) L("sources_down", "amber", { towns: tr.groups.sources_down });
  const unread = Object.entries(T).filter(([, x]) => x.state === "grey" && x.grey === "unavailable").map(([id]) => id);
  if (unread.length || shState === "unreadable") L("unreadable", "amber", { tiles: unread, sourceHealth: shState === "unreadable" });
  if (T.paying.state === "amber") L("paying_drop", "amber", { was: drop.was, now: drop.now });
  if (T.renewals.state === "amber") L("renewals_ending", "amber", { n: ending });
  if (S.state === "ok" && active) {
    const paid = new Set(entitled.map((s) => s.customer).filter(Boolean));
    const n = active.filter((r) => r.customer && !paid.has(r.customer)).length;
    if (n) L("served_not_paid", "amber", { n });
  }
  if (usable("subscriptions")) {
    const n = new Set(S.subs.filter((s) => s.other > 0).map((s) => s.customer || s.id)).size;
    if (n) L("unknown_price", "amber", { n });
  }
  if (on && S.hooks && Object.values(S.hooks).some((v) => !v)) L("webhook_events", "amber");
  if (funnel && funnel.length && isNum(funnel[0].no_customer_id) && funnel[0].no_customer_id > 0) L("no_customer_id", "amber", { n: funnel[0].no_customer_id });
  if (html.state === "present") {
    const zt = zip.state === "present" ? zip.uploaded : NaN;
    if (now - html.uploaded > 8 * DAY) L("portal", "amber", { why: "stale" });
    else if (isNum(zt) && Math.abs(html.uploaded - zt) > 15 * MIN) L("portal", "amber", { why: "drift" });
  }
  if (S.state === "refused") L("stripe_refused", "amber");
  // OUTREACH: absent, or present and readable, or anything else is unreadable
  // (a read that throws, over 64 KB, not JSON, towns not an object).
  const outState = outreachGot.state === "absent" ? "absent" : oOutreach(outreachGot).state === "present" ? "present" : "unreadable";
  if (outState === "unreadable") L("outreach_unreadable", "amber");
  const cov = isObj(status) && isObj(status.coverage) ? status.coverage : null;
  if (cov && cov.disclose === true) L("coverage_disclosed", "known");
  for (const id of ["sources_blocked", "sources_vanished", "sources_down_long", "sources_failing", "sources_stale"]) {
    if (tr.groups[id].length) L(id, "known", { towns: tr.groups[id] });
  }
  if (probe.state === "present" && now - probe.uploaded > 30 * DAY) L("registry_age", "known");
  if (S.state === "not-connected") L("stripe_not_connected", "known");
  if (S.state === "partial") L("stripe_partial", "known");
  if (outState === "absent") L("outreach_absent", "known");
  const ec = eng.state === "ok" && isObj(eng.value) && isObj(eng.value.counts) ? eng.value.counts : null;
  if (ec && ((ec["never-downloaded"] || 0) > 0 || (ec.lapsed || 0) > 0)) L("engagement", "known");
  const firstOf = (sev) => E.lines.find((l) => l.severity === sev);
  E.headline = firstOf("red") ? "red" : firstOf("amber") ? "amber" : "clear";

  // ── detail counts ──
  E.detail.customers = { count: active ? active.length : null,
    cancelled: rosterRows ? rosterRows.filter((r) => r.cancelled || r.active === false).length : null };
  E.detail.monday = mUnread ? { delivered: null, expected: null, missing: 0, failed: 0 } :
    { delivered: M.delivered, expected: M.expected, missing: M.missing, failed: M.failed, duplicates: M.duplicates,
      joined: M.joined, new_since_monday: M.newSince, monday_date: M.mondayDate, skipped_only: M.skippedOnly };
  E.detail.refresh = { fail_kind: oFailKind(status), count,
    coverage: cov ? { live_sources: cov.live_sources ?? null, expected_sources: cov.expected_sources ?? null,
      attempted_sources: cov.attempted_sources ?? null, lost_sources: cov.lost_sources ?? null, rows: cov.rows ?? null,
      disclose: cov.disclose === true } : null, sources: tr.list };
  E.detail.renewals = usable("subscriptions") ? due14.length : null;
  E.detail.failed_rows = (usable("subscriptions") ? S.subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length : 0) +
    (usable("invoices_open") ? S.open.filter((i) => (i.attempt_count || 0) > 0).length : 0) +
    (rosterRows ? rosterRows.filter((r) => r.payment_failing).length : 0);
  E.detail.engagement = ec;
  E.detail.setup = { stripe: on ? "ok" : S.state === "refused" ? "refused" : "not-connected", outreach: outState,
    events: S.hooks ? { ...S.hooks } : null };
  E.stripe = S;
  return E;
}

export function oracleMap({ r2, now, towns }) {
  const shHead = rawHead(r2, "source-health.json");
  const pmHead = rawHead(r2, "probe-map.json");
  const rs = rawGet(r2, "refresh-status.json");
  // A head or get that throws on the three objects the map is built from: 503.
  if (shHead.state === "unreadable" || pmHead.state === "unreadable" || rs.state === "unreadable" && failed(r2, "get", "refresh-status.json") ||
    (shHead.state === "present" && failed(r2, "get", "source-health.json")) ||
    (pmHead.state === "present" && failed(r2, "get", "probe-map.json"))) return { status: 503 };
  const sh = shHead.state === "present" ? rawGet(r2, "source-health.json") : { state: "absent" };
  const pm = pmHead.state === "present" ? rawGet(r2, "probe-map.json") : { state: "absent" };
  const shSources = sh.state === "ok" && isObj(sh.value) && isObj(sh.value.sources) ? sh.value.sources : {};
  const regTowns = {};
  const reg = pm.state === "ok" && isObj(pm.value) && isObj(pm.value.registry) && Array.isArray(pm.value.registry.towns) ? pm.value.registry.towns : [];
  for (const x of reg) { const k = isObj(x) ? oJoin(x.name, towns) : null; if (k) regTowns[k] = { method: x.method, feasibility: x.feasibility }; }
  const og = rawGet(r2, "admin/outreach.json");
  const outreach = og.state === "unreadable" && !r2.objects.has("admin/outreach.json") ? { state: "unreadable" } : oOutreach(og);
  const m = oMap(now, rs.state === "ok" ? rs.value : null, shSources, regTowns, outreach, towns);
  m.status = 200;
  return m;
}

export function setTowns(keys, aliases) {
  TOWNS.set = new Set(keys);
  TOWNS.aliases = aliases;
  TOWNS.keys = keys;
  return TOWNS;
}

// ── comparing the oracle with the route ────────────────────────────────────
// Every comparison is tallied by item (for the P4-COR trace table); every
// disagreement is collected, and the caller fails the test with all of them.
export const tally = {};
function cmp(bad, item, expected, got) {
  const ok = JSON.stringify(expected) === JSON.stringify(got);
  const e = tally[item] || (tally[item] = { n: 0, bad: 0 });
  e.n++;
  if (!ok) { e.bad++; bad.push(item + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(got)); }
}
const pl = (n, w, many) => n + " " + (n === 1 ? w : many || w + "s");
const named = (text) => {
  const seg = text.slice(text.indexOf(": ") + 2);
  const cut = seg.indexOf(". ");
  return (cut >= 0 ? seg.slice(0, cut) : seg.replace(/\.$/, ""));
};

export function checkMain(E, body) {
  const bad = [];
  const tiles = Object.fromEntries(body.tiles.map((x) => [x.id, x]));
  cmp(bad, "tiles.ids", ["paying", "revenue", "renewals", "failed", "monday", "refresh", "sales", "signups"], body.tiles.map((x) => x.id));
  for (const [id, x] of Object.entries(E.tiles)) {
    const g = tiles[id];
    cmp(bad, "tile." + id + ".state", [x.state, x.grey ?? null], [g.state, g.grey ?? null]);
    cmp(bad, "tile." + id + ".value", x.value, g.value);
    cmp(bad, "tile." + id + ".source", x.source, g.source);
    if (x.subExact) cmp(bad, "tile." + id + ".sub", x.subExact, g.sub);
    if (x.state === "grey") continue;
    const sub = g.sub || "";
    if (id === "paying" && x.source === "stripe") {
      cmp(bad, "tile.paying.sub", (x.atLeast ? "at least " + x.value + "; " : "") + pl(x.trials, "trial") + " included", sub);
    }
    if (id === "revenue") {
      cmp(bad, "tile.revenue.sub", (x.atLeast ? "at least; " : "") + "list-price run rate " +
        (x.rate === null ? "not available" : dollars(x.rate)) + (x.rate === null ? "" : "/mo"), sub);
    }
    if (id === "renewals") cmp(bad, "tile.renewals.sub", (x.atLeast ? "at least; " : "") + (x.ending ? x.ending + " set to cancel" : "none set to cancel"), sub);
    if (id === "failed" && x.source === "stripe") cmp(bad, "tile.failed.sub", pl(x.pd, "subscription") + " past due, " + pl(x.op, "open invoice") + " retried", sub);
    if (id === "sales" && x.money) {
      cmp(bad, "tile.sales.sub", (x.atLeast ? "at least; " : "") + dollars(x.money.newSub + x.money.pack) + " gross: " +
        dollars(x.money.newSub) + " new subscriptions, " + dollars(x.money.pack) + " packs", sub);
    }
    if (id === "signups") {
      cmp(bad, "tile.signups.sub", (x.atLeast ? "at least; " : "") + "prospects " + x.split[0] + " · agents " + x.split[1] + " · newsletter " + x.split[2], sub);
    }
  }
  // needs you: ids, severities, order, and the facts inside each sentence
  const got = body.needs_you.filter((l) => l.id !== "privacy");
  cmp(bad, "needs_you.ids", E.lines.map((l) => l.id + "/" + l.severity), got.map((l) => l.id + "/" + l.severity));
  cmp(bad, "headline.state", E.headline, body.headline.state);
  if (E.headline === "clear") cmp(bad, "headline.text", "Nothing is wrong that this page can see.", body.headline.text);
  else cmp(bad, "headline.text", (got.find((l) => l.severity === E.headline) || {}).text, body.headline.text);
  for (const l of E.lines) {
    const g = got.find((x) => x.id === l.id && x.severity === l.severity);
    if (!g) continue;
    if (l.id === "refresh" && l.severity === "red") {
      const want = { missing: /never reported/, too_old: /more than 36 hours/, not_landed: /has not landed by 17:00 UTC/,
        failed: /The data refresh (crashed|was stopped by its quality gate|failed)\./ }[l.rule];
      cmp(bad, "line.refresh.rule", true, want.test(g.text));
      cmp(bad, "line.refresh.monday_clause", l.mondayClause, g.text.includes("Monday's email will not send while this is the latest run."));
    }
    if (l.id === "monday" && l.severity === "red") {
      const n = { failed: E.detail.monday.failed, missing: E.detail.monday.missing }[l.rule];
      if (n !== undefined) cmp(bad, "line.monday.count", true, g.text.includes(pl(n, l.rule === "failed" ? "subscriber" : "expected subscriber")));
    }
    if (l.id === "failed_payments") cmp(bad, "line.failed_payments.count", true, g.text.startsWith(pl(l.n, "failed payment") + " "));
    if (l.id === "paying_drop") cmp(bad, "line.paying_drop.numbers", true, g.text.includes("fell from " + l.was + " to " + l.now));
    for (const k of ["paid_not_served", "renewals_ending", "served_not_paid", "unknown_price", "no_customer_id"]) {
      if (l.id === k) cmp(bad, "line." + k + ".count", String(l.n), g.text.split(" ")[0]);
    }
    if (l.towns) {
      const n = l.towns.length;
      cmp(bad, "line." + l.id + ".count", String(n), g.text.split(" ")[0]);
      const names = named(g.text).split(/, (?![^(]*\))/).map((s) => s.replace(/ \((dead|collapsed|down)[ ,].*\)$| \((dead|collapsed)\)$/, ""));
      const shown = names.filter((s) => !/^\+\d+ more$/.test(s));
      cmp(bad, "line." + l.id + ".towns", true, shown.length === Math.min(5, n) && shown.every((s) => l.towns.includes(s)));
      cmp(bad, "line." + l.id + ".more", n > 5 ? "+" + (n - 5) + " more" : null, names.find((s) => /^\+\d+ more$/.test(s)) || null);
    }
    if (l.id === "sources_blocked") cmp(bad, "line.sources_blocked.sentence", true, g.text.includes("do not retry, it will not come back by itself."));
    if (l.id === "unreadable") {
      const labels = Object.fromEntries(body.tiles.map((x) => [x.id, x.label]));
      const want = l.tiles.map((id) => labels[id]).concat(l.sourceHealth ? ["Source health"] : []);
      cmp(bad, "line.unreadable.labels", "Could not read: " + want.join(", ") + ".", g.text.split(" Reload")[0]);
    }
  }
  // detail
  const d = body.detail;
  cmp(bad, "detail.customers", [E.detail.customers.count, E.detail.customers.cancelled], [d.customers.count, d.customers.cancelled]);
  const m = d.monday, em = E.detail.monday;
  cmp(bad, "detail.monday.delivered", [em.delivered, em.expected], [m.delivered, m.expected]);
  cmp(bad, "detail.monday.missing_failed", [em.missing, em.failed], [m.missing.length, m.failed.length]);
  if ("duplicates" in em) {
    cmp(bad, "detail.monday.other", [em.duplicates, em.joined, em.new_since_monday, em.monday_date, em.skipped_only],
      [m.duplicates, m.joined_on_send_day.length, m.new_since_monday, m.monday_date, m.skipped_only]);
  }
  cmp(bad, "detail.refresh.fail_kind", E.detail.refresh.fail_kind, d.refresh.fail_kind);
  cmp(bad, "detail.refresh.count", E.detail.refresh.count, d.refresh.count);
  cmp(bad, "detail.refresh.coverage", E.detail.refresh.coverage, d.refresh.coverage);
  const srt = (a) => a.map((x) => JSON.stringify([x.town, x.state, x.since, x.ek, x.recent])).sort();
  cmp(bad, "detail.refresh.sources", srt(E.detail.refresh.sources), srt(d.refresh.sources));
  cmp(bad, "detail.renewals", E.detail.renewals, d.renewals ? d.renewals.rows.length : null);
  cmp(bad, "detail.failed_payments", E.detail.failed_rows, d.failed_payments.rows.length);
  if (E.detail.sales) {
    const s = d.sales;
    cmp(bad, "detail.sales", E.detail.sales, s && { new_checkouts: s.new_checkouts, renewal_deliveries: s.renewal_deliveries,
      gross_cents: s.gross_cents, new_subscription_cents: s.new_subscription_cents, pack_cents: s.pack_cents });
  } else cmp(bad, "detail.sales", null, d.sales);
  if (E.detail.signups) {
    const s = d.signups, e = E.detail.signups;
    cmp(bad, "detail.signups", [e.prospects, e.agents, e.newsletter_new, e.newsletter_confirmed, e.newsletter_pending, e.at_least],
      s && [s.prospects, s.agents, s.newsletter_new, s.newsletter_confirmed, s.newsletter_pending, s.at_least]);
    cmp(bad, "detail.signups.by_day", e.by_day, s && s.by_day);
    // Plain trade words are compared as they are; a hostile trade value is
    // neutralised by the route (privacy), so only its count is compared.
    const plain = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => /^[a-z][a-z -]*$/.test(k)));
    const total = (o) => Object.values(o || {}).reduce((a, x) => a + x, 0);
    cmp(bad, "detail.signups.trades", [plain(e.trades), total(e.trades)], s && [plain(s.trades), total(s.trades)]);
  } else cmp(bad, "detail.signups", null, d.signups);
  if (E.detail.engagement) for (const [k, v] of Object.entries(E.detail.engagement)) cmp(bad, "detail.engagement", v, d.engagement && d.engagement[k]);
  cmp(bad, "detail.setup.stripe", E.detail.setup.stripe, d.setup.stripe);
  cmp(bad, "detail.setup.outreach", E.detail.setup.outreach, d.setup.outreach);
  const ev = E.detail.setup.events;
  cmp(bad, "detail.setup.webhook_events", ev ? ev : { "invoice.payment_failed": "unknown", "customer.subscription.deleted": "unknown" },
    d.setup.webhook_events);
  return bad;
}

export function checkMap(E, res) {
  const bad = [];
  cmp(bad, "map.status", E.status, res.status);
  if (E.status !== 200 || res.status !== 200) return bad;
  const b = res.body;
  cmp(bad, "map.counts", E.counts, b.counts);
  cmp(bad, "map.counts.sum", 351, Object.values(b.counts).reduce((a, x) => a + x, 0));
  for (const [town, e] of Object.entries(E.towns)) {
    const g = b.towns[town] || { k: "none" };
    cmp(bad, "map.town.code", town + ":" + e.code, town + ":" + g.k);
    if (e.facts) {
      const f = e.facts;
      cmp(bad, "map.town.facts", [town, f.rows, f.newest, f.state, f.cadence, f.ek],
        [town, g.rows ?? null, g.newest ?? null, g.state ?? null, g.cadence ?? null, g.ek ?? null]);
    }
    cmp(bad, "map.town.outreach", [town, e.o, e.os, e.planned], [town, g.o ?? null, g.os ?? null, g.planned === 1]);
    cmp(bad, "map.town.lk", [town, e.lk], [town, g.lk ?? null]);
  }
  cmp(bad, "map.unmatched", E.unmatched, b.unmatched);
  cmp(bad, "map.outreach_ignored", E.ignored, b.outreach_ignored);
  cmp(bad, "map.opengov", E.opengov, b.opengov);
  return bad;
}
