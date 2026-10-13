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
//    waitUntil, failure-silent, and storing no IP, user-agent, referrer or
//    email;
//  * no em or en dash in anything a visitor can read.
//
// Safety: nothing leaves this machine. R2 is an in-memory Map, there is no
// fetch, and the Function is imported from a temp copy (the shipped file is
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
  "content-security-policy": "frame-ancestors 'none'",
};

// ---- fake R2 -----------------------------------------------------------------
class FakeBucket {
  constructor() {
    this.objects = new Map();
    this.ops = [];
    this.failGet = null; // (key) => boolean
    this.failPut = null;
    this.cancelled = 0;
  }
  seed(key, body, uploadedMs) {
    this.objects.set(key, { body: String(body), uploaded: new Date(uploadedMs) });
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
      key, size: Buffer.byteLength(o.body), uploaded: o.uploaded, body: stream,
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
    if (this.failPut && this.failPut(key)) throw new Error("R2 put refused");
    this.objects.set(key, { body: String(value), uploaded: new Date(), opts });
    return { key };
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
  waitUntil = true, params } = {}) {
  const request = new Request("https://masspermits.com/s/" + encodeURIComponent(String(code)),
    { method, headers });
  const waits = [];
  const context = { request, env: { BUNDLES: bucket }, params: params || { code }, next: async () => null };
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
  assert.equal(res.headers.get("content-security-policy").includes("script-src"), false,
    "the sample is interactive: no script policy");
  assert.equal(res.headers.get("allow"), null);
  const sampleReads = bucket.ops.filter((o) => o[1] === sampleKey(code));
  assert.deepEqual(sampleReads, [["get", sampleKey(code)]]);
  assert.ok(bucket.ops.every((o) => o[1] === sampleKey(code) || o[1] === viewsKey(code)),
    "no other key is reached: " + JSON.stringify(bucket.ops));
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
