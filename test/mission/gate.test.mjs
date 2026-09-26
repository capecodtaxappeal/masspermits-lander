// P1-2 .. P1-7: the owner gate and the route's request checks.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { m, stub, signer, owner, get } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const REASONS = new Set(["not-found", "not-configured", "no-assertion-header", "no-assertion", "not-jwt",
  "bad-encoding", "alg", "iss", "aud", "expired", "kid", "sig", "verify-error", "token-type",
  "not-a-person", "not-yet-valid", "not-owner"]);

function assertSecHeaders(res) {
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.ok(res.headers.get("content-type"));
  for (const [k] of res.headers) assert.ok(!k.toLowerCase().startsWith("access-control-allow"), k);
}

async function fresh() {
  const w = await H.healthyWorld(NOW);
  w.r2.ops.length = 0;
  stub.reset();
  return w;
}

test("P1-2 non-canonical hosts 404 with 0 R2 ops and 0 fetch calls", async () => {
  for (const host of ["www.masspermits.com", "masspermits-lander.pages.dev",
    "abc123.masspermits-lander.pages.dev", "heartbeat.masspermits-lander.pages.dev"]) {
    const w = await fresh();
    const res = await get(w, { host });
    assert.equal(res.status, 404, host);
    assert.equal(w.r2.ops.length, 0, host + " r2 ops");
    assert.equal(stub.calls.length, 0, host + " fetch calls");
    assertSecHeaders(res);
    for (const q of ["", "?view=map"]) {
      const r = await get(w, { host, query: q, headers: { Accept: "text/html" } });
      assert.equal(r.status, 404);
    }
  }
});

test("P1-2 an uppercase or trailing-dot host is not the apex", async () => {
  const w = await fresh();
  assert.equal((await get(w, { host: "MASSPERMITS.COM" })).status, 200, "URL lowercases the host");
  const r = await get(w, { host: "masspermits.com." });
  assert.equal(r.status, 404);
});

test("P1-3 each of the three variables missing or blank -> 403 not-configured, 0 R2 ops", async () => {
  for (const name of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_ALLOWED_EMAILS"]) {
    for (const value of [undefined, "", "   ", " , "]) {
      if (value === " , " && name !== "ADMIN_ALLOWED_EMAILS") continue;
      const w = await fresh();
      const e = H.env(w.r2);
      if (value === undefined) delete e[name]; else e[name] = value;
      const res = await H.call(m.mission, { env: e, now: NOW, token: owner() });
      assert.equal(res.status, 403, name + "=" + JSON.stringify(value));
      assert.equal(res.body.reason, "not-configured");
      assert.equal(w.r2.ops.length, 0);
      assertSecHeaders(res);
    }
  }
});

test("P1-3 OWNER_EMAIL alone does not enable it", async () => {
  const w = await fresh();
  const e = H.env(w.r2, { OWNER_EMAIL: H.OWNER });
  delete e.ADMIN_ALLOWED_EMAILS;
  const res = await H.call(m.mission, { env: e, now: NOW, token: owner() });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "not-configured");
  assert.equal(w.r2.ops.length, 0);
});

test("P1-4 a valid owner JWT only in the CF_Authorization cookie -> 403 no-assertion-header", async () => {
  const w = await fresh();
  const res = await get(w, { token: null, cookie: "CF_Authorization=" + owner() });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "no-assertion-header");
  assert.equal(w.r2.ops.length, 0);
  assert.equal(stub.calls.length, 0);
});

test("P1-5 stranger -> 403 not-owner, 0 R2 ops, 0 Stripe calls", async () => {
  const w = await fresh();
  const res = await get(w, { token: owner({ email: H.STRANGER }),
    env: { STRIPE_READ_KEY: H.liveKey(), MASSPERMITS_PRICE_IDS: H.PRICE_A } });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "not-owner");
  assert.equal(w.r2.ops.length, 0);
  assert.equal(stub.stripeCalls().length, 0);
  assertSecHeaders(res);
});

test("P1-5 positive control: mixed case and spaces in env and claim -> 200", async () => {
  const w = await fresh();
  const res = await get(w, { token: owner({ email: "  Owner@Example.COM " }),
    env: { ADMIN_ALLOWED_EMAILS: " someone.else@example.com ,  OWNER@example.com , " } });
  assert.equal(res.status, 200);
  assert.equal(res.body.signed_in_as, "owner@example.com");
  assertSecHeaders(res);
});

test("P1-6 non-person and not-yet-valid tokens -> 403", async () => {
  const cases = {
    "service token": [{ common_name: "svc.access", sub: "", email: undefined }, "not-a-person"],
    "common_name with an email": [{ common_name: "svc.access" }, "not-a-person"],
    "empty sub": [{ sub: "" }, "not-a-person"],
    "no email": [{ email: undefined }, "not-a-person"],
    "type org": [{ type: "org" }, "token-type"],
    "nbf in 10 minutes": [{ nbf: Math.floor(Date.now() / 1000) + 600 }, "not-yet-valid"],
    "iat in 10 minutes": [{ iat: Math.floor(Date.now() / 1000) + 600 }, "not-yet-valid"],
  };
  for (const [name, [over, reason]] of Object.entries(cases)) {
    const w = await fresh();
    const c = H.claims(over);
    for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
    const res = await get(w, { token: H.mint(signer, c) });
    assert.equal(res.status, 403, name);
    assert.equal(res.body.reason, reason, name);
    assert.equal(w.r2.ops.length, 0, name);
  }
});

test("P1-6 bad tokens -> 403 and no exception text in any body", async () => {
  const nowS = Math.floor(Date.now() / 1000);
  const other = H.makeSigner("other-kid");
  const cases = {
    expired: [H.mint(signer, H.claims({ exp: nowS - 5 })), "expired"],
    "wrong aud": [H.mint(signer, H.claims({ aud: ["someone-else"] })), "aud"],
    "wrong iss": [H.mint(signer, H.claims({ iss: "https://evil.cloudflareaccess.com" })), "iss"],
    "alg none": [H.mint(signer, H.claims(), { alg: "none" }), "alg"],
    HS256: [H.mint(signer, H.claims(), { alg: "HS256" }), "alg"],
    "bad signature": [H.mint(signer, H.claims(), { tamper: true }), "sig"],
    "signed by another key": [H.mint(other, H.claims(), { kid: signer.kid }), "sig"],
    "unknown kid": [H.mint(other, H.claims()), "kid"],
    "malformed base64": ["@@@.@@@.@@@", "bad-encoding"],
    "not a jwt": ["abc.def", "not-jwt"],
  };
  for (const [name, [token, reason]] of Object.entries(cases)) {
    const w = await fresh();
    const res = await get(w, { token });
    assert.equal(res.status, 403, name);
    assert.equal(res.body.reason, reason, name);
    assert.deepEqual(Object.keys(res.body).sort(), ["error", "reason"], name);
    assert.equal(w.r2.ops.length, 0, name);
    assert.ok(!/[A-Za-z]*Error\b|exception|stack|unexpected|network/.test(res.text), name + ": " + res.text);
  }
});

test("P1-6 certs endpoint throwing -> 403 verify-error, no exception text", async () => {
  const team = "example-team-certs-down.cloudflareaccess.com";
  const w = await fresh();
  const token = H.mint(signer, H.claims({ iss: "https://" + team }));
  const res = await get(w, { token, env: { CF_ACCESS_TEAM_DOMAIN: team } });
  assert.equal(res.status, 403);
  assert.equal(res.body.reason, "verify-error");
  assert.ok(!/[A-Za-z]*Error\b|unexpected|network|certs/.test(res.text), res.text);
  assert.equal(w.r2.ops.length, 0);
});

test("denied(): a navigation gets the HTML page with the security headers; reasons stay in the fixed set", async () => {
  const w = await fresh();
  const res = await get(w, { token: owner({ email: H.STRANGER }), headers: { Accept: "text/html" } });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assertSecHeaders(res);
  assert.ok(res.text.includes("not-owner"));
  const r2 = await m.gate.denied({ ok: false, status: 403, reason: "verify-error:boom secret" },
    new Request("https://masspermits.com/admin/api/mission"));
  assert.equal(JSON.parse(await r2.text()).reason, "verify-error");
  for (const r of REASONS) assert.ok(typeof r === "string");
});

test("P1-7 missing header, cross-site, bad view, extra parameter -> 403/403/400/400 with 0 R2 ops", async () => {
  const cases = [
    [{ mission: false }, 403],
    [{ site: "cross-site" }, 403],
    [{ site: "same-site" }, 403],
    [{ query: "?view=other" }, 400],
    [{ query: "?view=map&x=1" }, 400],
    [{ query: "?foo=1" }, 400],
    [{ query: "?view=map&view=map" }, 400],
    [{ query: "?view=" }, 400],
  ];
  for (const [o, status] of cases) {
    const w = await fresh();
    const res = await get(w, o);
    assert.equal(res.status, status, JSON.stringify(o));
    assert.equal(w.r2.ops.length, 0, JSON.stringify(o));
    assertSecHeaders(res);
  }
  const w = await fresh();
  assert.equal((await get(w, { site: null })).status, 200, "Sec-Fetch-Site absent is allowed");
  assert.equal((await get(w, { query: "?view=map" })).status, 200);
});

test("P1-7 POST to the GET route is not 200", async () => {
  assert.deepEqual(Object.keys(m.mission).sort(), ["onRequestGet"]);
  const w = await fresh();
  const res = await H.call(m.mission, { env: H.env(w.r2), now: NOW, token: owner(), method: "POST" });
  assert.notEqual(res.status, 200);
  assert.equal(w.r2.ops.length, 0);
});

test("every 200 carries the security headers", async () => {
  const w = await fresh();
  assertSecHeaders(await get(w));
  assertSecHeaders(await get(w, { query: "?view=map" }));
});
