// Scale replay for the Monday paid email (functions/api/weekly-send.js).
//
// Question: does the shipped sender still work at 200, 500 and 1,000 active
// subscribers? This file runs the REAL onRequest handler, including the real
// GitHub OIDC verifier, against a mocked world and measures what the handler
// does. Findings are written up in docs/scale/SEND_AT_200.md.
//
// Safety: nothing leaves this process. globalThis.fetch is replaced before any
// module is imported. The only URLs it answers are the GitHub JWKS URL (served
// from a key pair generated here, in memory) and https://api.resend.com/emails
// (recorded, never sent). Anything else throws. R2 is an in-memory Map.
// Subscribers are synthetic: sub001@example.test and so on.
//
//   node --test test/scale/send-scale.test.mjs
//   SCALE_TABLE=1 node --test test/scale/send-scale.test.mjs   (prints the numbers)
//
// Tests named "CURRENT BEHAVIOUR" pin what the code does today, including the
// parts that go wrong at scale. When the fix in SEND_AT_200.md lands, those
// tests are expected to fail and should be rewritten to the new behaviour.
//
// Limits used, and where they come from (see SEND_AT_200.md for detail):
//   FETCH_LIMIT_FREE = 50   Cloudflare Workers/Pages Functions free plan,
//                           external fetch() subrequests per invocation. The
//                           repo's own mission budget test (test/mission/
//                           security.test.mjs, "<= 45 subrequests") is sized
//                           against this 50.
//   FETCH_LIMIT_PAID = 1000 Workers Paid plan figure as last documented to us.
//                           An ASSUMPTION; Cloudflare has been raising it.
//   RESEND_RPS = 2          Resend default API rate limit, requests per second
//                           per team. An ASSUMPTION from Resend's docs; teams
//                           can ask for more.

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { webcrypto } from "node:crypto";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API = path.join(REPO, "functions/api");

const FETCH_LIMIT_FREE = 50;
const FETCH_LIMIT_PAID = 1000;
const RESEND_RPS = 2;
const SIZES = [200, 500, 1000];
const ZIP_BYTES = Number(process.env.SCALE_ZIP_BYTES || 256 * 1024);
const TABLE = {};

// ---------------------------------------------------------------- OIDC ------
const subtle = webcrypto.subtle;
const kp = await subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await subtle.exportKey("jwk", kp.publicKey)), kid: "scale-test-kid", alg: "RS256", use: "sig" };
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function mintToken() {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" }));
  const p = b64u(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com", aud: "masspermits-cron",
    repository: "capecodtaxappeal/masspermits-lander", ref: "refs/heads/main",
    exp: Math.floor(Date.now() / 1000) + 600 }));
  const sig = await subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64u(sig);
}

// ------------------------------------------------------------- network ------
// One Resend "account" per scenario. Virtual clock only: nothing sleeps.
function makeResend(opt = {}) {
  const o = {
    latencyMs: 300,          // per call, sequential, so wall time = sum
    rps: Infinity,           // enforce a per-second rate limit (429 above it)
    inject: new Map(),       // call number (1-based) -> HTTP status to return
    fetchLimit: Infinity,    // Cloudflare per-invocation external fetch cap
    dieAtCall: Infinity,     // the invocation is killed when it reaches this call
    ...opt,
  };
  const r = { o, calls: 0, accepted: [], statuses: {}, vt: 0, window: [], invocationFetches: 0,
              jwks: 0, died: false, onDie: null, maxBodyBytes: 0 };
  return r;
}
let RS = makeResend();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  RS.invocationFetches++;
  if (RS.invocationFetches > RS.o.fetchLimit) {
    // What a Worker sees once the subrequest cap is spent.
    throw new Error("Too many subrequests.");
  }
  if (u === "https://token.actions.githubusercontent.com/.well-known/jwks") {
    RS.jwks++;
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  if (u !== "https://api.resend.com/emails") throw new Error("BLOCKED network call to " + u);
  RS.calls++;
  if (RS.calls >= RS.o.dieAtCall) {
    // Isolate killed mid-run (CPU limit, eviction, deploy). Nothing after this
    // line of the handler ever runs, so the promise never settles.
    RS.died = true;
    if (RS.onDie) RS.onDie();
    return new Promise(() => {});
  }
  const body = String(init.body || "");
  if (body.length > RS.maxBodyBytes) RS.maxBodyBytes = body.length;
  RS.vt += RS.o.latencyMs;
  const inj = RS.o.inject.get(RS.calls);
  let status = inj || 200;
  if (!inj && RS.o.rps !== Infinity) {
    RS.window = RS.window.filter((t) => t > RS.vt - 1000);
    if (RS.window.length >= RS.o.rps) status = 429;
    else RS.window.push(RS.vt);
  }
  RS.statuses[status] = (RS.statuses[status] || 0) + 1;
  if (status !== 200) {
    return new Response(JSON.stringify({ name: status === 429 ? "rate_limit_exceeded" : "internal_server_error" }),
      { status });
  }
  const b = JSON.parse(body);
  RS.accepted.push({ to: b.to[0], html: b.html, attachments: (b.attachments || []).length });
  return new Response(JSON.stringify({ id: "em_" + RS.calls }), { status: 200 });
};

// ------------------------------------------------------------------ R2 ------
function makeR2() {
  const m = new Map();
  const ops = [];
  let n = 0;
  const obj = (k) => {
    const v = m.get(k);
    if (!v) return null;
    return {
      key: k, etag: v.etag, httpEtag: '"' + v.etag + '"', size: v.buf.length, uploaded: new Date(),
      text: async () => v.buf.toString("utf8"),
      arrayBuffer: async () => v.buf.buffer.slice(v.buf.byteOffset, v.buf.byteOffset + v.buf.byteLength),
    };
  };
  return {
    m, ops,
    set(k, body, etag) {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      m.set(k, { buf, etag: etag || "put-" + (++n) });
    },
    json(k) { const v = m.get(k); return v ? JSON.parse(v.buf.toString("utf8")) : null; },
    bytes(k) { const v = m.get(k); return v ? v.buf.length : 0; },
    get: async (k) => { ops.push("get:" + k); return obj(k); },
    head: async (k) => { ops.push("head:" + k); return obj(k); },
    put: async (k, val) => { ops.push("put:" + k); m.set(k, { buf: Buffer.from(String(val)), etag: "put-" + (++n) }); },
    list: async () => { ops.push("list"); return { objects: [] }; },
    delete: async (k) => { ops.push("delete:" + k); m.delete(k); },
  };
}

const email = (i) => "sub" + String(i).padStart(4, "0") + "@example.test";
function roster(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({ email: email(i), name: "Sub " + i, active: true,
               token: "t" + String(i).padStart(31, "0"), customer: "cus_TEST" + i });
  }
  // A cancelled row and a duplicate row, which the sender must drop.
  out.push({ email: "gone@example.test", active: false, token: "x".repeat(32) });
  out.push({ ...out[0], customer: "cus_TESTdup" });
  return out;
}

function fakeZip(bytes) {
  const b = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) b[i] = (i * 2654435761) >>> 24;
  b.write("PK\u0003\u0004", 0, "latin1");
  return b;
}
const ZIP = fakeZip(ZIP_BYTES);

function world(n) {
  const r2 = makeR2();
  r2.set("refresh-status.json", { ok: true, degraded: false, ran_at: new Date().toISOString(),
    coverage: { live_sources: 27, expected_sources: 140, disclose: true },
    bundle: { weekly: { rowset_sha256: "0".repeat(64), rows: 1234, max_issued_date: "2026-10-30" } } });
  r2.set("subscribers.json", roster(n));
  r2.set("latest-weekly.zip", ZIP, "etag-week-1");
  return { r2, env: { BUNDLES: r2, RESEND_API_KEY: "re_test_only", FROM_EMAIL: "MassPermits <leads@example.test>" } };
}

const ws = await import(pathToFileURL(path.join(API, "weekly-send.js")).href);

// One invocation of the handler, as one Cloudflare request. Returns the reply,
// or { died: true } if the mocked isolate was killed.
async function invoke(w, { force = false } = {}) {
  RS.invocationFetches = 0;
  RS.died = false;
  const ops0 = w.r2.ops.length, calls0 = RS.calls, vt0 = RS.vt;
  const token = await mintToken();
  const url = "https://masspermits.com/api/weekly-send" + (force ? "?force=1" : "");
  const req = new Request(url, { method: "POST", headers: { authorization: "Bearer " + token } });
  const cpu0 = process.cpuUsage();
  const died = new Promise((res) => { RS.onDie = () => res({ died: true }); });
  const out = await Promise.race([
    ws.onRequest({ request: req, env: w.env }).then(async (r) => ({ status: r.status, body: await r.json() })),
    died,
  ]);
  const cpu = process.cpuUsage(cpu0);
  RS.onDie = null;
  return { ...out, fetches: RS.invocationFetches, resendCalls: RS.calls - calls0,
           r2ops: w.r2.ops.length - ops0, cpuMs: Math.round((cpu.user + cpu.system) / 1000),
           virtualWallMs: RS.vt - vt0 };
}

// Who has had how many weekly emails so far in this scenario.
function tally() {
  const c = new Map();
  for (const a of RS.accepted) c.set(a.to, (c.get(a.to) || 0) + 1);
  return c;
}

// ============================================================================
// 1. Clean run, unlimited mocks: the raw cost of one Monday at each size.
// ============================================================================
for (const n of SIZES) {
  test(`clean run at ${n}: one Resend call per subscriber, all in ONE invocation`, async () => {
    RS = makeResend({ latencyMs: 300 });
    const w = world(n);
    const r = await invoke(w);
    assert.equal(r.status, 200);
    assert.equal(r.body.delivered, n);
    assert.equal(r.body.failed, 0);
    assert.equal(RS.accepted.length, n, "exactly one email per active, unique subscriber");
    assert.equal(new Set(RS.accepted.map((a) => a.to)).size, n);
    assert.ok(!RS.accepted.some((a) => a.to === "gone@example.test"), "inactive row is not mailed");
    // Per-subscriber download link, and the attachment on every single email.
    const s7 = RS.accepted.find((a) => a.to === email(7));
    assert.match(s7.html, /api\/my-leads\?t=t0+7"/);
    assert.ok(RS.accepted.every((a) => a.attachments === 1));
    // Subrequests: n Resend calls, plus the JWKS fetch on the first (cold) call
    // of this process. R2 binding ops are counted separately.
    const coldJwks = n === SIZES[0] ? 1 : 0;
    assert.equal(r.fetches, n + coldJwks);
    // refresh-status, subscribers, zip, send log (twice) = 5 gets; attempt marker + log = 2 puts.
    assert.equal(r.r2ops, 7, "R2 ops do not grow with subscribers: 5 gets + 2 puts");
    // Worst case is a cold isolate: n Resend calls + 1 JWKS fetch.
    const worst = n + 1;
    assert.ok(worst > FETCH_LIMIT_FREE, "over the free-plan fetch cap at every size tested");
    assert.equal(worst > FETCH_LIMIT_PAID, n >= 1000, "paid-plan cap is crossed at 1,000 only (cold isolate)");
    const logBytes = w.r2.bytes("feed-send-log.json");
    TABLE["clean_" + n] = {
      subscribers: n, fetch_subrequests: r.fetches, r2_ops: r.r2ops,
      cold_worst_case: worst, over_free_50: worst > FETCH_LIMIT_FREE, over_paid_1000: worst > FETCH_LIMIT_PAID,
      wall_s_at_300ms_per_call: r.virtualWallMs / 1000,
      wall_s_if_paced_at_2rps: n / RESEND_RPS,
      local_cpu_ms: r.cpuMs, request_body_bytes_each: RS.maxBodyBytes,
      log_bytes_one_entry: logBytes,
    };
  });
}

// ============================================================================
// 2. Resend's rate limit. The sender has no pacing and no retry.
// ============================================================================
test("CURRENT BEHAVIOUR at 200: fast Resend + 2 req/s limit => 429s, marked failed, no retry in run", async () => {
  // 200 ms per call means the loop runs at about 5 calls a second.
  RS = makeResend({ latencyMs: 200, rps: RESEND_RPS });
  const w = world(200);
  const r = await invoke(w);
  assert.equal(r.status, 200, "the reply is still 200 ok:true");
  assert.equal(r.body.ok, true);
  const n429 = RS.statuses[429] || 0;
  assert.ok(n429 > 100, "most of the run is rate limited: " + n429);
  assert.equal(r.body.failed, n429);
  assert.equal(r.resendCalls, 200, "one attempt each, no retry");
  const log = w.r2.json("feed-send-log.json");
  assert.equal(log[0].sent.filter((s) => !s.ok).length, n429);
  assert.match(log[0].sent.find((s) => !s.ok).error, /resend 429/);
  // A re-run mails ONLY the failed ones: the per-week ledger works when the log
  // got written. (The watchdog does NOT do this re-run: "partial" is alert-only.)
  RS.o.rps = Infinity;
  const r2 = await invoke(w);
  assert.equal(r2.body.delivered, n429);
  assert.equal(r2.body.already_delivered, 200 - n429);
  assert.ok([...tally().values()].every((c) => c === 1), "no duplicates after the re-run");
  TABLE.rate_limit_200 = { latency_ms: 200, resend_rps: RESEND_RPS, got_429: n429,
                           rerun_sent_only_failed: true, duplicates: 0 };
});

test("at 200: slow Resend (600 ms per call) stays under 2 req/s by accident; wall time 120 s", async () => {
  RS = makeResend({ latencyMs: 600, rps: RESEND_RPS });
  const w = world(200);
  const r = await invoke(w);
  assert.equal(r.body.failed, 0);
  assert.equal(r.virtualWallMs, 120_000);
});

test("CURRENT BEHAVIOUR: injected 5xx and 429 mid run are recorded per recipient and not retried", async () => {
  RS = makeResend({ latencyMs: 300, inject: new Map([[50, 500], [51, 503], [120, 429]]) });
  const w = world(200);
  const r = await invoke(w);
  assert.equal(r.body.failed, 3);
  assert.equal(r.body.delivered, 197);
  const failed = w.r2.json("feed-send-log.json")[0].sent.filter((s) => !s.ok).map((s) => s.to);
  assert.deepEqual(failed, [email(50), email(51), email(120)]);
  const r2 = await invoke(w);
  assert.equal(r2.body.delivered, 3, "re-run completes the three, nobody else");
});

// ============================================================================
// 3. The Cloudflare subrequest cap, enforced.
// ============================================================================
test("CURRENT BEHAVIOUR at 200, free-plan cap 50: one run delivers 49 to 50, the rest fail with 'Too many subrequests'", async () => {
  RS = makeResend({ latencyMs: 300, fetchLimit: FETCH_LIMIT_FREE });
  const w = world(200);
  const r = await invoke(w);
  assert.equal(r.status, 200);
  assert.ok(r.body.delivered >= 49 && r.body.delivered <= 50, "delivered " + r.body.delivered);
  assert.equal(r.body.failed, 200 - r.body.delivered);
  const log = w.r2.json("feed-send-log.json");
  assert.match(log[0].sent.find((s) => !s.ok).error, /Too many subrequests/);
  TABLE.free_cap_200 = { cap: FETCH_LIMIT_FREE, delivered_first_run: r.body.delivered, failed_first_run: r.body.failed };
});

for (const [n, cap] of [[200, FETCH_LIMIT_FREE], [1000, FETCH_LIMIT_FREE], [1000, FETCH_LIMIT_PAID]]) {
  test(`CURRENT BEHAVIOUR at ${n}, cap ${cap}: repeated manual re-runs until everyone has it`, async () => {
    RS = makeResend({ latencyMs: 300, fetchLimit: cap });
    const w = world(n);
    let runs = 0;
    while (runs < 25) {
      runs++;
      const r = await invoke(w);
      if (r.body.skipped || r.body.failed === 0) break;
    }
    const t = tally();
    const dups = [...t.values()].filter((c) => c > 1).length;
    const missing = n - t.size;
    const log = w.r2.json("feed-send-log.json");
    TABLE[`reruns_${n}_cap${cap}`] = { runs_needed: runs, duplicates: dups, still_missing: missing,
                                       log_entries: log.length, log_bytes: w.r2.bytes("feed-send-log.json") };
    if (n === 1000 && cap === FETCH_LIMIT_FREE) {
      // 20 runs of 50 need 20 log entries, but the log keeps 12. Each entry also
      // carries every FAILED row of its run, so it is the oldest DELIVERED rows
      // that fall off. Once they do, those people look undelivered and are
      // mailed again: the loop never converges.
      assert.ok(dups > 0, "the 12-entry log cap causes repeat emails at 1,000 on the free cap");
    } else {
      assert.equal(dups, 0);
      assert.equal(missing, 0);
    }
  });
}

// ============================================================================
// 4. A crash in the middle of the loop.
// ============================================================================
test("CURRENT BEHAVIOUR at 200: invocation killed after 120 emails => no log, re-run mails those 120 again", async () => {
  RS = makeResend({ latencyMs: 300, dieAtCall: 121 });
  const w = world(200);
  const r = await invoke(w);
  assert.equal(r.died, true);
  assert.equal(RS.accepted.length, 120);
  assert.equal(w.r2.json("feed-send-log.json"), null, "the log is written only after the loop");
  assert.ok(w.r2.json("last-send-attempt.json"), "attempt marker exists, so send-status says 'unknown'");
  // The watchdog will NOT retry an 'unknown'. But curl --retry 3 in
  // weekly-feed.yml retries on a 5xx/timeout from the killed request, and a
  // human pressing re-run does the same thing:
  RS.o.dieAtCall = Infinity;
  const r2 = await invoke(w);
  assert.equal(r2.body.delivered, 200, "everyone is mailed, including the 120 who already had it");
  const dups = [...tally().values()].filter((c) => c > 1).length;
  assert.equal(dups, 120);
  TABLE.crash_200 = { killed_after: 120, log_written: false, rerun_duplicates: dups };
});

test("CURRENT BEHAVIOUR: killed run repeated by curl --retry 3 => up to 4 copies for the first subscribers", async () => {
  RS = makeResend({ latencyMs: 300, dieAtCall: 121 });
  const w = world(200);
  for (let i = 0; i < 4; i++) {
    RS.calls = 0;          // each retry is a fresh invocation that dies at the same point
    await invoke(w);
  }
  const t = tally();
  assert.equal(t.get(email(1)), 4);
  assert.equal(t.get(email(200)), undefined);
  TABLE.curl_retry_crash_200 = { attempts: 4, copies_to_first_120: 4, last_80_got: 0 };
});

// ============================================================================
// 5. feed-send-log.json size: 12 full entries at each size.
// ============================================================================
test("feed-send-log.json at 12 entries: size per subscriber count", async () => {
  for (const n of SIZES) {
    const w = world(n);
    const entry = { at: new Date().toISOString(), subscribers: n,
      sent: roster(n).slice(0, n).map((s) => ({ to: s.email, ok: true })),
      coverage: { live_sources: 27, expected_sources: 140, disclose: true }, bundle_etag: "etag-week-1",
      bundle_rowset: "0".repeat(64), bundle_rows: 1234, bundle_max_issued: "2026-10-30", bundle_bytes: ZIP_BYTES };
    const bytes = Buffer.byteLength(JSON.stringify(Array(12).fill(entry)));
    TABLE["log12_" + n] = { subscribers: n, bytes_12_entries: bytes };
    assert.ok(bytes < 1024 * 1024, "under 1 MB even at 1,000: R2 size is not the problem");
    void w;
  }
});

test.after(() => {
  if (process.env.SCALE_TABLE) console.log("SCALE " + JSON.stringify(TABLE, null, 1));
});
