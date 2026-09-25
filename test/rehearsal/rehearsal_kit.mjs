// MassPermits monday rehearsal: the kit the rehearsal.js tests share
// (Node built-ins only). Everything is synthetic: @example.com addresses,
// cus_TEST ids, one-digit repeated tokens, invented people.
//
// loadRehearsal() copies rehearsal.js and everything it imports into a temp
// dir, byte for byte, and replaces ONLY _github-oidc.js with a stub whose
// verdict the test sets. my-leads.js and leads.js are copied byte for byte
// too, under a thin spy wrapper that records the context each handler is
// given (headers, and whether its bucket is the no-options roBucket).
// Acceptance 17 does not use this loader: it imports the shipped rehearsal.js
// with the REAL verifier.
//
// Like harness.mjs, this file installs nothing on the global object by
// itself; the test files install the fetch stub, the HTMLRewriter stub and the
// clock they need.

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { API_DIR, REPO, fakeR2, tok, zipBytes } from "./harness.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

// ── a controllable clock ────────────────────────────────────────────────────
// Replaces the global Date with a subclass whose no-argument constructor and
// Date.now() read the fake time, so shipped modules that call `new Date()`
// agree with the fixtures.
export function installClock() {
  const Real = globalThis.Date;
  let fake = null;
  class FakeDate extends Real {
    constructor(...a) { if (a.length === 0) super(fake ?? Real.now()); else super(...a); }
    static now() { return fake ?? Real.now(); }
  }
  globalThis.Date = FakeDate;
  return {
    set(ms) { fake = typeof ms === "string" ? Real.parse(ms) : ms; },
    real() { fake = null; },
    get now() { return fake ?? Real.now(); },
  };
}

// ── the loader ──────────────────────────────────────────────────────────────
const SPY = Symbol.for("masspermits.rehearsal.test.handlerSpy");
const OIDC = Symbol.for("masspermits.rehearsal.test.oidcVerdict");
export async function loadRehearsal() {
  const root = mkdtempSync(join(tmpdir(), "mp-rehearsal-"));
  const api = join(root, "functions", "api");
  mkdirSync(api, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  for (const f of ["rehearsal.js", "_rehearsal.js", "_rehearsal_mail.js", "_ro_bucket.js", "_presend.js", "_reconcile.js"]) {
    copyFileSync(join(API_DIR, f), join(api, f));
  }
  copyFileSync(join(API_DIR, "my-leads.js"), join(api, "my-leads.real.js"));
  copyFileSync(join(REPO, "functions", "leads.js"), join(root, "functions", "leads.real.js"));
  const spy = (from, label) =>
    `import { onRequestGet as real } from "${from}";\n` +
    "export async function onRequestGet(context) {\n" +
    `  const log = globalThis[Symbol.for("masspermits.rehearsal.test.handlerSpy")] || [];\n` +
    "  const r = await real(context);\n" +
    "  const b = context.env.BUNDLES;\n" +
    "  const probe = \"rehearsal/spy-probe-\" + log.length;\n" +
    "  await b.put(probe, \"x\");\n" +
    `  log.push({ handler: "${label}", url: context.request.url,\n` +
    "    authorization: context.request.headers.has(\"authorization\"),\n" +
    "    headers: [...context.request.headers.keys()].sort(),\n" +
    "    roBucket: Object.prototype.hasOwnProperty.call(b, \"captured\"),\n" +
    "    ownMethods: Object.keys(b).sort(), probe });\n" +
    "  return r;\n}\n";
  writeFileSync(join(api, "my-leads.js"), spy("./my-leads.real.js", "my-leads"));
  writeFileSync(join(root, "functions", "leads.js"), spy("./leads.real.js", "leads"));
  writeFileSync(join(api, "_github-oidc.js"),
    "export async function verifyGitHubOIDC(_request) {\n" +
    "  const v = globalThis[Symbol.for(\"masspermits.rehearsal.test.oidcVerdict\")];\n" +
    "  return v === undefined ? { ok: true, payload: {} } : v;\n" +
    "}\n");
  const mod = await import(pathToFileURL(join(api, "rehearsal.js")).href + "?v=" + randomUUID());
  globalThis[SPY] = [];
  return {
    mod, root,
    spyLog: () => globalThis[SPY],
    setVerdict(v) { globalThis[OIDC] = v; },
    byteIdentical() {
      const same = (a, b) => readFileSync(a, "utf8") === readFileSync(b, "utf8");
      return ["rehearsal.js", "_rehearsal.js", "_rehearsal_mail.js", "_ro_bucket.js", "_presend.js", "_reconcile.js"]
        .every((f) => same(join(api, f), join(API_DIR, f))) &&
        same(join(api, "my-leads.real.js"), join(API_DIR, "my-leads.js")) &&
        same(join(root, "functions", "leads.real.js"), join(REPO, "functions", "leads.js"));
    },
  };
}

// ── synthetic worlds ────────────────────────────────────────────────────────
export const OWNER = "owner@example.com";
const FIRST = ["Alex", "Blair", "Casey", "Drew", "Emery", "Finley", "Gray", "Harper", "Indy", "Jules"];
export function subscriber(i, extra = {}) {
  const hex = "0123456789abcdef";
  return {
    email: `buyer${i}.testperson@example.com`,
    name: `${FIRST[(i - 1) % FIRST.length]} Testperson`,
    customer: `cus_TEST${i}`,
    since: "2026-08-01",
    active: true,
    token: tok(hex[i % 16]) .slice(0, 31) + hex[(i + 7) % 16],
    ...extra,
  };
}
export function roster(n, fn) {
  return Array.from({ length: n }, (_, k) => {
    const s = subscriber(k + 1);
    return fn ? fn(s, k + 1) : s;
  });
}

// A healthy refresh-status.json for a refresh that ran at `ranAt`.
export function status(ranAt, extra = {}) {
  return {
    ok: true, degraded: false, ran_at: new Date(ranAt).toISOString(), count: 5702,
    coverage: { live_sources: 39, expected_sources: 140, disclose: false },
    bundle: {
      schema: 1, built_at: new Date(ranAt - 5 * MIN).toISOString(),
      weekly: { opens_as_zip: true, has_all_leads: true, rows: 5702, rowset_sha256: "RS-" + ranAt,
                max_issued_date: new Date(ranAt - DAY).toISOString().slice(0, 10), sha256: "x" },
      monthly: { opens_as_zip: true, has_all_leads: true, rows: 21000 },
    },
    ...extra,
  };
}

// One feed-send-log.json entry delivering to `emails` at `at`.
export function sendEntry(at, emails, extra = {}) {
  return { at: new Date(at).toISOString(), subscribers: emails.length,
    sent: emails.map((to) => ({ to, ok: true })), coverage: null,
    bundle_etag: "etag-" + at, bundle_rowset: "RS-" + at, bundle_rows: 5600, bundle_bytes: 4096, ...extra };
}

// world({...}) -> fakeR2. Every field has a healthy default for `now`.
//   refreshAt: when the refresh (and its uploads) ran.
//   subs: roster array (or a raw string for a corrupt file, or null for none)
//   log: feed-send-log.json array
//   omit: keys to leave out; extra: more keys
export function world(o) {
  const now = o.now;
  const refreshAt = o.refreshAt ?? now - 6 * HOUR;
  const init = {
    "refresh-status.json": o.status ?? status(refreshAt),
    "latest-weekly.zip": { __r2: { uploaded: o.weeklyAt ?? refreshAt - 2 * MIN, etag: o.weeklyEtag }, value: zipBytes(4096) },
    "latest-weekly.html": { __r2: { uploaded: o.htmlAt ?? refreshAt - 2 * MIN },
      value: "<html><head></head><body><span class=\"fresh\">x</span></body></html>" },
    "latest-monthly.zip": { __r2: { uploaded: o.monthlyAt ?? refreshAt - 1 * MIN }, value: zipBytes(8192) },
    "inbox-watchdog-state.json": o.inbox ?? { last_live_run_at: new Date(now - 3 * HOUR).toISOString(),
      last: { waiting: 0, oldest_hours: 0, roster_armed: true, roster_active: 1, roster_cancelled: 0 } },
    "feed-send-log.json": o.log ?? [],
  };
  if (o.subs !== null) init["subscribers.json"] = o.subs ?? roster(3);
  for (const k of o.omit || []) delete init[k];
  Object.assign(init, o.extra || {});
  return fakeR2(init, o.r2opts || {});
}

// Healthy runner facts; `over` is merged by dotted key.
export function facts(over = {}) {
  const f = {
    v: 1, api: "ok",
    refresh: { state: "completed", conclusion: "success", ship_step: "success", failed_at: "none",
      runs: 1, started_min: 540, completed_min: 600, shipped_min: [590, -1, -1, -1] },
    send: { state: "none", runs: 0, started_min: -1 },
    c0: { fn_state: "success", fn_age_min: 4000, fn_sha7: "abcdef1", head_state: "success" },
    c9: { guard1_present: true, mon_refresh_start: [545, 550, 560, 540], mon_send_start: [700, 720, 730, 710],
      mon_watchdog_start: [800, 810, 790, 805], refresh_late_min: 5, push_workflows: 3, push_commits: 0,
      push_runs: 0, monday_sensitive: 0 },
    c17: { refresh_ok_age_h: 6, watchdog_mon: true, watchdog_tue: true, rehearsal_prev_h: 24, inbox_mirror: "ok" },
    c14: { fetched: true, house_numbers: 0, contractor_echo: 0, owner_cue: 0, email_like: 0, hex32: 0 },
    mirror: "ok",
    purchase: { render: "ok", link_first: true, month_line: false },
    c8: { min_cents: 500, events_mirror: "ok" },
  };
  for (const [k, v] of Object.entries(over)) {
    const path = k.split(".");
    let o = f;
    for (const p of path.slice(0, -1)) { if (typeof o[p] !== "object" || o[p] === null) o[p] = {}; o = o[p]; }
    if (v === undefined) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = v;
  }
  return f;
}

export const PARTS = { sat: ["links", "core"], "mon-pre": ["links", "core"], dry: ["links", "core"],
  sun: ["links", "seed", "core"], "mon-post": ["core"] };

// One run the way the caller drives it: each part in order, links paged
// while more:true (at most page 24). Returns every response body (parsed).
export async function runMode(mod, env, { mode, date, trigger = "sched", run = "1001", body }) {
  const out = [];
  for (const part of PARTS[mode]) {
    let page = 0;
    for (;;) {
      const url = `https://masspermits.com/api/rehearsal?mode=${mode}&part=${part}&page=${page}` +
        `&date=${date}&trigger=${trigger}&run=${run}`;
      const r = await mod.onRequestPost({ request: new Request(url, {
        method: "POST", headers: { authorization: "Bearer test", "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body) }), env });
      const text = await r.text();
      out.push({ part, page, status: r.status, text, json: JSON.parse(text) });
      if (part === "links" && out[out.length - 1].json.more === true && page < 24) page++;
      else break;
    }
  }
  return { responses: out, core: out.find((x) => x.part === "core") || out[out.length - 1] };
}

export function baseEnv(bucket, extra = {}) {
  return { BUNDLES: bucket, REHEARSAL_MAIL: "1", REHEARSAL_TO: OWNER, FROM_EMAIL: "rehearsal@example.com",
    RESEND_API_KEY: "re_test_key", ...extra };
}

export const at = (s) => Date.parse(s);
export { HOUR, DAY, MIN };
