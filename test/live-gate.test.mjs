// /api/live is owner-only (approved by Patrick 2026-09-27). Test-only; nothing
// here ships.
//
// The route used to return every recent visitor's city, map point and network
// (AS organisation) to anyone. These tests pin the lockdown:
//   * a valid Cloudflare Access token (header, or the CF_Authorization cookie)
//     gets 200 with the data;
//   * no token, a wrong audience, a wrong issuer, a bad signature, an expired
//     token or a missing configuration gets 403 with NO data, and the refusal
//     happens before a single R2 call;
//   * no response carries an Access-Control-Allow-* header;
//   * ops.html, the only consumer, handles the 403.
//
// Self-contained: the shipped live.js and _cf-access.js are copied byte for
// byte to a temp dir and imported from there; fetch is stubbed to serve a
// test JWKS and THROWS on any other URL, so nothing leaves the machine. All
// visitor rows are invented.
//
//   node --test test/live-gate.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["functions/api/live.js", "functions/api/_cf-access.js"];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-gate-"));
for (const rel of FILES) {
  const dst = path.join(dir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), dst);
}
fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
const live = await import(pathToFileURL(path.join(dir, "functions/api/live.js")).href);

// ── keys, tokens, fetch stub ───────────────────────────────────────────────
const TEAM = "masspermits-test.cloudflareaccess.com";
const ISS = "https://" + TEAM;
const AUD = "aud-test-0123456789abcdef";

function signer(kid) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}
const KEY = signer("kid-live-1");
const ROGUE = signer("kid-live-1"); // same kid, different key: signature must fail

const b64u = (s) => Buffer.from(s).toString("base64url");
function mint(claims, key = KEY) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" }));
  const p = b64u(JSON.stringify(claims));
  const sig = createSign("RSA-SHA256").update(h + "." + p).sign(key.privateKey).toString("base64url");
  return h + "." + p + "." + sig;
}
function claims(over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { aud: [AUD], iss: ISS, exp: now + 3600, iat: now - 10, nbf: now - 10,
    email: "owner@example.com", sub: "sub-1", type: "app", ...over };
}

const fetchCalls = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  fetchCalls.push(u.href);
  if (u.origin === ISS && u.pathname === "/cdn-cgi/access/certs") {
    return new Response(JSON.stringify({ keys: [KEY.jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch in test: " + u.href);
};

// ── fake R2 with invented beacon hits ──────────────────────────────────────
const CITY = "Testville";
const ORG = "Example Test Networks";
function fakeR2() {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const objects = [
    { key: `hits/${day}/${now - 30_000}-aaaa0001`,
      customMetadata: { s: "direct", p: "/", c: "US", st: "MA", ci: CITY, la: "42.1", lo: "-71.1", o: ORG } },
    { key: `hits/${day}/${now - 120_000}-aaaa0002`,
      customMetadata: { s: "google", p: "/roofing", c: "US", st: "RI", ci: "Samplefield", la: "41.8", lo: "-71.4", o: ORG } },
  ];
  const r2 = {
    ops: [],
    async list(opts = {}) {
      r2.ops.push({ op: "list", prefix: opts.prefix });
      return { objects: objects.filter((o) => o.key.startsWith(opts.prefix || "")), truncated: false };
    },
    async get(key) { r2.ops.push({ op: "get", key }); return null; },
    async head(key) { r2.ops.push({ op: "head", key }); return null; },
    async put(key) { r2.ops.push({ op: "put", key }); throw new Error("no writes"); },
  };
  return r2;
}
const ENV = (r2, over = {}) => ({ BUNDLES: r2, CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ...over });

async function call({ headers = {}, env: over = {}, host = "masspermits.com" } = {}) {
  const r2 = fakeR2();
  const request = new Request(`https://${host}/api/live?v=1`, { headers });
  const res = await live.onRequestGet({ request, env: ENV(r2, over) });
  const text = await res.text();
  return { res, text, r2 };
}

function assertNoData(text, label) {
  for (const needle of [CITY, "Samplefield", ORG, "42.1", "-71.1", "recent", "states", "today_total", "active", "/roofing"]) {
    assert.ok(!text.includes(needle), `${label}: refusal body leaks ${needle}`);
  }
}
function assertHeaders(res, label) {
  assert.equal(res.headers.get("cache-control"), "private, no-store", label);
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow, noarchive, nosnippet", label);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", label);
  for (const [k] of res.headers) assert.ok(!k.toLowerCase().startsWith("access-control-allow"), label + " " + k);
}

// ── allowed ────────────────────────────────────────────────────────────────
test("valid Access header -> 200 with the visitor data", async () => {
  const { res, text, r2 } = await call({ headers: { "Cf-Access-Jwt-Assertion": mint(claims()) } });
  assert.equal(res.status, 200);
  assertHeaders(res, "200");
  const d = JSON.parse(text);
  assert.equal(d.active, 2);
  assert.equal(d.recent.length, 2);
  assert.equal(d.recent[0].ci, CITY);
  assert.equal(d.recent[0].o, ORG);
  assert.equal(d.recent[0].la, 42.1);
  assert.equal(d.states.MA, 1);
  assert.ok(r2.ops.length >= 1 && r2.ops.every((o) => o.op === "list"), "list only, no writes");
});

test("valid CF_Authorization cookie (no header) -> 200 with the visitor data", async () => {
  const { res, text } = await call({ headers: { Cookie: "a=1; CF_Authorization=" + mint(claims()) + "; b=2" } });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(text).recent[0].ci, CITY);
});

// ── refused, with no data and no R2 read ───────────────────────────────────
const REFUSALS = [
  ["no header, no cookie", {}, {}, "no-assertion"],
  ["wrong audience", { "Cf-Access-Jwt-Assertion": mint(claims({ aud: ["some-other-app-aud"] })) }, {}, "aud"],
  ["wrong issuer", { "Cf-Access-Jwt-Assertion": mint(claims({ iss: "https://evil.cloudflareaccess.com" })) }, {}, "iss"],
  ["expired", { "Cf-Access-Jwt-Assertion": mint(claims({ exp: Math.floor(Date.now() / 1000) - 5 })) }, {}, "expired"],
  ["bad signature", { "Cf-Access-Jwt-Assertion": mint(claims(), ROGUE) }, {}, "sig"],
  ["garbage token", { "Cf-Access-Jwt-Assertion": "not.a.jwt.at.all" }, {}, "not-jwt"],
  ["garbage cookie", { Cookie: "CF_Authorization=abc" }, {}, "not-jwt"],
  ["AUD not configured", { "Cf-Access-Jwt-Assertion": mint(claims()) }, { CF_ACCESS_AUD: "" }, "not-configured"],
  ["team not configured", { "Cf-Access-Jwt-Assertion": mint(claims()) }, { CF_ACCESS_TEAM_DOMAIN: undefined }, "not-configured"],
];

for (const [label, headers, envOver, reason] of REFUSALS) {
  test(`${label} -> 403, reason ${reason}, no data, zero R2 calls`, async () => {
    const { res, text, r2 } = await call({ headers, env: envOver });
    assert.equal(res.status, 403, label);
    assertHeaders(res, label);
    assert.equal(r2.ops.length, 0, label + ": R2 touched before the gate");
    assertNoData(text, label);
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ["error", "reason"]);
    assert.equal(body.error, "unauthorized");
    assert.equal(body.reason, reason);
  });
}

test("a browser navigation without a token gets the HTML 403 page, still no data", async () => {
  const { res, text, r2 } = await call({ headers: { Accept: "text/html,application/xhtml+xml", "Sec-Fetch-Mode": "navigate" } });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("content-type"), /^text\/html/);
  assertHeaders(res, "navigation");
  assert.equal(r2.ops.length, 0);
  assertNoData(text, "navigation");
  assert.match(text, /Not authorised/);
});

test("the pages.dev twin gets 403 too (no Access header or apex cookie reaches it)", async () => {
  const { res, r2 } = await call({ host: "masspermits-lander.pages.dev" });
  assert.equal(res.status, 403);
  assert.equal(r2.ops.length, 0);
});

test("only the Access JWKS is ever fetched", () => {
  assert.ok(fetchCalls.length >= 1);
  for (const u of fetchCalls) assert.equal(u, ISS + "/cdn-cgi/access/certs");
});

// ── the source keeps the gate ahead of R2 ──────────────────────────────────
test("live.js source: gate import, gate call precedes the first R2 list", () => {
  const src = fs.readFileSync(path.join(REPO, "functions/api/live.js"), "utf8");
  assert.match(src, /import \{ verifyCfAccess, accessDenied \} from "\.\/_cf-access\.js";/);
  const gate = src.indexOf("await verifyCfAccess(request, env)");
  const list = src.indexOf("env.BUNDLES.list(");
  assert.ok(gate > 0 && list > gate, "verifyCfAccess must run before BUNDLES.list");
  // No CORS header is ever SET (comments may name it).
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/["']Access-Control-Allow/i.test(code));
});

// ── the only consumer handles the 403 ──────────────────────────────────────
test("ops.html handles a 403 from /api/live instead of showing 'nobody here'", () => {
  const html = fs.readFileSync(path.join(REPO, "ops.html"), "utf8");
  const i = html.indexOf('fetch("/api/live');
  assert.ok(i > 0, "ops.html still fetches /api/live");
  const after = html.slice(i, i + 800);
  assert.match(after, /res\.status === 403/);
  assert.match(after, /owner only/i);
});
