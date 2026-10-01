// The engine read route (functions/api/get-drop.js): OIDC refusals and key attacks.
// Every refusal must happen BEFORE the bucket is touched.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_h.mjs";

const { getDrop } = await H.load();
const DATA_KEY = "manual-raw/town-a/20260921T140309Z-abcdef012345.csv";

function world() {
  const r2 = new H.FakeR2();
  r2.seed("manual-raw/index.json", JSON.stringify({ schema: 1, entries: [] }));
  r2.seed(DATA_KEY, "col_a,col_b\n1,2\n");
  for (const k of ["subscribers.json", "engine.tar.gz", "feed-send-log.json", "latest-weekly.zip",
    "manual-raw/subscribers.json", "manual-raw/town-a/notes.txt"]) r2.seed(k, "SECRET-" + k);
  r2.ops.length = 0;
  return r2;
}

async function get(query, { token, method = "GET", r2 = world() } = {}) {
  const t = token === undefined ? await H.jwt(H.ghClaims()) : token;
  const headers = t ? { Authorization: "Bearer " + t } : {};
  const request = new Request("https://masspermits.com/api/get-drop" + query, { method, headers });
  const res = await getDrop.onRequest({ request, env: { BUNDLES: r2 } });
  return { res, r2, body: await res.text() };
}

test("a valid weekly-refresh token on main reads the index and a data file", async () => {
  const a = await get("?key=manual-raw/index.json");
  assert.equal(a.res.status, 200);
  assert.equal(a.res.headers.get("cache-control"), "no-store");
  assert.equal(a.res.headers.get("content-type"), "application/json");
  const b = await get("?key=" + DATA_KEY);
  assert.equal(b.res.status, 200);
  assert.equal(b.body, "col_a,col_b\n1,2\n");
  assert.match(b.res.headers.get("content-type"), /^text\/csv/);
  const c = await get("?key=" + encodeURIComponent(DATA_KEY));
  assert.equal(c.res.status, 200, "a %2F-encoded slash is fine");
  for (const [k] of b.res.headers) assert.ok(!k.startsWith("access-control-"));
  const miss = await get("?key=manual-raw/town-a/20260921T140310Z-abcdef012345.pdf");
  assert.equal(miss.res.status, 404);
});

test("OIDC refusals: wrong workflow_ref, ref, repo, aud, issuer, expired, bad signature, no token", async () => {
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ["workflow_ref other file", H.ghClaims({ workflow_ref: "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-feed.yml@refs/heads/main" }), "workflow"],
    ["workflow_ref other branch", H.ghClaims({ workflow_ref: "capecodtaxappeal/masspermits-lander/.github/workflows/weekly-refresh.yml@refs/heads/dev" }), "workflow"],
    ["workflow_ref missing", H.ghClaims({ workflow_ref: undefined }), "workflow"],
    ["job_workflow_ref reusable elsewhere", H.ghClaims({ job_workflow_ref: "other/repo/.github/workflows/x.yml@refs/heads/main" }), "workflow"],
    ["ref", H.ghClaims({ ref: "refs/heads/claude/manual-inputs" }), "ref"],
    ["ref pull", H.ghClaims({ ref: "refs/pull/1/merge" }), "ref"],
    ["repo", H.ghClaims({ repository: "someone/masspermits-lander" }), "repo"],
    ["aud", H.ghClaims({ aud: "sts.amazonaws.com" }), "aud"],
    ["iss", H.ghClaims({ iss: "https://evil.example" }), "iss"],
    ["expired", H.ghClaims({ exp: now - 1 }), "expired"],
  ];
  for (const [name, claims, reason] of cases) {
    const { res, r2, body } = await get("?key=manual-raw/index.json", { token: await H.jwt(claims) });
    assert.equal(res.status, 401, name);
    assert.equal(JSON.parse(body).reason, reason, name);
    assert.equal(r2.ops.length, 0, name);
  }
  const forged = await get("?key=manual-raw/index.json", { token: await H.jwt(H.ghClaims(), { key: H.keys.rogue.privateKey }) });
  assert.equal(forged.res.status, 401);
  assert.equal(JSON.parse(forged.body).reason, "sig");
  const none = await get("?key=manual-raw/index.json", { token: "" });
  assert.equal(none.res.status, 401);
  assert.equal(none.r2.ops.length, 0);
});

test("key attacks are refused before R2", async () => {
  const bad = [
    "?key=manual-raw/../subscribers.json",
    "?key=manual-raw/%2e%2e/subscribers.json",
    "?key=manual-raw/%2E%2E%2Fsubscribers.json",
    "?key=manual-raw/%252e%252e/subscribers.json",
    "?key=manual-raw%2f..%2fsubscribers.json",
    "?key=manual-raw/..%5csubscribers.json",
    "?key=manual-raw\\..\\subscribers.json",
    "?key=manual-raw%5C..%5Csubscribers.json",
    "?key=manual-raw/x/../../engine.tar.gz",
    "?key=manual-raw/town-a/../../engine.tar.gz",
    "?key=manual-raw/subscribers.json",
    "?key=manual-raw/town-a/notes.txt",
    "?key=manual-raw/town-a/20260921T140309Z-abcdef012345.csv.exe",
    "?key=manual-raw/town-a/20260921T140309Z-abcdef012345.csv%00",
    "?key=manual-raw/town-a/20260921T140309Z-abcdef012345.csv%0a",
    "?key=manual-raw/town-a/20260921T140309Z-ABCDEF012345.csv",
    "?key=manual-raw/Town-A/20260921T140309Z-abcdef012345.csv",
    "?key=/manual-raw/index.json",
    "?key=manual-raw//index.json",
    "?key=manual-raw/index.json/",
    "?key=manual-raw/index.json%20",
    "?key=%20manual-raw/index.json",
    "?key=manual-raw/" + encodeURIComponent("indеx.json"),
    "?key=" + encodeURIComponent("manual‐raw/index.json"),
    "?key=manual-raw" + encodeURIComponent("∕") + "index.json",
    "?key=manual-raw/" + encodeURIComponent("．．") + "/subscribers.json",
    "?key=manual-raw/index.json&key=subscribers.json",
    "?key=subscribers.json&key=manual-raw/index.json",
    "?key=manual-raw/index.json&other=1",
    "?KEY=manual-raw/index.json",
    "?key=",
    "",
    "?key=subscribers.json",
    "?key=engine.tar.gz",
    "?key=feed-send-log.json",
    "?key=latest-weekly.zip",
    "?key=source-health.json",
  ];
  for (const q of bad) {
    const { res, r2, body } = await get(q);
    assert.equal(res.status, 400, q);
    assert.equal(r2.ops.length, 0, q);
    assert.ok(!body.includes("SECRET"), q);
  }
});

test("GET only: other methods 405 with no read", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const { res, r2 } = await get("?key=manual-raw/index.json", { method });
    assert.equal(res.status, 405, method);
    assert.equal(r2.ops.length, 0);
  }
});

test("an object over 25 MB is refused", async () => {
  const r2 = world();
  const real = r2.get.bind(r2);
  r2.get = async (k) => { const o = await real(k); return o && { ...o, size: 25 * 1024 * 1024 + 1 }; };
  const { res } = await get("?key=" + DATA_KEY, { r2 });
  assert.equal(res.status, 413);
});

test("KEY_RX is the only door and it is anchored and ASCII", async () => {
  const { store } = await H.load();
  assert.equal(store.KEY_RX.source.startsWith("^manual-raw\\/"), true);
  assert.equal(store.KEY_RX.source.endsWith(")$"), true);
  assert.equal(store.KEY_RX.flags, "");
  assert.equal(getDrop.WORKFLOW_REF, H.WORKFLOW_REF);
  assert.equal(getDrop.MAX_BYTES, 25 * 1024 * 1024);
});
