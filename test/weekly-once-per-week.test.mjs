// One weekly email per subscriber per delivery week.
//
// 2026-09-07: all three paying subscribers received Monday's email twice
// (15:20:31Z and 17:15:23Z, same subject). The push-triggered watchdog sent
// first; a push-triggered refresh then rebuilt latest-weekly.zip, so its etag
// changed; the late cron weekly-feed run passed the etag-only guard and sent
// again. This file replays that day, and the other ways a week can go, against
// the SHIPPED weekly-send.js, send-status.js and stripe-webhook.js.
//
// Safety: nothing leaves this machine. fetch is replaced before any module is
// imported and anything that is not the Resend URL throws; Resend calls are
// recorded, never made. R2 is an in-memory Map. Addresses are @example.com.
// The OIDC verifier is swapped for a stub by a loader hook, because a local
// process cannot mint a GitHub Actions token.
//
//   node --test test/weekly-once-per-week.test.mjs
//
// WS_ROOT=<another checkout> runs the same cases against that tree. Against
// origin/main 1068e8070 the 09-07 replay FAILS (6 emails, not 3): that is the
// proof this test reproduces the incident rather than describing it.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = process.env.WS_ROOT ? path.resolve(process.env.WS_ROOT) : REPO;
const API = path.join(ROOT, "functions/api");

// ---- loader: replace only the OIDC verifier --------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), "mp-once-"));
const stub = path.join(tmp, "oidc-stub.mjs");
writeFileSync(stub, "export async function verifyGitHubOIDC(){return {ok:true,reason:'test stub'};}\n");
const hook = path.join(tmp, "hook.mjs");
writeFileSync(hook, `export async function resolve(s, c, n) {
  if (s.endsWith("_github-oidc.js")) return n(${JSON.stringify(pathToFileURL(stub).href)}, c);
  return n(s, c);
}\n`);
register(pathToFileURL(hook).href);

// ---- clock -----------------------------------------------------------------
const RealDate = Date;
let NOW = RealDate.parse("2026-09-07T12:00:00Z");
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const at = (iso) => { NOW = RealDate.parse(iso); };

// ---- Resend ----------------------------------------------------------------
let mail = [];                 // every Resend call: { to, subject, kind }
let failFor = new Set();       // recipients Resend rejects
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.resend.com/")) throw new Error("BLOCKED network call to " + u);
  const b = JSON.parse(init.body);
  const to = (b.to || [])[0];
  const kind = /weekly MassPermits leads/.test(b.subject || "") ? "weekly" : "other";
  if (failFor.has(to)) return { ok: false, status: 500, text: async () => "simulated outage" };
  mail.push({ to, subject: b.subject, kind });
  return { ok: true, status: 200, text: async () => "{}" };
};

// ---- R2 --------------------------------------------------------------------
function makeR2() {
  const m = new Map();
  const throwOn = new Set();
  const writes = [];
  const wrap = (k) => {
    if (throwOn.has("get:" + k)) throw new Error("simulated R2 failure on " + k);
    const v = m.get(k);
    if (!v) return null;
    const buf = Buffer.from(v.body);
    return {
      key: k, etag: v.etag, httpEtag: '"' + v.etag + '"', size: buf.length, uploaded: new RealDate(v.uploaded),
      text: async () => buf.toString("utf8"),
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  };
  let n = 0;
  return {
    m, throwOn, writes,
    set(k, body, etag) { m.set(k, { body: typeof body === "string" ? body : JSON.stringify(body), etag: etag || "put-" + (++n), uploaded: NOW }); },
    json(k) { const v = m.get(k); return v ? JSON.parse(v.body) : null; },
    get: async (k) => wrap(k),
    head: async (k) => wrap(k),
    put: async (k, val) => { writes.push(k); m.set(k, { body: String(val), etag: "put-" + (++n), uploaded: NOW }); },
    list: async () => ({ objects: [] }),
    delete: async (k) => { m.delete(k); },
  };
}

const A = "a@example.com", B = "b@example.com", C = "c@example.com";
const ROSTER = [
  { email: A, name: "A Tester", active: true, token: "a".repeat(32), customer: "cus_a" },
  { email: B, name: "B Tester", active: true, token: "b".repeat(32), customer: "cus_b" },
  { email: C, name: "C Tester", active: true, token: "c".repeat(32), customer: "cus_c" },
];

// A refresh: new bytes (so a new etag) and a fresh refresh-status.json.
function refresh(w, iso, etag) {
  at(iso);
  w.r2.set("latest-weekly.zip", "PK zip built " + iso, etag);
  w.r2.set("latest-monthly.zip", "PK monthly " + iso, "m-" + etag);
  w.r2.set("refresh-status.json", {
    ok: true, degraded: false, ran_at: iso,
    coverage: { live_sources: 27, expected_sources: 140, disclose: true },
  });
}

function world({ log, etag = "E0", zipAt, roster = ROSTER } = {}) {
  const r2 = makeR2();
  const t0 = NOW;
  refresh({ r2 }, zipAt || new RealDate(NOW - 3600_000).toISOString(), etag);
  NOW = t0;
  r2.set("subscribers.json", roster);
  if (log !== undefined) r2.set("feed-send-log.json", log);
  return { r2, env: { BUNDLES: r2, RESEND_API_KEY: "re_test", FROM_EMAIL: "MassPermits <leads@example.com>",
                      STRIPE_WEBHOOK_SECRET: "whsec_test_only" } };
}

const entry = (iso, to, etag = "E0", ok = true) =>
  ({ at: iso, subscribers: to.length, sent: to.map((x) => ({ to: x, ok })), bundle_etag: etag });

const ws = await import(pathToFileURL(path.join(API, "weekly-send.js")).href);
const ss = await import(pathToFileURL(path.join(API, "send-status.js")).href);
const sw = await import(pathToFileURL(path.join(API, "stripe-webhook.js")).href);

async function send(w, iso, { force = false } = {}) {
  at(iso);
  const before = mail.length;
  const w0 = w.r2.writes.length;
  const url = "https://masspermits.com/api/weekly-send" + (force ? "?force=1" : "");
  const res = await ws.onRequest({ request: new Request(url, { method: "POST" }), env: w.env });
  const body = await res.json();
  return { status: res.status, body, to: mail.slice(before).map((x) => x.to), writes: w.r2.writes.slice(w0) };
}

async function status(w, iso) {
  at(iso);
  const res = await ss.onRequest({ request: new Request("https://masspermits.com/api/send-status"), env: w.env });
  return res.json();
}

// A real signed Stripe renewal (invoice.paid, subscription_cycle, $99).
async function renewal(w, iso, email) {
  at(iso);
  const payload = JSON.stringify({ id: "evt_test", type: "invoice.paid", data: { object: {
    billing_reason: "subscription_cycle", amount_paid: 9900, total: 9900, customer_email: email, customer: "cus_x" } } });
  const t = Math.floor(NOW / 1000);
  const sig = createHmac("sha256", "whsec_test_only").update(t + "." + payload).digest("hex");
  const before = mail.length;
  const res = await sw.onRequestPost({ request: new Request("https://masspermits.com/api/stripe-webhook",
    { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: payload }), env: w.env });
  return { status: res.status, body: await res.json(), mail: mail.slice(before) };
}

const count = (list, x) => list.filter((y) => y === x).length;
// A domain-masked "…@example.com" is allowed (that is the design); a local part is not.
const noAddr = (o) => assert.ok(!/[A-Za-z0-9._%+-]+@example\.com/.test(JSON.stringify(o)),
  "response must carry no full address");

test.beforeEach(() => { mail = []; failFor = new Set(); });

// ---------------------------------------------------------------------------
test("09-07 replay: watchdog retry, then a refresh changes the etag, then the cron feed. One email each.", async () => {
  const w = world({ log: [entry("2026-08-31T18:46:00Z", [A, B, C], "E-0831")], etag: "E-0831",
                    zipAt: "2026-08-31T16:44:00Z" });
  refresh(w, "2026-09-07T14:53:35Z", "3ca5172e1f");                 // scheduled refresh

  const s1 = await status(w, "2026-09-07T15:20:18Z");                // push-triggered watchdog
  assert.equal(s1.verdict, "missed");
  assert.equal(s1.retry_safe, true);
  const r1 = await send(w, "2026-09-07T15:20:31Z");                  // its retry
  assert.deepEqual(r1.to.sort(), [A, B, C].sort());
  assert.equal((await status(w, "2026-09-07T15:20:32Z")).verdict, "ok");

  refresh(w, "2026-09-07T15:30:54Z", "a01cd86943");                  // push-triggered refresh
  const r2 = await send(w, "2026-09-07T17:15:17Z");                  // late cron weekly-feed
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.to, [], "the 17:15 run must not mail anyone again");
  assert.ok(r2.body.skipped, "reported as a skip");
  assert.equal(r2.body.already_delivered, 3);
  assert.deepEqual(r2.writes, [], "a week skip writes no attempt marker and no log line");
  noAddr(r2.body);

  const s2 = await status(w, "2026-09-07T18:19:22Z");                // scheduled watchdog
  assert.equal(s2.verdict, "ok");
  assert.equal(s2.retry_safe, false);
  const s3 = await status(w, "2026-09-08T14:50:00Z");                // Tuesday backstop
  assert.equal(s3.verdict, "ok");
  const r3 = await send(w, "2026-09-08T14:50:05Z");                  // even if it had sent
  assert.deepEqual(r3.to, []);

  for (const x of [A, B, C]) assert.equal(count(mail.map((m) => m.to), x), 1, "exactly one weekly email");
});

test("partial first send, then a retry with the SAME bytes mails only the missed subscriber", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  failFor = new Set([C]);
  const r1 = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r1.to.sort(), [A, B]);
  assert.equal(r1.body.failed, 1);

  const s1 = await status(w, "2026-09-28T18:51:00Z");
  assert.equal(s1.verdict, "partial");
  assert.equal(s1.retry_safe, false);
  assert.equal(s1.last_failed, 1); // a count since D28
  noAddr(s1);

  failFor = new Set();
  const r2 = await send(w, "2026-09-28T19:05:00Z");                  // manual re-run, same etag
  assert.deepEqual(r2.to, [C], "only the subscriber who has not had it");
  assert.equal(r2.body.already_delivered, 2);
  const log = w.r2.json("feed-send-log.json");
  assert.deepEqual(log[0].sent.map((s) => s.to), [C]);
  assert.equal(log[0].already_delivered, 2);
  assert.equal(w.r2.json("last-send-attempt.json").subscribers, 1);

  const s2 = await status(w, "2026-09-28T19:06:00Z");
  assert.equal(s2.verdict, "ok", "the week is whole once C is delivered");
  assert.equal(s2.roster_gap, 0); // counts since D28
  assert.equal(s2.last_failed, 0);

  const r3 = await send(w, "2026-09-28T19:10:00Z");
  assert.deepEqual(r3.to, []);
  for (const x of [A, B, C]) assert.equal(count(mail.map((m) => m.to), x), 1);
});

// Edge 1. A run in which every provider call failed handed these bytes to
// nobody. It used to stand as the etag memory, so the next ordinary run of the
// SAME bundle was skipped as "identical bundle already delivered" and only
// ?force=1 could make the week good. It also answered ok:true with a 200, and
// send-status called the week `unknown` with "no results were recorded".
test("a Resend outage (nobody delivered) is retried by an ordinary re-run of the same bytes, once", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  failFor = new Set([A, B, C]);
  const r1 = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r1.to, []);
  assert.equal(r1.body.ok, false, "a run that delivered to nobody is not a success");
  assert.equal(r1.status, 424, "non-2xx, and not one weekly-feed.yml's curl --retry repeats");
  assert.equal(r1.body.delivered, 0);
  assert.equal(r1.body.failed, 3);
  noAddr(r1.body);
  assert.deepEqual(w.r2.json("feed-send-log.json")[0].sent.map((s) => s.ok), [false, false, false],
    "per-recipient results are still logged");

  const s1 = await status(w, "2026-09-28T18:51:00Z");
  assert.equal(s1.verdict, "failed", "results were recorded: every delivery failed");
  assert.equal(s1.retry_safe, false);
  assert.equal(s1.last_failed, 3);
  assert.ok(!/no results were recorded/.test(s1.detail), s1.detail);
  noAddr(s1);

  failFor = new Set();
  const r2 = await send(w, "2026-09-28T19:05:00Z");                  // ordinary re-run, same etag
  assert.equal(r2.status, 200);
  assert.ok(!r2.body.skipped, "nobody holds these bytes, so the same-bundle guard does not apply");
  assert.deepEqual(r2.to.sort(), [A, B, C]);
  assert.equal((await status(w, "2026-09-28T19:06:00Z")).verdict, "ok");

  const r3 = await send(w, "2026-09-28T19:10:00Z", { force: true });
  assert.deepEqual(r3.to, [], "force=1 cannot mail a subscriber twice in one week");
  const r4 = await send(w, "2026-09-28T19:15:00Z");
  assert.deepEqual(r4.to, []);
  for (const x of [A, B, C]) assert.equal(count(mail.map((m) => m.to), x), 1, "exactly one weekly email");
});

test("a re-run that completes a partial week but delivers to nobody is not reported as success", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  failFor = new Set([C]);
  const r1 = await send(w, "2026-09-28T17:52:00Z");
  assert.equal(r1.status, 200);
  assert.equal(r1.body.ok, true, "a partial delivery keeps its 200 and ok:true");
  const r2 = await send(w, "2026-09-28T18:30:00Z");                  // C is rejected again
  assert.deepEqual(r2.to, []);
  assert.equal(r2.status, 424);
  assert.equal(r2.body.ok, false);
  assert.equal(r2.body.failed, 1);
  assert.equal(r2.body.already_delivered, 2);
  const s = await status(w, "2026-09-28T18:51:00Z");
  assert.equal(s.verdict, "partial", "two of three have it: still partial");
  assert.equal(s.last_failed, 1);
  failFor = new Set();
  assert.deepEqual((await send(w, "2026-09-28T19:00:00Z")).to, [C]);
  assert.equal((await status(w, "2026-09-28T19:01:00Z")).verdict, "ok");
});

test("a failed run on top does not make the guard forget bytes subscribers already hold", async () => {
  // 09-21 delivered E-0921. The 09-28 refresh ran but rebuilt nothing, and a
  // forced attempt with those same bytes then failed for everyone. The bytes
  // are still the ones every subscriber received on 09-21: an ordinary run
  // must still skip them (stale_bundle), exactly as before.
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  at("2026-09-28T16:01:00Z");
  w.r2.set("refresh-status.json", { ok: true, ran_at: "2026-09-28T16:01:00Z" });
  failFor = new Set([A, B, C]);
  const forced = await send(w, "2026-09-28T17:00:00Z", { force: true });
  assert.equal(forced.status, 424);
  failFor = new Set();
  const r = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r.to, []);
  assert.ok(r.body.skipped, "identical to the bundle delivered 09-21");
  assert.match(String(w.r2.json("feed-send-log.json")[0].skipped), /2026-09-21T17:52:00Z/);
  assert.equal((await status(w, "2026-09-28T18:51:00Z")).verdict, "stale_bundle");
});

// Review scenario R3. The log keeps 12 entries. A is accepted and B rejected;
// twelve more ordinary re-runs that week each try only B and are rejected, so
// A's acceptance falls off the end of the log. Each of those re-runs recorded
// `already_delivered: 1`: somebody held these bytes. If lastEtagEntry passed
// over them as well, the log would hold no etag memory, the per-subscriber
// guard would no longer see A, and the next ordinary run would mail A the same
// bytes a second time. Main skips that run as an identical bundle, and so must
// this branch.
test("12 re-runs rejecting one subscriber do not let an ordinary run mail the other one again", async () => {
  const roster = ROSTER.filter((s) => s.email !== C);
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B], "E-0921")], etag: "E-0921", roster });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  failFor = new Set([B]);
  const r0 = await send(w, "2026-09-28T17:00:00Z");
  assert.equal(r0.status, 200);
  assert.deepEqual(r0.to, [A], "A accepted, B rejected");
  for (let i = 1; i <= 12; i++) {
    const t = new RealDate(RealDate.parse("2026-09-28T17:00:00Z") + i * 5 * 60_000).toISOString();
    const r = await send(w, t);
    assert.deepEqual(r.to, [], "re-run " + i + " tries only B, and B is rejected again");
    assert.equal(r.status, 424);
    assert.equal(r.body.already_delivered, 1);
  }
  const log = w.r2.json("feed-send-log.json");
  assert.equal(log.length, 12);
  assert.ok(log.every((e) => e.already_delivered === 1 && e.sent.every((s) => !s.ok)),
    "A's acceptance has been pushed out of the 12-entry log");

  failFor = new Set();
  const last = await send(w, "2026-09-28T18:10:00Z");               // ordinary run, no force
  assert.ok(!last.to.includes(A), "A already holds these bytes and must not get them again");
  assert.ok(last.body.skipped, "identical bundle: the etag memory still stands");
  assert.equal(count(mail.map((m) => m.to), A), 1, "exactly one weekly email for A");
});

test("send-status still says `unknown` when a later attempt left no results", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  failFor = new Set([A, B, C]);
  await send(w, "2026-09-28T17:52:00Z");                             // all failed, recorded
  at("2026-09-28T18:10:00Z");                                       // a later run crashed mid-send
  w.r2.set("last-send-attempt.json", { at: "2026-09-28T18:10:00Z", subscribers: 3, degraded: false });
  const s = await status(w, "2026-09-28T18:51:00Z");
  assert.equal(s.verdict, "unknown", "the newest attempt has no results, so nobody can say");
  assert.equal(s.retry_safe, false);
});

test("lastEtagEntry ignores a run that delivered to nobody when nobody already had it, and nothing else", async () => {
  const { lastEtagEntry } = await import(pathToFileURL(path.join(API, "_presend.js")).href);
  const allFailed = { at: "2026-09-28T17:52:00Z", bundle_etag: "E1", sent: [{ to: A, ok: false }, { to: B, ok: false }] };
  const partial = { at: "2026-09-28T17:00:00Z", bundle_etag: "E1", sent: [{ to: A, ok: true }, { to: B, ok: false }] };
  const skip = { at: "2026-09-28T16:00:00Z", bundle_etag: "E0", sent: [], skipped: "identical bundle" };
  const noSent = { at: "2026-09-21T17:52:00Z", bundle_etag: "E-old" };
  const rerunFailed = { at: "2026-09-28T18:00:00Z", bundle_etag: "E1", sent: [{ to: B, ok: false }], already_delivered: 1 };
  assert.equal(lastEtagEntry([allFailed, partial]), partial);
  assert.equal(lastEtagEntry([allFailed, skip]), skip, "a skip still carries the etag memory");
  assert.equal(lastEtagEntry([allFailed, { ...allFailed }, noSent]), noSent, "an entry without a sent list still counts");
  assert.equal(lastEtagEntry([allFailed]), null);
  assert.equal(lastEtagEntry([{ ...allFailed, sent: [null, { to: A, ok: false }] }]), null);
  assert.equal(lastEtagEntry([partial, allFailed]), partial);
  assert.equal(lastEtagEntry([rerunFailed, partial]), rerunFailed,
    "an all-failed re-run after somebody already had the bytes still counts");
  assert.equal(lastEtagEntry([rerunFailed]), rerunFailed, "even once the delivery itself has left the log");
  assert.equal(lastEtagEntry([allFailed, rerunFailed]), rerunFailed);
  assert.equal(lastEtagEntry([{ ...rerunFailed, already_delivered: 0 }]), null, "a zero count is nobody");
  for (const bad of [null, undefined, {}, "x", []]) assert.equal(lastEtagEntry(bad), null);
});

test("a new week sends normally; the same bytes as last week are still an etag skip (stale_bundle)", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T16:01:00Z", "E-0928");
  const r1 = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r1.to.sort(), [A, B, C]);
  assert.equal(r1.body.already_delivered, undefined, "normal response shape is unchanged");
  assert.equal(w.r2.json("feed-send-log.json")[0].already_delivered, undefined);

  const v = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  at("2026-09-28T16:01:00Z");
  v.r2.set("refresh-status.json", { ok: true, ran_at: "2026-09-28T16:01:00Z" });   // refresh ran, zip unchanged
  const r2 = await send(v, "2026-09-28T17:52:00Z");
  assert.deepEqual(r2.to, []);
  assert.ok(v.r2.json("feed-send-log.json")[0].skipped, "etag skip is still logged");
  assert.equal((await status(v, "2026-09-28T18:51:00Z")).verdict, "stale_bundle");
});

test("a renewal-day Stripe delivery does not block Monday, and Monday does not block a renewal", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T09:40:00Z", "E-0928");
  const pay1 = await renewal(w, "2026-09-28T10:00:00Z", A);          // A's card clears Monday morning
  assert.equal(pay1.status, 200);
  assert.equal(pay1.body.delivered, "weekly");
  assert.equal(pay1.mail.length, 1);
  assert.equal(w.r2.json("delivery-log.json").length, 1);
  assert.equal(w.r2.json("feed-send-log.json").length, 1, "the webhook never writes the weekly send log");

  const r1 = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r1.to.sort(), [A, B, C], "A still gets Monday's email");

  const pay2 = await renewal(w, "2026-09-28T20:00:00Z", B);          // B's card clears Monday evening
  assert.equal(pay2.body.delivered, "weekly");
  assert.equal(pay2.mail.length, 1, "payday delivery still goes out after Monday's send");

  const r2 = await send(w, "2026-09-28T21:00:00Z");
  assert.deepEqual(r2.to, []);
});

test("week boundary is Monday 00:00 New York: Sunday 23:59 is last week, Monday 00:01 is this week", async () => {
  // Summer (EDT, UTC-4).
  let w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-27T20:00:00Z", "E-sun");
  assert.deepEqual((await send(w, "2026-09-28T03:59:00Z")).to, [], "Sun 23:59 EDT: already had this week's");
  assert.deepEqual((await send(w, "2026-09-28T04:01:00Z")).to.sort(), [A, B, C], "Mon 00:01 EDT: new week");
  // Winter, across the DST change on Sunday 2026-11-01 (EST, UTC-5).
  w = world({ log: [entry("2026-10-26T17:52:00Z", [A, B, C], "E-1026")], etag: "E-1026" });
  refresh(w, "2026-11-01T20:00:00Z", "E-nov");
  assert.deepEqual((await send(w, "2026-11-02T04:59:00Z")).to, [], "Sun 23:59 EST");
  assert.deepEqual((await send(w, "2026-11-02T05:01:00Z")).to.sort(), [A, B, C], "Mon 00:01 EST");

  const { deliveryWeekStart } = await import(pathToFileURL(path.join(API, "_presend.js")).href);
  const iso = (s) => new RealDate(deliveryWeekStart(RealDate.parse(s))).toISOString();
  assert.equal(iso("2026-09-28T12:00:00Z"), "2026-09-28T04:00:00.000Z");
  assert.equal(iso("2026-09-28T03:59:59Z"), "2026-09-21T04:00:00.000Z");
  assert.equal(iso("2026-11-01T12:00:00Z"), "2026-10-26T04:00:00.000Z");
  assert.equal(iso("2026-11-02T05:00:00Z"), "2026-11-02T05:00:00.000Z");
  assert.equal(iso("2026-11-02T04:59:59Z"), "2026-10-26T04:00:00.000Z");
  assert.equal(iso("2027-03-08T12:00:00Z"), "2027-03-08T05:00:00.000Z");
  assert.equal(iso("2027-03-15T04:00:00Z"), "2027-03-15T04:00:00.000Z");
  assert.equal(iso("2027-03-14T12:00:00Z"), "2027-03-08T05:00:00.000Z");
});

test("empty or unreadable feed-send-log never blocks the send (today's behaviour)", async () => {
  const variants = [
    ["absent", (w) => w.r2.m.delete("feed-send-log.json")],
    ["empty array", (w) => w.r2.set("feed-send-log.json", [])],
    ["get throws", (w) => w.r2.throwOn.add("get:feed-send-log.json")],
    ["not JSON", (w) => w.r2.set("feed-send-log.json", "{not json")],
    ["an object", (w) => w.r2.set("feed-send-log.json", { at: "2026-09-28T12:00:00Z" })],
    ["junk rows", (w) => w.r2.set("feed-send-log.json", [null, 5, "x", { at: "garbage", sent: [{ to: A, ok: true }] },
                                                         { at: "2026-09-28T12:00:00Z", sent: "nope" }])],
    ["future-dated corrupt entry", (w) => w.r2.set("feed-send-log.json", [entry("2099-01-05T15:40:00Z", [A, B, C], "E-x")])],
  ];
  for (const [name, mutate] of variants) {
    mail = [];
    const w = world({ etag: "E-new" });
    refresh(w, "2026-09-28T16:01:00Z", "E-new");
    mutate(w);
    const r = await send(w, "2026-09-28T17:52:00Z");
    assert.equal(r.status, 200, name);
    assert.deepEqual(r.to.sort(), [A, B, C], name + ": everyone is mailed");
  }
});

test("two active rows for one address get one email", async () => {
  const roster = [...ROSTER, { email: " A@Example.com ", name: "A again", active: true, token: "z".repeat(32) }];
  const w = world({ roster, etag: "E-new" });
  refresh(w, "2026-09-28T16:01:00Z", "E-new");
  const r = await send(w, "2026-09-28T17:52:00Z");
  assert.deepEqual(r.to.sort(), [A, B, C]);
});

test("send-status: a Monday-morning send counts for the week, so the 13:30 watchdog does not retry", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  refresh(w, "2026-09-28T05:30:00Z", "E-0928");
  const r1 = await send(w, "2026-09-28T06:00:00Z");                  // manual early send, 02:00 EDT
  assert.equal(r1.to.length, 3);
  const s = await status(w, "2026-09-28T13:31:00Z");
  assert.equal(s.verdict, "ok", "not `missed`: the early send is in this delivery week");
  assert.equal(s.retry_safe, false);
  assert.deepEqual((await send(w, "2026-09-28T17:15:00Z")).to, []);
});

test("send-status: nothing delivered this week is still `missed` with retry_safe", async () => {
  const w = world({ log: [entry("2026-09-21T17:52:00Z", [A, B, C], "E-0921")], etag: "E-0921" });
  const s = await status(w, "2026-09-28T13:31:00Z");
  assert.equal(s.verdict, "missed");
  assert.equal(s.retry_safe, true);
  const n = await status(w, "2026-09-28T13:00:00Z");
  assert.equal(n.verdict, "not_due");
});
