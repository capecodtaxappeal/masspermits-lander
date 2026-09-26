// P2-6: the outreach editor, functions/admin/api/mission-outreach.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as H from "./_harness.mjs";

const { m, owner, stub } = await H.setup();
const NOW = H.T("2026-09-30T18:00:00Z");
const KEY = "admin/outreach.json";
const SEED = { version: 1, updated_at: "2026-09-20T00:00:00Z", towns: { Adams: { outreach: "sent", since: "2026-09-20" } } };

function world(doc = SEED) {
  const r2 = new H.FakeR2();
  if (doc !== null) r2.set(KEY, typeof doc === "string" ? doc : JSON.stringify(doc), { uploaded: NOW - H.DAY });
  r2.ops.length = 0;
  return r2;
}

async function post(r2, o = {}) {
  const headers = new Headers({ "Content-Type": o.type ?? "application/json" });
  if (o.mission !== false) headers.set("X-MassPermits-Mission", "1");
  if (o.site !== null) headers.set("Sec-Fetch-Site", o.site ?? "same-origin");
  const token = o.token === undefined ? owner() : o.token;
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  const body = o.raw ?? JSON.stringify(o.body ?? { town: "Alford", outreach: "sent" });
  const req = new Request("https://" + (o.host || "masspermits.com") + "/admin/api/mission-outreach",
    { method: "POST", headers, body });
  const env = H.env(r2, { MISSION_OUTREACH_EDIT: "1", ...(o.env || {}) });
  const res = await m.outreach.onRequestPost({ request: req, env, now: o.now ?? NOW });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}
const writes = (r2) => r2.ops.filter((o) => o.op === "put" || o.op === "delete");

test("P2-6 exports onRequestPost only", () => {
  assert.deepEqual(Object.keys(m.outreach), ["onRequestPost"]);
});

test("P2-6 flag unset (or anything but \"1\") -> 404 with 0 R2 ops", async () => {
  for (const flag of [undefined, "", "0", "true", " 1"]) {
    const r2 = world();
    const res = await post(r2, { env: { MISSION_OUTREACH_EDIT: flag } });
    assert.equal(res.status, 404);
    assert.equal(r2.ops.length, 0);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("P2-6 gate failures -> 403 with 0 R2 ops", async () => {
  const cases = [
    { token: null },
    { token: owner({ email: H.STRANGER }) },
    { env: { ADMIN_ALLOWED_EMAILS: "" } },
  ];
  for (const c of cases) {
    const r2 = world();
    const res = await post(r2, c);
    assert.equal(res.status, 403, JSON.stringify(c));
    assert.equal(r2.ops.length, 0);
  }
  const r2 = world();
  const www = await post(r2, { host: "www.masspermits.com" });
  assert.equal(www.status, 404);
  assert.equal(r2.ops.length, 0);
});

test("P2-6 missing mission header, missing or cross-site Sec-Fetch-Site -> 403, 0 ops", async () => {
  for (const c of [{ mission: false }, { site: null }, { site: "cross-site" }, { site: "same-site" }, { site: "none" }]) {
    const r2 = world();
    const res = await post(r2, c);
    assert.equal(res.status, 403, JSON.stringify(c));
    assert.equal(r2.ops.length, 0);
  }
});

test("P2-6 bad town, bad state, extra key, 513-byte body, wrong content type -> 400, 0 writes", async () => {
  const pad = (n) => { const b = { town: "Alford", outreach: "sent" }; const base = JSON.stringify(b).length; return JSON.stringify({ ...b }).replace("}", " ".repeat(n - base) + "}"); };
  assert.equal(pad(513).length, 513);
  const cases = [
    { body: { town: "Atlantis", outreach: "sent" } },
    { body: { town: "alford", outreach: "sent" } },
    { body: { town: "Alford", outreach: "emailed" } },
    { body: { town: "Alford", outreach: "sent", note: "x" } },
    { body: { town: "Alford" } },
    { raw: "[\"Alford\",\"sent\"]" },
    { raw: "not json" },
    { raw: pad(513) },
    { type: "text/plain" },
    { type: "application/x-www-form-urlencoded" },
  ];
  for (const c of cases) {
    const r2 = world();
    const res = await post(r2, c);
    assert.equal(res.status, 400, JSON.stringify(c).slice(0, 80));
    assert.deepEqual(writes(r2), []);
    assert.equal(r2.ops.length, 0);
  }
  // 512 bytes is still accepted
  const r2 = world();
  assert.equal((await post(r2, { raw: pad(512) })).status, 200);
});

test("P2-6 object absent or unparseable -> 409, nothing written", async () => {
  for (const doc of [null, "{not json", "[]", JSON.stringify({ version: 1 }), "x".repeat(70 * 1024)]) {
    const r2 = world(doc);
    const res = await post(r2);
    assert.equal(res.status, 409, String(doc).slice(0, 20));
    assert.deepEqual(writes(r2), []);
  }
});

test("P2-6 etag race: the object changes between read and write -> 409, the other write survives", async () => {
  const r2 = world();
  const get = r2.get.bind(r2);
  r2.get = async (k) => {
    const o = await get(k);
    r2.set(KEY, JSON.stringify({ ...SEED, updated_at: "2026-09-30T17:59:59Z" }));
    return o;
  };
  const res = await post(r2);
  assert.equal(res.status, 409);
  assert.deepEqual(res.json, { error: "changed" });
  assert.equal(r2.json(KEY).updated_at, "2026-09-30T17:59:59Z");
});

test("P2-6 success: exactly one conditional put of the one key; history appended and capped at 200", async () => {
  const history = [];
  for (let i = 0; i < 200; i++) history.push({ at: "2026-08-01T00:00:00Z", town: "Adams", from: null, to: "planned", i });
  const r2 = world({ ...SEED, history });
  const readEtag = r2.objects.get(KEY).etag;
  const res = await post(r2, { body: { town: "Alford", outreach: "answered" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  const puts = writes(r2);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, KEY);
  assert.deepEqual(puts[0].opts.onlyIf, { etagMatches: readEtag });
  assert.deepEqual(puts[0].opts.httpMetadata, { contentType: "application/json" });
  assert.deepEqual(r2.ops.map((o) => o.op), ["get", "put"]);
  const doc = r2.json(KEY);
  assert.deepEqual(doc.towns.Alford, { outreach: "answered", since: "2026-09-30" });
  assert.deepEqual(doc.towns.Adams, SEED.towns.Adams);
  assert.equal(doc.history.length, 200);
  assert.deepEqual(doc.history[199], { at: "2026-09-30T18:00:00.000Z", town: "Alford", from: null, to: "answered" });
  assert.equal(doc.history[0].i, 1, "the oldest entry was dropped");
  // clearing a state records from -> null and removes outreach and since
  const res2 = await post(r2, { body: { town: "Adams", outreach: null } });
  assert.equal(res2.status, 200);
  const doc2 = r2.json(KEY);
  assert.deepEqual(doc2.towns.Adams, {});
  assert.deepEqual(doc2.history.at(-1), { at: "2026-09-30T18:00:00.000Z", town: "Adams", from: "sent", to: null });
  assert.equal(stub.stripeCalls().length, 0);
});

test("P2-6 writerFor rejects any other key (the function as shipped, lifted from the source)", async () => {
  const src = fs.readFileSync(path.join(H.REPO, "functions/admin/api/mission-outreach.js"), "utf8");
  const key = src.match(/^const KEY = .*$/m)[0];
  const start = src.indexOf("function writerFor(");
  const fn = src.slice(start, src.indexOf("\n}\n", start) + 2);
  const writerFor = new Function(key + "\n" + fn + "\nreturn writerFor;")();
  const r2 = new H.FakeR2();
  const w = writerFor(r2);
  assert.deepEqual(Object.keys(w), ["put"]);
  assert.ok(Object.isFrozen(w));
  for (const k of ["subscribers.json", "admin/outreach.json ", "admin/other.json", "feed-send-log.json", ""]) {
    assert.throws(() => w.put(k, "{}"), /writer_refused/);
  }
  assert.deepEqual(r2.ops, []);
  await w.put(KEY, "{}");
  assert.deepEqual(r2.ops.map((o) => o.key), [KEY]);
});

test("P2-2 the editor's town constant equals the geometry's 351 keys", () => {
  const src = fs.readFileSync(path.join(H.REPO, "functions/admin/api/mission-outreach.js"), "utf8");
  assert.match(src, /import \{ TOWN_KEYS \} from "\.\.\/\.\.\/api\/_mission_data\.js";/);
  assert.match(src, /const TOWNS = new Set\(TOWN_KEYS\);/);
  const geo = JSON.parse(fs.readFileSync(path.join(H.REPO, "admin/mission-towns.json"), "utf8"));
  assert.deepEqual([...m.data.TOWN_KEYS].sort(), Object.keys(geo.towns).sort());
  assert.equal(m.data.TOWN_KEYS.length, 351);
});
