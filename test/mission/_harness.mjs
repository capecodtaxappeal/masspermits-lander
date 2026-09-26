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
];
// Page modules (P2): pure ES modules, copied the same way and imported from the copy.
export const PAGE = ["admin/mission-view.js", "admin/mission-render.js"];
const IMPORTED = ["functions/api/_cf-access.js", "functions/api/_presend.js"];

let tmpDir = null;
export function tempCopy() {
  if (tmpDir) return tmpDir;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-test-"));
  for (const rel of [...IMPORTED, ...SHIPPED, ...PAGE]) {
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
    outreach: await imp("functions/admin/api/mission-outreach.js"),
    view: await imp("admin/mission-view.js"),
    render: await imp("admin/mission-render.js"),
    gate: await imp("functions/api/_owner_gate.js"),
    r2: await imp("functions/api/_mission_r2.js"),
    stripe: await imp("functions/api/_mission_stripe.js"),
    data: await imp("functions/api/_mission_data.js"),
    presend: await imp("functions/api/_presend.js"),
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
  async put(key, value, opts = {}) {
    this.ops.push({ op: "put", key, opts });
    this._check("put", key);
    const cur = this.objects.get(key);
    const want = opts && opts.onlyIf && opts.onlyIf.etagMatches;
    if (want !== undefined && (!cur || cur.etag !== String(want).replace(/"/g, ""))) return null;
    this.set(key, String(value), { uploaded: Date.now() });
    return this._meta(key, this.objects.get(key));
  }
  async delete(key) { this.ops.push({ op: "delete", key }); this.objects.delete(key); }
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

export const FIRST = ["Avery", "Blake", "Casey", "Drew", "Emery", "Finley", "Harper", "Jordan", "Kendall", "Logan",
  "Morgan", "Parker", "Quinn", "Reese", "Riley", "Rowan", "Sawyer", "Skyler", "Taylor", "Wren", "Ellis", "Jules"];
export const LAST = ["Testwood", "Fakerly", "Samplesen", "Mockford", "Placeholt"];

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
    return call(m.mission, { ...o, env: env(w.r2, o.env), now: o.now ?? w.now,
      token: o.token === undefined ? owner() : o.token });
  };
  return { m, stub, signer, owner, get };
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

// ── a minimal fake DOM (P2) ─────────────────────────────────────────────────
// Just enough for mission-render.js and the demo boot. No dependency. The
// markup sinks (innerHTML, outerHTML, insertAdjacentHTML) THROW, so a page
// file that reached for one would fail its tests.
export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";

class FakeNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this.listeners = {}; }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) throw new Error("insertBefore: not a child");
    c.parentNode = this;
    this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    const s = String(v);
    if (s) this.appendChild(new FakeText(this.ownerDocument || this, s));
  }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this.listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  // Dispatch with bubbling to the document.
  dispatch(type, extra = {}) {
    const ev = { type, target: this, defaultPrevented: false, ...extra };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (let n = this; n; n = n.parentNode) for (const f of (n.listeners[type] || []).slice()) f(ev);
    return ev;
  }
  get innerHTML() { throw new Error("innerHTML is forbidden"); }
  set innerHTML(_) { throw new Error("innerHTML is forbidden"); }
  get outerHTML() { throw new Error("outerHTML is forbidden"); }
  set outerHTML(_) { throw new Error("outerHTML is forbidden"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML is forbidden"); }
}

class FakeText extends FakeNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = data; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

class FakeElement extends FakeNode {
  constructor(doc, tag, ns) {
    super(doc);
    this.nodeType = 1;
    this.localName = ns === SVG_NS ? tag : tag.toLowerCase();
    this.tagName = ns === SVG_NS ? tag : tag.toUpperCase();
    this.namespaceURI = ns;
    this.attributes = new Map();
  }
  setAttribute(k, v) {
    const key = String(k);
    if (/^on/i.test(key) || key.toLowerCase() === "style") throw new Error("forbidden attribute " + key);
    this.attributes.set(key, String(v));
  }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(v) { if (v) this.attributes.set("hidden", ""); else this.attributes.delete("hidden"); }
  get id() { return this.getAttribute("id") || ""; }
  get className() { return this.getAttribute("class") || ""; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  click() { return this.dispatch("click"); }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.nodeType = 9;
    this.activeElement = null;
    this.visibilityState = "visible";
    this.documentElement = this.appendChild(new FakeElement(this, "html", XHTML_NS));
    this.head = this.documentElement.appendChild(new FakeElement(this, "head", XHTML_NS));
    this.body = this.documentElement.appendChild(new FakeElement(this, "body", XHTML_NS));
  }
  createElement(tag) { return new FakeElement(this, String(tag), XHTML_NS); }
  createElementNS(ns, tag) { return new FakeElement(this, String(tag), ns); }
  createTextNode(s) { return new FakeText(this, String(s)); }
  getElementById(id) { return find(this, (n) => n.getAttribute("id") === id)[0] || null; }
}

export function fakeDocument() {
  return new FakeDocument();
}

// Depth-first list of elements under node matching pred.
export function find(node, pred) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        if (pred(c)) out.push(c);
        walk(c);
      }
    }
  };
  walk(node);
  return out;
}

export const byAttr = (node, name, value) =>
  find(node, (n) => n.hasAttribute(name) && (value === undefined || n.getAttribute(name) === value));
export const hasClass = (n, c) => (" " + (n.getAttribute("class") || "") + " ").includes(" " + c + " ");

// A tiny HTML reader for our own static markup (mission.html's shell and the
// demo file): tags, quoted attributes, comments, doctype, raw <script>/<style>
// text and the five basic entities. Not a general HTML parser.
const VOID = new Set(["meta", "link", "br", "img", "input", "hr", "source"]);
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[e]));

export function parseInto(doc, html) {
  let i = 0;
  let cur = null; // filled from <html>/<head>/<body> as they appear
  const stack = [];
  const top = () => stack[stack.length - 1] || doc.body;
  const text = (s) => { if (s) top().appendChild(new FakeText(doc, decode(s))); };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) { i = html.indexOf("-->", lt) + 3; continue; }
    if (html.startsWith("<!", lt)) { i = html.indexOf(">", lt) + 1; continue; }
    const gt = html.indexOf(">", lt);
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].localName.toLowerCase() === name) { stack.length = k; break; }
      }
      continue;
    }
    const m = /^([A-Za-z][A-Za-z0-9-]*)([\s\S]*)$/.exec(raw);
    const name = m[1];
    const lower = name.toLowerCase();
    const attrs = [];
    const re = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = re.exec(m[2]))) attrs.push([a[1], decode(a[2] ?? a[3] ?? a[4] ?? "")]);
    let e;
    if (lower === "html") e = doc.documentElement;
    else if (lower === "head") e = doc.head;
    else if (lower === "body") e = doc.body;
    else {
      const parentNs = top().namespaceURI;
      e = new FakeElement(doc, name, lower === "svg" || parentNs === SVG_NS ? SVG_NS : XHTML_NS);
      top().appendChild(e);
    }
    for (const [k, v] of attrs) e.attributes.set(k, v);
    if (lower === "script" || lower === "style") {
      const end = html.toLowerCase().indexOf("</" + lower, i);
      if (end > i) e.appendChild(new FakeText(doc, html.slice(i, end)));
      i = html.indexOf(">", end) + 1;
      continue;
    }
    if (VOID.has(lower) || raw.trimEnd().endsWith("/")) continue;
    if (lower === "html") { stack.length = 0; stack.push(e); continue; }
    stack.push(e);
    cur = e;
  }
  return cur;
}
