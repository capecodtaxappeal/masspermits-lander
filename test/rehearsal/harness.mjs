// MassPermits monday rehearsal: shared test harness (Node built-ins only).
//
// Test the SHIPPED source, never an edited copy. Everything here is a fake the
// tests hand to shipped modules: an in-memory R2, a fetch stub that answers
// fixture URLs and THROWS on anything else, a Stripe-Signature builder, a
// waitUntil collector, a minimal HTMLRewriter, a test RSA key whose JWK the
// fetch stub can serve, and a loader that runs weekly-send.js from a temp copy
// with only its OIDC import stubbed.
//
// This file never installs anything on the global object by itself. Each
// *.test.mjs file installs the fetch stub and the HTMLRewriter stub it needs,
// so the assignment is visible in the test that relies on it.
//
// Fixtures are synthetic: @example.com addresses, cus_TEST ids, tokens made of
// one repeated hex digit, invented people and streets.

import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac, generateKeyPairSync, createSign, randomUUID } from "node:crypto";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const API_DIR = join(REPO, "functions", "api");

// ── tiny assertion runner ───────────────────────────────────────────────────
// Every test file prints one "RESULT <file> pass=<n> fail=<m>" line at the end;
// functions/api/all.test.mjs reads it for the per-file counts.
export function makeRunner(fileLabel) {
  let pass = 0, fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log("  ok    " + name); }
    else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "   (" + detail + ")" : "")); }
    return !!cond;
  };
  const done = () => {
    console.log(`RESULT ${fileLabel} pass=${pass} fail=${fail}`);
    process.exitCode = fail ? 1 : 0;
    return { pass, fail };
  };
  return { check, done, get counts() { return { pass, fail }; } };
}

// ── in-memory R2 ────────────────────────────────────────────────────────────
// Every operation, reads included, is recorded in .ops as {op, key}.
// opts.failPut(key) -> true makes that put throw (for fail-closed tests).
export function fakeR2(initial = {}, opts = {}) {
  const store = new Map();
  const ops = [];
  let seq = 0;
  const enc = new TextEncoder();
  const toBytes = (v) => {
    if (v == null) return new Uint8Array(0);
    if (typeof v === "string") return enc.encode(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return enc.encode(typeof v === "object" ? JSON.stringify(v) : String(v));
  };
  const write = (key, value, o = {}) => {
    seq++;
    const bytes = toBytes(value);
    const hex = (seq.toString(16) + "0".repeat(32)).slice(0, 32);
    store.set(key, {
      key, bytes, size: bytes.length,
      etag: o.etag || hex, uploaded: o.uploaded ? new Date(o.uploaded) : new Date(),
      customMetadata: o.customMetadata || {}, httpMetadata: o.httpMetadata || {},
    });
  };
  for (const [k, v] of Object.entries(initial)) {
    if (v && typeof v === "object" && "__r2" in v) write(k, v.value, v.__r2);
    else write(k, typeof v === "string" || v instanceof Uint8Array ? v : JSON.stringify(v));
  }
  const meta = (o) => ({
    key: o.key, size: o.size, etag: o.etag, httpEtag: '"' + o.etag + '"',
    uploaded: o.uploaded, customMetadata: o.customMetadata, httpMetadata: o.httpMetadata,
  });
  const withBody = (o) => {
    const bytes = o.bytes;
    return Object.assign(meta(o), {
      get body() {
        return new ReadableStream({ start(c) { c.enqueue(bytes.slice()); c.close(); } });
      },
      async text() { return new TextDecoder().decode(bytes); },
      async json() { return JSON.parse(new TextDecoder().decode(bytes)); },
      async arrayBuffer() { return bytes.slice().buffer; },
    });
  };
  const bucket = {
    async get(key) { ops.push({ op: "get", key }); const o = store.get(key); return o ? withBody(o) : null; },
    async head(key) { ops.push({ op: "head", key }); const o = store.get(key); return o ? meta(o) : null; },
    async list(o = {}) {
      ops.push({ op: "list", key: o.prefix || "" });
      const objects = [...store.values()]
        .filter((x) => !o.prefix || x.key.startsWith(o.prefix)).map(meta);
      return { objects, truncated: false, delimitedPrefixes: [] };
    },
    async put(key, value, o = {}) {
      ops.push({ op: "put", key });
      if (opts.failPut && opts.failPut(key)) throw new Error("fake put failure");
      write(key, value, o);
      return meta(store.get(key));
    },
    async delete(key) {
      for (const k of Array.isArray(key) ? key : [key]) { ops.push({ op: "delete", key: k }); store.delete(k); }
    },
    async createMultipartUpload(key) { ops.push({ op: "createMultipartUpload", key }); return {}; },
    async resumeMultipartUpload(key) { ops.push({ op: "resumeMultipartUpload", key }); return {}; },
  };
  return {
    bucket, ops, store,
    text: (k) => (store.has(k) ? new TextDecoder().decode(store.get(k).bytes) : null),
    json: (k) => (store.has(k) ? JSON.parse(new TextDecoder().decode(store.get(k).bytes)) : null),
    writes: () => ops.filter((o) => o.op === "put" || o.op === "delete"),
  };
}

// ── fetch stub ──────────────────────────────────────────────────────────────
// routes: { "<exact url>": handler } or { "<prefix>*": handler }. A handler gets
// (url, init, request) and returns a Response (or a value to JSON-encode).
// Any URL not in routes is recorded in .unexpected and THROWS.
export function makeFetchStub(routes = {}) {
  const calls = [];
  const unexpected = [];
  const find = (url) => {
    if (Object.prototype.hasOwnProperty.call(routes, url)) return routes[url];
    for (const [k, h] of Object.entries(routes)) {
      if (k.endsWith("*") && url.startsWith(k.slice(0, -1))) return h;
    }
    return null;
  };
  async function fetch(input, init = {}) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    let body = init.body;
    if (body === undefined && input && typeof input === "object" && typeof input.text === "function") {
      try { body = await input.clone().text(); } catch { body = undefined; }
    }
    const headers = new Headers(init.headers || (typeof input === "object" && input.headers) || {});
    const rec = { url, method, headers: Object.fromEntries(headers), body };
    calls.push(rec);
    const h = find(url);
    if (!h) {
      unexpected.push(url);
      throw new Error("fetch stub: unexpected URL " + url);
    }
    const out = await h(url, { ...init, method, body, headers }, rec);
    return out instanceof Response ? out : new Response(JSON.stringify(out), {
      status: 200, headers: { "content-type": "application/json" } });
  }
  const to = (host) => calls.filter((c) => { try { return new URL(c.url).host === host; } catch { return false; } });
  return { fetch, calls, unexpected, to };
}

// A Resend fixture: records the parsed body of each POST to the emails URL.
// The URL is passed in by the test file: the Resend host name must appear in
// no non-test file this build adds other than rehearsal.js's sendInternal.
export function resendFixture(url) {
  const sent = [];
  let n = 0;
  const handler = (_url, init) => {
    let parsed = null;
    try { parsed = JSON.parse(init.body); } catch { parsed = { unparsed: String(init.body) }; }
    sent.push(parsed);
    n++;
    return new Response(JSON.stringify({ id: "test-resend-" + n }), {
      status: 200, headers: { "content-type": "application/json" } });
  };
  return { sent, handler, url };
}

// ── Stripe-Signature ────────────────────────────────────────────────────────
// HMAC-SHA256 over `${t}.${payload}`, hex, with a made-up secret.
export const TEST_WEBHOOK_SECRET = "whsec_test_" + "0".repeat(24);
export function stripeSignature(payload, secret = TEST_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// ── context.waitUntil collector ─────────────────────────────────────────────
export function waitUntilCollector() {
  const promises = [];
  return {
    promises,
    waitUntil(p) { promises.push(Promise.resolve(p).catch(() => {})); },
    async settle() { await Promise.all(promises); },
  };
}

// ── minimal HTMLRewriter ────────────────────────────────────────────────────
// leads.js uses the Workers global HTMLRewriter, which Node lacks. This stub
// records the selectors and hands the response through with its status and
// headers. It rewrites nothing: tests assert status, headers and captured R2
// writes, never page content.
export class HTMLRewriterStub {
  constructor() { this.selectors = []; }
  on(selector, handlers) { this.selectors.push(selector); void handlers; return this; }
  onDocument() { return this; }
  transform(response) {
    return new Response(response.body, { status: response.status, headers: response.headers });
  }
}

// ── weekly-send.js from a temp copy ─────────────────────────────────────────
// Copies weekly-send.js AND _presend.js byte for byte into a temp dir with a
// {"type":"module"} package.json and replaces ONLY _github-oidc.js with a stub
// whose verdict the test sets through the returned setVerdict().
// opts.mutate(src) -> src lets the mutation proof change one character of the
// COPY; the shipped file is never touched.
const OIDC_VERDICT = Symbol.for("masspermits.rehearsal.test.oidcVerdict");
export async function loadWeeklySend(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mp-weekly-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  copyFileSync(join(API_DIR, "_presend.js"), join(dir, "_presend.js"));
  let src = readFileSync(join(API_DIR, "weekly-send.js"), "utf8");
  if (opts.mutate) src = opts.mutate(src);
  writeFileSync(join(dir, "weekly-send.js"), src);
  writeFileSync(join(dir, "_github-oidc.js"),
    "export async function verifyGitHubOIDC(_request) {\n" +
    "  const v = globalThis[Symbol.for(\"masspermits.rehearsal.test.oidcVerdict\")];\n" +
    "  return v || { ok: false, reason: \"test-default\" };\n" +
    "}\n");
  const mod = await import(pathToFileURL(join(dir, "weekly-send.js")).href + "?v=" + randomUUID());
  return {
    mod, dir,
    setVerdict(v) { globalThis[OIDC_VERDICT] = v; },
    byteIdentical() {
      return readFileSync(join(dir, "weekly-send.js"), "utf8") ===
               readFileSync(join(API_DIR, "weekly-send.js"), "utf8") &&
             readFileSync(join(dir, "_presend.js"), "utf8") ===
               readFileSync(join(API_DIR, "_presend.js"), "utf8");
    },
  };
}

// ── test OIDC key ───────────────────────────────────────────────────────────
// A fresh RSA key pair per process. The fetch stub serves its public JWK at
// JWKS_URL so the REAL _github-oidc.js can verify tokens signed here.
export const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
export function makeOidcKit() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "rehearsal-test-" + randomUUID().slice(0, 8);
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const b64u = (buf) => Buffer.from(buf).toString("base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const validClaims = () => {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: "https://token.actions.githubusercontent.com",
      aud: "masspermits-cron",
      repository: "capecodtaxappeal/masspermits-lander",
      ref: "refs/heads/main",
      iat: now - 5, nbf: now - 5, exp: now + 300,
    };
  };
  const sign = (claims = {}, header = {}) => {
    const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid, ...header }));
    const p = b64u(JSON.stringify({ ...validClaims(), ...claims }));
    const s = createSign("RSA-SHA256").update(h + "." + p).sign(privateKey);
    return h + "." + p + "." + b64u(s);
  };
  const jwksHandler = () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200, headers: { "content-type": "application/json" } });
  return { jwk, kid, sign, validClaims, jwksHandler, JWKS_URL };
}

// ── purchase-email facts ────────────────────────────────────────────────────
// link_first: the first <a href> in the purchase email is the download link.
// month_line: the email promises "you both get a month" (the referral line).
export function purchaseFacts(html) {
  const s = String(html || "");
  const m = s.match(/<a\s[^>]*href="([^"]*)"/i);
  const first = m ? m[1] : "";
  return {
    link_first: /^https:\/\/masspermits\.com\/api\/my-leads\?t=[0-9a-f]{32}&k=monthly$/.test(first),
    month_line: /you both get a month/i.test(s),
  };
}

// ── synthetic fixtures ──────────────────────────────────────────────────────
export const tok = (c) => String(c).repeat(32).slice(0, 32);
export function zipBytes(n = 64) {
  // "PK\x03\x04" then filler: enough for anything that only checks the magic.
  const b = new Uint8Array(n);
  b.set([0x50, 0x4b, 0x03, 0x04]);
  for (let i = 4; i < n; i++) b[i] = i & 0xff;
  return b;
}
