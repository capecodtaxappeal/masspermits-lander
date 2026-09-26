// P1-8: hostile fixtures, production-shaped etags, owner names in engine text.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { m, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const EMAIL_RE = /[^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}/;
const HOSTILE_NAME = "<img src=x onerror=alert(1)>‮";
const PROSPECT_KEY = "prospects/%3Cb%3Ex%3C%2Fb%3E%40example.com";
const NEWS_TOK = H.md5("hostile-newsletter-tok");
const BECKET = "Becket, MA: the owner name 'JANE Q HOMEOWNER' reached a shipped row (x-1). Owner names " +
  "never ship at any aggregation (rule 5). Fix the parser; do not filter this downstream.";
const BECKET_403 = "HTTP 403 from https://example.invalid/x. That is an authorization decision by the site " +
  "for JANE Q HOMEOWNER; CANARYERR Zebulon Quux";
const CANARIES = ["HOMEOWNER", "JANE Q", "CANARYERR", "ZEBULON", "CANARYTB"];

async function hostileWorld(becketErr = BECKET) {
  const w = await H.healthyWorld(NOW);
  const roster = w.roster;
  roster[0].name = HOSTILE_NAME;
  roster[0].token = "a".repeat(32);
  w.r2.set("subscribers.json", roster, { uploaded: NOW - 3 * H.DAY });
  w.r2.set(PROSPECT_KEY, "", { customMetadata: { stage: "sent", ts: String(NOW - H.DAY), trade: "roofing" } });
  w.r2.set("newsletter/hostile.reader@example.com", "", { customMetadata: { c: "1", un: "0", ts: String(NOW - H.DAY), tok: NEWS_TOK } });
  // a vendor error that carries an email, in the send log and in a town error
  const log = w.r2.json("feed-send-log.json");
  log[0].sent.push({ to: "bounced.person@example.com", ok: false, error: "550 5.1.1 <bounced.person@example.com> mailbox unavailable" });
  w.r2.set("feed-send-log.json", log, { uploaded: w.sendAt });
  w.status.errors["Chatham, MA"] = "HTTP 500 from the portal; contact webmaster@example.org for access";
  w.status.sources["Chatham, MA"] = 0;
  // owner names in engine text
  w.status.errors["Becket, MA"] = becketErr;
  w.status.sources["Becket, MA"] = 0;
  const rec = H.shRecord("dead", w.ranAt, { lastGood: NOW - 2 * H.DAY, lastError: becketErr });
  rec.recent[0].err = becketErr;
  w.shSources["Becket, MA"] = rec;
  Object.assign(w.status, { ok: false, degraded: true, error: "only 3 towns produced data; CANARYERR Zebulon Quux",
    traceback: "Traceback ... /home/runner/CANARYTB" });
  w.save();
  w.r2.set("admin/outreach.json", { version: 1, updated_at: "2026-09-26T00:00:00Z", towns: {
    Adams: { outreach: "sent", since: "2026-09-20", note: "spoke to clerk.person@example.com at 413-555-0199" },
  } }, { uploaded: NOW - H.DAY });
  return w;
}

function assertNoCanary(res, label) {
  const up = res.text.toUpperCase();
  for (const c of CANARIES) assert.ok(!up.includes(c), label + " leaked " + c);
}

function assertHostileClean(res, r2, label) {
  H.assertClean(assert, res, r2, label);
  const strings = H.allStrings(res.body);
  for (const s of strings) {
    assert.ok(!EMAIL_RE.test(s), label + " email-shaped: " + s);
    assert.ok(!/\b[0-9a-f]{32}\b/.test(s), label + " 32-hex: " + s);
    assert.ok(!s.includes("prospects/") && !s.includes("newsletter/"), label + " prefix: " + s);
    assert.ok(!/\b(sk|rk)_(live|test)_|\bwhsec_|\bre_[A-Za-z0-9]{8,}/.test(s), label + " key shape: " + s);
    assert.ok(!s.includes("‮"), label + " bidi control survived");
  }
  assert.ok(!res.text.includes(NEWS_TOK), label + " newsletter tok");
  assert.ok(!res.text.includes("%3Cb%3E"), label + " prospect key");
  assertNoCanary(res, label);
}

test("P1-8 hostile world: 200, zero redactions, projections clean on their own", async () => {
  const w = await hostileWorld();
  const res = await get(w);
  assertHostileClean(res, w.r2, "default");
  assert.ok(res.text.includes(JSON.stringify("<img src=x onerror=alert(1)>").slice(1, -1)), "name appears cleaned");
  assert.ok(!res.text.includes("413-555-0199"));
  const names = H.allStrings(res.body).filter((s) => s.includes("onerror"));
  for (const n of names) assert.equal(n, "<img src=x onerror=alert(1)>");
  for (const cold of [true, false]) {
    const map = await get(w, { query: "?view=map", cold });
    assertHostileClean(map, w.r2, "map " + (cold ? "cold" : "warm"));
    assert.equal(map.body.towns.Becket.ek, "owner_name_gate");
  }
});

test("P1-8 mutation: a raw email injected into a projection is redacted, counted, and goes red", async () => {
  const w = await hostileWorld();
  const res = await get(w);
  const injected = structuredClone(res.body);
  injected.privacy_redactions = 0;
  injected.detail.customers.rows[1].name = "leak.person@example.com";
  const out = m.data.finish(injected, true);
  assert.equal(out.privacy_redactions, 1);
  assert.equal(out.needs_you[0].id, "privacy");
  assert.equal(out.needs_you[0].severity, "red");
  assert.equal(out.headline.state, "red");
  assert.ok(!JSON.stringify(out).includes("leak.person@example.com"));
});

test("P1-8 etags: production-shaped (MD5) everywhere, none in any view, zero redactions", async () => {
  const w = await H.healthyWorld(NOW);
  for (const e of w.r2.etags()) assert.match(e, /^[0-9a-f]{32}$/);
  for (const e of w.r2.json("feed-send-log.json")) assert.match(e.bundle_etag, /^[0-9a-f]{32}$/);
  // make the last send's bundle_etag the zip's own etag (the Monday duplicate path)
  const log = w.r2.json("feed-send-log.json");
  log[0].bundle_etag = w.r2.objects.get("latest-weekly.zip").etag;
  w.r2.set("feed-send-log.json", log, { uploaded: w.sendAt });
  const res = await get(w);
  H.assertClean(assert, res, w.r2, "default");
  assert.equal(res.body.detail.refresh.same_bundle_as_last_send, true);
  H.assertClean(assert, await get(w, { query: "?view=map" }), w.r2, "map cold");
  H.assertClean(assert, await get(w, { query: "?view=map", cold: false }), w.r2, "map warm");
  H.assertClean(assert, await get(w, { cold: false }), w.r2, "default warm");
});

test("P1-8 mutation: one head's etag put into detail.refresh -> 1 redaction and a red line", async () => {
  const w = await H.healthyWorld(NOW);
  const res = await get(w);
  const p = structuredClone(res.body);
  p.detail.refresh.status_uploaded = w.r2.objects.get("refresh-status.json").etag;
  const out = m.data.finish(p, true);
  assert.equal(out.privacy_redactions, 1);
  assert.deepEqual([out.needs_you[0].id, out.needs_you[0].severity], ["privacy", "red"]);
  assert.equal(out.headline.state, "red");
});

async function bothViews(w, label, check) {
  const main = await get(w);
  check(main, label + " default");
  for (const cold of [true, false]) {
    check(await get(w, { query: "?view=map", cold }), label + " map " + (cold ? "cold" : "warm"));
  }
  return main;
}

test("P1-8 owner names: hostile, crash shape, ABORT shape and 403 wording never reach either view", async () => {
  // hostile (ok:false, degraded:true)
  let w = await hostileWorld();
  const main = await bothViews(w, "hostile", (res, label) => assertHostileClean(res, w.r2, label));
  assert.equal(main.body.detail.refresh.fail_kind, null, "degraded is not a failure");

  // "refresh crashed" FAILURE SHAPE exactly
  w = await hostileWorld();
  w.status = H.crashedStatus(w.ranAt);
  w.save({ runs_unscored: 1, last_unscored_at: new Date(w.ranAt).toISOString(), last_unscored_why: "refresh crashed" });
  const crash = await bothViews(w, "crash", (res, label) => assertHostileClean(res, w.r2, label));
  assert.equal(crash.body.detail.refresh.fail_kind, "crash");
  assert.equal(crash.body.detail.refresh.coverage, null);
  assert.equal(crash.body.detail.refresh.count, null);
  assert.equal((await get(w, { query: "?view=map" })).body.towns.Becket.ek, "owner_name_gate");

  // "ABORT:" shape quoting a town's error inside the refresh error
  w = await hostileWorld();
  Object.assign(w.status, { ok: false, degraded: false, error: "ABORT: Becket, MA failed (" + BECKET + "); not shipping",
    coverage: null, contracts: null });
  w.save();
  const abort = await bothViews(w, "abort", (res, label) => assertHostileClean(res, w.r2, label));
  assert.equal(abort.body.detail.refresh.fail_kind, "gate");
  assert.equal(H.tileOf(abort.body, "refresh").state, "red");

  // same name under a 403 wording
  w = await hostileWorld(BECKET_403);
  await bothViews(w, "403", (res, label) => assertHostileClean(res, w.r2, label));
  const map = await get(w, { query: "?view=map" });
  assert.equal(map.body.towns.Becket.ek, "access_controlled");
});
