// Pay path audit: my-leads.js, get-object.js, upload-bundle.js (SHIPPED source).
//   node --test test/paypath-audit/r2-endpoints.audit.test.mjs
// See _harness.mjs for the DEFECT / OK naming rule and the no-network guard.

import test from "node:test";
import assert from "node:assert/strict";
import { load, fakeR2, env, sub, zip, tok } from "./_harness.mjs";

const ml = await load("functions/api/my-leads.js");
const go = await load("functions/api/get-object.js");
const ub = await load("functions/api/upload-bundle.js");

const AUTH = { authorization: "Bearer test-stub" };
const MAIN_REFRESH = "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/main";
const OTHER_WF = "capecodtaxappeal/masspermits-lander/.github/workflows/cold-outreach.yml@refs/heads/main";

function world() {
  return fakeR2({
    "subscribers.json": [sub(1), sub(2, { active: false, cancelled: "2026-10-01" })],
    "latest-weekly.zip": zip("weekly"), "latest-monthly.zip": zip("monthly"),
    "cold-queue.json": { q: [] }, "carry-store.json.gz": zip("gz"),
  });
}
const leads = (r2, q, ua = "Mozilla/5.0") => ml.onRequestGet({
  request: new Request("https://masspermits.com/api/my-leads" + q, { headers: { "user-agent": ua } }),
  env: env(r2), waitUntil: (p) => p });

// ---------------------------------------------------------------- my-leads
test("DEFECT M1: an R2 error reading the bundle escapes the handler (generic platform 500, no customer message)", async () => {
  const r2 = world();
  r2.throwAlways.add("get:latest-weekly.zip");
  let res;
  try { res = await leads(r2, "?t=" + sub(1).token); } catch (e) { res = { status: "threw: " + e.message }; }
  assert.equal(res.status, 503, "expected the same friendly 503 the subscribers.json read gives; got " + res.status);
});

test("OK: my-leads token gate: valid 200, inactive 403, unknown 403, malformed or encoded 400", async () => {
  const r2 = world();
  assert.equal((await leads(r2, "?t=" + sub(1).token)).status, 200);
  assert.equal((await leads(r2, "?t=" + sub(2).token)).status, 403);
  assert.equal((await leads(r2, "?t=" + tok("9"))).status, 403);
  for (const bad of ["", "?t=", "?t=" + sub(1).token.toUpperCase(), "?t=" + sub(1).token + "%00",
                     "?t=" + sub(1).token + "x", "?t=../subscribers.json", "?t[]=" + sub(1).token]) {
    assert.equal((await leads(r2, bad)).status, 400, bad);
  }
});

test("OK: my-leads `k` never reaches R2 as a key: traversal and odd values fall back to the weekly bundle", async () => {
  const r2 = world();
  for (const k of ["../subscribers.json", "subscribers", "MONTHLY", "monthly%2f..", "sample"]) {
    r2.gets.length = 0;
    const res = await leads(r2, "?t=" + sub(1).token + "&k=" + encodeURIComponent(k));
    assert.equal(res.status, 200);
    assert.deepEqual(r2.gets.filter((g) => g !== "subscribers.json"), ["latest-weekly.zip"], k);
  }
});

test("OK: my-leads 403 body names nobody and the download is no-store", async () => {
  const r2 = world();
  const t = await (await leads(r2, "?t=" + sub(2).token)).text();
  assert.ok(!/example\.test|Sub2|cus_/.test(t));
  const ok = await leads(r2, "?t=" + sub(1).token);
  assert.equal(ok.headers.get("cache-control"), "no-store");
});

test("OK (by design, see audit O1): a token never expires while the row is active; it dies only with active:false", async () => {
  const r2 = world();
  const row = r2.json("subscribers.json"); row[0].since = "2020-01-01"; r2.set("subscribers.json", row);
  assert.equal((await leads(r2, "?t=" + sub(1).token)).status, 200);
});

// ---------------------------------------------------------------- get-object
const getObj = (r2, key, headers = AUTH) => go.onRequestGet({
  request: new Request("https://masspermits.com/api/get-object?key=" + key, { headers }), env: env(r2) });

test("OK: get-object allowlist is exact: traversal, encoding, case, padding and the customer list are refused", async () => {
  globalThis.__OIDC = { workflow_ref: OTHER_WF };
  const r2 = world();
  for (const k of ["subscribers.json", "..%2Fsubscribers.json", "./cold-queue.json", "Cold-Queue.json",
                   "cold-queue.json%20", "cold-queue.json%00", "cold-queue.json%2F..%2Fsubscribers.json",
                   "latest-monthly.zip", "constructor", "__proto__", "feed-send-log.json", "delivery-log.json"]) {
    const res = await getObj(r2, k);
    assert.equal(res.status, 400, k);
  }
  assert.equal((await getObj(r2, "cold-queue.json")).status, 200);
  assert.equal((await getObj(r2, "cold-queue.json", {})).status, 401);
});

test("OK: get-object serves the paid carry store only to weekly-refresh.yml on main", async () => {
  const r2 = world();
  globalThis.__OIDC = { workflow_ref: OTHER_WF };
  assert.equal((await getObj(r2, "carry-store.json.gz")).status, 401);
  globalThis.__OIDC = { workflow_ref: MAIN_REFRESH, job_workflow_ref: OTHER_WF };
  assert.equal((await getObj(r2, "carry-store.json.gz")).status, 401);
  globalThis.__OIDC = { workflow_ref: MAIN_REFRESH };
  assert.equal((await getObj(r2, "carry-store.json.gz")).status, 200);
});

// ---------------------------------------------------------------- upload-bundle
const up = (r2, key, method = "PUT", headers = AUTH, data = "x") => ub.onRequest({
  request: new Request("https://masspermits.com/api/upload-bundle?key=" + key,
    { method, headers, body: method === "GET" ? undefined : data }), env: env(r2) });

test("DEFECT U1: upload-bundle allowlist uses `in`, so Object.prototype names (constructor, toString, __proto__) are writable keys", async () => {
  globalThis.__OIDC = { workflow_ref: OTHER_WF };
  const r2 = world();
  const got = {};
  for (const k of ["constructor", "toString", "hasOwnProperty", "__proto__"]) got[k] = (await up(r2, k)).status;
  assert.deepEqual(got, { constructor: 400, toString: 400, hasOwnProperty: 400, __proto__: 400 },
    "R2 objects written: " + r2.writes.map((w) => w.key).join(","));
});

test("OK: upload-bundle refuses the customer list, traversal, case variants, GET and unauthenticated callers", async () => {
  globalThis.__OIDC = { workflow_ref: OTHER_WF };
  const r2 = world();
  for (const k of ["subscribers.json", "..%2Fsubscribers.json", "Latest-Weekly.zip", "latest-weekly.zip%20",
                   "cold-queue.json", "suppression.json", "feed-send-log.json"]) {
    assert.equal((await up(r2, k)).status, 400, k);
  }
  assert.equal((await up(r2, "latest-weekly.zip", "GET")).status, 405);
  assert.equal((await up(r2, "latest-weekly.zip", "PUT", {})).status, 401);
  assert.equal((await up(r2, "carry-store.json.gz")).status, 401, "carry store write pinned to weekly-refresh.yml");
  assert.equal((await up(r2, "latest-weekly.zip", "PUT", AUTH, "")).status, 400, "empty body refused");
  assert.equal(r2.writes.length, 0);
});
