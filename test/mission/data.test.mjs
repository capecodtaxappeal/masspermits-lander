// Unit tests for the pure helpers and the two small I/O helpers.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { m, stub } = await H.setup();
const D = m.data;

test("maskEmail", () => {
  assert.equal(D.maskEmail("jane.doe@example.com"), "j… · example.com");
  assert.equal(D.maskEmail("  Jane@Example.COM "), "j… · example.com");
  for (const bad of ["no-at-sign", "a@b@example.com", "@example.com", "x@", null, 42, undefined]) {
    assert.equal(D.maskEmail(bad), "hidden", String(bad));
  }
  assert.equal(D.maskEmail("x@" + "a".repeat(32) + ".com"), "hidden", "a 32-hex domain never reaches the walk");
  assert.ok(!D.maskEmail("jane.doe@example.com").includes("@"));
});

test("cleanName strips control and bidi characters, collapses whitespace, cuts to 80", () => {
  assert.equal(D.cleanName("<img src=x onerror=alert(1)>‮"), "<img src=x onerror=alert(1)>");
  assert.equal(D.cleanName("  A​  B\u0007⁦C\u009F "), "A BC");
  assert.equal(D.cleanName("x".repeat(200)).length, 80);
  for (const e of ["", "   ", null, undefined, "‮‏"]) assert.equal(D.cleanName(e), "(no name)");
});

test("t8 and stripeUrl", () => {
  assert.equal(D.t8("a".repeat(32)), "aaaaaaaa");
  assert.equal(D.t8("A".repeat(32)), null);
  assert.equal(D.t8("abc"), null);
  assert.equal(D.stripeUrl("cus_TEST000001"), "https://dashboard.stripe.com/customers/cus_TEST000001");
  assert.equal(D.stripeUrl("sub_TEST000001"), "https://dashboard.stripe.com/subscriptions/sub_TEST000001");
  assert.equal(D.stripeUrl("in_TESTopen0001"), "https://dashboard.stripe.com/invoices/in_TESTopen0001");
  for (const bad of ["cus_1", "pi_TEST000001", "cus_TEST/../x", "sub_1&expand[]=x", null]) assert.equal(D.stripeUrl(bad), null);
});

test("errKind: fixed codes, first matching rule wins, in order", () => {
  const cases = {
    "the owner name 'X' reached a shipped row (x-1)": "owner_name_gate",
    "violates rule 5; HTTP 403": "owner_name_gate",
    "HTTP 403 Forbidden": "access_controlled",
    "HTTP 401": "access_controlled",
    "That is an authorization decision": "access_controlled",
    "login wall": "access_controlled",
    "requires_credentials": "access_controlled",
    "blocked by robots.txt": "access_controlled",
    "returned 0 rows": "no_rows",
    "no rows; timed out": "no_rows",
    "silently dead": "no_rows",
    "Read timed out": "timeout",
    "timeout after 30s": "timeout",
    "HTTP 500": "http_error",
    "502 Bad Gateway": "http_error",
    "URLError: nope": "http_error",
    "connection reset": "http_error",
    "SSL: CERTIFICATE_VERIFY_FAILED": "http_error",
    "could not parse table": "parse",
    "missing column 'Issued'": "parse",
    "JSON decode": "parse",
    "something else": "other",
    "": "other",
  };
  for (const [s, code] of Object.entries(cases)) assert.equal(D.errKind(s), code, s);
  for (const v of [null, undefined, 3, {}, []]) assert.equal(D.errKind(v), "other");
});

test("failKind only for ok === false and degraded !== true", () => {
  assert.equal(D.failKind({ ok: false, degraded: false, error: "refresh crashed" }), "crash");
  assert.equal(D.failKind({ ok: false, degraded: false, error: "bundle build crashed" }), "crash");
  assert.equal(D.failKind({ ok: false, error: "ABORT: only 12 permits scraped" }), "gate");
  assert.equal(D.failKind({ ok: false, error: null }), "unknown");
  assert.equal(D.failKind({ ok: false, degraded: true, error: "refresh crashed" }), undefined);
  assert.equal(D.failKind({ ok: true, error: "refresh crashed" }), undefined);
  assert.equal(D.failKind(null), undefined);
});

test("lastDue is the most recent 09:00 UTC at or before now", () => {
  assert.equal(D.lastDue(H.T("2026-09-30T08:59:59Z")), H.T("2026-09-29T09:00:00Z"));
  assert.equal(D.lastDue(H.T("2026-09-30T09:00:00Z")), H.T("2026-09-30T09:00:00Z"));
  assert.equal(D.lastDue(H.T("2026-10-01T00:00:00Z")), H.T("2026-09-30T09:00:00Z"));
});

test("refreshState edges: exactly at due + 8 h, exactly 36 h old", () => {
  const due = H.T("2026-09-30T09:00:00Z");
  const base = { ok: true, degraded: false, ran_at: "2026-09-29T14:20:00Z" };
  const rs = (now, status = base) => D.refreshState({ now, status, head: "present", weeklyUploaded: null });
  assert.equal(rs(due + 8 * H.HOUR - 1).state, "grey");
  assert.equal(rs(due + 8 * H.HOUR).state, "red");
  const ran = H.T("2026-09-30T14:20:00Z");
  const s = { ...base, ran_at: new Date(ran).toISOString() };
  assert.equal(rs(ran + 36 * H.HOUR, s).rule, "not_landed"); // due anchor fires first at 36 h here
  assert.equal(rs(ran + 36 * H.HOUR + 1, s).rule, "too_old");
  assert.equal(D.refreshState({ now: due, status: null, head: "absent" }).rule, "missing");
  assert.equal(D.refreshState({ now: due, status: null, head: "present" }).grey, "unavailable");
  assert.equal(rs(due, { ...base, ran_at: "not a date" }).rule, "missing");
});

test("privacyWalk: every pattern, counted, signed_in_as exempt, keys walked too", () => {
  const { payload, redactions } = D.privacyWalk({
    signed_in_as: "owner@example.com",
    a: "mail x.y@example.com now",
    b: ["a".repeat(32), "rk_" + "live_" + "abc", "whsec_" + "abc", "re_" + "abcdefgh1", "prospects/x", "newsletter/y"],
    c: { "k@example.com": 1 },
    fine: "re_short and 31-hex " + "a".repeat(31),
  });
  assert.equal(redactions, 8);
  assert.equal(payload.signed_in_as, "owner@example.com");
  assert.ok(!JSON.stringify(payload).replace("owner@example.com", "").includes("@"));
  assert.equal(payload.fine, "re_short and 31-hex " + "a".repeat(31));
});

test("sourceTriage never uses alerted_at; missing dates count as recent", () => {
  const now = H.T("2026-09-30T18:00:00Z");
  const proj = {
    "Old, MA": { state: "dead", last_good: new Date(now - 30 * H.DAY).toISOString(), ek: "timeout" },
    "New, MA": { state: "dead", last_good: new Date(now - 2 * H.DAY).toISOString(), ek: "timeout" },
    "Nodate, MA": { state: "dead", last_good: null, first_seen: null, ek: "other" },
    "Col, MA": { state: "collapsed", consecutive_low: 11, ek: "no_rows" },
    "Col2, MA": { state: "collapsed", consecutive_low: 10, ek: "no_rows" },
    "Colx, MA": { state: "collapsed", consecutive_low: "x", ek: "no_rows" },
    "Blocked, MA": { state: "dead", last_good: new Date(now).toISOString(), ek: "access_controlled" },
    "Fine, MA": { state: "ok" },
  };
  const t = D.sourceTriage(proj, { errors: { "Fine, MA": "HTTP 500", "Norecord, MA": "HTTP 403" } }, now);
  const towns = (id) => t.groups[id].map((i) => i.town).sort();
  assert.deepEqual(towns("sources_down"), ["Col2", "Colx", "New", "Nodate"]);
  assert.deepEqual(towns("sources_down_long"), ["Col", "Old"]);
  assert.deepEqual(towns("sources_blocked"), ["Blocked", "Norecord"]);
  assert.deepEqual(towns("sources_failing"), ["Fine"]);
  const nullErrors = D.sourceTriage(proj, { errors: null }, now);
  assert.ok(!nullErrors.sources.some((s) => s.town === "Fine"));
});

test("readView: frozen, exactly get/head/list, a non-enumerable op counter", async () => {
  const r2 = new H.FakeR2().set("a.json", { x: 1 });
  const ro = m.r2.readView(r2);
  assert.ok(Object.isFrozen(ro));
  assert.deepEqual(Object.keys(ro).sort(), ["get", "head", "list"]);
  assert.equal(ro.put, undefined);
  assert.equal(ro.delete, undefined);
  assert.equal(ro.createMultipartUpload, undefined);
  await ro.get("a.json"); await ro.head("a.json"); await ro.list({ prefix: "a" });
  assert.equal(ro.ops, 3);
  assert.ok(!Object.keys(ro).includes("ops"));
  await assert.rejects(m.r2.readView(undefined).get("x"));
});

test("cachedProjection: parse only when the etag changes; the etag never leaves", async () => {
  await H.resetCaches();
  const r2 = new H.FakeR2().set("source-health.json", { sources: { "Adams, MA": { state: "ok" } } }, { uploaded: 1000 });
  const ro = m.r2.readView(r2);
  let calls = 0;
  const project = (o) => { calls++; return { n: Object.keys(o.sources).length }; };
  const a = await m.r2.cachedProjection(ro, "source-health.json", project);
  const b = await m.r2.cachedProjection(ro, "source-health.json", project);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), ["proj", "size", "state", "uploaded"]);
  r2.set("source-health.json", { sources: { "Adams, MA": { state: "ok" }, "Alford, MA": { state: "dead" } } });
  const c = await m.r2.cachedProjection(ro, "source-health.json", project);
  assert.equal(calls, 2);
  assert.equal(c.proj.n, 2);
  r2.set("source-health.json", "{broken");
  assert.equal((await m.r2.cachedProjection(ro, "source-health.json", project)).state, "unreadable");
  r2.remove("source-health.json");
  assert.equal((await m.r2.cachedProjection(ro, "source-health.json", project)).state, "absent");
});

test("stripeSnapshot caches its projection for 5 minutes, never an unavailable result", async () => {
  await H.resetCaches();
  const now = H.T("2026-09-30T18:00:00Z");
  const roster = H.rosterRows(3, now);
  stub.stripe = H.stripeFake(H.stripeData(roster, now));
  stub.reset();
  const env = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A };
  const a = await m.stripe.stripeSnapshot(env, now);
  const n = stub.stripeCalls().length;
  const b = await m.stripe.stripeSnapshot(env, now + 4 * 60_000);
  assert.equal(stub.stripeCalls().length, n);
  assert.equal(a, b);
  await m.stripe.stripeSnapshot(env, now + 5 * 60_000);
  assert.equal(stub.stripeCalls().length, 2 * n);
  // projection only: no raw Stripe member (lines, line_items, object, price objects), no email
  const s = JSON.stringify(a);
  assert.ok(!/"lines"|"line_items"|"object"|"price":\{|"recurring"|@/.test(s), s.slice(0, 200));
  await H.resetCaches();
  stub.stripe = H.stripeFake(H.stripeData(roster, now), { fail: () => ({ status: 500, body: "oops" }) });
  const u = await m.stripe.stripeSnapshot(env, now);
  assert.equal(u.state, "unavailable");
  stub.stripe = H.stripeFake(H.stripeData(roster, now));
  assert.equal((await m.stripe.stripeSnapshot(env, now + 1000)).state, "ok");
  // an unparseable body is unavailable, never zero
  await H.resetCaches();
  stub.stripe = (u2) => (u2.pathname === "/v1/subscriptions" ? { status: 200, body: "<html>" } : H.stripeFake(H.stripeData(roster, now))(u2, "GET"));
  const v = await m.stripe.stripeSnapshot(env, now);
  assert.equal(v.subscriptions.state, "unavailable");
  assert.deepEqual(v.subscriptions.items, []);
});

test("renewal dates come from items current_period_end; cancel_at_period_end within 14 days is amber", async () => {
  await H.resetCaches();
  const now = H.T("2026-09-30T18:00:00Z");
  const nowS = Math.floor(now / 1000);
  const roster = H.rosterRows(3, now);
  const data = H.stripeData(roster, now);
  data.subscriptions[0] = H.subscription(1, roster[0].customer, { now, periodEnd: nowS + 5 * 86400, cancel: true });
  data.subscriptions[1] = H.subscription(2, roster[1].customer, { now, periodEnd: nowS + 13 * 86400, status: "trialing" });
  data.subscriptions[2].current_period_end = nowS + 86400; // on the Subscription object: ignored
  stub.stripe = H.stripeFake(data);
  const w = await H.healthyWorld(now, { roster: 3 });
  w.r2.set("subscribers.json", roster);
  const { get } = { get: (o) => H.call(m.mission, o) };
  const signer = H.makeSigner("unit-kid");
  stub.jwks["unit-team.cloudflareaccess.com"] = [signer.jwk];
  const res = await get({ env: H.env(w.r2, { CF_ACCESS_TEAM_DOMAIN: "unit-team.cloudflareaccess.com",
    STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A }), now,
  token: H.mint(signer, H.claims({ iss: "https://unit-team.cloudflareaccess.com" })) });
  const r = H.tileOf(res.body, "renewals");
  assert.deepEqual([r.state, r.value], ["amber", 2]);
  assert.ok(H.lineIds(res.body, "amber").includes("renewals_ending"));
  assert.equal(res.body.detail.renewals.rows.length, 2);
  assert.equal(res.body.detail.renewals.rows[0].date, H.isoDay(now + 5 * H.DAY));
  const p = H.tileOf(res.body, "paying");
  assert.equal(p.value, 3);
  assert.match(p.sub, /1 trial included/);
});
