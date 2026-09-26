// P2-6: the outreach editor, POST /admin/api/mission-outreach.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, stub, owner } = await H.setup();
const E = m.outreach;
const NOW = H.T("2026-09-30T18:00:00Z");
const KEY = "admin/outreach.json";
const SEED = { version: 1, updated_at: "2026-09-01T00:00:00Z",
  towns: { Adams: { outreach: "planned", locked: true, note: "records request" }, Alford: { outreach: "sent", since: "2026-09-10" } },
  history: [] };

const ABSENT = Symbol("absent");
function world(doc = SEED) {
  const r2 = new H.FakeR2();
  if (doc !== ABSENT) r2.set(KEY, typeof doc === "string" ? doc : JSON.stringify(doc), { uploaded: NOW - H.DAY });
  r2.ops.length = 0;
  return r2;
}

function req(o = {}) {
  const h = new Headers();
  if (o.token !== null) h.set("Cf-Access-Jwt-Assertion", o.token || owner());
  if (o.mission !== false) h.set("X-MassPermits-Mission", "1");
  if (o.site !== null) h.set("Sec-Fetch-Site", o.site || "same-origin");
  if (o.ctype !== null) h.set("Content-Type", o.ctype || "application/json");
  const body = o.raw !== undefined ? o.raw : JSON.stringify(o.body || { town: "Adams", outreach: "sent" });
  return new Request("https://" + (o.host || "masspermits.com") + "/admin/api/mission-outreach",
    { method: "POST", headers: h, body });
}

async function post(r2, o = {}, envOver = {}) {
  stub.reset();
  const env = H.env(r2, { MISSION_OUTREACH_EDIT: "1", ...envOver });
  const res = await E.onRequestPost({ request: req(o), env, now: NOW });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { body = null; }
  return { status: res.status, body, text, headers: res.headers };
}

const puts = (r2) => r2.ops.filter((x) => x.op === "put");

test("P2-6 flag unset (or not exactly \"1\") -> 404 with 0 R2 ops and 0 fetch calls", async () => {
  for (const flag of [undefined, "", "0", "true", " 1", "yes"]) {
    const r2 = world();
    const res = await post(r2, {}, { MISSION_OUTREACH_EDIT: flag });
    assert.equal(res.status, 404, String(flag));
    assert.equal(r2.ops.length, 0);
    assert.equal(stub.calls.length, 0);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("P2-6 gate failures -> 403 (or the gate's 404 off the apex) with 0 R2 ops", async () => {
  const cases = [
    [{ host: "www.masspermits.com" }, {}, 404],
    [{ host: "masspermits-lander.pages.dev" }, {}, 404],
    [{}, { ADMIN_ALLOWED_EMAILS: "" }, 403],
    [{}, { CF_ACCESS_AUD: " " }, 403],
    [{ token: null }, {}, 403],
    [{ token: H.mint(H.makeSigner("other-kid"), H.claims()) }, {}, 403],
    [{ token: "not.a.jwt" }, {}, 403],
  ];
  for (const [o, env, want] of cases) {
    const r2 = world();
    const res = await post(r2, o, env);
    assert.equal(res.status, want, JSON.stringify(o) + JSON.stringify(env));
    assert.equal(r2.ops.length, 0);
  }
  const r2 = world();
  const stranger = await post(r2, { token: owner({ email: H.STRANGER }) });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.reason, "not-owner");
  assert.equal(r2.ops.length, 0);
});

test("P2-6 missing mission header, missing or cross-site Sec-Fetch-Site -> 403, 0 ops", async () => {
  for (const o of [{ mission: false }, { site: null }, { site: "cross-site" }, { site: "same-site" }, { site: "none" }]) {
    const r2 = world();
    const res = await post(r2, o);
    assert.equal(res.status, 403, JSON.stringify(o));
    assert.equal(r2.ops.length, 0);
  }
});

test("P2-6 bad town, bad state, extra key, 513-byte body, wrong content type -> 400, 0 writes", async () => {
  const big = JSON.stringify({ town: "Adams", outreach: "sent", pad: "" });
  const pad513 = big.slice(0, -2) + "x".repeat(513 - big.length) + "\"}";
  assert.equal(Buffer.byteLength(pad513), 513);
  const cases = [
    { body: { town: "Atlantis", outreach: "sent" } },
    { body: { town: "adams", outreach: "sent" } },
    { body: { town: "Foxboro", outreach: "sent" } },
    { body: { town: "__proto__", outreach: "sent" } },
    { body: { town: "Adams", outreach: "won" } },
    { body: { town: "Adams", outreach: "" } },
    { body: { town: "Adams" } },
    { body: { town: "Adams", outreach: "sent", note: "x" } },
    { raw: pad513 },
    { raw: "{\"town\":\"Adams\",\"outreach\":\"sent\"" },
    { raw: "[\"Adams\",\"sent\"]" },
    { raw: "" },
    { ctype: "text/plain" },
    { ctype: null },
    { ctype: "application/x-www-form-urlencoded" },
  ];
  for (const o of cases) {
    const r2 = world();
    const res = await post(r2, o);
    assert.equal(res.status, 400, JSON.stringify(o).slice(0, 80));
    assert.deepEqual(res.body, { error: "bad_request" });
    assert.equal(puts(r2).length, 0);
    assert.equal(r2.ops.length, 0);
  }
  // a 512-byte body is accepted
  const ok512 = JSON.stringify({ town: "Adams", outreach: "sent" }) + " ".repeat(512 - 34);
  assert.equal(Buffer.byteLength(ok512), 512);
  const r2 = world();
  assert.equal((await post(r2, { raw: ok512 })).status, 200);
});

test("P2-6 object absent or unparseable -> 409, 0 writes", async () => {
  for (const doc of [ABSENT, "{not json", "[]", JSON.stringify({ version: 1 }), JSON.stringify({ towns: [] })]) {
    const r2 = world(doc);
    const res = await post(r2);
    assert.equal(res.status, 409, String(doc));
    assert.equal(puts(r2).length, 0);
    assert.ok(["absent", "unreadable"].includes(res.body.error));
  }
  const r2 = world("{" + "\"x\":1,".repeat(12000) + "\"towns\":{}}");
  const res = await post(r2);
  assert.equal(res.status, 409);
  assert.equal(puts(r2).length, 0);
});

test("P2-6 etag race: the object changes between read and write -> 409, nothing lost", async () => {
  const r2 = world();
  const realGet = r2.get.bind(r2);
  r2.get = async (key) => {
    const o = await realGet(key);
    // someone else writes after this read
    r2.set(KEY, JSON.stringify({ ...SEED, towns: { ...SEED.towns, Ashfield: { outreach: "planned" } } }));
    return o;
  };
  const res = await post(r2);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: "conflict" });
  assert.equal(puts(r2).length, 1, "the conditional put was attempted");
  assert.equal(r2.json(KEY).towns.Ashfield.outreach, "planned", "the other write survives");
  assert.equal(r2.json(KEY).towns.Adams.outreach, "planned");
});

test("P2-6 success -> exactly one put of admin/outreach.json with onlyIf etagMatches; {ok:true}", async () => {
  const r2 = world();
  const etag = r2.objects.get(KEY).etag;
  const res = await post(r2, { body: { town: "Adams", outreach: "sent" } });
  assert.equal(res.status, 200);
  assert.equal(res.text, "{\"ok\":true}");
  const p = puts(r2);
  assert.equal(p.length, 1);
  assert.equal(p[0].key, KEY);
  assert.deepEqual(p[0].opts.onlyIf, { etagMatches: etag });
  assert.deepEqual(p[0].opts.httpMetadata, { contentType: "application/json" });
  assert.deepEqual(r2.ops.map((x) => x.op + " " + x.key), ["get " + KEY, "put " + KEY]);
  const doc = r2.json(KEY);
  assert.deepEqual(doc.towns.Adams, { outreach: "sent", locked: true, note: "records request", since: "2026-09-30" });
  assert.deepEqual(doc.history, [{ at: "2026-09-30T18:00:00.000Z", town: "Adams", from: "planned", to: "sent" }]);
  assert.equal(doc.updated_at, "2026-09-30T18:00:00.000Z");
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  // null clears the state and its date, keeps the owner's other fields
  const res2 = await post(r2, { body: { town: "Adams", outreach: null } });
  assert.equal(res2.status, 200);
  assert.deepEqual(r2.json(KEY).towns.Adams, { locked: true, note: "records request" });
  assert.deepEqual(r2.json(KEY).history[1], { at: "2026-09-30T18:00:00.000Z", town: "Adams", from: "sent", to: null });
  // a town with nothing left is removed
  await post(r2, { body: { town: "Alford", outreach: null } });
  assert.equal(r2.json(KEY).towns.Alford, undefined);
});

test("P2-6 history is capped at the newest 200", async () => {
  const history = Array.from({ length: 200 }, (_, i) => ({ at: "2026-01-01T00:00:00Z", town: "Adams", from: null, to: "h" + i }));
  const r2 = world({ ...SEED, history });
  const res = await post(r2, { body: { town: "Ashfield", outreach: "planned" } });
  assert.equal(res.status, 200);
  const h = r2.json(KEY).history;
  assert.equal(h.length, 200);
  assert.equal(h[0].to, "h1");
  assert.deepEqual(h[199], { at: "2026-09-30T18:00:00.000Z", town: "Ashfield", from: null, to: "planned" });
});

test("P2-6 writerFor exposes only put, and only for admin/outreach.json", async () => {
  // writerFor is module-private (the route exports onRequestPost only), so the
  // test evaluates the SHIPPED function's own source text, byte for byte.
  const src = fs.readFileSync(path.join(H.REPO, "functions/admin/api/mission-outreach.js"), "utf8");
  const start = src.indexOf("function writerFor(bucket) {");
  const end = src.indexOf("\n}\n", start) + 2;
  assert.ok(start > 0 && end > start);
  const url = "data:text/javascript," + encodeURIComponent('const KEY = "admin/outreach.json";\n' +
    src.slice(start, end) + "\nexport { writerFor };");
  const { writerFor } = await import(url);
  const r2 = new H.FakeR2();
  const w = writerFor(r2);
  assert.deepEqual(Object.keys(w), ["put"]);
  assert.ok(Object.isFrozen(w));
  for (const k of ["subscribers.json", "admin/outreach.json.bak", "admin/outreach.jso", "ADMIN/OUTREACH.JSON", "", "prospects/x"]) {
    assert.throws(() => w.put(k, "{}"), /writer_key/, k);
  }
  assert.equal(r2.ops.length, 0);
  await w.put(KEY, "{}");
  assert.deepEqual(r2.ops.map((x) => x.key), [KEY]);
  assert.match(src, /const KEY = "admin\/outreach\.json";/);
});
