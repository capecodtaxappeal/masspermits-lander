// P2-6: the outreach editor (functions/admin/api/mission-outreach.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, owner, stub } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const KEY = "admin/outreach.json";
const ON = { MISSION_OUTREACH_EDIT: "1" };

function seeded(doc) {
  const r2 = new H.FakeR2();
  if (doc !== undefined) r2.set(KEY, doc, { uploaded: NOW - H.DAY });
  return r2;
}
const SEED = { version: 1, updated_at: "2026-09-20T00:00:00Z", towns: { Adams: { outreach: "planned", note: "records request" } },
  history: [] };

async function post(r2, o = {}) {
  const h = new Headers();
  if (o.token !== null) h.set("Cf-Access-Jwt-Assertion", o.token || owner());
  if (o.mission !== false) h.set("X-MassPermits-Mission", "1");
  if (o.site !== null) h.set("Sec-Fetch-Site", o.site || "same-origin");
  h.set("Content-Type", o.type || "application/json");
  const body = o.raw !== undefined ? o.raw : JSON.stringify(o.body || { town: "Alford", outreach: "sent" });
  const request = new Request("https://" + (o.host || "masspermits.com") + "/admin/api/mission-outreach",
    { method: "POST", headers: h, body });
  const env = { ...H.env(r2), ...(o.env === undefined ? ON : o.env) };
  const res = await m.outreach.onRequestPost({ request, env, now: o.now ?? NOW });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, body: json, text, headers: res.headers };
}
const writes = (r2) => r2.ops.filter((o) => o.op === "put" || o.op === "delete");

test("P2-6 flag unset (or not exactly \"1\") -> 404 with 0 R2 ops", async () => {
  for (const env of [{}, { MISSION_OUTREACH_EDIT: "true" }, { MISSION_OUTREACH_EDIT: "0" }, { MISSION_OUTREACH_EDIT: " 1" }]) {
    const r2 = seeded(SEED);
    stub.reset();
    const res = await post(r2, { env });
    assert.equal(res.status, 404, JSON.stringify(env));
    assert.equal(r2.ops.length, 0);
    assert.equal(stub.calls.length, 0, "not even the JWKS");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("P2-6 gate failures -> 403 (host -> 404), 0 R2 ops", async () => {
  const cases = [
    [{ token: null }, 403],
    [{ token: H.mint(H.makeSigner("other-kid"), H.claims()) }, 403],
    [{ token: owner({ email: H.STRANGER }) }, 403],
    [{ env: { ...ON, ADMIN_ALLOWED_EMAILS: "" } }, 403],
    [{ host: "www.masspermits.com" }, 404],
    [{ host: "masspermits-lander.pages.dev" }, 404],
  ];
  for (const [o, want] of cases) {
    const r2 = seeded(SEED);
    const res = await post(r2, o);
    assert.equal(res.status, want, JSON.stringify(o));
    assert.equal(r2.ops.length, 0);
  }
});

test("P2-6 missing mission header, missing or cross-site Sec-Fetch-Site -> 403, 0 ops", async () => {
  for (const o of [{ mission: false }, { site: null }, { site: "cross-site" }, { site: "same-site" }, { site: "none" }]) {
    const r2 = seeded(SEED);
    const res = await post(r2, o);
    assert.equal(res.status, 403, JSON.stringify(o));
    assert.equal(r2.ops.length, 0);
  }
});

test("P2-6 bad town, bad state, extra key, 513-byte body, wrong content type -> 400, 0 writes", async () => {
  const pad = (n) => {
    const base = JSON.stringify({ town: "Alford", outreach: "sent" });
    return base.slice(0, -1) + " ".repeat(n - base.length) + "}";
  };
  assert.equal(Buffer.byteLength(pad(513)), 513);
  const cases = [
    { body: { town: "Atlantis", outreach: "sent" } },
    { body: { town: "alford", outreach: "sent" } },
    { body: { town: "Alford, MA", outreach: "sent" } },
    { body: { town: "Alford", outreach: "won" } },
    { body: { town: "Alford", outreach: "" } },
    { body: { town: "Alford", outreach: "sent", note: "x" } },
    { body: { town: "Alford" } },
    { raw: "[]" },
    { raw: "not json" },
    { raw: pad(513) },
    { type: "text/plain" },
    { type: "application/x-www-form-urlencoded" },
  ];
  for (const o of cases) {
    const r2 = seeded(SEED);
    const res = await post(r2, o);
    assert.equal(res.status, 400, JSON.stringify(o));
    assert.equal(writes(r2).length, 0);
    assert.ok(typeof res.body.error === "string");
  }
  // 512 bytes exactly is accepted
  const r2 = seeded(SEED);
  assert.equal((await post(r2, { raw: pad(512) })).status, 200);
});

test("P2-6 object absent or unparseable -> 409, nothing written", async () => {
  for (const r2 of [seeded(undefined), seeded("{not json"), seeded("[1,2]")]) {
    const res = await post(r2);
    assert.equal(res.status, 409);
    assert.equal(writes(r2).length, 0);
  }
});

test("P2-6 etag race -> 409", async () => {
  const r2 = seeded(SEED);
  const realGet = r2.get.bind(r2);
  r2.get = async (key) => {
    const o = await realGet(key);
    r2.set(KEY, { ...SEED, updated_at: "2026-09-29T00:00:00Z" }); // someone else wrote in between
    return o;
  };
  const res = await post(r2);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "conflict");
  assert.equal(r2.json(KEY).updated_at, "2026-09-29T00:00:00Z", "the other write survives");
});

test("P2-6 success: exactly one put of admin/outreach.json with onlyIf etagMatches; history capped at 200", async () => {
  const hist = Array.from({ length: 200 }, (_, i) => ({ at: "2026-09-01T00:00:00Z", town: "Adams", from: null, to: "planned", i }));
  const r2 = seeded({ ...SEED, history: hist });
  const etag = r2.objects.get(KEY).etag;
  const res = await post(r2, { body: { town: "Alford", outreach: "answered" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  const puts = writes(r2);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, KEY);
  assert.deepEqual(puts[0].opts.onlyIf, { etagMatches: etag });
  assert.equal(puts[0].opts.httpMetadata.contentType, "application/json");
  const doc = r2.json(KEY);
  assert.deepEqual(doc.towns.Alford, { outreach: "answered", since: "2026-09-30" });
  assert.deepEqual(doc.towns.Adams, SEED.towns.Adams, "other towns untouched");
  assert.equal(doc.history.length, 200);
  assert.deepEqual(doc.history[199], { at: "2026-09-30T18:00:00.000Z", town: "Alford", from: null, to: "answered" });
  assert.equal(doc.history[0].i, 1, "the oldest entry dropped");
  // clearing keeps the other fields and records from -> null
  const res2 = await post(r2, { body: { town: "Adams", outreach: null } });
  assert.equal(res2.status, 200);
  const doc2 = r2.json(KEY);
  assert.deepEqual(doc2.towns.Adams, { note: "records request" });
  assert.deepEqual(doc2.history.at(-1), { at: "2026-09-30T18:00:00.000Z", town: "Adams", from: "planned", to: null });
  // the data route sees the change
  assert.ok(r2.ops.every((o) => o.key === KEY));
});

test("P2-6 writerFor rejects any other key (the shipped function, evaluated on its own)", async () => {
  const src = fs.readFileSync(path.join(H.REPO, "functions/admin/api/mission-outreach.js"), "utf8");
  const start = src.indexOf("function writerFor(");
  const end = src.indexOf("\n}\n", start);
  assert.ok(start >= 0 && end > start);
  const writerFor = new Function(src.slice(start, end + 2) + "\nreturn writerFor;")();
  const r2 = new H.FakeR2();
  const w = writerFor(r2);
  assert.deepEqual(Object.keys(w), ["put"]);
  assert.ok(Object.isFrozen(w));
  for (const k of ["subscribers.json", "admin/outreach.json.bak", "admin/outreach", "../admin/outreach.json", ""]) {
    assert.throws(() => w.put(k, "{}"), /writer_key/);
  }
  assert.equal(r2.ops.length, 0);
  await w.put("admin/outreach.json", "{}");
  assert.deepEqual(r2.ops.map((o) => o.key), ["admin/outreach.json"]);
});

test("P2-6 a thrown R2 op -> 503 with no exception text", async () => {
  const r2 = seeded(SEED);
  r2.fail.add("put:" + KEY);
  const res = await post(r2);
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "unavailable" });
  assert.ok(!res.text.includes("failed for test"));
});
