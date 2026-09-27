// Road to 100: the owner gate and the route's request checks. Every refusal
// reads nothing: 0 R2 operations and 0 Stripe calls.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { stub, signer, owner, call, envOf } = await H.growthSetup();
const NOW = H.T("2026-09-27T18:00:00Z");

function world() {
  const r2 = new H.GrowthR2();
  r2.hit(NOW - H.HOUR);
  stub.stripe = H.stripeServer({ sessions: [H.session(NOW - H.DAY, "complete")], subscriptions: [H.sub(NOW - 9 * H.DAY, "active")] });
  stub.reset();
  return r2;
}

function assertHeaders(res) {
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  for (const [k] of res.headers) assert.ok(!k.toLowerCase().startsWith("access-control-"), "CORS header " + k);
}

function assertNothingRead(r2) {
  assert.equal(r2.ops.length, 0, "R2 ops " + JSON.stringify(r2.ops));
  assert.equal(stub.stripeCalls().length, 0, "Stripe calls");
}

test("the owner gets 200, no-store and no CORS header", async () => {
  const r2 = world();
  const res = await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  assert.equal(res.status, 200);
  assertHeaders(res);
  assert.equal(typeof res.body.paying_now, "number");
});

test("non-apex hosts answer 404 and read nothing", async () => {
  for (const host of ["www.masspermits.com", "masspermits-lander.pages.dev", "abc123.masspermits-lander.pages.dev", "masspermits.com."]) {
    const r2 = world();
    const res = await call({ env: envOf(r2, H.stripeEnv()), now: NOW, host });
    assert.equal(res.status, 404, host);
    assertHeaders(res);
    assertNothingRead(r2);
    assert.equal(stub.calls.length, 0, host + " made a network call");
  }
});

test("each Access variable missing or blank: 403 not-configured", async () => {
  for (const name of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "ADMIN_ALLOWED_EMAILS"]) {
    for (const value of [undefined, "", "  "]) {
      const r2 = world();
      const e = envOf(r2, H.stripeEnv());
      if (value === undefined) delete e[name]; else e[name] = value;
      const res = await call({ env: e, now: NOW });
      assert.equal(res.status, 403, name);
      assert.equal(res.body.reason, "not-configured");
      assertHeaders(res);
      assertNothingRead(r2);
    }
  }
});

test("token refusals: none, cookie only, bad signature, wrong audience, expired, service token, stranger", async () => {
  const cases = [
    [{ token: null }, "no-assertion-header"],
    [{ token: null, cookie: "CF_Authorization=" + owner() }, "no-assertion-header"],
    [{ token: H.mint(signer, H.claims(), { tamper: true }) }, "sig"],
    [{ token: owner({ aud: ["some-other-app"] }) }, "aud"],
    [{ token: owner({ exp: Math.floor(Date.now() / 1000) - 60 }) }, "expired"],
    [{ token: owner({ common_name: "svc.example.com" }) }, "not-a-person"],
    [{ token: owner({ email: H.STRANGER }) }, "not-owner"],
    [{ token: "not.a.jwt.at.all" }, "not-jwt"],
  ];
  for (const [o, reason] of cases) {
    const r2 = world();
    const res = await call({ ...o, env: envOf(r2, H.stripeEnv()), now: NOW });
    assert.equal(res.status, 403, reason);
    assert.equal(res.body.reason, reason);
    assertHeaders(res);
    assertNothingRead(r2);
  }
});

test("a browser navigation that is refused gets the HTML page, still no-store", async () => {
  const r2 = world();
  const res = await call({ token: null, env: envOf(r2, H.stripeEnv()), now: NOW, headers: { Accept: "text/html" } });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assertHeaders(res);
  assertNothingRead(r2);
});

test("the owner without the page header, or cross-site, is refused before any read", async () => {
  for (const [o, reason] of [[{ growth: false }, "missing-growth-header"], [{ site: "cross-site" }, "cross-site"], [{ site: "same-site" }, "cross-site"]]) {
    const r2 = world();
    const res = await call({ ...o, env: envOf(r2, H.stripeEnv()), now: NOW });
    assert.equal(res.status, 403, reason);
    assert.equal(res.body.reason, reason);
    assertHeaders(res);
    assertNothingRead(r2);
  }
});

test("any query parameter is a 400 before any read", async () => {
  for (const q of ["?x=1", "?view=map", "?debug"]) {
    const r2 = world();
    const res = await call({ query: q, env: envOf(r2, H.stripeEnv()), now: NOW });
    assert.equal(res.status, 400, q);
    assertHeaders(res);
    assertNothingRead(r2);
  }
});

test("a broken bucket shows \"unavailable\" (or a bare 503), never the exception text", async () => {
  const r2 = world();
  const e = envOf({ list() { throw new Error("SECRET-STACK"); }, get() { throw new Error("SECRET-STACK"); }, head() { throw new Error("x"); } }, H.stripeEnv());
  const res = await call({ env: e, now: NOW });
  // R2 failures degrade to "unavailable" cells rather than a 503; the body never carries the error text.
  assert.ok(res.status === 200 || res.status === 503);
  assert.ok(!res.text.includes("SECRET-STACK"));
  if (res.status === 200) {
    for (const w of res.body.weeks) assert.equal(w.visits, "unavailable");
  }
  assert.equal(r2.ops.length, 0);
});

test("the route writes nothing: no put or delete on any request", async () => {
  const r2 = world();
  await call({ env: envOf(r2, H.stripeEnv()), now: NOW });
  assert.ok(r2.ops.length > 0);
  assert.ok(!r2.ops.some((o) => o.op === "put" || o.op === "delete"));
  for (const c of stub.stripeCalls()) assert.equal(c.method, "GET");
});
