// P4-SEC: regression tests for the security review. Each "fix" test failed on
// the P3 head (fc186fad) and passes after the fix; each "holds" test records an
// attack that did not get through, so a later change cannot open it quietly.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, stub, signer, owner, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z"); // a Wednesday
const D = m.data;

// ── (1) the gate ────────────────────────────────────────────────────────────
test("fix (1): a non-ASCII email claim cannot case-fold onto an allowlisted address", async () => {
  // U+212A KELVIN SIGN lower-cases to ASCII "k": "Kate@..." would equal "kate@...".
  const w = await H.healthyWorld(NOW);
  w.r2.ops.length = 0;
  const env = { ADMIN_ALLOWED_EMAILS: "kate@example.com" };
  const res = await get(w, { env, token: owner({ email: "Kate@example.com" }) });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "not-owner");
  assert.equal(w.r2.ops.length, 0);
  // positive control: the same address in ASCII, any case, still passes
  const ok = await get(w, { env, token: owner({ email: " Kate@Example.COM " }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.signed_in_as, "kate@example.com");
  // a non-ASCII entry in the allowlist never matches anything
  const odd = await get(w, { env: { ADMIN_ALLOWED_EMAILS: "Kate@example.com" }, token: owner({ email: "kate@example.com" }) });
  assert.equal(odd.status, 403);
});

test("holds (1): host tricks, duplicate headers, port, HEAD, cookie-only on the map view", async () => {
  const w = await H.healthyWorld(NOW);
  for (const host of ["masspermits.com.", "masspermits.com.evil.example", "evil.example", "xn--masspermits-.com",
    "www.masspermits.com.", "masspermits.com@evil.example"]) {
    w.r2.ops.length = 0;
    let status;
    try {
      status = (await get(w, { host })).status;
    } catch (_) {
      status = "unparseable"; // new Request() refuses it: never reaches the route
    }
    assert.ok(status === 404 || status === "unparseable", host + " -> " + status);
    assert.equal(w.r2.ops.length, 0, host);
  }
  // a port on the apex is still the apex (same origin rules apply in the browser)
  assert.equal((await get(w, { host: "masspermits.com:443" })).status, 200);
  // two assertion headers are joined by ", " and never verify
  const two = await get(w, { token: owner() + ", " + owner() });
  assert.equal(two.status, 403);
  // the map view with a valid cookie and no header
  w.r2.ops.length = 0;
  const ck = await get(w, { query: "?view=map", token: null, cookie: "CF_Authorization=" + owner() });
  assert.equal(ck.status, 403);
  assert.equal(ck.body.reason, "no-assertion-header");
  assert.equal(w.r2.ops.length, 0);
  // HEAD (if Pages routes it to onRequestGet) is refused after auth, before any read
  w.r2.ops.length = 0;
  const head = await H.call(m.mission, { env: H.env(w.r2), now: NOW, token: owner(), method: "HEAD" });
  assert.notEqual(head.status, 200);
  assert.equal(w.r2.ops.length, 0);
  // a token for the right team and audience but with an email claim that is not a string
  for (const email of [["owner@example.com"], { v: "owner@example.com" }, 1]) {
    assert.equal((await get(w, { token: owner({ email }) })).status, 403, JSON.stringify(email));
  }
});

// ── (3) privacy ─────────────────────────────────────────────────────────────
test("fix (3): privacyWalk exempts signed_in_as only at the top level", () => {
  const r = D.privacyWalk({ signed_in_as: "owner@example.com", detail: { signed_in_as: "jane.doe@example.com" } });
  assert.equal(r.payload.signed_in_as, "owner@example.com");
  assert.equal(r.payload.detail.signed_in_as, "[withheld]");
  assert.equal(r.redactions, 1);
});

test("fix (3): a trade value is lower-cased before it is neutralised (no self-inflicted red line)", async () => {
  const w = await H.healthyWorld(NOW);
  const bad = ["NEWSLETTER/", "PROSPECTS/X", "RK_" + "LIVE_" + "Q".repeat(12), "WHSEC_" + "Q".repeat(12), "RE_" + "Q".repeat(10)];
  bad.forEach((trade, i) => w.r2.set("prospects/trade" + i + "@example.com", "",
    { customMetadata: { stage: "sent", ts: String(NOW - H.HOUR), trade } }));
  const res = await get(w);
  H.assertClean(assert, res, w.r2, "trades");
  assert.notEqual(res.body.headline.state, "red");
  for (const k of Object.keys(res.body.detail.signups.trades)) {
    assert.ok(!/prospects\/|newsletter\/|\b(sk|rk)_(live|test)_|\bwhsec_|\bre_[a-z0-9]{8,}/i.test(k), k);
  }
});

test("fix (3): an outreach note is redacted before it is cut, so no partial email or phone survives", () => {
  const cases = [
    "x".repeat(70) + " jane.doe@example.com",
    "y".repeat(73) + " 413-555-0100",
    "z".repeat(60) + " call (413) 555-0100 or jane@example.com",
    "reach a.b@c" + ".co".repeat(30),
  ];
  for (const note of cases) {
    const o = D.parseOutreach(JSON.stringify({ version: 1, towns: { Adams: { outreach: "sent", note } } }));
    const n = o.towns.Adams.note;
    assert.ok(n.length <= 80, n);
    assert.ok(!n.includes("@"), n);
    assert.ok(!/jane|a\.b/.test(n), n);
    assert.ok(!/\d{3}[-) ]+\d/.test(n), n);
  }
  // a long note does not make the phone pattern scan the whole 64 KB object
  const t0 = Date.now();
  D.parseOutreach(JSON.stringify({ version: 1, towns: { Adams: { note: "1 ".repeat(30000) } } }));
  assert.ok(Date.now() - t0 < 500, "note scan time");
});

test("fix (3): cleanName also strips U+061C, the Arabic letter mark (a bidi control)", () => {
  assert.equal(D.cleanName("Ava؜ Test"), "Ava Test");
  assert.equal(D.cleanName("؜"), "(no name)");
});

test("holds (3): hostile Stripe fields never reach the payload raw", async () => {
  const w = await H.healthyWorld(NOW);
  const data = H.stripeData(w.roster, NOW);
  const s0 = data.subscriptions[0];
  s0.status = "active"; // an entitled status, so the row is emitted
  s0.id = "sub_1&expand[]=data.customer";
  s0.customer = { id: "cus_TEST000001", email: "leak@example.com", name: "Leaky Customer", address: { line1: "1 Leak St" } };
  s0.metadata = { note: "jane@example.com" };
  s0.items.data[0].price.currency = "usd<script>";
  stub.stripe = H.stripeFake(data);
  const env = { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B };
  const res = await get(w, { env });
  H.assertClean(assert, res, w.r2, "stripe fields");
  assert.ok(!/Leaky|Leak St|<script|expand\[\]/.test(res.text), "raw Stripe field in the payload");
});

// ── (5) truthfulness ───────────────────────────────────────────────────────
test("fix (5): an unreadable send log is grey unavailable, never pending and never a false red", async () => {
  for (const [label, now, spoil] of [
    ["Wednesday, get throws", NOW, (w) => w.r2.fail.add("get:feed-send-log.json")],
    ["Wednesday, not JSON", NOW, (w) => w.r2.set("feed-send-log.json", "{not json", { uploaded: NOW - H.DAY })],
    ["Monday 16:00Z, get throws", H.T("2026-09-28T16:00:00Z"), (w) => w.r2.fail.add("get:feed-send-log.json")],
  ]) {
    const w = await H.healthyWorld(now);
    spoil(w);
    const res = await get(w, { now });
    const t = H.tileOf(res.body, "monday");
    assert.deepEqual([t.state, t.grey, t.value], ["grey", "unavailable", null], label);
    const line = res.body.needs_you.find((l) => l.id === "unreadable");
    assert.ok(line && /Monday email/.test(line.text), label);
    assert.ok(!H.lineIds(res.body, "red").includes("monday"), label);
  }
  // control: an absent log (never sent) is still judged by the rules
  const w = await H.healthyWorld(NOW, { mondayLog: false });
  assert.equal(H.tileOf((await get(w)).body, "monday").state, "red");
});

test("fix (5): a timestamp from the future cannot hold a tile green", async () => {
  // refresh-status ran_at in 2099: not a usable run time
  const w = await H.healthyWorld(NOW);
  w.status.ran_at = "2099-01-01T14:20:00Z";
  w.save();
  const r = await get(w);
  assert.equal(H.tileOf(r.body, "refresh").state, "red");
  assert.equal(r.body.needs_you.find((l) => l.id === "refresh").severity, "red");
  // a send-log entry dated in the future is not a delivery for this Monday
  const v = await H.healthyWorld(NOW, { mondayLog: false });
  v.r2.set("feed-send-log.json", [H.logEntry(H.T("2099-01-05T15:40:00Z"), v.roster.map((x) => ({ to: x.email, ok: true })))]);
  const s = await get(v);
  assert.notEqual(H.tileOf(s.body, "monday").state, "green");
  // an hour of clock skew is tolerated (the runner's clock against the edge's)
  const u = await H.healthyWorld(NOW);
  u.status.ran_at = new Date(NOW + 30 * 60_000).toISOString();
  u.save();
  assert.equal(H.tileOf((await get(u)).body, "refresh").state, "green");
});

// ── (6) the page ────────────────────────────────────────────────────────────
test("fix (6): the page links only to the Stripe dashboard, whatever the payload says", () => {
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "https://evil.example/x",
    "https://dashboard.stripe.com.evil.example/customers/cus_TEST000001", "//evil.example", "/admin/pipeline"]) {
    assert.equal(m.view.rowLine({ name: "A", stripe_url: href }).href, null, href);
  }
  for (const href of ["https://dashboard.stripe.com/customers/cus_TEST000001",
    "https://dashboard.stripe.com/subscriptions/sub_TEST000001", "https://dashboard.stripe.com/invoices/in_TEST000001"]) {
    assert.equal(m.view.rowLine({ name: "A", stripe_url: href }).href, href);
  }
});

test("holds (6): the /admin/mission CSP allows no inline script, no eval and no other origin", () => {
  const hdr = fs.readFileSync(path.join(H.REPO, "_headers"), "utf8");
  const block = hdr.slice(hdr.indexOf("\n/admin/mission\n"));
  const csp = /Content-Security-Policy: (.*)/.exec(block)[1];
  const dir = Object.fromEntries(csp.split(";").map((s) => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir["script-src"], ["'self'"]);
  assert.deepEqual(dir["default-src"], ["'none'"]);
  assert.deepEqual(dir["frame-ancestors"], ["'none'"]);
  assert.ok(!/unsafe-|\*|https?:/.test(csp), csp);
});

// ── (7) build safety ────────────────────────────────────────────────────────
test("holds (7): every top-level statement in the new functions files is an import, export or declaration", () => {
  const files = ["functions/api/_owner_gate.js", "functions/api/_mission_r2.js", "functions/api/_mission_stripe.js",
    "functions/api/_mission_data.js", "functions/admin/api/mission.js", "functions/admin/api/mission-outreach.js"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(H.REPO, f), "utf8");
    let depth = 0, inStr = null, lineStart = true, bad = [];
    const lines = src.split("\n");
    for (const ln of lines) {
      if (depth === 0 && !inStr && lineStart) {
        const t = ln.trim();
        if (t && !t.startsWith("//") && !/^(import|export|const|let|function|async function|\}|\)|\]|"|'|`|\+|\.|[A-Za-z_$][\w$]*:|\/\/)/.test(t)) bad.push(t);
      }
      for (let i = 0; i < ln.length; i++) {
        const c = ln[i];
        if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
        if (c === "/" && ln[i + 1] === "/") break;
        if (c === '"' || c === "'" || c === "`") inStr = c;
        else if (c === "{" || c === "(" || c === "[") depth++;
        else if (c === "}" || c === ")" || c === "]") depth--;
      }
      lineStart = true;
    }
    assert.deepEqual(bad, [], f);
  }
});

// ── (9) the editor ──────────────────────────────────────────────────────────
test("fix (9): the editor never writes without an etag to condition on", async () => {
  const r2 = new H.FakeR2();
  r2.set("admin/outreach.json", { version: 1, towns: {} }, { uploaded: NOW - H.DAY });
  const orig = r2.get.bind(r2);
  r2.get = async (k) => { const o = await orig(k); if (o) { delete o.etag; delete o.httpEtag; } return o; };
  r2.ops.length = 0;
  const headers = new Headers({ "Content-Type": "application/json", "X-MassPermits-Mission": "1",
    "Sec-Fetch-Site": "same-origin", "Cf-Access-Jwt-Assertion": owner() });
  const req = new Request("https://masspermits.com/admin/api/mission-outreach",
    { method: "POST", headers, body: JSON.stringify({ town: "Adams", outreach: "sent" }) });
  const res = await m.outreach.onRequestPost({ request: req, env: H.env(r2, { MISSION_OUTREACH_EDIT: "1" }), now: NOW });
  assert.equal(res.status, 409);
  assert.equal(r2.ops.filter((o) => o.op === "put").length, 0);
});

// ── (10) subrequests, measured in one request ───────────────────────────────
test("holds (10): cold JWKS + worst-case R2 + worst-case Stripe in ONE request stays <= 45 subrequests", async () => {
  const team = "budget-team.example.com";
  stub.jwks[team] = [signer.jwk];
  const w = await H.quietWorld(NOW);
  w.r2.listLimit = 1;
  for (const [prefix, meta] of [["prospects/", { trade: "roofing" }], ["agent-prospects/", { town: "Barnstable" }],
    ["newsletter/", { c: "1", un: "0" }]]) {
    for (let i = 0; i < 5; i++) w.r2.set(prefix + "b" + i + "@example.com", "", { customMetadata: { ...meta, ts: String(NOW - H.DAY) } });
  }
  // every list long enough to still have more after 3 pages (as the P1-14 Stripe budget test builds it)
  const nowS = Math.floor(NOW / 1000);
  const many = H.stripeData(w.roster, NOW, {
    openInvoices: [1, 2, 3, 4].map((i) => ({ id: "in_TESTopen000" + i, customer: w.roster[i].customer, status: "open",
      amount_due: 4900, currency: "usd", created: nowS - 86400, attempt_count: 0, lines: { data: [{ price: { id: H.PRICE_A } }] } })),
    webhooks: [1, 2, 3, 4].map((i) => ({ id: "we_TEST00000" + i, status: "enabled", enabled_events: ["*"] })),
  });
  many.sessions.push(...many.sessions.map((c, i) => ({ ...c, id: c.id + "x" + i })));
  stub.stripe = H.stripeFake(many, { pageSize: 1, alwaysMore: () => true });
  await H.resetCaches();
  stub.reset();
  w.r2.ops.length = 0;
  const token = H.mint(signer, H.claims({ iss: "https://" + team }));
  const res = await H.call(m.mission, { env: H.env(w.r2, { CF_ACCESS_TEAM_DOMAIN: team,
    STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A + "," + H.PRICE_B }), now: NOW, token });
  assert.equal(res.status, 200);
  const jwks = stub.calls.filter((c) => c.url.endsWith("/cdn-cgi/access/certs")).length;
  const total = w.r2.ops.length + stub.calls.length;
  assert.equal(jwks, 1);
  assert.equal(stub.stripeCalls().length, 15);
  assert.equal(w.r2.ops.length, 25);
  assert.ok(total <= 45, "subrequests " + total);
  if (process.env.MISSION_TABLE) console.log("SUBREQUESTS " + JSON.stringify({ r2: w.r2.ops.length, stripe: 15, jwks, total }));
});
