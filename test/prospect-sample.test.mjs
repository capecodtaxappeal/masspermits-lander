// The hosted prospect sample (functions/s/[code].js): masspermits.com/s/<code>.
//
// What this file proves, against the SHIPPED Function:
//  * a malformed code and an unknown code get the same 404, byte for byte and
//    header for header, and a malformed code never reaches R2;
//  * a live code streams the stored bytes with every security header; HEAD
//    gives the same status and headers with no body;
//  * 30 days from the R2 upload time, then 410; an R2 error is a 503 with no
//    stack trace; any other method is a 405 that names GET and HEAD;
//  * the view counter: only on a 200, classified open or scanner, written in
//    waitUntil with a conditional put, failure-silent, and storing no IP,
//    user-agent, referrer or email;
//  * the owner alert: one email on the first human open, at most one more on
//    a re-open 3 or more days later, always to the owner constant, never on a
//    scanner hit, HEAD or refusal, exactly once under a write race, and a
//    failed send never touches the page or the count;
//  * no em or en dash in anything a visitor can read.
//
// Safety: nothing leaves this machine. R2 is an in-memory Map, fetch is
// replaced for the whole file by a stub that records and never sends, and
// the Function is imported from a temp copy (the shipped file is
// never touched). Every code here is made up. Addresses are assembled at run
// time from neutral parts, so no literal address sits in this file.
//
//   node --test test/prospect-sample.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHIPPED = "functions/s/[code].js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prospect-sample-"));
fs.mkdirSync(path.join(tmp, "functions", "s"), { recursive: true });
fs.copyFileSync(path.join(REPO, SHIPPED), path.join(tmp, "functions", "s", "code.js"));
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
// No test in this file may reach the network. The alert tests swap in a
// recorder; anything else that calls fetch fails loudly.
globalThis.fetch = async (url) => { throw new Error("test fetch refused: " + url); };
const fn = await import(pathToFileURL(path.join(tmp, "functions", "s", "code.js")).href);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const AT = String.fromCharCode(64);
const CONTACT = "patrick" + AT + "masspermits.com";
const DAY = 86400_000;
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const newCode = () => Array.from(crypto.randomBytes(20), (b) => B32[b & 31]).join("");
const sampleKey = (c) => "prospect-samples/" + c + ".html";
const viewsKey = (c) => "prospect-sample-views/" + c + ".json";

const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const BS = String.fromCharCode(92);
const DASH = new RegExp(
  "[" + EM + EN + "]|&[mn]dash;|&#0*821[12];|&#[xX]0*201[34];|" + BS + BS + "u201[34]", "i");

// The page a made-up prospect was emailed. Inline script, like the real one.
const SAMPLE = "<!doctype html><html><head><title>Sample for Example Co</title></head><body>" +
  "<table id=\"t\"></table><script>document.getElementById('t').innerHTML='<tr><td>12 E*** St</td></tr>';" +
  "</script></body></html>";

const SECURITY = {
  "content-type": "text/html; charset=utf-8",
  "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
  "referrer-policy": "no-referrer",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

// The CSP as a map of directive -> sources, so a test can name the directive
// it cares about rather than compare one long string.
const cspOf = (res) => Object.fromEntries((res.headers.get("content-security-policy") || "").split(";")
  .map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1).join(" ")]));

// ---- fake R2 -----------------------------------------------------------------
class FakeBucket {
  constructor() {
    this.objects = new Map();
    this.ops = [];
    this.failGet = null; // (key) => boolean
    this.failPut = null;
    this.cancelled = 0;
    this.putGate = null; // a promise every put waits on, to line up two writers
    this.conflicts = 0;
    this.etags = 0;
  }
  seed(key, body, uploadedMs) {
    this.objects.set(key, { body: String(body), uploaded: new Date(uploadedMs), etag: "e" + ++this.etags });
  }
  json(key) {
    const o = this.objects.get(key);
    return o ? JSON.parse(o.body) : null;
  }
  async get(key) {
    this.ops.push(["get", key]);
    if (this.failGet && this.failGet(key)) throw new Error("R2 exploded at /internal/stack/frame.js:42");
    const o = this.objects.get(key);
    if (!o) return null;
    const self = this;
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(o.body)); c.close(); },
      cancel() { self.cancelled++; },
    });
    return {
      key, size: Buffer.byteLength(o.body), uploaded: o.uploaded, etag: o.etag, body: stream,
      text: async () => o.body,
    };
  }
  async head(key) {
    this.ops.push(["head", key]);
    const o = this.objects.get(key);
    return o ? { key, size: Buffer.byteLength(o.body), uploaded: o.uploaded } : null;
  }
  async put(key, value, opts) {
    this.ops.push(["put", key]);
    if (this.putGate) await this.putGate;
    if (this.failPut && this.failPut(key)) throw new Error("R2 put refused");
    // R2 onlyIf: a failed precondition resolves to null and writes nothing.
    const cur = this.objects.get(key);
    const c = opts && opts.onlyIf;
    if (c instanceof Headers && c.get("if-none-match") === "*" && cur) { this.conflicts++; return null; }
    if (c && !(c instanceof Headers) && c.etagMatches && (!cur || cur.etag !== c.etagMatches)) {
      this.conflicts++;
      return null;
    }
    const etag = "e" + ++this.etags;
    this.objects.set(key, { body: String(value), uploaded: new Date(), opts, etag });
    return { key, etag };
  }
  puts() { return this.ops.filter((o) => o[0] === "put"); }
}

// A desktop browser, as a person opening the link would send it.
const BROWSER = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  "accept": "text/html",
};

async function call(code, { method = "GET", headers = BROWSER, bucket = new FakeBucket(), handler,
  waitUntil = true, params, env = {}, query = "" } = {}) {
  const request = new Request("https://masspermits.com/s/" + encodeURIComponent(String(code)) + query,
    { method, headers });
  const waits = [];
  const context = { request, env: { ...env, BUNDLES: bucket }, params: params || { code }, next: async () => null };
  if (waitUntil) context.waitUntil = (p) => { waits.push(p); };
  const h = handler || (method === "GET" ? fn.onRequestGet : method === "HEAD" ? fn.onRequestHead : fn.onRequest);
  const res = await h(context);
  const settled = await Promise.allSettled(waits);
  const body = res.body ? await res.text() : null;
  return { res, body, bucket, waits, settled };
}

function assertSecurityHeaders(res, label) {
  for (const [k, v] of Object.entries(SECURITY)) assert.equal(res.headers.get(k), v, label + ": " + k);
  assert.equal(res.headers.get("set-cookie"), null, label + ": no cookie");
}

const headerMap = (res) => Object.fromEntries([...res.headers].sort());
// The visible text of a page: style and head dropped, paragraphs separated by
// one space, inline tags (b, a) removed without adding space.
const textOf = (html) => html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<\/p>/g, " ")
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function live(ageMs = DAY) {
  const bucket = new FakeBucket();
  const code = newCode();
  bucket.seed(sampleKey(code), SAMPLE, Date.now() - ageMs);
  return { bucket, code };
}

// ---- refusals ----------------------------------------------------------------
const MALFORMED = [
  "", "abc", "abcdefghijklmnopqrs", "abcdefghijklmnopqrstu", "ABCDEFGHIJKLMNOPQRST",
  "abcdefghijklmnopqrs1", "abcdefghijklmnopqrs8", "abcdefghijklmnopqrs0", "abcdefghijklmnopqrs9",
  "abcdefghijklmnopqrs_", "abcdefghijklmnopqrs-", "abcdefghijklmnopqrst.html", "../subscribers.json",
  "abcdefghij/klmnopqrst", " abcdefghijklmnopqrs", "abcdefghijklmnopqrst\n", "abcdefghijklmnopqrSt",
];

test("a malformed code is a 404 and never touches R2", async () => {
  for (const c of MALFORMED) {
    const { res, body, bucket, waits } = await call(c);
    assert.equal(res.status, 404, JSON.stringify(c));
    assertSecurityHeaders(res, "malformed " + JSON.stringify(c));
    assert.deepEqual(bucket.ops, [], "no R2 op for " + JSON.stringify(c));
    assert.equal(waits.length, 0);
    assert.equal(textOf(body), "MassPermits This link isn't valid. For a sample, email " + CONTACT + ".");
  }
  // a param that is not a string (a catch-all route would hand over an array)
  const arr = await call("x", { params: { code: ["abcdefghijklmnopqrst"] } });
  assert.equal(arr.res.status, 404);
  assert.deepEqual(arr.bucket.ops, []);
  const none = await call("x", { params: {} });
  assert.equal(none.res.status, 404);
});

test("an unknown well-formed code gets the identical 404: same bytes, same headers", async () => {
  const bad = await call("not-a-code");
  const unknown = await call(newCode());
  assert.equal(unknown.res.status, 404);
  assert.equal(unknown.body, bad.body, "no oracle in the body");
  assert.deepEqual(headerMap(unknown.res), headerMap(bad.res), "no oracle in the headers");
  assert.deepEqual(unknown.bucket.ops.map((o) => o[0]), ["get"], "one read, no write");
  assert.equal(unknown.waits.length, 0);
  // A HEAD on either is the same status and headers, no body.
  const hb = await call("not-a-code", { method: "HEAD" });
  const hu = await call(newCode(), { method: "HEAD" });
  assert.equal(hb.res.status, 404);
  assert.equal(hu.res.status, 404);
  assert.equal(hb.body, null);
  assert.equal(hu.body, null);
  assert.deepEqual(headerMap(hu.res), headerMap(hb.res));
});

test("a live code: 200, the stored bytes unchanged, every header, one read of the sample key", async () => {
  const { bucket, code } = live();
  const { res, body } = await call(code, { bucket });
  assert.equal(res.status, 200);
  assert.equal(body, SAMPLE);
  assertSecurityHeaders(res, "200");
  const csp = cspOf(res);
  assert.equal(csp["frame-ancestors"], "'none'", "never framed");
  assert.equal(csp["default-src"], "'none'", "nothing loads unless a directive below allows it");
  assert.equal(csp["script-src"], "'unsafe-inline'", "the sample's own inline script runs, nothing external");
  assert.equal(csp["style-src"], "'unsafe-inline'");
  assert.equal(csp["img-src"], "data:");
  assert.equal(csp["base-uri"], "'none'");
  assert.equal(csp["form-action"], "'none'");
  assert.equal(res.headers.get("allow"), null);
  const sampleReads = bucket.ops.filter((o) => o[1] === sampleKey(code));
  assert.deepEqual(sampleReads, [["get", sampleKey(code)]]);
  assert.ok(bucket.ops.every((o) => o[1] === sampleKey(code) || o[1] === viewsKey(code)),
    "no other key is reached: " + JSON.stringify(bucket.ops));
});

test("CSP connect-src 'none' on every response: a script on /s/<code> can make no request at all", async () => {
  // Same origin as /leads, whose portal cookie (Path=/leads, SameSite=Lax) a
  // fetch("/leads") from this page would carry. connect-src 'none' is what
  // stops a sample, or a beacon added to one, from reading the paid file.
  const { bucket, code } = live();
  const old = live(31 * DAY);
  const e = live();
  e.bucket.failGet = () => true;
  const runs = [
    await call(code, { bucket }),
    await call(code, { bucket, method: "HEAD" }),
    await call("bad"),
    await call(newCode()),
    await call(old.code, { bucket: old.bucket }),
    await call(e.code, { bucket: e.bucket }),
    await call(code, { bucket, method: "POST", handler: fn.onRequest }),
  ];
  for (const r of runs) {
    const csp = cspOf(r.res);
    assert.equal(csp["connect-src"], "'none'", "status " + r.res.status);
    assert.equal(csp["default-src"], "'none'", "status " + r.res.status);
    assert.ok(!/\*|https?:|'self'|'unsafe-eval'/.test(r.res.headers.get("content-security-policy")),
      "no host, wildcard, self or eval source anywhere in the policy");
  }
});

test("HEAD on a live code: 200, same headers as GET, no body, stream released", async () => {
  const { bucket, code } = live();
  const g = await call(code, { bucket });
  const h = await call(code, { bucket, method: "HEAD" });
  assert.equal(h.res.status, 200);
  assert.equal(h.body, null);
  assert.equal(h.res.body, null);
  assert.deepEqual(headerMap(h.res), headerMap(g.res));
  assert.equal(bucket.cancelled, 1, "the HEAD read's body stream is cancelled");
});

test("onRequest: GET and HEAD dispatch to the same handlers; every other method is a 405", async () => {
  const { bucket, code } = live();
  const g = await call(code, { bucket, handler: fn.onRequest });
  assert.equal(g.res.status, 200);
  assert.equal(g.body, SAMPLE);
  const h = await call(code, { bucket, method: "HEAD", handler: fn.onRequest });
  assert.equal(h.res.status, 200);
  assert.equal(h.body, null);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const b = new FakeBucket();
    b.seed(sampleKey(code), SAMPLE, Date.now());
    const r = await call(code, { bucket: b, method, handler: fn.onRequest });
    assert.equal(r.res.status, 405, method);
    assert.equal(r.res.headers.get("allow"), "GET, HEAD", method);
    assertSecurityHeaders(r.res, method);
    assert.deepEqual(b.ops, [], method + " never reaches R2");
    assert.equal(r.waits.length, 0);
    assert.ok(!r.body.includes("Sample for"), "405 never carries the sample");
  }
});

test("expiry: 200 at 29 days, 410 at 30 days and 1 second", async () => {
  const young = live(29 * DAY);
  const y = await call(young.code, { bucket: young.bucket });
  assert.equal(y.res.status, 200);
  assert.equal(y.body, SAMPLE);

  const old = live(30 * DAY + 1000);
  const o = await call(old.code, { bucket: old.bucket });
  assert.equal(o.res.status, 410);
  assertSecurityHeaders(o.res, "410");
  assert.equal(textOf(o.body), "MassPermits This sample link has expired. Email " + CONTACT + " for a fresh one.");
  assert.ok(!o.body.includes("Sample for"), "the expired page never carries the sample");
  assert.equal(old.bucket.cancelled, 1, "the expired object's stream is released");
  const oh = await call(old.code, { bucket: old.bucket, method: "HEAD" });
  assert.equal(oh.res.status, 410);
  assert.equal(oh.body, null);
});

test("expiry boundary is inclusive at exactly 30 days, and a re-upload restarts the clock", async (t) => {
  const T = Date.parse("2026-11-12T15:00:00.000Z");
  t.mock.method(Date, "now", () => T);
  const bucket = new FakeBucket();
  const code = newCode();
  bucket.seed(sampleKey(code), SAMPLE, T - 30 * DAY);
  assert.equal((await call(code, { bucket })).res.status, 200);
  bucket.seed(sampleKey(code), SAMPLE, T - 30 * DAY - 1);
  assert.equal((await call(code, { bucket })).res.status, 410);
  bucket.seed(sampleKey(code), SAMPLE, T - 5 * 60_000); // the operator re-ran the wrangler put
  assert.equal((await call(code, { bucket })).res.status, 200);
});

test("a missing or unreadable upload timestamp fails closed (410)", async () => {
  const { bucket, code } = live();
  bucket.objects.get(sampleKey(code)).uploaded = undefined;
  assert.equal((await call(code, { bucket })).res.status, 410);
  bucket.objects.get(sampleKey(code)).uploaded = "not a date";
  assert.equal((await call(code, { bucket })).res.status, 410);
});

test("an R2 error is a 503 with a short page, never a stack trace", async () => {
  const { bucket, code } = live();
  bucket.failGet = () => true;
  const r = await call(code, { bucket });
  assert.equal(r.res.status, 503);
  assertSecurityHeaders(r.res, "503");
  assert.equal(textOf(r.body), "MassPermits This sample is temporarily unavailable. Please try again in a few " +
    "minutes, or email " + CONTACT + ".");
  for (const leak of ["Error", "exploded", "stack", ".js", "R2"]) assert.ok(!r.body.includes(leak), leak);
  assert.equal(r.waits.length, 0, "no counter on a 503");
  const h = await call(code, { bucket, method: "HEAD" });
  assert.equal(h.res.status, 503);
  assert.equal(h.body, null);
  // A missing binding is the same 503, not a 500.
  const nb = await fn.onRequestGet({ request: new Request("https://masspermits.com/s/" + code),
    env: {}, params: { code }, waitUntil() {} });
  assert.equal(nb.status, 503);
});

// ---- the view counter --------------------------------------------------------
const FIELDS = ["first_open", "last_open", "opens", "scanner_hits", "first_hit", "last_hit"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("counter: a browser GET is an open; first_open stays put, last_open moves", async (t) => {
  const { bucket, code } = live();
  let now = Date.parse("2026-10-14T13:00:00.000Z");
  bucket.seed(sampleKey(code), SAMPLE, now - DAY);
  t.mock.method(Date, "now", () => now);
  const r1 = await call(code, { bucket });
  assert.equal(r1.res.status, 200);
  assert.equal(r1.waits.length, 1, "the write goes through waitUntil");
  let v = bucket.json(viewsKey(code));
  assert.deepEqual(Object.keys(v), FIELDS);
  assert.deepEqual(v, { first_open: "2026-10-14T13:00:00.000Z", last_open: "2026-10-14T13:00:00.000Z",
    opens: 1, scanner_hits: 0, first_hit: "2026-10-14T13:00:00.000Z", last_hit: "2026-10-14T13:00:00.000Z" });
  assert.equal(bucket.objects.get(viewsKey(code)).opts.httpMetadata.contentType, "application/json");

  now += 3_600_000;
  await call(code, { bucket });
  v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 2);
  assert.equal(v.first_open, "2026-10-14T13:00:00.000Z");
  assert.equal(v.last_open, "2026-10-14T14:00:00.000Z");
  assert.equal(v.first_hit, "2026-10-14T13:00:00.000Z");
  assert.equal(v.last_hit, "2026-10-14T14:00:00.000Z");
  assert.equal(v.scanner_hits, 0);
});

test("counter: a scanner fetch before the person opens it is a scanner hit, then the open lands", async (t) => {
  const { bucket, code } = live();
  let now = Date.parse("2026-10-14T13:00:00.000Z");
  bucket.seed(sampleKey(code), SAMPLE, now - DAY);
  t.mock.method(Date, "now", () => now);
  await call(code, { bucket, headers: { "user-agent": "Mozilla/5.0 (compatible; SafeLinks)", "accept-language": "en-US" } });
  let v = bucket.json(viewsKey(code));
  assert.deepEqual(v, { first_open: null, last_open: null, opens: 0, scanner_hits: 1,
    first_hit: "2026-10-14T13:00:00.000Z", last_hit: "2026-10-14T13:00:00.000Z" });
  now += 7 * 3_600_000;
  await call(code, { bucket });
  v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 1);
  assert.equal(v.scanner_hits, 1);
  assert.equal(v.first_hit, "2026-10-14T13:00:00.000Z");
  assert.equal(v.first_open, "2026-10-14T20:00:00.000Z");
});

test("counter: HEAD, a missing Accept-Language, and every scanner user-agent pattern are scanner hits", async () => {
  const cases = [
    ["HEAD from a browser", "HEAD", BROWSER],
    ["no Accept-Language", "GET", { "user-agent": BROWSER["user-agent"] }],
    ["empty Accept-Language", "GET", { "user-agent": BROWSER["user-agent"], "accept-language": "" }],
    ["no headers at all", "GET", {}],
  ];
  for (const ua of ["Googlebot/2.1", "AhrefsCrawler", "Baiduspider", "Outlook-iOS link preview",
    "VirusScanner/1.0", "Barracuda Sentinel", "Proofpoint URL Defense", "Mimecast Security",
    "cudasvc/3.1", "LinkProtect/2", "Microsoft SafeLinks", "python-requests/2.32", "curl/8.4.0",
    "Wget/1.21", "Mozilla/5.0 HeadlessChrome/129.0", "Go-http-client/1.1", "Java/17.0.2",
    "okhttp/4.12.0", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0",
    "Google-InspectionTool/1.0", "GoogleInspection", "BOT-IN-CAPS"]) {
    cases.push(["UA " + ua, "GET", { "user-agent": ua, "accept-language": "en-US" }]);
  }
  for (const [label, method, headers] of cases) {
    const { bucket, code } = live();
    const r = await call(code, { bucket, method, headers });
    assert.equal(r.res.status, 200, label);
    const v = bucket.json(viewsKey(code));
    assert.equal(v.scanner_hits, 1, label);
    assert.equal(v.opens, 0, label);
    assert.equal(v.first_open, null, label);
    assert.equal(v.last_open, null, label);
  }
  // and the control: a plain phone browser is an open
  const { bucket, code } = live();
  await call(code, { bucket, headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "accept-language": "en-us" } });
  assert.equal(bucket.json(viewsKey(code)).opens, 1);
});

test("counter: a failing put or get never changes the response", async () => {
  const base = live();
  const clean = await call(base.code, { bucket: base.bucket });

  const p = live();
  p.bucket.failPut = (k) => k.startsWith("prospect-sample-views/");
  const rp = await call(p.code, { bucket: p.bucket });
  assert.equal(rp.res.status, 200);
  assert.equal(rp.body, SAMPLE);
  assert.deepEqual(headerMap(rp.res), headerMap(clean.res));
  assert.deepEqual(rp.settled.map((s) => s.status), ["fulfilled"], "the waitUntil promise never rejects");
  assert.equal(p.bucket.objects.has(viewsKey(p.code)), false);

  const g = live();
  g.bucket.seed(viewsKey(g.code), JSON.stringify({ first_open: null, last_open: null, opens: 0, scanner_hits: 7,
    first_hit: "2026-10-01T00:00:00.000Z", last_hit: "2026-10-02T00:00:00.000Z" }), Date.now());
  g.bucket.failGet = (k) => k.startsWith("prospect-sample-views/");
  const rg = await call(g.code, { bucket: g.bucket });
  assert.equal(rg.res.status, 200);
  assert.equal(rg.body, SAMPLE);
  assert.deepEqual(rg.settled.map((s) => s.status), ["fulfilled"]);
  assert.equal(g.bucket.puts().length, 0, "an unreadable counter is left alone, never reset to zero");
  assert.equal(g.bucket.json(viewsKey(g.code)).scanner_hits, 7);
});

test("counter: a views body that breaks partway (text() rejects) is left alone, never reset", async () => {
  const { bucket, code } = live();
  const stored = { first_open: "2026-10-01T00:00:00.000Z", last_open: "2026-10-02T00:00:00.000Z", opens: 9,
    scanner_hits: 4, first_hit: "2026-10-01T00:00:00.000Z", last_hit: "2026-10-02T00:00:00.000Z" };
  bucket.seed(viewsKey(code), JSON.stringify(stored), Date.now());
  // get() resolves, the body stream then fails (a dropped connection mid-read)
  const realGet = bucket.get.bind(bucket);
  bucket.get = async (key) => {
    const o = await realGet(key);
    if (o && key === viewsKey(code)) o.text = async () => { throw new Error("network connection lost"); };
    return o;
  };
  const r = await call(code, { bucket });
  assert.equal(r.res.status, 200);
  assert.equal(r.body, SAMPLE);
  assert.deepEqual(r.settled.map((s) => s.status), ["fulfilled"], "the waitUntil promise never rejects");
  assert.equal(bucket.puts().length, 0, "a failed read writes nothing");
  assert.deepEqual(bucket.json(viewsKey(code)), stored, "history and first_open survive");
});

test("counter: no waitUntil on the context still serves the page", async () => {
  const { bucket, code } = live();
  const r = await call(code, { bucket, waitUntil: false });
  assert.equal(r.res.status, 200);
  assert.equal(r.body, SAMPLE);
});

test("counter: nothing is written on a 404, 410, 405 or 503", async () => {
  const runs = [];
  runs.push(await call("bad"));
  runs.push(await call(newCode()));
  const old = live(31 * DAY);
  runs.push(await call(old.code, { bucket: old.bucket }));
  runs.push(await call(old.code, { bucket: old.bucket, method: "HEAD" }));
  const p = live();
  runs.push(await call(p.code, { bucket: p.bucket, method: "POST", handler: fn.onRequest }));
  const e = live();
  e.bucket.failGet = () => true;
  runs.push(await call(e.code, { bucket: e.bucket }));
  for (const r of runs) {
    assert.notEqual(r.res.status, 200);
    assert.equal(r.waits.length, 0, "no waitUntil for " + r.res.status);
    assert.deepEqual(r.bucket.puts(), [], "no put for " + r.res.status);
    assert.ok(![...r.bucket.objects.keys()].some((k) => k.startsWith("prospect-sample-views/")));
  }
});

test("counter: the stored JSON holds six fields and no IP, user-agent, referrer or email", async () => {
  const { bucket, code } = live();
  const ip = "198.51.100.23";
  const email = "someone" + AT + "example.com";
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) UniqueAgentMarker/9.9";
  const headers = { "user-agent": ua, "accept-language": "en-US", "cf-connecting-ip": ip,
    "x-forwarded-for": ip, "referer": "https://mail.example.com/inbox?u=" + email, "from": email,
    "cookie": "x=" + email };
  // an older or hand-edited object carrying extra fields gets them dropped
  bucket.seed(viewsKey(code), JSON.stringify({ first_open: null, last_open: null, opens: 0, scanner_hits: 2,
    first_hit: "2026-10-01T00:00:00.000Z", last_hit: "2026-10-01T00:00:00.000Z", ua, ip, email }), Date.now());
  await call(code, { bucket, headers });
  const raw = bucket.objects.get(viewsKey(code)).body;
  const v = JSON.parse(raw);
  assert.deepEqual(Object.keys(v), FIELDS);
  for (const leak of [ip, email, ua, "UniqueAgentMarker", "Macintosh", "mail.example.com", AT, "en-US", code]) {
    assert.ok(!raw.includes(leak), "stored JSON carries " + leak);
  }
  assert.equal(v.opens, 1);
  assert.equal(v.scanner_hits, 2);
  assert.equal(v.first_hit, "2026-10-01T00:00:00.000Z");
  for (const k of ["first_open", "last_open", "first_hit", "last_hit"]) assert.match(v[k], ISO, k);
  assert.ok(Number.isSafeInteger(v.opens) && Number.isSafeInteger(v.scanner_hits));
});

test("counter: a corrupt or wrong-shaped object is rebuilt from scratch", async () => {
  for (const junk of ["{not json", "[]", "null", "42", JSON.stringify({ opens: "lots", scanner_hits: -3,
    first_open: "yesterday", first_hit: 7 })]) {
    const { bucket, code } = live();
    bucket.seed(viewsKey(code), junk, Date.now());
    await call(code, { bucket });
    const v = bucket.json(viewsKey(code));
    assert.deepEqual(Object.keys(v), FIELDS, junk);
    assert.equal(v.opens, 1, junk);
    assert.equal(v.scanner_hits, 0, junk);
    assert.match(v.first_open, ISO, junk);
    assert.match(v.first_hit, ISO, junk);
  }
});

// ---- the owner alert ----------------------------------------------------------
// Invented values only. The key and sender are placeholders, never real.
const MAIL_ENV = { RESEND_API_KEY: "re_test_placeholder", FROM_EMAIL: "Test Sender <alerts" + AT + "example.com>" };
const T0 = Date.parse("2026-10-14T13:00:00.000Z"); // 9:00 AM in New York (EDT)
const HOUR = 3_600_000;

// Records every Resend call. status 0 means the fetch itself throws.
function mailbox(t, status = 200) {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    assert.equal(String(url), "https://api.resend.com/emails");
    sent.push({ init, body: JSON.parse(init.body) });
    if (status === 0) throw new Error("network down");
    return new Response(status === 200 ? "{\"id\":\"test\"}" : "error", { status });
  });
  return sent;
}

function liveAt(t, startMs) {
  const clock = { now: startMs };
  t.mock.method(Date, "now", () => clock.now);
  const { bucket, code } = live();
  bucket.seed(sampleKey(code), SAMPLE, startMs - DAY);
  return { bucket, code, clock };
}

test("alert: a scanner hit, a HEAD, a 404, a 410, a 405 and a 503 send nothing", async (t) => {
  const sent = mailbox(t);
  const { bucket, code } = live();
  await call(code, { bucket, env: MAIL_ENV, headers: { "user-agent": "Microsoft SafeLinks", "accept-language": "en-US" } });
  await call(code, { bucket, env: MAIL_ENV, headers: { "user-agent": BROWSER["user-agent"] } });
  await call(code, { bucket, env: MAIL_ENV, method: "HEAD" });
  assert.equal(bucket.json(viewsKey(code)).scanner_hits, 3);
  assert.equal(bucket.json(viewsKey(code)).opens, 0);
  await call("bad", { env: MAIL_ENV });
  await call(newCode(), { env: MAIL_ENV });
  const old = live(31 * DAY);
  assert.equal((await call(old.code, { bucket: old.bucket, env: MAIL_ENV })).res.status, 410);
  assert.equal((await call(old.code, { bucket: old.bucket, env: MAIL_ENV, method: "HEAD" })).res.status, 410);
  const p = live();
  assert.equal((await call(p.code, { bucket: p.bucket, env: MAIL_ENV, method: "POST", handler: fn.onRequest })).res.status, 405);
  const e = live();
  e.bucket.failGet = () => true;
  assert.equal((await call(e.code, { bucket: e.bucket, env: MAIL_ENV })).res.status, 503);
  assert.equal(sent.length, 0);
  assert.equal(bucket.json(viewsKey(code)).alerted_first, undefined, "a scanner hit claims nothing");
});

test("alert: the first human open sends exactly one email, to the owner, with only the prefix and the time", async (t) => {
  const sent = mailbox(t);
  const { bucket, code } = liveAt(t, T0);
  // A first scanner hit does not count as the first open.
  await call(code, { bucket, env: MAIL_ENV, headers: { "user-agent": "Proofpoint URL Defense", "accept-language": "en-US" } });
  assert.equal(sent.length, 0);
  const ip = "198.51.100.23";
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) UniqueAgentMarker/9.9";
  const r = await call(code, { bucket, env: MAIL_ENV, headers: { "user-agent": ua, "accept-language": "en-US",
    "cf-connecting-ip": ip, "cf-ipcity": "Exampleville" } });
  assert.equal(r.res.status, 200);
  assert.equal(r.waits.length, 1, "counter and alert share one waitUntil");
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(Object.keys(m.body).sort(), ["from", "html", "subject", "to"]);
  assert.deepEqual(m.body.to, [CONTACT]);
  assert.equal(m.body.from, MAIL_ENV.FROM_EMAIL);
  assert.equal(m.init.method, "POST");
  assert.equal(m.init.headers.Authorization, "Bearer " + MAIL_ENV.RESEND_API_KEY);
  const tag = code.slice(0, 6);
  assert.equal(m.body.subject, "Sample link opened: " + tag);
  assert.equal(textOf(m.body.html), "First opened: Wed, Oct 14, 2026, 9:00 AM EDT " +
    "Search your Sent mail for " + tag + " to find the thread.");
  const raw = JSON.stringify(m.body);
  for (const leak of [code, code.slice(0, 7), ip, ua, "UniqueAgentMarker", "Exampleville", "en-US"]) {
    assert.ok(!raw.includes(leak), "the alert carries " + leak);
  }
  const v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 1);
  assert.equal(v.scanner_hits, 1);
  assert.equal(v.alerted_first, "2026-10-14T13:00:00.000Z");
  assert.equal(v.alerted_again, undefined);
});

test("alert: same-day re-open sends nothing, 3 days later sends one 'opened again', then never again", async (t) => {
  const sent = mailbox(t);
  const { bucket, code, clock } = liveAt(t, T0);
  const tag = code.slice(0, 6);
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(sent.length, 1);
  clock.now = T0 + HOUR;
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(sent.length, 1, "a second open the same day sends nothing");
  clock.now = T0 + HOUR + 3 * DAY - 1;
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(sent.length, 1, "a millisecond short of 3 days after the previous open sends nothing");
  clock.now = T0 + 2 * HOUR + 6 * DAY;
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(sent.length, 2, "3 or more days after the previous open: one more");
  assert.equal(sent[1].body.subject, "Sample link opened again: " + tag);
  assert.deepEqual(sent[1].body.to, [CONTACT]);
  assert.equal(textOf(sent[1].body.html), "Opened again: Tue, Oct 20, 2026, 11:00 AM EDT " +
    "Search your Sent mail for " + tag + " to find the thread.");
  clock.now = T0 + 20 * DAY;
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(sent.length, 2, "the next open, even weeks later, sends nothing");
  const v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 5);
  assert.equal(v.alerted_first, new Date(T0).toISOString());
  assert.equal(v.alerted_again, new Date(T0 + 2 * HOUR + 6 * DAY).toISOString());
});

test("alert: a failing Resend call leaves the page at 200, its headers unchanged, and the counter bumped", async (t) => {
  const base = live();
  const clean = await call(base.code, { bucket: base.bucket });
  for (const status of [500, 0]) {
    await t.test("resend " + (status || "throws"), async (st) => {
      const sent = mailbox(st, status);
      const { bucket, code } = live();
      const r = await call(code, { bucket, env: MAIL_ENV });
      assert.equal(sent.length, 1);
      assert.equal(r.res.status, 200);
      assert.equal(r.body, SAMPLE);
      assert.deepEqual(headerMap(r.res), headerMap(clean.res));
      assert.deepEqual(r.settled.map((s) => s.status), ["fulfilled"], "the waitUntil promise never rejects");
      assert.equal(bucket.json(viewsKey(code)).opens, 1);
      // the claim stands: a failed send is not retried on the next open
      await call(code, { bucket, env: MAIL_ENV });
      assert.equal(sent.length, 1);
      assert.equal(bucket.json(viewsKey(code)).opens, 2);
    });
  }
});

test("alert: no header, query, path or environment value can steer the recipient", async (t) => {
  const sent = mailbox(t);
  const evil = "attacker" + AT + "example.net";
  const { bucket, code } = live();
  const headers = { ...BROWSER, "to": evil, "x-owner-email": evil, "reply-to": evil, "from": evil,
    "x-forwarded-for": evil, "cookie": "to=" + evil };
  const env = { ...MAIL_ENV, OWNER_EMAIL: evil, TO_EMAIL: evil, ALERT_EMAIL: evil, NOTIFY_EMAIL: evil };
  const r = await call(code, { bucket, env, headers, query: "?to=" + encodeURIComponent(evil) + "&email=" + evil,
    params: { code, to: evil } });
  assert.equal(r.res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, [CONTACT]);
  assert.ok(!JSON.stringify(sent[0].body).includes("attacker"));
  // a path with anything after the code is not a code, so it is a 404 and sends nothing
  await call(code + "/" + evil, { env: MAIL_ENV, bucket });
  assert.equal(sent.length, 1);
});

test("alert: two first opens racing on the etag still send exactly one email", async (t) => {
  const sent = mailbox(t);
  const { bucket, code } = live();
  let release;
  bucket.putGate = new Promise((r) => { release = r; });
  const both = Promise.all([call(code, { bucket, env: MAIL_ENV }), call(code, { bucket, env: MAIL_ENV })]);
  // Hold every put until both writers have read the (missing) views object.
  while (bucket.ops.filter((o) => o[0] === "get" && o[1] === viewsKey(code)).length < 2) {
    await new Promise((r) => setImmediate(r));
  }
  release();
  const [a, b] = await both;
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  assert.ok(bucket.conflicts >= 1, "the second writer hit the precondition");
  assert.equal(sent.length, 1, "exactly one alert");
  const v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 2, "the loser re-read and still counted");
  assert.match(v.alerted_first, ISO);
});

test("alert: a conflict from a scanner write is re-read and the open still alerts once", async (t) => {
  const sent = mailbox(t);
  const { bucket, code } = live();
  const realPut = bucket.put.bind(bucket);
  let injected = false;
  bucket.put = async (key, value, opts) => {
    if (!injected && key === viewsKey(code)) {
      injected = true;
      // another request's scanner hit lands between our read and our write
      await realPut(key, JSON.stringify({ first_open: null, last_open: null, opens: 0, scanner_hits: 1,
        first_hit: "2026-10-01T00:00:00.000Z", last_hit: "2026-10-01T00:00:00.000Z" }), {});
    }
    return realPut(key, value, opts);
  };
  await call(code, { bucket, env: MAIL_ENV });
  assert.equal(bucket.conflicts, 1);
  assert.equal(sent.length, 1);
  const v = bucket.json(viewsKey(code));
  assert.equal(v.opens, 1);
  assert.equal(v.scanner_hits, 1, "the other writer's count survived");
  assert.match(v.alerted_first, ISO);
  // every views write is conditional
  const opts = bucket.objects.get(viewsKey(code)).opts;
  assert.equal(typeof opts.onlyIf.etagMatches, "string");
});

test("alert: without RESEND_API_KEY or FROM_EMAIL nothing is sent or claimed", async (t) => {
  const sent = mailbox(t);
  for (const env of [{}, { RESEND_API_KEY: MAIL_ENV.RESEND_API_KEY }, { FROM_EMAIL: MAIL_ENV.FROM_EMAIL }]) {
    const { bucket, code } = live();
    await call(code, { bucket, env });
    const v = bucket.json(viewsKey(code));
    assert.deepEqual(Object.keys(v), FIELDS);
    assert.equal(v.opens, 1);
  }
  assert.equal(sent.length, 0);
});

test("alert: clean() keeps well-formed alert times and drops malformed ones", async (t) => {
  const sent = mailbox(t);
  const { bucket, code } = liveAt(t, T0);
  bucket.seed(viewsKey(code), JSON.stringify({ first_open: "2026-10-01T00:00:00.000Z",
    last_open: "2026-10-13T00:00:00.000Z", opens: 3, scanner_hits: 0, first_hit: "2026-10-01T00:00:00.000Z",
    last_hit: "2026-10-13T00:00:00.000Z", alerted_first: "2026-10-01T00:00:00.000Z", alerted_again: "soon" }), T0);
  await call(code, { bucket, env: MAIL_ENV });
  const v = bucket.json(viewsKey(code));
  assert.equal(v.alerted_first, "2026-10-01T00:00:00.000Z");
  assert.equal(v.alerted_again, undefined, "a malformed time is dropped");
  assert.equal(sent.length, 0, "13 hours after the previous open is not a re-open alert");
});

// ---- copy rules ----------------------------------------------------------------
test("no em or en dash in any page a visitor can read, or anywhere in the Function", async () => {
  const pages = [];
  pages.push((await call("bad")).body);
  pages.push((await call(newCode())).body);
  const old = live(31 * DAY);
  pages.push((await call(old.code, { bucket: old.bucket })).body);
  const e = live();
  e.bucket.failGet = () => true;
  pages.push((await call(e.code, { bucket: e.bucket })).body);
  const p = live();
  pages.push((await call(p.code, { bucket: p.bucket, method: "POST", handler: fn.onRequest })).body);
  assert.equal(pages.length, 5);
  for (const html of pages) {
    assert.ok(html && html.length < 2000, "short page");
    assert.ok(!DASH.test(html), html);
    assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/);
  }
  assert.ok(!DASH.test(fs.readFileSync(path.join(REPO, SHIPPED), "utf8")), "shipped file is dash-free, comments included");
});

test("the Function names no one: its only email address is the public contact", () => {
  const src = fs.readFileSync(path.join(REPO, SHIPPED), "utf8");
  const found = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || [];
  assert.ok(found.length > 0);
  assert.deepEqual([...new Set(found)], [CONTACT]);
  // no code-shaped literal (a real code would be a live credential in a public repo)
  const literals = src.match(/["'`][a-z2-7]{20}["'`]/g) || [];
  assert.deepEqual(literals, []);
});
