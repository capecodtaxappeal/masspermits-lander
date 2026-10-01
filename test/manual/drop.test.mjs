// The owner drop box API (functions/admin/api/drop.js): Access in code,
// method and origin checks, upload validation, the view, and its headers.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_h.mjs";

const { drop } = await H.load();
const URL_ = "https://masspermits.com/admin/api/drop";

async function call({ r2 = new H.FakeR2(), env, method = "POST", host, token, headers = {}, body, slug = "town-a", name = "a.csv", noAuth } = {}) {
  let t = token;
  if (t === undefined && !noAuth) t = await H.jwt(H.accessClaims());
  const h = { "X-MassPermits-Drop": "1", "Sec-Fetch-Site": "same-origin", ...headers };
  if (t) h["Cf-Access-Jwt-Assertion"] = t;
  if (method === "POST") { h["X-Drop-Slug"] = slug; h["X-Drop-Name"] = encodeURIComponent(name); }
  const url = host ? URL_.replace("masspermits.com", host) : URL_;
  const request = new Request(url, { method, headers: h, body: method === "POST" ? (body === undefined ? H.F.csv() : body) : undefined });
  const res = await drop.onRequest({ request, env: env || H.pagesEnv(r2) });
  let j = null;
  try { j = JSON.parse(await res.clone().text()); } catch (_) { j = null; }
  return { res, j, r2 };
}

function assertHeaders(res) {
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet");
  for (const [k] of res.headers) assert.ok(!k.toLowerCase().startsWith("access-control-"), k);
}

test("Access refusals: no token, bad aud, expired, forged, wrong owner; nothing read or written", async () => {
  const cases = [
    ["no token", { noAuth: true }, "no-assertion-header"],
    ["bad aud", { token: await H.jwt(H.accessClaims({ aud: ["other-aud"] })) }, "aud"],
    ["expired", { token: await H.jwt(H.accessClaims({ exp: Math.floor(Date.now() / 1000) - 10 })) }, "expired"],
    ["forged signature", { token: await H.jwt(H.accessClaims(), { key: H.keys.rogue.privateKey }) }, "sig"],
    ["forged header text", { token: "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyIn0." }, "alg"],
    ["garbage header", { token: "forged-by-hand" }, "not-jwt"],
    ["alg none", { token: await H.jwt(H.accessClaims(), { alg: "none" }) }, "alg"],
    ["wrong issuer", { token: await H.jwt(H.accessClaims({ iss: "https://evil.cloudflareaccess.com" })) }, "iss"],
    ["not the owner", { token: await H.jwt(H.accessClaims({ email: H.addr("someone", "other.example") })) }, "not-owner"],
    ["service token", { token: await H.jwt(H.accessClaims({ common_name: "svc" })) }, "not-a-person"],
  ];
  for (const [name, opts, reason] of cases) {
    for (const method of ["GET", "POST"]) {
      const { res, j, r2 } = await call({ ...opts, method });
      assert.equal(res.status, 403, name + " " + method);
      assert.equal(j.reason, reason, name);
      assert.equal(r2.ops.length, 0, name + " touched R2");
      assertHeaders(res);
    }
  }
});

test("Access refusal: the cookie alone is not enough (header only)", async () => {
  const cookie = "CF_Authorization=" + await H.jwt(H.accessClaims());
  const { res, j, r2 } = await call({ noAuth: true, headers: { Cookie: cookie } });
  assert.equal(res.status, 403);
  assert.equal(j.reason, "no-assertion-header");
  assert.equal(r2.ops.length, 0);
});

test("pages.dev, www and preview hosts 404 before anything", async () => {
  for (const host of ["masspermits-lander.pages.dev", "abc123.masspermits-lander.pages.dev", "www.masspermits.com"]) {
    for (const method of ["GET", "POST"]) {
      const { res, r2 } = await call({ host, method });
      assert.equal(res.status, 404, host);
      assert.equal(r2.ops.length, 0);
      assertHeaders(res);
    }
  }
});

test("Access not configured fails closed", async () => {
  for (const over of [{ CF_ACCESS_AUD: "" }, { CF_ACCESS_TEAM_DOMAIN: "" }, { ADMIN_ALLOWED_EMAILS: "" }]) {
    const r2 = new H.FakeR2();
    const { res, j } = await call({ r2, env: H.pagesEnv(r2, over) });
    assert.equal(res.status, 403);
    assert.equal(j.reason, "not-configured");
    assert.equal(r2.ops.length, 0);
  }
});

test("cross-site requests are refused: missing custom header, cross-site fetch", async () => {
  for (const headers of [{ "X-MassPermits-Drop": "" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
    const { res, r2 } = await call({ headers });
    assert.equal(res.status, 400);
    assert.equal(r2.ops.length, 0);
  }
});

test("methods other than GET and POST: 405, no CORS preflight answer", async () => {
  for (const method of ["PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const request = new Request(URL_, { method, headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    const r2 = new H.FakeR2();
    const res = await drop.onRequest({ request, env: H.pagesEnv(r2) });
    assert.equal(res.status, 405);
    assertHeaders(res);
    assert.equal(r2.ops.length, 0);
  }
});

test("uploads: each type stored under manual-raw/<slug>/, answered in JSON", async () => {
  const r2 = new H.FakeR2();
  for (const [bytes, ext] of [[H.F.csv(), "csv"], [H.F.xlsx(), "xlsx"], [H.F.pdf(), "pdf"]]) {
    const { res, j } = await call({ r2, body: bytes, name: "file." + ext });
    assert.equal(res.status, 200, ext);
    assert.equal(j.status, "stored");
    assert.equal(j.ext, ext);
    assert.match(res.headers.get("content-type"), /^application\/json/);
    assertHeaders(res);
  }
  const keys = [...r2.objects.keys()];
  assert.equal(keys.filter((k) => /^manual-raw\/town-a\/\d{8}T\d{6}Z-[0-9a-f]{12}\.(csv|xlsx|pdf)$/.test(k)).length, 3);
  assert.ok(keys.every((k) => k.startsWith("manual-raw/")));
});

test("the same file twice: already received, no new object", async () => {
  const r2 = new H.FakeR2();
  await call({ r2 });
  const n = r2.objects.size;
  const { res, j } = await call({ r2 });
  assert.equal(res.status, 200);
  assert.equal(j.status, "duplicate");
  assert.equal(j.message, "already received");
  assert.equal(r2.objects.size, n);
});

test("a slug not in MANUAL_SOURCES is refused before any read", async () => {
  for (const slug of ["town-z", "", "../subscribers", "manual-raw", "TOWN-A", "town-a/../x"]) {
    const { res, j, r2 } = await call({ slug });
    assert.equal(res.status, 400, slug);
    assert.equal(j.error, "unknown-source");
    assert.equal(r2.ops.length, 0);
  }
  // No MANUAL_SOURCES at all: nothing is accepted.
  const r2 = new H.FakeR2();
  const { res } = await call({ r2, env: H.pagesEnv(r2, { MANUAL_SOURCES: undefined }) });
  assert.equal(res.status, 400);
});

test("content validation over HTTP: exe, xlsm, encrypted, empty, oversize, wrong type for source", async () => {
  const cases = [
    [H.F.exe(), "invoice.pdf", 415, "unrecognized"],
    [H.F.xlsm(), "book.xlsx", 415, "macro"],
    [H.F.ole(), "book.xlsx", 415, "encrypted"],
    [H.F.pdfEncrypted(), "doc.pdf", 415, "encrypted"],
    [H.F.nestedZip(), "book.xlsx", 415, "nested-archive"],
    [H.F.empty(), "empty.csv", 400, "empty"],
    [H.F.oversize(), "big.csv", 413, "too-large"],
  ];
  for (const [body, name, status, error] of cases) {
    const { res, j, r2 } = await call({ body, name });
    assert.equal(res.status, status, name + " " + error);
    assert.equal(j.error, error);
    assert.ok(!r2.ops.some((o) => o[0] === "put"), "nothing written for " + error);
  }
  const { res, j } = await call({ slug: "town-b", body: H.F.csv() });
  assert.equal(res.status, 415);
  assert.equal(j.error, "type-not-accepted");
});

test("oversize by Content-Length is refused before the body is read", async () => {
  const { res, j, r2 } = await call({ headers: { "Content-Length": String(11 * 1024 * 1024) } });
  assert.equal(res.status, 413);
  assert.equal(j.error, "too-large");
  assert.equal(r2.ops.length, 0);
});

test("the stored index keeps a sanitized name; the API never returns it", async () => {
  const r2 = new H.FakeR2();
  await call({ r2, name: "C:\\fakepath\\..\\Weekly <List>.csv" });
  const idx = JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());
  assert.equal(idx.entries[0].name, "Weekly _List_.csv");
  const { res, j } = await call({ r2, method: "GET" });
  assert.equal(res.status, 200);
  const text = JSON.stringify(j);
  assert.ok(!text.includes("Weekly") && !text.includes(idx.entries[0].sha256) && !text.includes("manual-raw/"));
  const a = j.sources.find((s) => s.slug === "town-a");
  assert.equal(a.receipts.length, 1);
  assert.deepEqual(Object.keys(a.receipts[0]).sort(), ["bytes", "ext", "received_at", "via"]);
  assert.equal(a.state, "ok");
  assert.equal(j.sources.find((s) => s.slug === "town-b").state, "overdue");
  assertHeaders(res);
});

test("an R2 failure answers 503 with no exception text", async () => {
  const r2 = new H.FakeR2();
  r2.get = async () => { throw new Error("secret internal detail"); };
  const { res } = await call({ r2 });
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("secret"));
});
