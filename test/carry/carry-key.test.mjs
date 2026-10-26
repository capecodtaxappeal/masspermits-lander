// Engine round 8 (2026-10-26): the carry-forward store key, carry-store.json.gz.
//
// Patrick's explicit decision: ONE new private key, readable through
// get-object.js and writable through upload-bundle.js, by weekly-refresh.yml on
// main only. These tests run the SHIPPED handlers against the real OIDC
// verifier (a test RSA key served by a fetch stub that throws on any other
// URL) and an in-memory R2, and read the shipped workflow file. Offline:
// nothing here can reach a network. Fixtures are synthetic bytes.
//
//   node --test test/carry/carry-key.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, fakeR2, makeFetchStub, makeOidcKit } from "../rehearsal/harness.mjs";
import { parseYaml } from "../rehearsal/yaml.mjs";

const KEY = "carry-store.json.gz";
// main when this branch was cut (origin/main 3e908ffdb, which contains bb693438a)
const BASE = "3e908ffdb";
const WF = (file) => `capecodtaxappeal/masspermits-lander/.github/workflows/${file}@refs/heads/main`;
const REFRESH = WF("weekly-refresh.yml");

const kit = makeOidcKit();
const stub = makeFetchStub({ [kit.JWKS_URL]: kit.jwksHandler });
globalThis.fetch = stub.fetch;
const token = (ref = REFRESH, extra = {}) => kit.sign({ workflow_ref: ref, job_workflow_ref: ref, ...extra });

const read = (p) => readFileSync(join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const git = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const hasBase = (() => { try { git("cat-file", "-e", BASE + "^{commit}"); return true; } catch { return false; } })();
const readableOf = (src) => [...src.match(/const READABLE = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const allowedOf = (src) => [...src.match(/const ALLOWED_KEYS = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);

const getObject = await import("../../functions/api/get-object.js");
const upload = await import("../../functions/api/upload-bundle.js");
const BYTES = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3, 4, 5]);

async function get(key, tok, r2) {
  const req = new Request(`https://masspermits.com/api/get-object?key=${encodeURIComponent(key)}`,
    { headers: tok ? { authorization: "Bearer " + tok } : {} });
  return getObject.onRequestGet({ request: req, env: { BUNDLES: r2.bucket } });
}
async function put(key, tok, r2, body = BYTES) {
  const req = new Request(`https://masspermits.com/api/upload-bundle?key=${encodeURIComponent(key)}`,
    { method: "PUT", body, headers: { authorization: "Bearer " + tok, "content-type": "application/gzip" } });
  return upload.onRequest({ request: req, env: { BUNDLES: r2.bucket } });
}

test("READABLE and ALLOWED_KEYS differ from main by exactly the one key", { skip: !hasBase && "base commit not in this clone" }, () => {
  const r0 = readableOf(git("show", `${BASE}:functions/api/get-object.js`).replace(/\r\n/g, "\n"));
  const r1 = readableOf(read("functions/api/get-object.js"));
  assert.deepEqual(r1, [...r0, KEY]);
  const a0 = allowedOf(git("show", `${BASE}:functions/api/upload-bundle.js`).replace(/\r\n/g, "\n"));
  const a1 = allowedOf(read("functions/api/upload-bundle.js"));
  assert.deepEqual(a1, [...a0, KEY]);
  assert.ok(!r1.includes("subscribers.json") && !a1.includes("subscribers.json"));
  assert.match(read("functions/api/get-object.js"), /PATRICK'S EXPLICIT DECISION/);
  assert.match(read("functions/api/upload-bundle.js"), /PATRICK'S EXPLICIT DECISION/);
  // the upload cap is unchanged
  assert.match(read("functions/api/upload-bundle.js"), /const MAX_BYTES = 25 \* 1024 \* 1024;/);
});

test("get-object: the refresh workflow reads the store as application/gzip, byte for byte", async () => {
  const r2 = fakeR2({ [KEY]: BYTES });
  const res = await get(KEY, token(), r2);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/gzip");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), BYTES);
});

test("get-object: a missing store is a 404 (the engine's 'absent', first run)", async () => {
  const res = await get(KEY, token(), fakeR2({}));
  assert.equal(res.status, 404);
});

test("get-object: any other workflow on main, or none, is refused the store (401) without reading R2", async () => {
  for (const tok of [token(WF("cold-outreach.yml")), token(WF("weekly-feed.yml")),
    token(REFRESH, { job_workflow_ref: WF("weekly-feed.yml") }),
    kit.sign({}), token(REFRESH, { ref: "refs/heads/claude/x" }), null]) {
    const r2 = fakeR2({ [KEY]: BYTES });
    const res = await get(KEY, tok, r2);
    assert.equal(res.status, 401);
    assert.equal(r2.ops.length, 0, "R2 was not read");
  }
});

test("get-object: the other keys behave exactly as before", async () => {
  const r2 = fakeR2({ "source-health.json": { a: 1 }, "subscribers.json": { secret: 1 } });
  const ok = await get("source-health.json", token(WF("cold-outreach.yml")), r2);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/json");
  assert.equal((await get("subscribers.json", token(), r2)).status, 400);
  assert.equal((await get("latest-monthly.zip", token(), r2)).status, 400);
});

test("upload-bundle: the refresh workflow writes the store with application/gzip", async () => {
  const r2 = fakeR2({});
  const res = await put(KEY, token(), r2);
  assert.equal(res.status, 200);
  const o = r2.store.get(KEY);
  assert.deepEqual(o.bytes, BYTES);
  assert.equal(o.httpMetadata.contentType, "application/gzip");
});

test("upload-bundle: any other workflow on main is refused the store (401), and writes nothing", async () => {
  for (const tok of [token(WF("cold-outreach.yml")), token(REFRESH, { job_workflow_ref: WF("x.yml") }), kit.sign({})]) {
    const r2 = fakeR2({});
    const res = await put(KEY, tok, r2);
    assert.equal(res.status, 401);
    assert.equal(r2.writes().length, 0);
  }
  // an unrelated key from another workflow is unchanged behaviour (allowed)
  const r2 = fakeR2({});
  assert.equal((await put("cold-log.txt", token(WF("cold-outreach.yml")), r2, "x")).status, 200);
});

test("upload-bundle: the 25 MB cap still applies to the store", async () => {
  const r2 = fakeR2({});
  const res = await put(KEY, token(), r2, new Uint8Array(25 * 1024 * 1024 + 1));
  assert.equal(res.status, 413);
  assert.equal(r2.writes().length, 0);
});

test("weekly-refresh.yml: the two carry steps sit where the design says, and never print the store", () => {
  const y = parseYaml(read(".github/workflows/weekly-refresh.yml"));
  const steps = y.jobs.refresh.steps;
  const names = steps.map((s) => s.name);
  const at = (n) => names.indexOf(n);
  const fetchI = at("Fetch carry-forward store (private; never printed)");
  const scrapeI = at("Scrape, quality-gate, build bundles");
  const shipI = at("Ship bundles to R2 (curl + OIDC)");
  const carryI = at("Ship carry-forward store (private; never printed)");
  assert.ok(fetchI > 0 && fetchI < scrapeI, "fetch before the scrape");
  assert.equal(carryI, shipI + 1, "store upload right after the bundle upload");
  for (const i of [fetchI, carryI]) {
    const s = steps[i];
    assert.equal(s["continue-on-error"], true);
    assert.equal(s.if, undefined, "default if: success() (no always())");
    assert.ok(!/\b(cat|head|tail|less|zcat|gunzip|base64|xxd|od)\b[^\n]*carry-store\.(json|out)/.test(s.run), "never printed");
    assert.ok(!/always\(\)/.test(s.run));
  }
  assert.match(steps[fetchI].run, /get-object\?key=carry-store\.json\.gz/);
  assert.match(steps[carryI].run, /upload-bundle\?key=carry-store\.json\.gz/);
  assert.match(steps[carryI].run, /--data-binary @carry-store\.out\.json\.gz/);
  // the uploaded file is the engine's OUT file, never the downloaded one
  assert.ok(!/@carry-store\.json\.gz/.test(steps[carryI].run));
  const verify = steps[at("Verify the engine is complete")].run;
  assert.match(verify, /for f in source_health\.py bundle_manifest\.py carry_forward\.py; do/);
  // the paying-customer steps are untouched
  assert.equal(steps[shipI].run, parseYaml(git("show", `${BASE}:.github/workflows/weekly-refresh.yml`).replace(/\r\n/g, "\n"))
    .jobs.refresh.steps.find((s) => s.name === "Ship bundles to R2 (curl + OIDC)").run);
});

test("weekly-refresh.yml differs from main only by the carry steps and the warn-only line", { skip: !hasBase && "base commit not in this clone" }, () => {
  const old = parseYaml(git("show", `${BASE}:.github/workflows/weekly-refresh.yml`).replace(/\r\n/g, "\n"));
  const neu = parseYaml(read(".github/workflows/weekly-refresh.yml"));
  const strip = (y) => JSON.parse(JSON.stringify(y, (k, v) => v));
  const o = strip(old), n = strip(neu);
  const nSteps = n.jobs.refresh.steps.filter((s) => !/carry-forward store/.test(s.name || ""));
  const vI = nSteps.findIndex((s) => s.name === "Verify the engine is complete");
  nSteps[vI] = { ...nSteps[vI], run: nSteps[vI].run
    .replace(/ *# carry_forward\.py \(engine round 8\) joins this tier: without it the\n *# engine carries nothing and writes no carry store, exactly as before\.\n/, "")
    .replace("bundle_manifest.py carry_forward.py;", "bundle_manifest.py;") };
  n.jobs.refresh.steps = nSteps;
  assert.deepEqual(n, o);
});

test("no network call was attempted except the stubbed JWKS", () => {
  assert.deepEqual(stub.unexpected, []);
});
